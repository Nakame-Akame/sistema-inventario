const express = require('express');
const router = express.Router();
const db = require('../../database-postgres');
const XLSX = require('xlsx');
const { requierePermiso } = require('../../middleware/permisos');

router.use(requierePermiso('reportes:ver'));

// Tipos que representan una VENTA real (afectan ingresos)
const TIPOS_VENTA = ['factura', 'boleta'];
// Tipos que restan ingresos (notas de crédito y devoluciones)
const TIPOS_REVERSA = ['nota_credito_f', 'nota_credito_b', 'nota_devolucion'];

const enListaVenta = `('${TIPOS_VENTA.join("','")}')`;

function fechaISOValida(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return Number.isFinite(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

// GET - Resumen general del negocio
router.get('/resumen', async (req, res) => {
  try {
    const totalClientes = (await db.query('SELECT COUNT(*)::int as total FROM clientes', [])).rows[0];
    const totalProductos = (await db.query('SELECT COUNT(*)::int as total FROM productos', [])).rows[0];
    const totalComprobantes = (await db.query(`
      SELECT COUNT(*)::int as total FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND estado != 'anulado'
    `, [])).rows[0];

    const ventasHoy = (await db.query(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND estado != 'anulado'
        AND DATE(fecha) = CURRENT_DATE
    `, [])).rows[0];

    const ventasMes = (await db.query(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND estado != 'anulado'
        AND TO_CHAR(fecha, 'YYYY-MM') = TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM')
    `, [])).rows[0];

    const ventasTotales = (await db.query(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND estado != 'anulado'
    `, [])).rows[0];

    const stockBajo = (await db.query('SELECT COUNT(*)::int as total FROM productos WHERE stock <= 5', [])).rows[0];

    const porCobrar = (await db.query(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND estado = 'emitido'
        AND condicion_pago = 'credito'
    `, [])).rows[0];

    res.json({
      ok: true,
      data: {
        clientes: totalClientes.total,
        productos: totalProductos.total,
        facturas: totalComprobantes.total,
        ventas_hoy: parseFloat(Number(ventasHoy.total).toFixed(2)),
        ventas_mes: parseFloat(Number(ventasMes.total).toFixed(2)),
        ventas_totales: parseFloat(Number(ventasTotales.total).toFixed(2)),
        productos_stock_bajo: stockBajo.total,
        por_cobrar_credito: parseFloat(Number(porCobrar.total).toFixed(2)),
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Alertas de stock bajo para operación y reposición
router.get('/alertas-stock', async (req, res) => {
  try {
    const alertas = (await db.query(`
      SELECT
        id,
        nombre,
        categoria,
        stock,
        COALESCE(stock_minimo, 0) AS stock_minimo,
        CASE
          WHEN stock_minimo IS NULL OR stock_minimo <= 0 THEN 5
          ELSE stock_minimo
        END AS umbral,
        precio_compra
      FROM productos
      WHERE stock <= CASE
        WHEN stock_minimo IS NULL OR stock_minimo <= 0 THEN 5
        ELSE stock_minimo
      END
      ORDER BY stock ASC, nombre ASC
    `, [])).rows;

    const resumen = {
      total_alertas: alertas.length,
      umbral_predeterminado: 5,
      valor_total_critico: alertas.reduce((total, item) => total + Number(item.precio_compra || 0) * Number(item.stock || 0), 0),
    };

    res.json({ ok: true, data: alertas, resumen });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Ventas por día (últimos 30 días)
router.get('/ventas-por-dia', async (req, res) => {
  try {
    const ventas = (await db.query(`
      SELECT
        DATE(fecha) as dia,
        COUNT(*)::int as cantidad_facturas,
        ROUND((SUM(subtotal))::numeric, 2)::double precision as subtotal,
        ROUND((SUM(igv))::numeric, 2)::double precision as igv,
        ROUND((SUM(total))::numeric, 2)::double precision as total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND estado != 'anulado'
        AND fecha >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(fecha)
      ORDER BY dia DESC
    `, [])).rows;
    res.json({ ok: true, data: ventas });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Ventas por mes (último año)
router.get('/ventas-por-mes', async (req, res) => {
  try {
    const ventas = (await db.query(`
      SELECT
        TO_CHAR(fecha, 'YYYY-MM') as mes,
        COUNT(*)::int as cantidad_facturas,
        ROUND((SUM(subtotal))::numeric, 2)::double precision as subtotal,
        ROUND((SUM(igv))::numeric, 2)::double precision as igv,
        ROUND((SUM(total))::numeric, 2)::double precision as total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND estado != 'anulado'
        AND fecha >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY TO_CHAR(fecha, 'YYYY-MM')
      ORDER BY mes DESC
    `, [])).rows;
    res.json({ ok: true, data: ventas });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Productos más vendidos
router.get('/productos-mas-vendidos', async (req, res) => {
  try {
    const productos = (await db.query(`
      SELECT
        p.id,
        p.nombre,
        p.categoria,
        p.precio,
        SUM(d.cantidad) as unidades_vendidas,
        ROUND((SUM(d.subtotal))::numeric, 2)::double precision as ingresos_generados
      FROM detalle_comprobante d
      JOIN productos p ON d.producto_id = p.id
      JOIN comprobantes c ON d.comprobante_id = c.id
      WHERE c.tipo IN ${enListaVenta} AND c.estado != 'anulado'
      GROUP BY p.id
      ORDER BY unidades_vendidas DESC
      LIMIT 10
    `, [])).rows;
    res.json({ ok: true, data: productos });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Clientes que más compran
router.get('/mejores-clientes', async (req, res) => {
  try {
    const clientes = (await db.query(`
      SELECT
        cl.id,
        cl.nombre,
        cl.documento,
        cl.email,
        COUNT(c.id)::int as total_facturas,
        ROUND((SUM(c.total))::numeric, 2)::double precision as total_compras
      FROM clientes cl
      JOIN comprobantes c ON c.cliente_id = cl.id
      WHERE c.tipo IN ${enListaVenta} AND c.estado != 'anulado'
      GROUP BY cl.id
      ORDER BY total_compras DESC
      LIMIT 10
    `, [])).rows;
    res.json({ ok: true, data: clientes });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Ventas por categoría de producto
router.get('/ventas-por-categoria', async (req, res) => {
  try {
    const categorias = (await db.query(`
      SELECT
        p.categoria,
        COUNT(DISTINCT c.id)::int as facturas,
        SUM(d.cantidad) as unidades_vendidas,
        ROUND((SUM(d.subtotal))::numeric, 2)::double precision as ingresos
      FROM detalle_comprobante d
      JOIN productos p ON d.producto_id = p.id
      JOIN comprobantes c ON d.comprobante_id = c.id
      WHERE c.tipo IN ${enListaVenta} AND c.estado != 'anulado' AND p.categoria IS NOT NULL
      GROUP BY p.categoria
      ORDER BY ingresos DESC
    `, [])).rows;
    res.json({ ok: true, data: categorias });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Comprobantes por estado (todos los tipos)
router.get('/facturas-por-estado', async (req, res) => {
  try {
    const estados = (await db.query(`
      SELECT
        estado,
        COUNT(*)::int as cantidad,
        ROUND((SUM(total))::numeric, 2)::double precision as monto_total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta}
      GROUP BY estado
    `, [])).rows;
    res.json({ ok: true, data: estados });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Reporte de IGV del mes actual
router.get('/igv-mes', async (req, res) => {
  try {
    const igv = (await db.query(`
      SELECT
        TO_CHAR(fecha, 'YYYY-MM') as mes,
        COUNT(*)::int as facturas,
        ROUND((SUM(subtotal))::numeric, 2)::double precision as base_imponible,
        ROUND((SUM(igv))::numeric, 2)::double precision as igv_total,
        ROUND((SUM(total))::numeric, 2)::double precision as total_con_igv
      FROM comprobantes
      WHERE tipo IN ${enListaVenta}
        AND TO_CHAR(fecha, 'YYYY-MM') = TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM')
        AND estado != 'anulado'
      GROUP BY mes
    `, [])).rows[0];
    res.json({ ok: true, data: igv || { mes: null, facturas: 0, base_imponible: 0, igv_total: 0, total_con_igv: 0 } });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Comprobantes por tipo (conteo general, todos los 8 tipos)
router.get('/comprobantes-por-tipo', async (req, res) => {
  try {
    const data = (await db.query(`
      SELECT tipo, COUNT(*)::int as cantidad, ROUND((SUM(total))::numeric, 2)::double precision as monto_total
      FROM comprobantes
      WHERE estado != 'anulado'
      GROUP BY tipo
    `, [])).rows;
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Créditos pendientes / próximos a vencer
router.get('/creditos-pendientes', async (req, res) => {
  try {
    const data = (await db.query(`
      SELECT c.id, c.tipo, c.serie, c.numero, c.total, c.fecha_vencimiento,
             cl.nombre as cliente_nombre,
             COALESCE(p.monto_cobrado, 0) AS monto_cobrado,
             ROUND((GREATEST(0, c.total - COALESCE(p.monto_cobrado, 0)))::numeric, 2)::double precision AS saldo_pendiente,
             CASE WHEN DATE(c.fecha_vencimiento) < CURRENT_DATE THEN 1 ELSE 0 END as vencido
      FROM comprobantes c
      JOIN clientes cl ON c.cliente_id = cl.id
      LEFT JOIN (
        SELECT comprobante_id, ROUND((SUM(monto))::numeric, 2)::double precision AS monto_cobrado
        FROM pagos_comprobante GROUP BY comprobante_id
      ) p ON p.comprobante_id = c.id
      WHERE c.tipo IN ${enListaVenta}
        AND c.condicion_pago = 'credito'
        AND c.estado IN ('emitido', 'parcial')
      ORDER BY c.fecha_vencimiento ASC
    `, [])).rows;
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.get('/cuentas-por-cobrar', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!fechaISOValida(desde) || !fechaISOValida(hasta) || desde > hasta) {
      return res.status(400).json({ ok: false, error: 'Envía un rango válido con fechas YYYY-MM-DD, desde menor o igual a hasta.' });
    }

    const base = `
      WITH pagos AS (
        SELECT comprobante_id, ROUND((SUM(monto))::numeric, 2)::double precision AS monto_cobrado
        FROM pagos_comprobante
        GROUP BY comprobante_id
      ),
      cuentas AS (
        SELECT c.id AS comprobante_id, c.tipo, c.serie, c.numero, c.fecha,
               c.fecha_vencimiento, c.estado, c.total,
               cl.id AS cliente_id, cl.nombre AS cliente_nombre, cl.documento AS cliente_documento,
               COALESCE(p.monto_cobrado, 0) AS monto_cobrado,
               ROUND((GREATEST(0, c.total - COALESCE(p.monto_cobrado, 0)))::numeric, 2)::double precision AS saldo_pendiente,
               CASE WHEN DATE(c.fecha_vencimiento) < CURRENT_DATE THEN 1 ELSE 0 END AS vencido,
               CASE WHEN DATE(c.fecha_vencimiento) < CURRENT_DATE
                 THEN GREATEST(0, CAST((CURRENT_DATE - c.fecha_vencimiento::date) AS INTEGER))
                 ELSE 0 END AS dias_vencido
        FROM comprobantes c
        JOIN clientes cl ON cl.id = c.cliente_id
        LEFT JOIN pagos p ON p.comprobante_id = c.id
        WHERE c.tipo IN ${enListaVenta}
          AND c.condicion_pago = 'credito'
          AND c.estado IN ('emitido', 'parcial')
          AND DATE(c.fecha) BETWEEN $1 AND $2
      )
    `;
    const parametros = [desde, hasta];
    const resumen = (await db.query(`${base}
      SELECT COUNT(*)::int AS cantidad_documentos,
             ROUND((COALESCE(SUM(total), 0))::numeric, 2)::double precision AS monto_facturado,
             ROUND((COALESCE(SUM(monto_cobrado), 0))::numeric, 2)::double precision AS monto_cobrado,
             ROUND((COALESCE(SUM(saldo_pendiente), 0))::numeric, 2)::double precision AS saldo_pendiente,
             ROUND((COALESCE(SUM(CASE WHEN vencido = 1 THEN saldo_pendiente ELSE 0 END), 0))::numeric, 2)::double precision AS monto_vencido,
             SUM(vencido)::int AS documentos_vencidos
      FROM cuentas
    `, parametros)).rows[0];

    const data = (await db.query(`${base}
      SELECT * FROM cuentas
      ORDER BY vencido DESC, fecha_vencimiento ASC, comprobante_id ASC
    `, parametros)).rows;

    const porCliente = (await db.query(`${base}
      SELECT cliente_id, cliente_nombre, cliente_documento,
             COUNT(*)::int AS documentos,
             ROUND((SUM(monto_cobrado))::numeric, 2)::double precision AS monto_cobrado,
             ROUND((SUM(saldo_pendiente))::numeric, 2)::double precision AS saldo_pendiente,
             ROUND((SUM(CASE WHEN vencido = 1 THEN saldo_pendiente ELSE 0 END))::numeric, 2)::double precision AS monto_vencido
      FROM cuentas
      GROUP BY cliente_id, cliente_nombre, cliente_documento
      ORDER BY saldo_pendiente DESC, cliente_nombre  ASC
    `, parametros)).rows;

    res.json({ ok: true, periodo: { desde, hasta }, resumen, data, por_cliente: porCliente });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.get('/cuentas-por-cobrar/exportar', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!fechaISOValida(desde) || !fechaISOValida(hasta) || desde > hasta) {
      return res.status(400).json({ ok: false, error: 'Envía un rango válido con fechas YYYY-MM-DD, desde menor o igual a hasta.' });
    }

    const base = `
      WITH pagos AS (
        SELECT comprobante_id, ROUND((SUM(monto))::numeric, 2)::double precision AS monto_cobrado
        FROM pagos_comprobante
        GROUP BY comprobante_id
      )
    `;
    const parametros = [desde, hasta];
    const cuentas = (await db.query(`${base}
      SELECT c.id AS comprobante_id, c.tipo, c.serie, c.numero, DATE(c.fecha) AS fecha,
             DATE(c.fecha_vencimiento) AS fecha_vencimiento, cl.nombre AS cliente_nombre,
             cl.documento AS cliente_documento, c.total,
             COALESCE(p.monto_cobrado, 0) AS monto_cobrado,
             ROUND((GREATEST(0, c.total - COALESCE(p.monto_cobrado, 0)))::numeric, 2)::double precision AS saldo_pendiente,
             CASE WHEN DATE(c.fecha_vencimiento) < CURRENT_DATE THEN 1 ELSE 0 END AS vencido,
             CASE WHEN DATE(c.fecha_vencimiento) < CURRENT_DATE
               THEN GREATEST(0, CAST((CURRENT_DATE - c.fecha_vencimiento::date) AS INTEGER))
               ELSE 0 END AS dias_vencido
      FROM comprobantes c
      JOIN clientes cl ON cl.id = c.cliente_id
      LEFT JOIN pagos p ON p.comprobante_id = c.id
      WHERE c.tipo IN ${enListaVenta}
        AND c.condicion_pago = 'credito'
        AND c.estado IN ('emitido', 'parcial')
        AND DATE(c.fecha) BETWEEN $1 AND $2
      ORDER BY vencido DESC, c.fecha_vencimiento ASC, c.id ASC
    `, parametros)).rows;

    const porCliente = (await db.query(`${base}
      SELECT cl.id AS cliente_id, cl.nombre AS cliente_nombre, cl.documento AS cliente_documento,
             COUNT(*)::int AS comprobantes,
             ROUND((SUM(c.total))::numeric, 2)::double precision AS monto_facturado,
             ROUND((SUM(COALESCE(p.monto_cobrado, 0)))::numeric, 2)::double precision AS monto_cobrado,
             ROUND((SUM(GREATEST(0, c.total - COALESCE(p.monto_cobrado, 0))))::numeric, 2)::double precision AS saldo_pendiente
      FROM comprobantes c
      JOIN clientes cl ON cl.id = c.cliente_id
      LEFT JOIN pagos p ON p.comprobante_id = c.id
      WHERE c.tipo IN ${enListaVenta}
        AND c.condicion_pago = 'credito'
        AND c.estado IN ('emitido', 'parcial')
        AND DATE(c.fecha) BETWEEN $1 AND $2
      GROUP BY cl.id, cl.nombre, cl.documento
      ORDER BY saldo_pendiente DESC, cl.nombre  ASC
    `, parametros)).rows;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(cuentas), 'Cuentas por cobrar');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(porCliente), 'Resumen por cliente');
    const contenido = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="cuentas_por_cobrar_${desde}_${hasta}.xlsx"`);
    res.send(contenido);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'No se pudo generar el Excel de cuentas por cobrar.' });
  }
});

// GET - Recepciones de compra agrupadas por proveedor y producto
router.get('/compras', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!fechaISOValida(desde) || !fechaISOValida(hasta) || desde > hasta) {
      return res.status(400).json({ ok: false, error: 'Envía un rango válido con fechas YYYY-MM-DD, desde menor o igual a hasta.' });
    }

    const condicionFecha = `COALESCE(NULLIF(dc.fecha_ingreso, '')::date, NULLIF(dc.fecha_factura, '')::date, dc.created_at::date) BETWEEN $1 AND $2`;
    const parametrosFecha = [desde, hasta];
    const resumen = (await db.query(`
      SELECT COUNT(DISTINCT dc.id)::int AS total_documentos,
             COUNT(d.id)::int AS total_lineas,
             COALESCE(SUM(d.cantidad), 0)::int AS unidades_recibidas
      FROM documentos_compra dc
      JOIN detalle_documento_compra d ON d.documento_compra_id = dc.id
      WHERE ${condicionFecha}
    `, parametrosFecha)).rows[0];

    const porProveedor = (await db.query(`
      SELECT dc.proveedor_documento, dc.proveedor_razon_social,
             COUNT(DISTINCT dc.id)::int AS documentos,
             COUNT(d.id)::int AS lineas,
             SUM(d.cantidad) AS unidades_recibidas
      FROM documentos_compra dc
      JOIN detalle_documento_compra d ON d.documento_compra_id = dc.id
      WHERE ${condicionFecha}
      GROUP BY dc.proveedor_documento, dc.proveedor_razon_social
      ORDER BY unidades_recibidas DESC, dc.proveedor_razon_social  ASC
    `, parametrosFecha)).rows;

    const porProducto = (await db.query(`
      SELECT p.id AS producto_id, p.nombre AS producto_nombre,
             COUNT(DISTINCT dc.id)::int AS documentos,
             COUNT(d.id)::int AS lineas,
             SUM(d.cantidad) AS unidades_recibidas
      FROM documentos_compra dc
      JOIN detalle_documento_compra d ON d.documento_compra_id = dc.id
      JOIN productos p ON p.id = d.producto_id
      WHERE ${condicionFecha}
      GROUP BY p.id, p.nombre
      ORDER BY unidades_recibidas DESC, p.nombre  ASC
    `, parametrosFecha)).rows;

    res.json({
      ok: true,
      periodo: { desde, hasta },
      resumen,
      por_proveedor: porProveedor,
      por_producto: porProducto,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.get('/compras/exportar', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!fechaISOValida(desde) || !fechaISOValida(hasta) || desde > hasta) {
      return res.status(400).json({ ok: false, error: 'Envía un rango válido con fechas YYYY-MM-DD, desde menor o igual a hasta.' });
    }

    const recepciones = (await db.query(`
      SELECT dc.id AS documento_id,
             COALESCE(NULLIF(dc.fecha_ingreso, '')::date, NULLIF(dc.fecha_factura, '')::date, dc.created_at::date) AS fecha,
             dc.tipo, dc.serie, dc.numero, dc.proveedor_documento, dc.proveedor_razon_social,
             dc.moneda, dc.tipo_cambio,
             p.id AS producto_id, p.nombre AS producto_nombre,
             d.cantidad, d.costo_unitario,
             ROUND((d.cantidad * d.costo_unitario)::numeric, 2)::double precision AS subtotal_pen,
             a.nombre AS almacen_nombre
      FROM documentos_compra dc
      JOIN detalle_documento_compra d ON d.documento_compra_id = dc.id
      JOIN productos p ON p.id = d.producto_id
      JOIN almacenes a ON a.id = d.almacen_id
      WHERE COALESCE(NULLIF(dc.fecha_ingreso, '')::date, NULLIF(dc.fecha_factura, '')::date, dc.created_at::date) BETWEEN $1 AND $2
      ORDER BY fecha ASC, dc.id ASC, d.id ASC
    `, [desde, hasta])).rows;

    const cuentasPorPagar = (await db.query(`
      WITH totales_linea AS (
        SELECT documento_compra_id,
               ROUND((SUM(cantidad * costo_unitario))::numeric, 2)::double precision AS importe_estimado_pen
        FROM detalle_documento_compra
        GROUP BY documento_compra_id
      ),
      totales_pago AS (
        SELECT documento_compra_id, ROUND((SUM(monto))::numeric, 2)::double precision AS monto_pagado_pen
        FROM pagos_documento_compra
        GROUP BY documento_compra_id
      )
      SELECT dc.id AS documento_id,
             COALESCE(NULLIF(dc.fecha_factura, '')::date, NULLIF(dc.fecha_ingreso, '')::date, dc.created_at::date) AS fecha,
             dc.proveedor_documento, dc.proveedor_razon_social,
             dc.serie, dc.numero, dc.estado,
             COALESCE(tl.importe_estimado_pen, 0) AS importe_estimado_pen,
             COALESCE(tp.monto_pagado_pen, 0) AS monto_pagado_pen,
             ROUND((GREATEST(0, COALESCE(tl.importe_estimado_pen, 0) - COALESCE(tp.monto_pagado_pen, 0)))::numeric, 2)::double precision AS saldo_pendiente_pen
      FROM documentos_compra dc
      LEFT JOIN totales_linea tl ON tl.documento_compra_id = dc.id
      LEFT JOIN totales_pago tp ON tp.documento_compra_id = dc.id
      WHERE dc.condicion_pago = 'credito'
        AND dc.estado NOT IN ('pagado', 'anulado')
        AND COALESCE(NULLIF(dc.fecha_factura, '')::date, NULLIF(dc.fecha_ingreso, '')::date, dc.created_at::date) BETWEEN $1 AND $2
      ORDER BY fecha ASC, dc.id ASC
    `, [desde, hasta])).rows;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(recepciones), 'Recepciones');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(cuentasPorPagar), 'Cuentas por pagar');
    const contenido = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="compras_${desde}_${hasta}.xlsx"`);
    res.send(contenido);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'No se pudo generar el Excel de compras.' });
  }
});

// GET - Cuentas por pagar estimadas de compras a crédito no pagadas
router.get('/cuentas-por-pagar', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!fechaISOValida(desde) || !fechaISOValida(hasta) || desde > hasta) {
      return res.status(400).json({ ok: false, error: 'Envía un rango válido con fechas YYYY-MM-DD, desde menor o igual a hasta.' });
    }

    const parametros = [desde, hasta];
    const baseSaldos = `
      WITH totales_linea AS (
        SELECT documento_compra_id, COUNT(*)::int AS lineas,
               ROUND((SUM(cantidad * costo_unitario))::numeric, 2)::double precision AS importe_estimado_pen
        FROM detalle_documento_compra
        GROUP BY documento_compra_id
      ),
      totales_pago AS (
        SELECT documento_compra_id, ROUND((SUM(monto))::numeric, 2)::double precision AS monto_pagado_pen
        FROM pagos_documento_compra
        GROUP BY documento_compra_id
      ),
      saldos AS (
        SELECT dc.id, dc.tipo, dc.serie, dc.numero, dc.estado, dc.fecha_factura,
               dc.fecha_ingreso, dc.created_at, dc.proveedor_documento,
               dc.proveedor_razon_social,
               COALESCE(tl.lineas, 0) AS lineas,
               COALESCE(tl.importe_estimado_pen, 0) AS importe_estimado_pen,
               COALESCE(tp.monto_pagado_pen, 0) AS monto_pagado_pen,
               ROUND((GREATEST(0, COALESCE(tl.importe_estimado_pen, 0) - COALESCE(tp.monto_pagado_pen, 0)))::numeric, 2)::double precision AS saldo_pendiente_pen
        FROM documentos_compra dc
        LEFT JOIN totales_linea tl ON tl.documento_compra_id = dc.id
        LEFT JOIN totales_pago tp ON tp.documento_compra_id = dc.id
        WHERE dc.condicion_pago = 'credito'
          AND dc.estado NOT IN ('pagado', 'anulado')
          AND COALESCE(NULLIF(dc.fecha_factura, '')::date, NULLIF(dc.fecha_ingreso, '')::date, dc.created_at::date) BETWEEN $1 AND $2
      )
    `;
    const resumen = (await db.query(`${baseSaldos}
      SELECT COUNT(*)::int AS total_documentos,
             COALESCE(SUM(lineas), 0)::int AS total_lineas,
             ROUND((COALESCE(SUM(importe_estimado_pen), 0))::numeric, 2)::double precision AS importe_estimado_pen,
             ROUND((COALESCE(SUM(monto_pagado_pen), 0))::numeric, 2)::double precision AS monto_pagado_pen,
             ROUND((COALESCE(SUM(saldo_pendiente_pen), 0))::numeric, 2)::double precision AS saldo_estimado_pen
      FROM saldos
    `, parametros)).rows[0];

    const porProveedor = (await db.query(`${baseSaldos}
      SELECT proveedor_documento, proveedor_razon_social,
             COUNT(*)::int AS documentos,
             SUM(lineas)::int AS lineas,
             ROUND((SUM(importe_estimado_pen))::numeric, 2)::double precision AS importe_estimado_pen,
             ROUND((SUM(monto_pagado_pen))::numeric, 2)::double precision AS monto_pagado_pen,
             ROUND((SUM(saldo_pendiente_pen))::numeric, 2)::double precision AS saldo_estimado_pen
      FROM saldos
      GROUP BY proveedor_documento, proveedor_razon_social
      ORDER BY saldo_estimado_pen DESC, proveedor_razon_social  ASC
    `, parametros)).rows;

    const documentos = (await db.query(`${baseSaldos}
      SELECT * FROM saldos
      ORDER BY COALESCE(NULLIF(fecha_factura, '')::date, NULLIF(fecha_ingreso, '')::date, created_at::date) ASC, id ASC
    `, parametros)).rows;

    res.json({
      ok: true,
      periodo: { desde, hasta },
      resumen,
      por_proveedor: porProveedor,
      documentos,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Reporte personalizado por rango de fechas
router.get('/rango', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
      return res.status(400).json({ ok: false, error: 'Debes enviar los parámetros desde y hasta' });
    }

    const resumen = (await db.query(`
      SELECT
        COUNT(*)::int as total_facturas,
        ROUND((SUM(subtotal))::numeric, 2)::double precision as subtotal,
        ROUND((SUM(igv))::numeric, 2)::double precision as igv,
        ROUND((SUM(total))::numeric, 2)::double precision as total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND DATE(fecha) BETWEEN $1 AND $2 AND estado != 'anulado'
    `, [desde, hasta])).rows[0];

    const porDia = (await db.query(`
      SELECT
        DATE(fecha) as dia,
        COUNT(*)::int as facturas,
        ROUND((SUM(total))::numeric, 2)::double precision as total
      FROM comprobantes
      WHERE tipo IN ${enListaVenta} AND DATE(fecha) BETWEEN $1 AND $2 AND estado != 'anulado'
      GROUP BY DATE(fecha)
      ORDER BY dia ASC
    `, [desde, hasta])).rows;

    const productosTop = (await db.query(`
      SELECT
        p.nombre,
        SUM(d.cantidad) as unidades,
        ROUND((SUM(d.subtotal))::numeric, 2)::double precision as ingresos
      FROM detalle_comprobante d
      JOIN productos p ON d.producto_id = p.id
      JOIN comprobantes c ON d.comprobante_id = c.id
      WHERE c.tipo IN ${enListaVenta} AND DATE(c.fecha) BETWEEN $1 AND $2 AND c.estado != 'anulado'
      GROUP BY p.id
      ORDER BY ingresos DESC
      LIMIT 5
    `, [desde, hasta])).rows;

    res.json({
      ok: true,
      periodo: { desde, hasta },
      resumen,
      ventas_por_dia: porDia,
      top_productos: productosTop
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;