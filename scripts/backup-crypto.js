const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const MAGIC = Buffer.from('FACTURAPRO-SQLITE-BACKUP-V1\n');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function parseEncryptionKey(value = process.env.BACKUP_ENCRYPTION_KEY) {
  if (typeof value !== 'string' || !/^[\da-f]{64}$/i.test(value)) {
    throw new Error('BACKUP_ENCRYPTION_KEY debe contener 64 caracteres hexadecimales (32 bytes).');
  }
  return Buffer.from(value, 'hex');
}

function readExactly(fileDescriptor, length, position) {
  const buffer = Buffer.alloc(length);
  let bytesRead = 0;
  while (bytesRead < length) {
    const read = fs.readSync(fileDescriptor, buffer, bytesRead, length - bytesRead, position + bytesRead);
    if (!read) throw new Error('El respaldo cifrado está incompleto.');
    bytesRead += read;
  }
  return buffer;
}

async function encryptBackup(sourcePath, destinationPath, key) {
  const source = path.resolve(sourcePath);
  const destination = path.resolve(destinationPath);
  if (source === destination || fs.existsSync(destination)) {
    throw new Error('El destino del respaldo cifrado ya existe o coincide con el origen.');
  }
  if (!fs.existsSync(source)) throw new Error(`No existe el archivo que se va a cifrar: ${source}`);

  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  try {
    const output = fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
    output.write(MAGIC);
    output.write(iv);
    await pipeline(fs.createReadStream(source), cipher, output);
    fs.appendFileSync(temporary, cipher.getAuthTag());
    fs.renameSync(temporary, destination);
    return destination;
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}

async function decryptBackup(sourcePath, destinationPath, key) {
  const source = path.resolve(sourcePath);
  const destination = path.resolve(destinationPath);
  if (source === destination || fs.existsSync(destination)) {
    throw new Error('El destino temporal del descifrado ya existe o coincide con el origen.');
  }

  const sourceDescriptor = fs.openSync(source, 'r');
  let sourceSize;
  let iv;
  let authTag;
  try {
    sourceSize = fs.fstatSync(sourceDescriptor).size;
    if (sourceSize < MAGIC.length + IV_LENGTH + TAG_LENGTH) {
      throw new Error('El respaldo cifrado está incompleto.');
    }
    if (!readExactly(sourceDescriptor, MAGIC.length, 0).equals(MAGIC)) {
      throw new Error('El formato del respaldo cifrado no es válido.');
    }
    iv = readExactly(sourceDescriptor, IV_LENGTH, MAGIC.length);
    authTag = readExactly(sourceDescriptor, TAG_LENGTH, sourceSize - TAG_LENGTH);
  } finally {
    fs.closeSync(sourceDescriptor);
  }

  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  try {
    await pipeline(
      fs.createReadStream(source, { start: MAGIC.length + IV_LENGTH, end: sourceSize - TAG_LENGTH - 1 }),
      decipher,
      fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
    );
    fs.renameSync(temporary, destination);
    return destination;
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw new Error('No se pudo autenticar o descifrar el respaldo; verifica la clave y la integridad del archivo.', { cause: error });
  }
}

module.exports = { decryptBackup, encryptBackup, parseEncryptionKey };
