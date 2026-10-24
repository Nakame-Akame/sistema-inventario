require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const session  = require('express-session');
const helmet   = require('helmet');
const { rateLimit } = require('express-rate-limit');
const path = require('node:path');
const fs = require('node:fs');

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error('Falta SESSION_SECRET. Configúrala en el entorno antes de iniciar el servidor.');
}

const db = require('./database');

const app  = express();
const PORT = Number(process.env.PORT || 3000);
const useBuiltAssets = process.env.NODE_ENV === 'production'
  || process.env.FRONTEND_ASSET_MODE === 'production';
const publicDirectory = useBuiltAssets
  ? path.join(__dirname, 'dist', 'public')
  : path.join(__dirname, 'public');
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

if (corsOrigins.length) app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  }
}));

app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT || 5),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiados intentos. Intenta nuevamente más tarde.' },
}));

function requiereLogin(req, res, next) {
  if (!req.session.usuario)
    return res.status(401).json({ ok: false, error: 'Debes iniciar sesión' });
  next();
}

app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: 'Base de datos no disponible' });
  }
});

// Rutas públicas
app.use('/api/auth', require('./routes/auth'));

// Rutas protegidas
app.use('/api/clientes',     requiereLogin, require('./routes/clientes'));
app.use('/api/productos',    requiereLogin, require('./routes/productos'));
app.use('/api/inventario',    requiereLogin, require('./routes/inventario'));
app.use('/api/compras',      requiereLogin, require('./routes/compras'));
app.use('/api/proveedores',  requiereLogin, require('./routes/proveedores'));
app.use('/api/tipo-cambio',  requiereLogin, require('./routes/tipo-cambio'));
app.use('/api/comprobantes', requiereLogin, require('./routes/comprobantes'));
app.use('/api/reportes',     requiereLogin, require('./routes/reportes'));
app.use('/api/pdf',          requiereLogin, require('./routes/pdf'));

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'Ruta no encontrada' });
});

if (useBuiltAssets && !fs.existsSync(publicDirectory)) {
  throw new Error('Faltan los recursos de producción. Ejecuta "npm run build" antes de iniciar el servidor.');
}
app.use(express.static(publicDirectory));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  const requestedStatus = Number(error.status || error.statusCode);
  const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus < 600
    ? requestedStatus
    : 500;
  console.error(JSON.stringify({
    level: 'error',
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    status,
    error: error.name || 'Error',
  }));

  res.status(status).json({
    ok: false,
    error: status < 500 ? 'Solicitud inválida' : 'Error interno del servidor',
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✓ Servidor corriendo en http://localhost:${PORT}`);
    console.log(`✓ Entorno: ${process.env.NODE_ENV || 'development'}`);
  });
}

module.exports = app;