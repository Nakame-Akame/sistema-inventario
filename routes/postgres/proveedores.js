const express = require('express');
const db = require('../../database-postgres');
const { requierePermiso } = require('../../middleware/permisos');

const router = express.Router();

function leerProveedor(body) {
  const proveedor = {
    documento: String(body?.documento || '').trim().toUpperCase(),
    razon_social: String(body?.razon_social || '').trim(),
    direccion: String(body?.direccion || '').trim(),
    telefono: String(body?.telefono || '').trim(),
    email: String(body?.email || '').trim(),
  };

  if (!proveedor.documento || proveedor.documento.length > 30) {
    return { error: 'El documento es obligatorio y admite hasta 30 caracteres.' };
  }
  if (!proveedor.razon_social || proveedor.razon_social.length > 200) {
    return { error: 'La razón social es obligatoria y admite hasta 200 caracteres.' };
  }
  if (proveedor.direccion.length > 300 || proveedor.telefono.length > 50 || proveedor.email.length > 254) {
    return { error: 'Uno de los datos de contacto excede la longitud permitida.' };
  }
  if (proveedor.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proveedor.email)) {
    return { error: 'El correo electrónico no es válido.' };
  }

  return { proveedor };
}

async function responderProveedor(res, id) {
  const { rows } = await db.query('SELECT * FROM proveedores WHERE id = $1', [id]);
  return res.json({ ok: true, data: rows[0] });
}

router.get('/', requierePermiso('compras:ver'), async (req, res) => {
  const buscar = String(req.query.buscar || '').trim();
  const incluirInactivos = req.query.incluir_inactivos === 'true';
  const { rows } = await db.query(`
    SELECT * FROM proveedores
    WHERE ($1::boolean OR activo = 1)
      AND ($2 = '' OR documento ILIKE '%' || $2 || '%'
        OR razon_social ILIKE '%' || $2 || '%')
    ORDER BY lower(razon_social) ASC, id ASC
  `, [incluirInactivos, buscar]);
  res.json({ ok: true, data: rows });
});

router.post('/', requierePermiso('compras:crear'), async (req, res) => {
  const resultado = leerProveedor(req.body);
  if (resultado.error) return res.status(400).json({ ok: false, error: resultado.error });

  try {
    const { proveedor } = resultado;
    const insertado = await db.query(`
      INSERT INTO proveedores (documento, razon_social, direccion, telefono, email)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [proveedor.documento, proveedor.razon_social, proveedor.direccion || null,
      proveedor.telefono || null, proveedor.email || null]);
    return res.status(201).json({ ok: true, id: Number(insertado.rows[0].id), ...proveedor, activo: 1 });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Ya existe un proveedor con ese documento.' });
    }
    return res.status(500).json({ ok: false, error: 'No se pudo guardar el proveedor.' });
  }
});

router.put('/:id', requierePermiso('compras:crear'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'Identificador no válido.' });
  const resultado = leerProveedor(req.body);
  if (resultado.error) return res.status(400).json({ ok: false, error: resultado.error });

  try {
    const { proveedor } = resultado;
    const actualizado = await db.query(`
      UPDATE proveedores
      SET documento = $1, razon_social = $2, direccion = $3, telefono = $4,
        email = $5, updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
    `, [proveedor.documento, proveedor.razon_social, proveedor.direccion || null,
      proveedor.telefono || null, proveedor.email || null, id]);
    if (!actualizado.rowCount) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado.' });
    return responderProveedor(res, id);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Ya existe un proveedor con ese documento.' });
    }
    return res.status(500).json({ ok: false, error: 'No se pudo actualizar el proveedor.' });
  }
});

router.patch('/:id/estado', requierePermiso('compras:crear'), async (req, res) => {
  const id = Number(req.params.id);
  const activo = req.body?.activo;
  if (!Number.isInteger(id) || id <= 0 || typeof activo !== 'boolean') {
    return res.status(400).json({ ok: false, error: 'Identificador o estado no válido.' });
  }
  const actualizado = await db.query(`
    UPDATE proveedores SET activo = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2
  `, [Number(activo), id]);
  if (!actualizado.rowCount) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado.' });
  return responderProveedor(res, id);
});

module.exports = router;