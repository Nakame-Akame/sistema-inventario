const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { decryptBackup, encryptBackup, parseEncryptionKey } = require('./backup-crypto');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const projectRoot = path.resolve(__dirname, '..');

function configuredPath(value) {
  return path.resolve(projectRoot, value);
}

function verifyDatabase(filePath) {
  const database = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const result = database.pragma('quick_check', { simple: true });
    if (result !== 'ok') throw new Error('La base de datos no pasó la comprobación de integridad.');
  } finally {
    database.close();
  }
}

async function backupToFile(sourcePath, destinationPath) {
  const source = path.resolve(sourcePath);
  const destination = path.resolve(destinationPath);
  if (source === destination) throw new Error('El origen y el destino del respaldo deben ser distintos.');
  if (!fs.existsSync(source)) throw new Error(`No existe la base de datos de origen: ${source}`);
  if (fs.existsSync(destination)) throw new Error(`El archivo de destino ya existe: ${destination}`);

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const database = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await database.backup(destination);
  } finally {
    database.close();
  }
  fs.chmodSync(destination, 0o600);
  verifyDatabase(destination);
  return destination;
}

function timestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function pruneBackups(directory, retentionDays) {
  if (!fs.existsSync(directory)) return;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const backupName = /^facturacion-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.db(?:\.enc)?$/;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !backupName.test(entry.name)) continue;
    const backup = path.join(directory, entry.name);
    if (fs.statSync(backup).mtimeMs < cutoff) fs.unlinkSync(backup);
  }
}

async function createBackup(
  sourcePath = process.env.DB_PATH || 'facturacion.db',
  backupDirectory = process.env.BACKUP_DIR || 'backups',
  options = {},
) {
  const source = configuredPath(sourcePath);
  const directory = configuredPath(backupDirectory);
  const offsiteValue = options.offsiteDirectory ?? process.env.BACKUP_OFFSITE_DIR ?? '';
  const retentionDays = Number(options.retentionDays ?? process.env.BACKUP_RETENTION_DAYS ?? 30);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error('BACKUP_RETENTION_DAYS debe ser un entero entre 1 y 3650.');
  }
  const offsiteDirectory = offsiteValue ? configuredPath(offsiteValue) : '';
  const requireSeparateDevice = options.requireSeparateDevice ?? process.env.NODE_ENV === 'production';
  const encryptionKey = offsiteDirectory
    ? parseEncryptionKey(options.encryptionKey ?? process.env.BACKUP_ENCRYPTION_KEY)
    : null;
  if (offsiteDirectory && (
    isInside(directory, offsiteDirectory) || isInside(offsiteDirectory, directory) ||
    isInside(offsiteDirectory, source) || isInside(directory, source)
  )) {
    throw new Error('El respaldo fuera del servidor debe estar separado de la base de datos y de BACKUP_DIR.');
  }

  let backupName;
  let timestampValue = Date.now();
  do {
    backupName = `facturacion-${timestamp(new Date(timestampValue++))}.db`;
  } while (
    fs.existsSync(path.join(directory, backupName)) ||
    (offsiteDirectory && fs.existsSync(path.join(offsiteDirectory, backupName)))
  );
  const destination = path.join(directory, backupName);
  await backupToFile(source, destination);
  pruneBackups(directory, retentionDays);

  let offsiteDestination = null;
  if (offsiteDirectory) {
    let offsiteStats;
    try {
      offsiteStats = fs.statSync(offsiteDirectory);
    } catch {
      throw new Error('BACKUP_OFFSITE_DIR debe existir y estar montado antes de ejecutar el respaldo.');
    }
    if (!offsiteStats.isDirectory()) {
      throw new Error('BACKUP_OFFSITE_DIR debe ser un directorio.');
    }
    fs.mkdirSync(directory, { recursive: true });
    if (requireSeparateDevice && process.platform === 'linux' && offsiteStats.dev === fs.statSync(directory).dev) {
      throw new Error('BACKUP_OFFSITE_DIR no está en un sistema de archivos separado; verifica que el almacenamiento externo esté montado.');
    }
    offsiteDestination = path.join(offsiteDirectory, `${path.basename(destination)}.enc`);
    const verificationPath = `${destination}.offsite-verify.db`;
    try {
      await encryptBackup(destination, offsiteDestination, encryptionKey);
      await decryptBackup(offsiteDestination, verificationPath, encryptionKey);
      verifyDatabase(verificationPath);
    } catch (error) {
      if (fs.existsSync(offsiteDestination)) fs.unlinkSync(offsiteDestination);
      throw new Error(`El respaldo local quedó guardado, pero falló la copia fuera del servidor: ${error.message}`, { cause: error });
    } finally {
      if (fs.existsSync(verificationPath)) fs.unlinkSync(verificationPath);
    }
  }

  if (offsiteDirectory) pruneBackups(offsiteDirectory, retentionDays);
  return { localPath: destination, offsitePath: offsiteDestination };
}

async function restoreBackup(backupPath, destinationPath = process.env.DB_PATH || 'facturacion.db', options = {}) {
  const source = path.resolve(backupPath || '');
  const destination = configuredPath(destinationPath);
  if (!backupPath || source === destination) {
    throw new Error('Indica un respaldo válido distinto de la base de datos de destino.');
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const isEncrypted = source.endsWith('.db.enc');
  const encryptionKey = isEncrypted
    ? parseEncryptionKey(options.encryptionKey ?? process.env.BACKUP_ENCRYPTION_KEY)
    : null;
  const decryptedSource = isEncrypted
    ? `${destination}.decrypt-${process.pid}-${timestamp()}.db`
    : null;
  const stamp = timestamp();
  const temporary = `${destination}.restore-${process.pid}-${stamp}`;
  const displaced = `${destination}.previous-${process.pid}-${stamp}`;
  const safetyBackup = fs.existsSync(destination)
    ? `${destination}.before-restore-${stamp}.db`
    : null;

  try {
    const restoreSource = isEncrypted
      ? await decryptBackup(source, decryptedSource, encryptionKey)
      : source;
    verifyDatabase(restoreSource);
    await backupToFile(restoreSource, temporary);
    if (safetyBackup) await backupToFile(destination, safetyBackup);
    if (fs.existsSync(destination)) fs.renameSync(destination, displaced);
    try {
      fs.renameSync(temporary, destination);
      if (fs.existsSync(displaced)) fs.unlinkSync(displaced);
    } catch (error) {
      if (!fs.existsSync(destination) && fs.existsSync(displaced)) {
        fs.renameSync(displaced, destination);
      }
      throw error;
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (decryptedSource && fs.existsSync(decryptedSource)) fs.unlinkSync(decryptedSource);
  }

  return { database: destination, safetyBackup };
}

module.exports = { createBackup, restoreBackup, verifyDatabase };