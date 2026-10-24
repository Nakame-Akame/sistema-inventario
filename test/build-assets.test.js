process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-only-production-session-secret';
process.env.NODE_ENV = 'development';
process.env.FRONTEND_ASSET_MODE = 'production';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const publicDirectory = path.join(projectRoot, 'dist', 'public');
let server;
let api;
let db;

test.before(async () => {
  const build = spawnSync(process.execPath, ['scripts/build-assets.js'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

  const app = require('../server');
  db = require('../database');
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  api = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  if (db) db.close();
});

test('production serves minified assets without exposing source maps', async () => {
  const shell = await fetch(api);
  assert.equal(shell.status, 200);
  const shellHtml = await shell.text();
  assert.ok(shellHtml.includes('href="/assets/app.min.css"'));
  assert.ok(shellHtml.includes('src="/assets/app.min.js"'));
  assert.ok(shellHtml.includes('link[data-page-style]'));

  const appScript = await fetch(`${api}/assets/app.min.js`);
  assert.equal(appScript.status, 200);
  const appSource = await appScript.text();
  const originalApp = fs.readFileSync(path.join(projectRoot, 'public', 'app.js'), 'utf8');
  assert.ok(appSource.length < originalApp.length);
  assert.doesNotMatch(appSource, /sourceMappingURL/);
  assert.equal((await fetch(`${api}/app.js`)).status, 404);
  assert.equal((await fetch(`${api}/Script.js`)).status, 404);
  assert.equal((await fetch(`${api}/public/app.js`)).status, 404);

  const baseStyles = await fetch(`${api}/assets/app.min.css`);
  assert.equal(baseStyles.status, 200);
  const styles = await baseStyles.text();
  assert.doesNotMatch(styles, /\n/);
  assert.match(styles, /\.sales-layout/);
  assert.match(styles, /\.client-lookup-grid/);

  for (const file of ['Style.css', 'styles/ventas.css']) {
    assert.equal((await fetch(`${api}/${file}`)).status, 404, file);
  }

  const page = await fetch(`${api}/pages/ventas.html`);
  assert.equal(page.status, 200);
  assert.doesNotMatch(await page.text(), /data-page-style|<link/i);

  const assetDirectory = await fetch(`${api}/assets/`);
  assert.equal(assetDirectory.status, 404);

  for (const file of ['app.min.js', 'app.min.css']) {
    const source = await fetch(`${api}/assets/${file}`);
    assert.equal(source.status, 200, file);
    assert.doesNotMatch(await source.text(), /sourceMappingURL/);
  }

  const publicFiles = fs.readdirSync(publicDirectory, { recursive: true });
  assert.ok(!publicFiles.some(file => String(file).endsWith('.map')));
});
