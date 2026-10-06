const fs = require('node:fs');
const path = require('node:path');

const LOG_PATH = path.resolve(__dirname, '..', 'logs', 'auditoria.log');

function sanitizarTexto(valor, maxLongitud = 200) {
  if (typeof valor !== 'string') return '';
  const texto = valor.trim();
  return texto.length > maxLongitud ? texto.slice(0, maxLongitud) : texto;
}

function esEmailValido(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function validarBodyObject(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
    return next();
  }

  if (req.body !== undefined && (typeof req.body !== 'object' || Array.isArray(req.body))) {
    return res.status(400).json({ ok: false, error: 'Formato de solicitud inválido.' });
  }

  return next();
}

function registrarAuditoria({ req, accion, detalle = {}, ok = true }) {
  try {
    const usuario = req?.session?.usuario || null;
    const entrada = {
      timestamp: new Date().toISOString(),
      accion,
      ok,
      ip: req?.ip || null,
      method: req?.method || null,
      path: req?.originalUrl || req?.path || null,
      usuarioId: usuario?.id ?? null,
      rol: usuario?.rol ?? null,
      detalle,
    };

    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `${JSON.stringify(entrada)}\n`, 'utf8');
  } catch {
    // no-op: la auditoría no debe bloquear la operación principal
  }
}

module.exports = {
  LOG_PATH,
  sanitizarTexto,
  esEmailValido,
  validarBodyObject,
  registrarAuditoria,
};
