const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

function loadProductionServer(overrides = {}) {
  const directory = path.join(os.tmpdir(), 'facturapro-deployment-config');
  return spawnSync(process.execPath, ['-e', "require('./server')"], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SESSION_SECRET: 'x'.repeat(48),
      DB_PATH: path.join(directory, 'facturacion.db'),
      BACKUP_DIR: path.join(directory, 'backups'),
      BACKUP_OFFSITE_DIR: path.join(os.tmpdir(), 'facturapro-offsite'),
      BACKUP_ENCRYPTION_KEY: 'a'.repeat(64),
      HOST: '127.0.0.1',
      ...overrides,
    },
  });
}

test('refuses production startup without an offsite backup directory', () => {
  const result = loadProductionServer({ BACKUP_OFFSITE_DIR: '' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BACKUP_OFFSITE_DIR es obligatorio en producción/);
});

test('refuses production startup when Node would listen on a public interface', () => {
  const result = loadProductionServer({ HOST: '0.0.0.0' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HOST debe ser loopback/);
});
