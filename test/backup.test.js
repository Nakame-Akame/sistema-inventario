const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const test = require('node:test');
const { createBackup, restoreBackup } = require('../scripts/sqlite-backups');

test('backup can be verified and restored without losing a recovery copy', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'facturacion-backup-test-'));
  const databasePath = path.join(directory, 'source.db');
  const backupDirectory = path.join(directory, 'backups');
  const offsiteDirectory = path.join(directory, 'offsite');
  fs.mkdirSync(offsiteDirectory);
  const encryptionKey = 'a'.repeat(64);

  try {
    let database = new Database(databasePath);
    database.exec('CREATE TABLE sample (value TEXT NOT NULL); INSERT INTO sample VALUES (\'original\');');
    database.close();

    const { localPath: backupPath, offsitePath } = await createBackup(databasePath, backupDirectory, {
      offsiteDirectory,
      encryptionKey,
    });
    assert.equal(fs.existsSync(offsitePath), true);
    assert.ok(offsitePath.endsWith('.db.enc'));
    await assert.rejects(
      restoreBackup(offsitePath, path.join(directory, 'wrong-key.db'), { encryptionKey: 'b'.repeat(64) }),
      /autenticar o descifrar/,
    );
    const offsiteRestorePath = path.join(directory, 'offsite-restored.db');
    await restoreBackup(offsitePath, offsiteRestorePath, { encryptionKey });
    database = new Database(offsiteRestorePath, { readonly: true });
    assert.deepEqual(database.prepare('SELECT value FROM sample').all(), [{ value: 'original' }]);
    database.close();
    database = new Database(databasePath);
    database.exec("INSERT INTO sample VALUES ('newer');");
    database.close();

    const result = await restoreBackup(backupPath, databasePath);
    database = new Database(databasePath, { readonly: true });
    const values = database.prepare('SELECT value FROM sample ORDER BY rowid').all();
    database.close();

    assert.deepEqual(values, [{ value: 'original' }]);
    assert.ok(result.safetyBackup);
    assert.equal(fs.existsSync(result.safetyBackup), true);
    assert.equal(fs.readdirSync(backupDirectory).length, 1);
    assert.equal(fs.readdirSync(offsiteDirectory).length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('retains only recent generated backups and fails if the offsite mount is missing', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'facturacion-backup-retention-'));
  const databasePath = path.join(directory, 'source.db');
  const backupDirectory = path.join(directory, 'backups');
  fs.mkdirSync(backupDirectory);
  const database = new Database(databasePath);
  database.exec('CREATE TABLE sample (value TEXT NOT NULL); INSERT INTO sample VALUES (\'kept\');');
  database.close();

  const oldName = `facturacion-${new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString().replace(/[:.]/g, '-')}.db`;
  const oldGeneratedBackup = path.join(backupDirectory, oldName);
  const unrelatedFile = path.join(backupDirectory, 'manual-copy.db');
  fs.writeFileSync(oldGeneratedBackup, 'old');
  fs.writeFileSync(unrelatedFile, 'keep');
  fs.utimesSync(oldGeneratedBackup, new Date(0), new Date(0));

  try {
    await assert.rejects(
      createBackup(databasePath, backupDirectory, {
        offsiteDirectory: path.join(directory, 'not-mounted'),
        encryptionKey: 'a'.repeat(64),
      }),
      /debe existir y estar montado/,
    );
    assert.equal(fs.existsSync(oldGeneratedBackup), false);
    assert.equal(fs.existsSync(unrelatedFile), true);

    await createBackup(databasePath, backupDirectory, { retentionDays: 30, offsiteDirectory: '' });
    assert.equal(fs.existsSync(oldGeneratedBackup), false);
    assert.equal(fs.existsSync(unrelatedFile), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});