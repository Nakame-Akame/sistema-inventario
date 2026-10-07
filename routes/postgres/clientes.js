const express = require('express');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();
const db = require('../../database-postgres');
const { requierePermiso } = require('../../middleware/permisos');
const { ErrorConsultaDocumento, consultarDocumento } = require('../../services/consulta-documento');

const limitarConsultasDocumento = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiadas consultas de documentos. Intenta nuevamente más tarde.' },
});

router.get('/', requierePermiso('clientes:ver'), async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM clientes ORDER BY nombre ASC');
    res.json({ ok: true, data: rows });
  } catch {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.get('/consultar-documento/:numero', requierePermiso('clientes:ver'), limitarConsultasDocumento, async (req, res) => {
  try {
    const data = await consultarDocumento(req.params.numero);
    res.json({ ok: true, data });
  } catch (error) {
    const status = error instanceof ErrorConsultaDocumento ? error.status : 502;
    res.status(status).json({
      ok: false,
      error: status === 502 ? 'No se pudo validar el documento' : error.message,
    });
  }
});

router.get('/:id', requierePermiso('clientes:ver'), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM clientes WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });
    res.json({ ok: true, data: rows[0] });
  } catch {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.post('/', requierePermiso('clientes:crear'), async (req, res) => {
  try {
    const { nombre, documento, direccion, email, telefono } = req.body;
    const tipoDocumento = req.body.tipo_documento || 'DNI';
    if (!nombre) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio' });
    if (!['DNI', 'RUC', 'CE'].includes(tipoDocumento)) {
      return res.status(400).json({ ok: false, error: 'Tipo de documento inválido' });
    }

    const result = await db.query(`
      INSERT INTO clientes (nombre, documento, tipo_documento, direccion, email, telefono)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [nombre, documento, tipoDocumento, direccion, email, telefono]);
    res.status(201).json({ ok: true, id: result.rows[0].id, mensaje: 'Cliente creado' });
  } catch {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.put('/:id', requierePermiso('clientes:editar'), async (req, res) => {
  try {
    const { nombre, documento, direccion, email, telefono } = req.body;
    const tipoDocumento = req.body.tipo_documento || 'DNI';
    if (!['DNI', 'RUC', 'CE'].includes(tipoDocumento)) {
      return res.status(400).json({ ok: false, error: 'Tipo de documento inválido' });
    }
    const result = await db.query(`
      UPDATE clientes
      SET nombre = $1, documento = $2, tipo_documento = $3,
        direccion = $4, email = $5, telefono = $6
      WHERE id = $7
    `, [nombre, documento, tipoDocumento, direccion, email, telefono, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });
    res.json({ ok: true, mensaje: 'Cliente actualizado' });
  } catch {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.delete('/:id', requierePermiso('clientes:eliminar'), async (req, res) => {
  try {
    const result = await db.query('DELETE FROM clientes WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });
    res.json({ ok: true, mensaje: 'Cliente eliminado' });
  } catch {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

router.get('/buscar/:texto', requierePermiso('clientes:ver'), async (req, res) => {
  try {
    const texto = `%${req.params.texto}%`;
    const { rows } = await db.query(`
      SELECT * FROM clientes
      WHERE nombre ILIKE $1 OR documento ILIKE $1 OR email ILIKE $1
      ORDER BY nombre ASC
    `, [texto]);
    res.json({ ok: true, data: rows, total: rows.length });
  } catch {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;