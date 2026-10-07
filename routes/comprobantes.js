const express = require('express');
const router = express.Router();
const db = require('../database');
const METODOS_COBRO = new Set(['efectivo', 'transferencia', 'tarjeta', 'otro', 'yape', 'bcp']);
const { tienePermiso, requierePermiso } = require('../middleware/permisos');
const {
  ErrorValidacion,
  TIPOS,
  crearComprobante,
  cambiarEstadoComprobante,
} = require('../services/comprobantes');

// ─── LISTAR ───────────────────────────────────────────────
// GET /api/comprobantes?tipo=factura
router.get('/', requierePermiso('comprobantes:ver'), (req, res) => {
  try {
    const { tipo, fecha_desde, fecha_hasta } = req.query;
    let query = `
      SELECT c.*, cl.nombre as cliente_nombre, cl.documento as cliente_documento,
             s.serie as serie_actual,
             COALESCE(pagos.monto_cobrado, 0) AS monto_cobrado,
             CASE WHEN c.estado = 'pagado' THEN 0
               ELSE ROUND(MAX(0, c.total - COALESCE(pagos.monto_cobrado, 0)), 2)
             END AS saldo_pendiente
      FROM comprobantes c
      JOIN clientes cl ON c.cliente_id = cl.id
      JOIN series s ON s.tipo = c.tipo
      LEFT JOIN (
        SELECT comprobante_id, ROUND(SUM(monto), 2) AS monto_cobrado
        FROM pagos_comprobante GROUP BY comprobante_id
      ) pagos ON pagos.comprobante_id = c.id
    `;
    const filtros = [];
    const params = [];

    if (tipo) {
      filtros.push('c.tipo = ?');
      params.push(tipo);
    }
    if (fecha_desde) {
      filtros.push('DATE(c.fecha) >= DATE(?)');
      params.push(fecha_desde);
    }
    if (fecha_hasta) {
      filtros.push('DATE(c.fecha) <= DATE(?)');
      params.push(fecha_hasta);
    }
    if (filtros.length) query += ` WHERE ${filtros.join(' AND ')}`;

    query += ' ORDER BY c.fecha DESC';
    const data = db.prepare(query).all(...params);
    res.json({ ok: true, data });
  } catch (err) {
    console.error('Error al listar comprobantes:', err);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// ─── LISTAR TIPOS DISPONIBLES ─────────────────────────────
router.get('/meta/tipos', requierePermiso('comprobantes:ver'), (req, res) => {
  const series = db.prepare('SELECT * FROM series').all();
  const data = series.map(s => ({
    tipo: s.tipo,
    serie: s.serie,
    ultimo_numero: s.ultimo_numero,
    label: TIPOS[s.tipo]?.label || s.tipo,
    afecta_igv: TIPOS[s.tipo]?.afecta_igv,
    mueve_stock: TIPOS[s.tipo]?.mueve_stock,
  }));
  res.json({ ok: true, data });
});

// ─── VER UNO ──────────────────────────────────────────────
router.get('/:id', requierePermiso('comprobantes:ver'), (req, res) => {
  try {
    const comp = db.prepare(`
      SELECT c.*, cl.nombre as cliente_nombre, cl.documento as cliente_documento,
             cl.tipo_documento, cl.direccion as cliente_direccion,
             cl.email as cliente_email, cl.telefono as cliente_telefono,
             cr.serie as ref_serie, cr.numero as ref_numero, cr.tipo as ref_tipo
      FROM comprobantes c
      JOIN clientes cl ON c.cliente_id = cl.id
      LEFT JOIN comprobantes cr ON c.comprobante_ref_id = cr.id
      WHERE c.id = ?
    `).get(req.params.id);
    if (!comp) return res.status(404).json({ ok: false, error: 'Comprobante no encontrado' });

    const detalle = db.prepare(`
      SELECT d.*, p.nombre as producto_nombre
      FROM detalle_comprobante d
      LEFT JOIN productos p ON d.producto_id = p.id
      WHERE d.comprobante_id = ?
    `).all(req.params.id);

    const pagos = db.prepare(`
      SELECT monto, fecha_pago, metodo_pago, referencia
      FROM pagos_comprobante
      WHERE comprobante_id = ?
      ORDER BY fecha_pago ASC, id ASC
    `).all(req.params.id);

    const montoCobrado = Number(pagos.reduce((total, pago) => total + Number(pago.monto), 0).toFixed(2));
    res.json({
      ok: true,
      data: {
        ...comp,
        detalle,
        pagos,
        monto_cobrado: montoCobrado,
        saldo_pendiente: comp.estado === 'pagado'
          ? 0
          : Math.max(0, Number((Number(comp.total) - montoCobrado).toFixed(2))),
      },
    });
  } catch (err) {
    console.error('Error al consultar comprobante:', err);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// ─── CREAR ────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const tipo = req.body?.tipo;
    if (!TIPOS[tipo]) return res.status(400).json({ ok: false, error: 'Tipo de comprobante inválido' });
    const permisoTipo = tipo === 'nota_devolucion'
      ? 'comprobantes:devolver'
      : `comprobantes:crear_${tipo}`;
    if (!tienePermiso(req.session.usuario.rol, permisoTipo, req.session.usuario.permisos)) {
      return res.status(403).json({
        ok: false,
        error: `Tu rol no puede crear comprobantes de tipo: ${TIPOS[tipo].label}`
      });
    }

    const comprobante = crearComprobante(db, req.body);
    res.status(201).json({
      ok: true,
      ...comprobante,
      mensaje: `${TIPOS[tipo].label} ${comprobante.numero} creada exitosamente`
    });

  } catch (err) {
    const status = err instanceof ErrorValidacion ? err.status : 500;
    if (status === 500) console.error('Error al crear comprobante:', err);
    res.status(status).json({
      ok: false,
      error: status === 500 ? 'Error interno del servidor' : err.message,
    });
  }
});

router.post('/:id/pagos', requierePermiso('comprobantes:pagar'), (req, res) => {
  const id = Number(req.params.id);
  const monto = Number(req.body?.monto);
  const fechaPago = req.body?.fecha_pago;
  const metodoPago = String(req.body?.metodo_pago || '').trim().toLowerCase();
  const referencia = String(req.body?.referencia || '').trim();
  const centavos = Math.round(monto * 100);
  const fecha = typeof fechaPago === 'string' ? new Date(`${fechaPago}T00:00:00.000Z`) : null;
  if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(monto) || monto <= 0 ||
      Math.abs(monto * 100 - centavos) > 1e-7 || !fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fechaPago) ||
      !Number.isFinite(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== fechaPago ||
      !METODOS_COBRO.has(metodoPago) || referencia.length > 100) {
    return res.status(400).json({ ok: false, error: 'Datos del cobro no válidos.' });
  }

  try {
    const data = db.transaction(() => {
      const comprobante = db.prepare(`
        SELECT id, tipo, total, condicion_pago, estado
        FROM comprobantes WHERE id = ?
      `).get(id);
      if (!comprobante) throw new ErrorValidacion('Comprobante no encontrado', 404);
      if (!['factura', 'boleta'].includes(comprobante.tipo) || comprobante.condicion_pago !== 'credito') {
        throw new ErrorValidacion('Solo se aceptan cobros de facturas o boletas a crédito', 409);
      }
      if (!['emitido', 'parcial'].includes(comprobante.estado)) {
        throw new ErrorValidacion('El comprobante no admite más cobros', 409);
      }

      const totalCentimos = Math.round(Number(comprobante.total) * 100);
      const cobradoCentimos = Math.round(Number(db.prepare(`
        SELECT COALESCE(SUM(monto), 0) AS total
        FROM pagos_comprobante WHERE comprobante_id = ?
      `).get(id).total) * 100);
      const saldoCentimos = Math.max(0, totalCentimos - cobradoCentimos);
      if (centavos > saldoCentimos) {
        throw new ErrorValidacion('El cobro no puede superar el saldo pendiente');
      }

      db.prepare(`
        INSERT INTO pagos_comprobante
          (comprobante_id, monto, fecha_pago, metodo_pago, referencia, usuario_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, monto, fechaPago, metodoPago, referencia || null, req.session?.usuario?.id || null);

      const nuevoCobrado = cobradoCentimos + centavos;
      const saldoRestante = totalCentimos - nuevoCobrado;
      const estado = saldoRestante === 0 ? 'pagado' : 'parcial';
      const actualizacion = db.prepare(`
        UPDATE comprobantes SET estado = ?, fecha_pago = ?
        WHERE id = ? AND estado = ?
      `).run(estado, fechaPago, id, comprobante.estado);
      if (actualizacion.changes !== 1) throw new Error('El estado del comprobante cambió durante el cobro.');

      return {
        comprobante_id: id,
        estado,
        total: totalCentimos / 100,
        monto_cobrado: nuevoCobrado / 100,
        saldo_pendiente: saldoRestante / 100,
      };
    })();
    res.status(201).json({ ok: true, data });
  } catch (error) {
    const status = error instanceof ErrorValidacion ? error.status : 500;
    res.status(status).json({
      ok: false,
      error: status === 500 ? 'No se pudo registrar el cobro.' : error.message,
    });
  }
});

// ─── CAMBIAR ESTADO ───────────────────────────────────────
router.patch('/:id/estado', (req, res, next) => {
  const { estado } = req.body;
  const permiso = estado === 'anulado'
    ? 'comprobantes:anular'
    : estado === 'pagado'
      ? 'comprobantes:pagar'
      : 'comprobantes:estado';
  return requierePermiso(permiso)(req, res, next);
}, (req, res) => {
  try {
    const cambio = cambiarEstadoComprobante(db, req.params.id, req.body?.estado);
    res.json({ ok: true, mensaje: `Comprobante marcado como ${cambio.estado}` });
  } catch (err) {
    const status = err instanceof ErrorValidacion ? err.status : 500;
    res.status(status).json({
      ok: false,
      error: status === 500 ? 'Error interno del servidor' : err.message,
    });
  }
});

module.exports = router;