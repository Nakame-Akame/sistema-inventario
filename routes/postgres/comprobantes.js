const express = require('express');
const router = express.Router();
const db = require('../../database-postgres');
const { tienePermiso, requierePermiso } = require('../../middleware/permisos');
const {
  ErrorValidacion,
  TIPOS,
  aCentimos,
  crearComprobante,
  cambiarEstadoComprobante,
} = require('../../services/comprobantes-postgres');

const METODOS_COBRO = new Set(['efectivo', 'transferencia', 'tarjeta', 'otro', 'yape', 'bcp']);

router.get('/', requierePermiso('comprobantes:ver'), async (req, res) => {
  try {
    const filtros = [];
    const values = [];
    for (const [field, param] of [['tipo', 'tipo'], ['fecha_desde', 'fecha_desde'], ['fecha_hasta', 'fecha_hasta']]) {
      const value = req.query[param];
      if (typeof value !== 'string' || !value) continue;
      values.push(value);
      if (field === 'tipo') filtros.push(`c.tipo = $${values.length}`);
      else if (field === 'fecha_desde') filtros.push(`c.fecha::date >= $${values.length}::date`);
      else filtros.push(`c.fecha::date <= $${values.length}::date`);
    }
    const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
    const result = await db.query(`
      SELECT c.*, cl.nombre AS cliente_nombre, cl.documento AS cliente_documento,
        s.serie AS serie_actual, COALESCE(pagos.monto_cobrado, 0) AS monto_cobrado,
        CASE WHEN c.estado = 'pagado' THEN 0
          ELSE ROUND(GREATEST(0, c.total - COALESCE(pagos.monto_cobrado, 0))::numeric, 2)
        END AS saldo_pendiente
      FROM comprobantes c
      JOIN clientes cl ON cl.id = c.cliente_id
      JOIN series s ON s.tipo = c.tipo
      LEFT JOIN (
        SELECT comprobante_id, ROUND(SUM(monto)::numeric, 2) AS monto_cobrado
        FROM pagos_comprobante GROUP BY comprobante_id
      ) pagos ON pagos.comprobante_id = c.id
      ${where}
      ORDER BY c.fecha DESC
    `, values);
    res.json({ ok: true, data: result.rows });
  } catch {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.get('/meta/tipos', requierePermiso('comprobantes:ver'), async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM series ORDER BY id');
    res.json({ ok: true, data: rows.map(serie => ({
      tipo: serie.tipo,
      serie: serie.serie,
      ultimo_numero: serie.ultimo_numero,
      label: TIPOS[serie.tipo]?.label || serie.tipo,
      afecta_igv: TIPOS[serie.tipo]?.afecta_igv,
      mueve_stock: TIPOS[serie.tipo]?.mueve_stock,
    })) });
  } catch {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.get('/:id', requierePermiso('comprobantes:ver'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT c.*, cl.nombre AS cliente_nombre, cl.documento AS cliente_documento,
        cl.tipo_documento, cl.direccion AS cliente_direccion, cl.email AS cliente_email,
        cl.telefono AS cliente_telefono, cr.serie AS ref_serie, cr.numero AS ref_numero,
        cr.tipo AS ref_tipo
      FROM comprobantes c
      JOIN clientes cl ON cl.id = c.cliente_id
      LEFT JOIN comprobantes cr ON cr.id = c.comprobante_ref_id
      WHERE c.id = $1
    `, [req.params.id]);
    const comp = result.rows[0];
    if (!comp) return res.status(404).json({ ok: false, error: 'Comprobante no encontrado' });
    const [detalleResult, pagosResult] = await Promise.all([
      db.query(`
        SELECT d.*, p.nombre AS producto_nombre
        FROM detalle_comprobante d LEFT JOIN productos p ON p.id = d.producto_id
        WHERE d.comprobante_id = $1
      `, [req.params.id]),
      db.query(`
        SELECT monto, fecha_pago, metodo_pago, referencia
        FROM pagos_comprobante WHERE comprobante_id = $1
        ORDER BY fecha_pago ASC, id ASC
      `, [req.params.id]),
    ]);
    const montoCobrado = Number(pagosResult.rows.reduce((sum, pago) => sum + Number(pago.monto), 0).toFixed(2));
    res.json({ ok: true, data: {
      ...comp,
      detalle: detalleResult.rows,
      pagos: pagosResult.rows,
      monto_cobrado: montoCobrado,
      saldo_pendiente: comp.estado === 'pagado'
        ? 0
        : Math.max(0, Number((Number(comp.total) - montoCobrado).toFixed(2))),
    } });
  } catch {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.post('/', async (req, res) => {
  const tipo = req.body?.tipo;
  if (!TIPOS[tipo]) return res.status(400).json({ ok: false, error: 'Tipo de comprobante inválido' });
  const permisoTipo = tipo === 'nota_devolucion' ? 'comprobantes:devolver' : `comprobantes:crear_${tipo}`;
  if (!tienePermiso(req.session.usuario.rol, permisoTipo, req.session.usuario.permisos)) {
    return res.status(403).json({
      ok: false,
      error: `Tu rol no puede crear comprobantes de tipo: ${TIPOS[tipo].label}`,
    });
  }
  try {
    const comprobante = await crearComprobante(req.body);
    res.status(201).json({
      ok: true,
      ...comprobante,
      mensaje: `${TIPOS[tipo].label} ${comprobante.numero} creada exitosamente`,
    });
  } catch (error) {
    const status = error instanceof ErrorValidacion ? error.status : 500;
    if (status === 500) console.error('Error al crear comprobante:', error);
    res.status(status).json({
      ok: false,
      error: status === 500 ? 'Error interno del servidor' : error.message,
    });
  }
});

router.post('/:id/pagos', requierePermiso('comprobantes:pagar'), async (req, res) => {
  const id = Number(req.params.id);
  const monto = Number(req.body?.monto);
  const fechaPago = req.body?.fecha_pago;
  const metodoPago = String(req.body?.metodo_pago || '').trim().toLowerCase();
  const referencia = String(req.body?.referencia || '').trim();
  let centavos;
  try {
    centavos = aCentimos(req.body?.monto, 'El monto');
  } catch {
    centavos = -1;
  }
  const fecha = typeof fechaPago === 'string' ? new Date(`${fechaPago}T00:00:00.000Z`) : null;
  if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(monto) || monto <= 0 ||
      centavos <= 0 || !fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fechaPago) ||
      !Number.isFinite(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== fechaPago ||
      !METODOS_COBRO.has(metodoPago) || referencia.length > 100) {
    return res.status(400).json({ ok: false, error: 'Datos del cobro no válidos.' });
  }

  try {
    const data = await db.transaction(async client => {
      const result = await client.query(`
        SELECT id, tipo, total, condicion_pago, estado
        FROM comprobantes WHERE id = $1 FOR UPDATE
      `, [id]);
      const comprobante = result.rows[0];
      if (!comprobante) throw new ErrorValidacion('Comprobante no encontrado', 404);
      if (!['factura', 'boleta'].includes(comprobante.tipo) || comprobante.condicion_pago !== 'credito') {
        throw new ErrorValidacion('Solo se aceptan cobros de facturas o boletas a crédito', 409);
      }
      if (!['emitido', 'parcial'].includes(comprobante.estado)) {
        throw new ErrorValidacion('El comprobante no admite más cobros', 409);
      }
      const totalCentimos = Math.round(Number(comprobante.total) * 100);
      const paid = await client.query(
        'SELECT COALESCE(SUM(monto), 0) AS total FROM pagos_comprobante WHERE comprobante_id = $1',
        [id],
      );
      const cobradoCentimos = Math.round(Number(paid.rows[0].total) * 100);
      const saldoCentimos = Math.max(0, totalCentimos - cobradoCentimos);
      if (centavos > saldoCentimos) throw new ErrorValidacion('El cobro no puede superar el saldo pendiente');

      await client.query(`
        INSERT INTO pagos_comprobante
          (comprobante_id, monto, fecha_pago, metodo_pago, referencia, usuario_id)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [id, centavos / 100, fechaPago, metodoPago, referencia || null, req.session?.usuario?.id || null]);
      const nuevoCobrado = cobradoCentimos + centavos;
      const saldoRestante = totalCentimos - nuevoCobrado;
      const estado = saldoRestante === 0 ? 'pagado' : 'parcial';
      await client.query(
        'UPDATE comprobantes SET estado = $1, fecha_pago = $2 WHERE id = $3',
        [estado, fechaPago, id],
      );
      return {
        comprobante_id: id,
        estado,
        total: totalCentimos / 100,
        monto_cobrado: nuevoCobrado / 100,
        saldo_pendiente: saldoRestante / 100,
      };
    });
    res.status(201).json({ ok: true, data });
  } catch (error) {
    const status = error instanceof ErrorValidacion ? error.status : 500;
    res.status(status).json({
      ok: false,
      error: status === 500 ? 'No se pudo registrar el cobro.' : error.message,
    });
  }
});

router.patch('/:id/estado', (req, res, next) => {
  const { estado } = req.body;
  const permiso = estado === 'anulado'
    ? 'comprobantes:anular'
    : estado === 'pagado' ? 'comprobantes:pagar' : 'comprobantes:estado';
  return requierePermiso(permiso)(req, res, next);
}, async (req, res) => {
  try {
    const cambio = await cambiarEstadoComprobante(req.params.id, req.body?.estado);
    res.json({ ok: true, mensaje: `Comprobante marcado como ${cambio.estado}` });
  } catch (error) {
    const status = error instanceof ErrorValidacion ? error.status : 500;
    res.status(status).json({
      ok: false,
      error: status === 500 ? 'Error interno del servidor' : error.message,
    });
  }
});

module.exports = router;
