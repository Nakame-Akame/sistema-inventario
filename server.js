require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const session  = require('express-session');
const helmet   = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const fs = require('node:fs');
const SQLiteSessionStore = require('./services/sqlite-session-store');

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error('Falta SESSION_SECRET. Configúrala en el entorno antes de iniciar el servidor.');
}
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && Buffer.byteLength(sessionSecret, 'utf8') < 32) {
  throw new Error('SESSION_SECRET debe tener al menos 32 bytes en producción.');
}

const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) {
  throw new Error('TRUST_PROXY_HOPS debe ser un entero entre 0 y 5.');
}

const loginLimit = Number(process.env.LOGIN_RATE_LIMIT || 5);
if (!Number.isInteger(loginLimit) || loginLimit < 1) {
  throw new Error('LOGIN_RATE_LIMIT debe ser un entero positivo.');
}

const backupRetentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 30);
if (!Number.isInteger(backupRetentionDays) || backupRetentionDays < 1 || backupRetentionDays > 3650) {
  throw new Error('BACKUP_RETENTION_DAYS debe ser un entero entre 1 y 3650.');
}

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (isProduction ? '127.0.0.1' : '0.0.0.0');
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT debe ser un puerto válido entre 1 y 65535.');
}
if (isProduction && !['127.0.0.1', '::1'].includes(HOST)) {
  throw new Error('En producción, HOST debe ser loopback para que solo el proxy HTTPS pueda acceder al servidor.');
}

const backupDirectory = path.resolve(__dirname, process.env.BACKUP_DIR || 'backups');
const offsiteBackupDirectory = process.env.BACKUP_OFFSITE_DIR
  ? path.resolve(__dirname, process.env.BACKUP_OFFSITE_DIR)
  : '';
const databasePath = path.resolve(__dirname, process.env.DB_PATH || 'facturacion.db');
function pathsOverlap(first, second) {
  const isWithin = (parent, candidate) => {
    const relative = path.relative(parent, candidate);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  return isWithin(first, second) || isWithin(second, first);
}
if (isProduction && !offsiteBackupDirectory) {
  throw new Error('BACKUP_OFFSITE_DIR es obligatorio en producción y debe apuntar a almacenamiento fuera del servidor.');
}
if (isProduction && !/^[\da-f]{64}$/i.test(process.env.BACKUP_ENCRYPTION_KEY || '')) {
  throw new Error('BACKUP_ENCRYPTION_KEY debe contener una clave hexadecimal de 32 bytes en producción.');
}
if (isProduction && process.env.DB_PATH === ':memory:') {
  throw new Error('DB_PATH debe apuntar a un archivo persistente en producción.');
}
if (offsiteBackupDirectory && (
  pathsOverlap(offsiteBackupDirectory, backupDirectory) ||
  pathsOverlap(offsiteBackupDirectory, databasePath)
)) {
  throw new Error('BACKUP_OFFSITE_DIR debe estar separado de BACKUP_DIR y de la base de datos.');
}

const db = require('./database');

const app  = express();
if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);
const useBuiltAssets = process.env.NODE_ENV === 'production'
  || process.env.FRONTEND_ASSET_MODE === 'production';
const publicDirectory = useBuiltAssets
  ? path.join(__dirname, 'dist', 'public')
  : path.join(__dirname, 'public');
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

for (const origin of corsOrigins) {
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new Error(`CORS_ORIGIN contiene un origen inválido: ${origin}`);
  }
  if (parsedOrigin.origin !== origin || (isProduction && parsedOrigin.protocol !== 'https:')) {
    throw new Error('CORS_ORIGIN debe contener solo orígenes exactos y usar HTTPS en producción.');
  }
}

if (corsOrigins.length) app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      styleSrcAttr: ["'unsafe-inline'"],
      upgradeInsecureRequests: isProduction ? [] : null,
    },
  },
}));
app.use(express.json());
app.use(session({
  secret: sessionSecret,
  store: new SQLiteSessionStore(db),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
  }
}));

app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: loginLimit,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { ok: false, error: 'Demasiados intentos fallidos. Espera 15 minutos antes de volver a intentarlo.' },
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
  app.listen(PORT, HOST, () => {
    console.log(`✓ Servidor corriendo en http://${HOST}:${PORT}`);
    console.log(`✓ Entorno: ${process.env.NODE_ENV || 'development'}`);
  });
}

module.exports = app;