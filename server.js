require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const session  = require('express-session');
const helmet   = require('helmet');
const { rateLimit } = require('express-rate-limit');
const path = require('node:path');
const { validarBodyObject } = require('./middleware/seguridad');

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error('Falta SESSION_SECRET. Configúrala en el entorno antes de iniciar el servidor.');
}

const databaseBackend = process.env.DB_PATH === ':memory:'
  ? 'sqlite'
  : (process.env.DATABASE_BACKEND || 'postgres');
if (!['postgres', 'sqlite'].includes(databaseBackend)) {
  throw new Error('DATABASE_BACKEND debe ser postgres o sqlite.');
}
const db = databaseBackend === 'sqlite' ? require('./database') : require('./database-postgres');
const rutas = databaseBackend === 'postgres'
  ? {
    auth: './routes/postgres/auth',
    clientes: './routes/postgres/clientes',
    productos: './routes/postgres/productos',
    inventario: './routes/postgres/inventario',
    compras: './routes/postgres/compras',
    proveedores: './routes/postgres/proveedores',
    tipoCambio: './routes/postgres/tipo-cambio',
    comprobantes: './routes/postgres/comprobantes',
    reportes: './routes/postgres/reportes',
    pdf: './routes/postgres/pdf',
  }
  : {
    auth: './routes/auth',
    clientes: './routes/clientes',
    productos: './routes/productos',
    inventario: './routes/inventario',
    compras: './routes/compras',
    proveedores: './routes/proveedores',
    tipoCambio: './routes/tipo-cambio',
    comprobantes: './routes/comprobantes',
    reportes: './routes/reportes',
    pdf: './routes/pdf',
  };

const app  = express();
const PORT = Number(process.env.PORT || 3000);
app.disable('x-powered-by');
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

if (corsOrigins.length) app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(validarBodyObject);
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 60 * 60 * 1000,
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

app.get('/api/health', async (_req, res) => {
  try {
    if (databaseBackend === 'postgres') await db.healthCheck();
    else db.prepare('SELECT 1').get();
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false, error: 'Base de datos no disponible' });
  }
});

// Rutas públicas
app.use('/api/auth', require(rutas.auth));

// Rutas protegidas
app.use('/api/clientes',     requiereLogin, require(rutas.clientes));
app.use('/api/productos',    requiereLogin, require(rutas.productos));
app.use('/api/inventario',   requiereLogin, require(rutas.inventario));
app.use('/api/compras',      requiereLogin, require(rutas.compras));
app.use('/api/proveedores',  requiereLogin, require(rutas.proveedores));
app.use('/api/tipo-cambio',  requiereLogin, require(rutas.tipoCambio));
app.use('/api/comprobantes', requiereLogin, require(rutas.comprobantes));
app.use('/api/reportes',     requiereLogin, require(rutas.reportes));
app.use('/api/pdf',          requiereLogin, require(rutas.pdf));

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'Ruta no encontrada' });
});

app.use(express.static(path.join(__dirname, 'public')));

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
  Promise.resolve(databaseBackend === 'postgres' ? db.initialize() : undefined)
    .then(() => app.listen(PORT, () => {
      console.log(`✓ Servidor corriendo en http://localhost:${PORT}`);
      console.log(`✓ Entorno: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✓ Base de datos: ${databaseBackend}`);
    }))
    .catch(error => {
      console.error(JSON.stringify({
        level: 'error',
        timestamp: new Date().toISOString(),
        event: 'database_initialization_failed',
        error: error.name || 'Error',
      }));
      process.exitCode = 1;
    });
}

module.exports = app;