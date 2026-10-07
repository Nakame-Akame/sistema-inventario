const express = require('express');
const db = require('../../database-postgres');
const { requierePermiso } = require('../../middleware/permisos');

const router = express.Router();
const TIPOS_MOVIMIENTO = new Set([
  'ENTRADA',
  'SALIDA',
  'VENTA',
  'COMPRA',
  'DEVOLUCION',
  'AJUSTE',
  'TRANSFERENCIA'
]);

function parseCantidad(valor, nombreCampo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero === 0) {
    throw new Error(`${nombreCampo} debe ser un número válido y distinto de cero.`);
  }
  return Math.trunc(numero);
}

function fechaISOValida(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return Number.isFinite(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

function movimientoAfectaStock(tipo) {
  return ['ENTRADA', 'COMPRA', 'DEVOLUCION', 'AJUSTE', 'SALIDA', 'VENTA'].includes(tipo);
}

function calcularDelta(tipo, cantidad) {
  if (tipo === 'TRANSFERENCIA') return 0;
  if (['ENTRADA', 'COMPRA', 'DEVOLUCION'].includes(tipo)) return cantidad;
  if (tipo === 'AJUSTE') return cantidad;
  return -cantidad;
}

router.get('/almacenes', requierePermiso('inventario:ver'), async (req, res) => {
  try {
    const rows = (await db.query(
      'SELECT * FROM almacenes WHERE activo = 1 ORDER BY nombre ASC'
    , [])).rows;
    res.json({ ok: true, data: rows });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

router.post('/almacenes', requierePermiso('inventario:gestionar'), async (req, res) => {
  try {
    const nombre = String(req.body?.nombre || '').trim();
    const codigo = String(req.body?.codigo || '').trim();

    if (!nombre || !codigo) {
      return res.status(400).json({ ok: false, message: 'Nombre y código son obligatorios.' });
    }

    const existing = (await db.query('SELECT id FROM almacenes WHERE codigo = $1', [codigo.toUpperCase()])).rows[0];
    if (existing) {
      return res.status(409).json({ ok: false, message: 'Ya existe un almacén con ese código.' });
    }

    const result = (await db.query(
      'INSERT INTO almacenes (nombre, codigo, tipo, activo) VALUES ($1, $2, $3, 1) RETURNING id'
    , [nombre, codigo.toUpperCase(), String(req.body?.tipo || 'principal')]));

    const almacen = (await db.query('SELECT * FROM almacenes WHERE id = $1', [result.rows[0].id])).rows[0];
    res.status(201).json({ ok: true, id: almacen.id, nombre: almacen.nombre, codigo: almacen.codigo, tipo: almacen.tipo, activo: almacen.activo });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

router.get('/kardex', requierePermiso('inventario:ver'), async (req, res) => {
  try {
    const productoId = req.query.producto_id ? Number(req.query.producto_id) : null;
    const almacenId = req.query.almacen_id ? Number(req.query.almacen_id) : null;
    const { desde, hasta } = req.query;
    const tipo = req.query.tipo ? String(req.query.tipo).trim().toUpperCase() : null;

    if ((productoId !== null && (!Number.isInteger(productoId) || productoId <= 0)) ||
        (almacenId !== null && (!Number.isInteger(almacenId) || almacenId <= 0))) {
      return res.status(400).json({ ok: false, message: 'Los identificadores de producto o almacén no son válidos.' });
    }
    if ((desde !== undefined && !fechaISOValida(desde)) || (hasta !== undefined && !fechaISOValida(hasta))) {
      return res.status(400).json({ ok: false, message: 'Las fechas deben tener formato YYYY-MM-DD y ser válidas.' });
    }
    if (desde && hasta && desde > hasta) {
      return res.status(400).json({ ok: false, message: 'La fecha desde no puede ser posterior a la fecha hasta.' });
    }
    if (tipo && !TIPOS_MOVIMIENTO.has(tipo)) {
      return res.status(400).json({ ok: false, message: 'Tipo de movimiento no válido.' });
    }

    const condiciones = [];
    const parametros = [];
    if (productoId !== null) {
      condiciones.push(`km.producto_id = $${parametros.length + 1}`);
      parametros.push(productoId);
    }
    if (almacenId !== null) {
      condiciones.push(`km.almacen_id = $${parametros.length + 1}`);
      parametros.push(almacenId);
    }
    if (tipo) {
      condiciones.push(`km.tipo = $${parametros.length + 1}`);
      parametros.push(tipo);
    }
    if (desde) {
      condiciones.push(`km.fecha::date >= $${parametros.length + 1}::date`);
      parametros.push(desde);
    }
    if (hasta) {
      condiciones.push(`km.fecha::date <= $${parametros.length + 1}::date`);
      parametros.push(hasta);
    }

    const rows = (await db.query(`
      SELECT
        km.*,
        p.nombre AS producto_nombre,
        a.nombre AS almacen_nombre
      FROM kardex_movimientos km
      INNER JOIN productos p ON p.id = km.producto_id
      LEFT JOIN almacenes a ON a.id = km.almacen_id
      ${condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''}
      ORDER BY km.fecha ASC, km.id ASC
    `, parametros)).rows;

    res.json({ ok: true, data: rows });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

router.get('/resumen', requierePermiso('inventario:ver'), async (req, res) => {
  try {
    const totalProductos = (await db.query('SELECT COUNT(*)::int AS total FROM productos', [])).rows[0].total;
    const stockTotal = (await db.query('SELECT COALESCE(SUM(stock), 0) AS total FROM productos', [])).rows[0].total;
    const valorTotal = (await db.query('SELECT COALESCE(SUM(stock * COALESCE(precio_compra, 0)), 0) AS total FROM productos', [])).rows[0].total;

    const alertas = (await db.query(`
      SELECT id, nombre, stock, stock_minimo, precio_compra, categoria,
             COALESCE(stock_minimo, 0) AS umbral
      FROM productos
      WHERE stock <= COALESCE(stock_minimo, 0) OR stock <= 5
      ORDER BY stock ASC, nombre ASC
    `, [])).rows;

    const porAlmacen = (await db.query(`
      WITH ultimo_movimiento AS (
        SELECT producto_id, almacen_id, MAX(id) AS ultimo_id
        FROM kardex_movimientos
        GROUP BY producto_id, almacen_id
      ),
      stock_almacen AS (
        SELECT km.producto_id, km.almacen_id, km.stock_posterior AS stock_actual
        FROM kardex_movimientos km
        JOIN ultimo_movimiento um ON um.ultimo_id = km.id
      )
      SELECT a.id AS almacen_id,
             a.nombre AS almacen_nombre,
             COALESCE(SUM(CASE WHEN sa.stock_actual IS NULL THEN p.stock ELSE sa.stock_actual END), 0) AS total_stock,
             COALESCE(SUM(CASE WHEN sa.stock_actual IS NULL THEN p.stock * COALESCE(p.precio_compra, 0) ELSE sa.stock_actual * COALESCE(p.precio_compra, 0) END), 0) AS total_valor
      FROM almacenes a
      LEFT JOIN stock_almacen sa ON sa.almacen_id = a.id
      LEFT JOIN productos p ON p.id = sa.producto_id
      WHERE a.activo = 1
      GROUP BY a.id, a.nombre
      ORDER BY a.nombre ASC
    `, [])).rows;

    res.json({
      ok: true,
      data: {
        total_productos: totalProductos,
        stock_total: Number(stockTotal) || 0,
        valor_total: Number(valorTotal) || 0,
        alertas,
        por_almacen: porAlmacen.map(item => ({
          almacen_id: item.almacen_id,
          almacen_nombre: item.almacen_nombre,
          total_stock: Number(item.total_stock) || 0,
          total_valor: Number(item.total_valor) || 0,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

router.post('/movimientos', requierePermiso('inventario:gestionar'), async (req, res) => {
  try {
    const tipo = String(req.body?.tipo || '').trim().toUpperCase();
    const productoId = Number(req.body?.producto_id);
    const almacenId = Number(req.body?.almacen_id);
    const origenAlmacenId = Number(req.body?.origen_almacen_id);
    const destinoAlmacenId = Number(req.body?.destino_almacen_id);
    const documentoRelacionado = String(req.body?.documento_relacionado || '').trim();
    const observacion = String(req.body?.observacion || '').trim();

    if (!TIPOS_MOVIMIENTO.has(tipo)) {
      return res.status(400).json({ ok: false, message: 'Tipo de movimiento no válido.' });
    }

    if (!Number.isInteger(productoId) || productoId <= 0) {
      return res.status(400).json({ ok: false, message: 'producto_id no válido.' });
    }

    const cantidad = parseCantidad(req.body?.cantidad, 'cantidad');
    const producto = (await db.query('SELECT id, nombre, stock, precio_compra FROM productos WHERE id = $1', [productoId])).rows[0];
    if (!producto) {
      return res.status(404).json({ ok: false, message: 'Producto no encontrado.' });
    }

    const costoUnitario = Number(req.body?.costo_unitario ?? producto.precio_compra ?? 0);
    if (!Number.isFinite(costoUnitario) || costoUnitario < 0) {
      return res.status(400).json({ ok: false, message: 'costo_unitario no válido.' });
    }

    let almacenUsadoId = null;
    if (tipo === 'TRANSFERENCIA') {
      if (!Number.isInteger(origenAlmacenId) || origenAlmacenId <= 0 || !Number.isInteger(destinoAlmacenId) || destinoAlmacenId <= 0) {
        return res.status(400).json({ ok: false, message: 'origen_almacen_id y destino_almacen_id son obligatorios para transferencias.' });
      }
      if (origenAlmacenId === destinoAlmacenId) {
        return res.status(400).json({ ok: false, message: 'El almacén origen y destino deben ser distintos.' });
      }
      almacenUsadoId = origenAlmacenId;
    } else {
      if (!Number.isInteger(almacenId) || almacenId <= 0) {
        return res.status(400).json({ ok: false, message: 'almacen_id no válido.' });
      }
      almacenUsadoId = almacenId;
    }

    const almacen = (await db.query('SELECT id FROM almacenes WHERE id = $1 AND activo = 1', [almacenUsadoId])).rows[0];
    if (!almacen) {
      return res.status(404).json({ ok: false, message: 'Almacén no encontrado.' });
    }

    if (tipo === 'TRANSFERENCIA') {
      const origen = (await db.query('SELECT id FROM almacenes WHERE id = $1 AND activo = 1', [origenAlmacenId])).rows[0];
      const destino = (await db.query('SELECT id FROM almacenes WHERE id = $1 AND activo = 1', [destinoAlmacenId])).rows[0];
      if (!origen || !destino) {
        return res.status(404).json({ ok: false, message: 'Los almacenes de la transferencia no existen.' });
      }
    }

    const movimiento = await db.transaction(async client => {
      const productoActual = (await client.query('SELECT id, stock, precio_compra FROM productos WHERE id = $1 FOR UPDATE', [productoId])).rows[0];
      if (!productoActual) {
        throw Object.assign(new Error('Producto no encontrado.'), { statusCode: 404 });
      }

      const stockAnterior = Number(productoActual.stock || 0);
      let delta = calcularDelta(tipo, cantidad);
      let stockPosterior = stockAnterior + delta;

      if (tipo === 'TRANSFERENCIA') {
        if (stockAnterior < cantidad) {
          throw Object.assign(new Error('Stock insuficiente para transferir entre almacenes.'), { statusCode: 400 });
        }
        stockPosterior = stockAnterior;
        delta = 0;

        const origenResult = (await client.query(`
          INSERT INTO kardex_movimientos (
            producto_id, almacen_id, tipo, cantidad, costo_unitario, stock_anterior, stock_posterior,
            documento_relacionado, observacion, usuario_id, fecha
          ) VALUES ($1, $2, 'TRANSFERENCIA', $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
          RETURNING id
        `, [productoId,
          origenAlmacenId,
          cantidad,
          costoUnitario,
          stockAnterior,
          stockPosterior,
          documentoRelacionado || null,
          observacion || null,
          req.session?.usuario?.id || null]));

        const destinoResult = (await client.query(`
          INSERT INTO kardex_movimientos (
            producto_id, almacen_id, tipo, cantidad, costo_unitario, stock_anterior, stock_posterior,
            documento_relacionado, observacion, usuario_id, fecha
          ) VALUES ($1, $2, 'TRANSFERENCIA', $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
          RETURNING id
        `, [productoId,
          destinoAlmacenId,
          cantidad,
          costoUnitario,
          stockAnterior,
          stockPosterior,
          documentoRelacionado || null,
          observacion || null,
          req.session?.usuario?.id || null]));

        return {
          id: origenResult.rows[0].id,
          producto_id: productoId,
          almacen_id: origenAlmacenId,
          tipo,
          cantidad,
          costo_unitario: costoUnitario,
          stock_anterior: stockAnterior,
          stock_posterior: stockPosterior,
          documento_relacionado: documentoRelacionado || null,
          observacion: observacion || null,
          fecha: new Date().toISOString(),
          transferencia_destino_id: destinoResult.rows[0].id,
        };
      }

      if (movimientoAfectaStock(tipo) && stockPosterior < 0) {
        throw Object.assign(new Error('Stock insuficiente para registrar este movimiento.'), { statusCode: 400 });
      }

      if (delta !== 0) {
        (await client.query('UPDATE productos SET stock = stock + $1 WHERE id = $2', [delta, productoId]));
      }

      const result = (await client.query(`
        INSERT INTO kardex_movimientos (
          producto_id, almacen_id, tipo, cantidad, costo_unitario, stock_anterior, stock_posterior,
          documento_relacionado, observacion, usuario_id, fecha
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
        RETURNING id
      `, [productoId,
        almacenUsadoId,
        tipo,
        cantidad,
        costoUnitario,
        stockAnterior,
        stockPosterior,
        documentoRelacionado || null,
        observacion || null,
        req.session?.usuario?.id || null]));

      return {
        id: result.rows[0].id,
        producto_id: productoId,
        almacen_id: almacenUsadoId,
        tipo,
        cantidad,
        costo_unitario: costoUnitario,
        stock_anterior: stockAnterior,
        stock_posterior: stockPosterior,
        documento_relacionado: documentoRelacionado || null,
        observacion: observacion || null,
        fecha: new Date().toISOString()
      };
    });

    res.status(201).json({
      ok: true,
      id: movimiento.id,
      producto_id: movimiento.producto_id,
      almacen_id: movimiento.almacen_id,
      tipo: movimiento.tipo,
      cantidad: movimiento.cantidad,
      costo_unitario: movimiento.costo_unitario,
      stock_anterior: movimiento.stock_anterior,
      stock_posterior: movimiento.stock_posterior,
      documento_relacionado: movimiento.documento_relacionado,
      observacion: movimiento.observacion,
      fecha: movimiento.fecha,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ ok: false, message: error.message });
  }
});

module.exports = router;
