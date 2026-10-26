const express = require('express');
const { rateLimit } = require('express-rate-limit');
const router = express.Router();
const db = require('../database');
const { requierePermiso } = require('../middleware/permisos');
const { ErrorConsultaDocumento, consultarDocumento } = require('../services/consulta-documento');

const limitarConsultasDocumento = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiadas consultas de documentos. Intenta nuevamente más tarde.' },
});

// GET - Listar todos los clientes
router.get('/', requierePermiso('clientes:ver'), (req, res) => {
  try {
    const clientes = db.prepare('SELECT * FROM clientes ORDER BY nombre ASC').all();
    res.json({ ok: true, data: clientes });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Consultar DNI en RENIEC o RUC en SUNAT a través del proveedor configurado
router.get('/consultar-documento/:numero', requierePermiso('clientes:ver'), limitarConsultasDocumento, async (req, res) => {
  try {
    const data = await consultarDocumento(req.params.numero);
    res.json({ ok: true, data });
  } catch (err) {
    const status = err instanceof ErrorConsultaDocumento ? err.status : 502;
    res.status(status).json({
      ok: false,
      error: status === 502 ? 'No se pudo validar el documento' : err.message,
    });
  }
});

// GET - Obtener un cliente por ID
router.get('/:id', requierePermiso('clientes:ver'), (req, res) => {
  try {
    const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
    if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });
    res.json({ ok: true, data: cliente });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// POST - Crear nuevo cliente
router.post('/', requierePermiso('clientes:crear'), (req, res) => {
  try {
    const { nombre, documento, direccion, email, telefono } = req.body;
    const tipoDocumento = req.body.tipo_documento || 'DNI';
    if (!nombre) return res.status(400).json({ ok: false, error: 'El nombre es obligatorio' });
    if (!['DNI', 'RUC', 'CE'].includes(tipoDocumento)) {
      return res.status(400).json({ ok: false, error: 'Tipo de documento inválido' });
    }

    const result = db.prepare(`
      INSERT INTO clientes (nombre, documento, tipo_documento, direccion, email, telefono)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(nombre, documento, tipoDocumento, direccion, email, telefono);

    res.status(201).json({ ok: true, id: result.lastInsertRowid, mensaje: 'Cliente creado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// PUT - Actualizar cliente
router.put('/:id', requierePermiso('clientes:editar'), (req, res) => {
  try {
    const { nombre, documento, direccion, email, telefono } = req.body;
    const tipoDocumento = req.body.tipo_documento;
    if (tipoDocumento !== undefined && !['DNI', 'RUC', 'CE'].includes(tipoDocumento)) {
      return res.status(400).json({ ok: false, error: 'Tipo de documento inválido' });
    }
    const existe = db.prepare('SELECT id FROM clientes WHERE id = ?').get(req.params.id);
    if (!existe) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });

    db.prepare(`
      UPDATE clientes SET nombre=?, documento=?, tipo_documento=COALESCE(?, tipo_documento), direccion=?, email=?, telefono=?
      WHERE id=?
    `).run(nombre, documento, tipoDocumento ?? null, direccion, email, telefono, req.params.id);

    res.json({ ok: true, mensaje: 'Cliente actualizado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// DELETE - Eliminar cliente
router.delete('/:id', requierePermiso('clientes:eliminar'), (req, res) => {
  try {
    const existe = db.prepare('SELECT id FROM clientes WHERE id = ?').get(req.params.id);
    if (!existe) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });

    db.prepare('DELETE FROM clientes WHERE id = ?').run(req.params.id);
    res.json({ ok: true, mensaje: 'Cliente eliminado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// GET - Buscar clientes por nombre o documento
router.get('/buscar/:texto', requierePermiso('clientes:ver'), (req, res) => {
  try {
    const texto = `%${req.params.texto}%`;
    const clientes = db.prepare(`
      SELECT * FROM clientes 
      WHERE nombre LIKE ? OR documento LIKE ? OR email LIKE ?
      ORDER BY nombre ASC
    `).all(texto, texto, texto);
    res.json({ ok: true, data: clientes, total: clientes.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;
