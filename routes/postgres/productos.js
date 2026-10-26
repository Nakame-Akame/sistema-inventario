const express = require('express');
const router = express.Router();
const db = require('../../database-postgres');
const { requierePermiso } = require('../../middleware/permisos');
const { aCentimos, desdeCentimos } = require('../../services/comprobantes');

const SORT_FIELDS = new Set(['nombre', 'precio', 'stock', 'precio_compra', 'categoria', 'marca', 'created_at']);
const TEXT_FIELDS = ['nombre', 'codigo_interno', 'sku', 'codigo_barras', 'marca', 'categoria', 'ubicacion'];

function normalizarPrecio(precio) {
  const valor = Number(precio);
  if (!Number.isFinite(valor) || valor <= 0 || valor > 1000000000) return null;
  const redondeado = desdeCentimos(aCentimos(precio, 'El precio'));
  return redondeado > 0 ? redondeado : null;
}

function normalizarStock(stock) {
  const valor = stock === undefined ? 0 : Number(stock);
  return Number.isSafeInteger(valor) && valor >= 0 ? valor : null;
}

function normalizarCosto(costo) {
  const valor = costo === undefined ? 0 : Number(costo);
  if (!Number.isFinite(valor) || valor < 0 || valor > 1000000000) return null;
  return desdeCentimos(aCentimos(valor, 'El precio de compra'));
}

function normalizarTexto(valor, { maxLength = 200, permitirVacio = false } = {}) {
  if (valor === undefined || valor === null) return permitirVacio ? '' : null;
  const texto = String(valor).trim();
  if (!texto && !permitirVacio) return null;
  return texto.length > maxLength ? texto.slice(0, maxLength) : texto;
}

function normalizarBoolean(valor, defecto = true) {
  if (valor === undefined || valor === null) return defecto;
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'string') {
    const texto = valor.trim().toLowerCase();
    if (['1', 'true', 'yes', 'si', 'on'].includes(texto)) return true;
    if (['0', 'false', 'no', 'off'].includes(texto)) return false;
  }
  if (typeof valor === 'number') return Boolean(valor);
  return defecto;
}

function obtenerCamposProducto(payload = {}) {
  const precio = normalizarPrecio(payload.precio);
  return {
    nombre: normalizarTexto(payload.nombre, { maxLength: 200 }),
    descripcion: normalizarTexto(payload.descripcion, { maxLength: 500, permitirVacio: true }) || null,
    codigo_interno: normalizarTexto(payload.codigo_interno, { maxLength: 80, permitirVacio: true }) || null,
    sku: normalizarTexto(payload.sku, { maxLength: 100, permitirVacio: true }) || null,
    codigo_barras: normalizarTexto(payload.codigo_barras, { maxLength: 100, permitirVacio: true }) || null,
    marca: normalizarTexto(payload.marca, { maxLength: 100, permitirVacio: true }) || null,
    categoria: normalizarTexto(payload.categoria, { maxLength: 100, permitirVacio: true }) || null,
    unidad_medida: normalizarTexto(payload.unidad_medida, { maxLength: 20, permitirVacio: true }) || 'UND',
    precio,
    precio_rebaja: normalizarPrecio(payload.precio_rebaja ?? payload.precio),
    precio_pase: normalizarPrecio(payload.precio_pase ?? payload.precio),
    precio_compra: normalizarCosto(payload.precio_compra),
    stock: normalizarStock(payload.stock ?? 0),
    stock_minimo: normalizarStock(payload.stock_minimo ?? 0),
    stock_maximo: normalizarStock(payload.stock_maximo ?? 0),
    imagen: normalizarTexto(payload.imagen, { maxLength: 500, permitirVacio: true }) || null,
    activo: normalizarBoolean(payload.activo, true) ? 1 : 0,
    igv: normalizarBoolean(payload.igv, true) ? 1 : 0,
    ubicacion: normalizarTexto(payload.ubicacion, { maxLength: 200, permitirVacio: true }) || null,
    proveedor_principal: normalizarTexto(payload.proveedor_principal, { maxLength: 200, permitirVacio: true }) || null,
  };
}

function validarProducto(producto) {
  if (!producto.nombre) return 'El nombre es obligatorio';
  if ([producto.precio, producto.precio_rebaja, producto.precio_pase].some(value => value === null)) {
    return 'Los precios deben ser positivos y válidos';
  }
  if (producto.precio_compra === null) return 'El precio de compra no es válido';
  if ([producto.stock, producto.stock_minimo, producto.stock_maximo].some(value => value === null)) {
    return 'Los stocks deben ser enteros no negativos';
  }
  return null;
}

async function validarDuplicado(producto, excluirId) {
  for (const campo of ['codigo_interno', 'sku', 'codigo_barras']) {
    const valor = producto[campo];
    if (!valor) continue;
    const values = excluirId ? [valor, excluirId] : [valor];
    const excluding = excluirId ? 'AND id <> $2' : '';
    const result = await db.query(`
      SELECT id FROM productos
      WHERE lower(COALESCE(${campo}, '')) = lower($1) ${excluding}
      LIMIT 1
    `, values);
    if (result.rowCount) return { campo, valor };
  }
  return null;
}

function buildFilters(search, categoria, activo) {
  const clauses = [];
  const values = [];
  if (search) {
    values.push(`%${search}%`);
    const searchIndex = values.length;
    clauses.push(`(${TEXT_FIELDS.map(field => `${field} ILIKE $${searchIndex}`).join(' OR ')})`);
  }
  if (categoria) {
    values.push(categoria);
    clauses.push(`lower(categoria) = lower($${values.length})`);
  }
  if (activo !== null) {
    values.push(activo ? 1 : 0);
    clauses.push(`activo = $${values.length}`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

function responderErrorProducto(res, error) {
  if (error?.code === '23505') {
    return res.status(409).json({ ok: false, error: 'Ya existe otro producto con el mismo código' });
  }
  return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
}

router.get('/', requierePermiso('productos:ver'), async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const categoria = typeof req.query.categoria === 'string' ? req.query.categoria.trim() : '';
    const activo = req.query.activo === undefined ? null : normalizarBoolean(req.query.activo, true);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const sort = SORT_FIELDS.has(req.query.sort) ? req.query.sort : 'nombre';
    const order = req.query.order === 'asc' ? 'ASC' : 'DESC';
    const { where, values } = buildFilters(search, categoria, activo);
    const total = await db.query(`SELECT COUNT(*)::int AS total FROM productos ${where}`, values);
    const page = await db.query(`
      SELECT * FROM productos ${where}
      ORDER BY ${sort} ${order}
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `, [...values, limit, offset]);
    res.json({ ok: true, data: page.rows, total: total.rows[0].total, limit, offset });
  } catch {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.get('/:id', requierePermiso('productos:ver'), async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM productos WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    res.json({ ok: true, data: result.rows[0] });
  } catch {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.post('/', requierePermiso('productos:crear'), async (req, res) => {
  try {
    const producto = obtenerCamposProducto(req.body);
    const error = validarProducto(producto);
    if (error) return res.status(400).json({ ok: false, error });
    const duplicado = await validarDuplicado(producto);
    if (duplicado) return res.status(409).json({ ok: false, error: `Ya existe otro producto con el mismo ${duplicado.campo.replace('_', ' ')}` });

    const columns = Object.keys(producto);
    const values = columns.map(column => producto[column]);
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const result = await db.query(`
      INSERT INTO productos (${columns.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING id
    `, values);
    res.status(201).json({ ok: true, id: result.rows[0].id, mensaje: 'Producto creado' });
  } catch (error) {
    responderErrorProducto(res, error);
  }
});

router.put('/:id', requierePermiso('productos:editar'), async (req, res) => {
  try {
    const producto = obtenerCamposProducto(req.body);
    const error = validarProducto(producto);
    if (error) return res.status(400).json({ ok: false, error });
    const duplicado = await validarDuplicado(producto, req.params.id);
    if (duplicado) return res.status(409).json({ ok: false, error: `Ya existe otro producto con el mismo ${duplicado.campo.replace('_', ' ')}` });

    const columns = Object.keys(producto);
    const values = columns.map(column => producto[column]);
    values.push(req.params.id);
    const result = await db.query(`
      UPDATE productos SET ${columns.map((column, index) => `${column} = $${index + 1}`).join(', ')}
      WHERE id = $${values.length}
    `, values);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    res.json({ ok: true, mensaje: 'Producto actualizado' });
  } catch (error) {
    responderErrorProducto(res, error);
  }
});

router.delete('/:id', requierePermiso('productos:eliminar'), async (req, res) => {
  try {
    const result = await db.query('DELETE FROM productos WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Producto no encontrado' });
    res.json({ ok: true, mensaje: 'Producto eliminado' });
  } catch (error) {
    responderErrorProducto(res, error);
  }
});

router.get('/buscar/:texto', requierePermiso('productos:ver'), async (req, res) => {
  try {
    const texto = `%${req.params.texto}%`;
    const { rows } = await db.query(`
      SELECT * FROM productos
      WHERE nombre ILIKE $1 OR categoria ILIKE $1 OR descripcion ILIKE $1
        OR codigo_interno ILIKE $1 OR sku ILIKE $1 OR codigo_barras ILIKE $1
      ORDER BY nombre ASC
    `, [texto]);
    res.json({ ok: true, data: rows, total: rows.length });
  } catch {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.get('/alertas/stock-bajo', requierePermiso('productos:ver'), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT * FROM productos
      WHERE stock <= COALESCE(stock_minimo, 0) OR stock <= 5
      ORDER BY stock ASC
    `);
    res.json({ ok: true, data: rows, total: rows.length });
  } catch {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.patch('/:id/stock', requierePermiso('productos:ajustar_stock'), async (req, res) => {
  const cantidad = Number(req.body?.cantidad);
  const operacion = req.body?.operacion;
  if (!Number.isSafeInteger(cantidad) || cantidad <= 0) return res.status(400).json({ ok: false, error: 'La cantidad debe ser un entero positivo' });
  if (!['sumar', 'restar'].includes(operacion)) return res.status(400).json({ ok: false, error: 'La operación debe ser sumar o restar' });

  try {
    const resultado = await db.transaction(async client => {
      const found = await client.query('SELECT id, stock FROM productos WHERE id = $1 FOR UPDATE', [req.params.id]);
      const producto = found.rows[0];
      if (!producto) return { error: 'Producto no encontrado', status: 404 };
      if (operacion === 'restar' && producto.stock < cantidad) return { error: 'Stock insuficiente', status: 400 };
      const delta = operacion === 'sumar' ? cantidad : -cantidad;
      const update = await client.query('UPDATE productos SET stock = stock + $1 WHERE id = $2 RETURNING stock', [delta, producto.id]);
      return { stockAnterior: producto.stock, stockNuevo: update.rows[0].stock };
    });
    if (resultado.error) return res.status(resultado.status).json({ ok: false, error: resultado.error });
    res.json({ ok: true, mensaje: 'Stock actualizado', stock_anterior: resultado.stockAnterior, stock_nuevo: resultado.stockNuevo });
  } catch {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.get('/categorias/lista', requierePermiso('productos:ver'), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT DISTINCT categoria FROM productos
      WHERE categoria IS NOT NULL AND TRIM(categoria) <> ''
      ORDER BY categoria ASC
    `);
    res.json({ ok: true, data: rows.map(row => row.categoria) });
  } catch {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;