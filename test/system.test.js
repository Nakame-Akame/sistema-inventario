process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-only-session-secret';
process.env.LOGIN_RATE_LIMIT = '100';
process.env.DECOLECTA_API_TOKEN = 'test-decolecta-token';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { createAdmin } = require('../scripts/create-admin');
const app = require('../server');

let server;
let api;

test.before(async () => {
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM usuarios WHERE email = 'admin@facturapro.com'").get().total, 0);
  await createAdmin({
    nombre: 'Administrador de prueba',
    email: 'admin@facturapro.com',
    password: 'PruebaAdmin-2026!Seguro',
  });
  assert.ok(db.prepare("SELECT created_at FROM usuarios WHERE email = 'admin@facturapro.com'").get().created_at);
  db.prepare('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)')
    .run('Vendedor de prueba', 'vendedor@test.local', bcrypt.hashSync('VendedorSeguro-2026!Pass', 12), 'vendedor');
  db.prepare('INSERT INTO clientes (nombre, documento) VALUES (?, ?)')
    .run('Cliente de prueba', 'DOC-TEST');
  db.prepare('INSERT INTO productos (nombre, precio, stock) VALUES (?, ?, ?)')
    .run('Producto de prueba', 100, 10);
  db.prepare('INSERT INTO productos (nombre, precio, stock) VALUES (?, ?, ?)')
    .run('Producto con stock limitado', 50, 1);
  db.prepare('INSERT INTO productos (nombre, precio, stock) VALUES (?, ?, ?)')
    .run('Producto fraccionario', 0.1, 3);
  db.prepare('INSERT INTO productos (nombre, precio, stock) VALUES (?, ?, ?)')
    .run('Producto con precio legado', 1.005, 1);

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  api = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  db.close();
});

async function login(email = 'admin@facturapro.com', password = 'PruebaAdmin-2026!Seguro') {
  const response = await fetch(`${api}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cookieHeader = response.headers.get('set-cookie');
  return {
    response,
    cookie: cookieHeader?.split(';')[0],
    cookieHeader,
  };
}

test('health endpoint responds successfully', async () => {
  const response = await fetch(`${api}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await response.json(), { ok: true });
});

test('unknown API routes return a consistent JSON 404', async () => {
  const response = await fetch(`${api}/api/route-that-does-not-exist`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: 'Ruta no encontrada' });
});

test('serves the page shell and every linked frontend section', async () => {
  const pageNames = ['dashboard', 'ventas', 'facturas', 'clientes', 'productos', 'reportes', 'compras', 'usuarios', 'modals'];
  const shell = await fetch(api);
  const shellHtml = await shell.text();
  assert.equal(shell.status, 200);
  assert.match(shellHtml, /page-views-root/);
  assert.match(shellHtml, /fetch\('\/pages\/modals\.html'\)/);
  assert.doesNotMatch(shellHtml, /id="page-dashboard"/);
  assert.match(shellHtml, /<link id="base-stylesheet" rel="stylesheet" href="\/Style\.css">/);
  assert.doesNotMatch(shellHtml, /<style\b|\sstyle="/i);

  const sections = await Promise.all(pageNames.map(name => fetch(`${api}/pages/${name}.html`)));
  assert.ok(sections.every(response => response.status === 200));
  const sectionHtml = await Promise.all(sections.map(response => response.text()));
  assert.doesNotMatch(sectionHtml.join('\n'), /<style\b|\sstyle="/i);
  const sectionStyles = ['ventas', 'facturas', 'reportes', 'compras', 'usuarios', 'modals'];
  for (const name of sectionStyles) {
    assert.match(sectionHtml[pageNames.indexOf(name)], new RegExp(`<link rel="stylesheet" data-page-style href="/styles/${name}\\.css">`));
    const stylesheetResponse = await fetch(`${api}/styles/${name}.css`);
    assert.equal(stylesheetResponse.status, 200);
    assert.ok((await stylesheetResponse.text()).trim().length > 0);
  }
  assert.match(shellHtml, /link\[data-page-style\]/);
  assert.match(shellHtml, /insertBefore\(stylesheet, document\.getElementById\('base-stylesheet'\)\)/);
  assert.match(shellHtml, /await Promise\.all\(stylesheetPromises\.values\(\)\)/);
  assert.ok(sectionHtml[0].includes('id="page-dashboard"'));
  assert.ok(sectionHtml[6].includes('id="page-compras"'));
  assert.ok(sectionHtml[8].includes('id="modal-cobro-factura"'));

  const stylesheet = await fetch(`${api}/Style.css`);
  assert.equal(stylesheet.status, 200);
  const css = await stylesheet.text();
  assert.match(css, /--bg:\s*#eef3ee;/);
  assert.doesNotMatch(css, /--bg:\s*#0f1117;/);
  assert.match(css, /\.modal-overlay\s*\{[^}]*display:\s*none;[^}]*position:\s*fixed;/s);
  assert.match(css, /\.form-grid\s*\{\s*display:\s*grid;/);
  assert.match(css, /\.page\s*\{\s*display:\s*none;/);
  assert.match(css, /\.page\.active\s*\{\s*display:\s*block;/);
  assert.match(css, /\.stats-grid\s*\{\s*display:\s*grid;/);
  assert.match(css, /#app-shell\.u-hidden\s*\{\s*display:\s*none;/);
  assert.match(css, /#app-shell\s*\{\s*display:\s*block;/);
  assert.match(css, /\.login-form label\s*\{\s*display:\s*block;/);

  const modalStylesheet = await fetch(`${api}/styles/modals.css`);
  assert.match(await modalStylesheet.text(), /\.client-lookup-grid/);

  const appScript = await fetch(`${api}/app.js`);
  assert.equal(appScript.status, 200);
  assert.match(await appScript.text(), /async function cargarUsuarios/);
});

test('malformed JSON returns a sanitized client error', async () => {
  const response = await fetch(`${api}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid-json',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: 'Solicitud inválida' });
});

test('login accepts valid credentials and rejects invalid credentials', async () => {
  const valid = await login();
  assert.equal(valid.response.status, 200);
  assert.ok(valid.cookie);

  assert.match(valid.cookieHeader, /HttpOnly/i);
  assert.match(valid.cookieHeader, /SameSite=Lax/i);
  const invalid = await login('admin@facturapro.com', 'incorrecta');
  assert.equal(invalid.response.status, 401);
});

test('the current user can edit personal information and password', async () => {
  const { cookie } = await login();
  const update = await fetch(`${api}/api/auth/perfil`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      nombre: 'Administrador actualizado',
      email: 'admin.actualizado@test.local',
      password: 'NuevoPasswordSeguro-2026!Admin',
      avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAF',
    }),
  });

  assert.equal(update.status, 200);
  const payload = await update.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.usuario.nombre, 'Administrador actualizado');
  assert.equal(payload.usuario.email, 'admin.actualizado@test.local');
  assert.match(payload.usuario.avatar, /^data:image\//);

  const meResponse = await fetch(`${api}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(meResponse.status, 200);
  const me = await meResponse.json();
  assert.equal(me.usuario.email, 'admin.actualizado@test.local');

  const relogin = await login('admin.actualizado@test.local', 'NuevoPasswordSeguro-2026!Admin');
  assert.equal(relogin.response.status, 200);
});

test('the comprobantes endpoint filters by date range', async () => {
  const { cookie } = await login();
  const headers = { Cookie: cookie };

  const cliente = db.prepare('INSERT INTO clientes (nombre, documento) VALUES (?, ?)').run('Cliente Fechas', '77777777').lastInsertRowid;
  db.prepare('INSERT OR IGNORE INTO series (tipo, serie, ultimo_numero) VALUES (?, ?, ?)').run('factura', 'F', 0);
  db.prepare('INSERT INTO comprobantes (tipo, serie, numero, cliente_id, condicion_pago, subtotal, igv, descuento, total, afecta_igv, precios_incluyen_igv, estado, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('factura', 'F', 1, cliente, 'contado', 100, 18, 0, 118, 1, 0, 'emitido', '2026-01-12');
  db.prepare('INSERT INTO comprobantes (tipo, serie, numero, cliente_id, condicion_pago, subtotal, igv, descuento, total, afecta_igv, precios_incluyen_igv, estado, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('factura', 'F', 2, cliente, 'contado', 200, 36, 0, 236, 1, 0, 'emitido', '2026-01-25');

  const response = await fetch(`${api}/api/comprobantes?fecha_desde=2026-01-10&fecha_hasta=2026-01-20`, { headers });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].numero, 1);
  assert.equal(body.data[0].fecha.slice(0, 10), '2026-01-12');
});

test('admin can create administrator and seller accounts with separated permissions', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };
  const permissionCatalogResponse = await fetch(`${api}/api/auth/usuarios/permisos`, { headers });
  const permissionCatalog = await permissionCatalogResponse.json();
  assert.equal(permissionCatalogResponse.status, 200);
  assert.ok(permissionCatalog.data.some(group => group.permisos.some(permission => permission.id === 'inventario:ver')));
  const accounts = [
    { nombre: 'Administrador adicional', email: 'admin.adicional@test.local', password: 'AdminCuenta-2026!Seguro', rol: 'admin' },
    { nombre: 'Vendedor adicional', email: 'vendedor.adicional@test.local', password: 'VendedorCuenta-2026!Seguro', rol: 'vendedor', permisos: ['clientes:ver'] },
  ];

  for (const account of accounts) {
    const response = await fetch(`${api}/api/auth/usuarios`, {
      method: 'POST',
      headers,
      body: JSON.stringify(account),
    });
    assert.equal(response.status, 201);
  }

  const invalidRole = await fetch(`${api}/api/auth/usuarios`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...accounts[0], email: 'rol-invalido@test.local', rol: 'supervisor' }),
  });
  assert.equal(invalidRole.status, 400);

  const invalidPermission = await fetch(`${api}/api/auth/usuarios`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...accounts[1], email: 'permiso-invalido@test.local', permisos: ['inventario:acceso-total'] }),
  });
  assert.equal(invalidPermission.status, 400);

  const usersResponse = await fetch(`${api}/api/auth/usuarios`, { headers: { Cookie: cookie } });
  const users = await usersResponse.json();
  const seller = users.data.find(user => user.email === accounts[1].email);
  assert.equal(usersResponse.status, 200);
  assert.equal(seller.rol, 'vendedor');
  assert.deepEqual(seller.permisos, ['clientes:ver']);
  assert.equal(Object.hasOwn(seller, 'password'), false);

  const sellerLogin = await login(accounts[1].email, accounts[1].password);
  assert.equal(sellerLogin.response.status, 200);
  const sellerHeaders = { Cookie: sellerLogin.cookie, 'Content-Type': 'application/json' };
  const sellerClients = await fetch(`${api}/api/clientes`, { headers: sellerHeaders });
  assert.equal(sellerClients.status, 200);
  const deniedClientCreation = await fetch(`${api}/api/clientes`, {
    method: 'POST',
    headers: sellerHeaders,
    body: JSON.stringify({ nombre: 'No autorizado', documento: 'DOC-NO-AUTORIZADO' }),
  });
  assert.equal(deniedClientCreation.status, 403);
  const deniedInventoryAccess = await fetch(`${api}/api/inventario/kardex`, {
    headers: { Cookie: sellerLogin.cookie },
  });
  assert.equal(deniedInventoryAccess.status, 403);
  const sellerUsers = await fetch(`${api}/api/auth/usuarios`, {
    headers: { Cookie: sellerLogin.cookie },
  });
  assert.equal(sellerUsers.status, 403);

  const adminLogin = await login(accounts[0].email, accounts[0].password);
  assert.equal(adminLogin.response.status, 200);
  const adminUsers = await fetch(`${api}/api/auth/usuarios`, {
    headers: { Cookie: adminLogin.cookie },
  });
  assert.equal(adminUsers.status, 200);
});

test('creates a comprobante using server-calculated totals', async () => {
  const { cookie } = await login();
  const response = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      tipo: 'factura',
      cliente_id: 1,
      items: [{ producto_id: 1, cantidad: 1, precio_unitario: 0.01 }],
      total: 1,
    }),
  });
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.subtotal, 84.75);
  assert.equal(result.igv, 15.25);
  assert.equal(result.total, 100);

  const saved = db.prepare('SELECT total FROM comprobantes WHERE id = ?').get(result.id);
  assert.equal(saved.total, 100);
  const savedItem = db.prepare('SELECT precio_unitario FROM detalle_comprobante WHERE comprobante_id = ?').get(result.id);
  assert.equal(savedItem.precio_unitario, 100);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 9);

  const detailResponse = await fetch(`${api}/api/comprobantes/${result.id}`, {
    headers: { Cookie: cookie },
  });
  const detail = await detailResponse.json();
  assert.equal(detailResponse.status, 200);
  assert.equal(detail.data.id, result.id);
  assert.equal(detail.data.tipo_documento, 'DNI');
  assert.equal(detail.data.detalle.length, 1);

  const pdf = await fetch(`${api}/api/pdf/${result.id}`, {
    headers: { Cookie: cookie },
  });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

  for (const formato of ['80mm', '58mm']) {
    const ticket = await fetch(`${api}/api/pdf/${result.id}?formato=${formato}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(ticket.status, 200);
    assert.match(ticket.headers.get('content-type'), /application\/pdf/);
    assert.equal(Buffer.from(await ticket.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.match(ticket.headers.get('content-disposition'), new RegExp(`ticket-${formato}`));
  }
});

test('consults DNI and RUC through the authenticated server-side identity endpoint', async () => {
  const { cookie } = await login();
  const nativeFetch = global.fetch;
  const consultas = [];
  global.fetch = async (input, options) => {
    const url = String(input);
    if (!url.startsWith('https://api.decolecta.com/')) return nativeFetch(input, options);

    consultas.push({ url, authorization: options.headers.Authorization });
    const datos = url.includes('/reniec/')
      ? { full_name: 'ANA PEREZ', document_number: '12345678' }
      : { razon_social: 'EMPRESA DEMO SAC', numero_documento: '20123456789', direccion: 'LIMA' };
    return new Response(JSON.stringify(datos), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const dniResponse = await fetch(`${api}/api/clientes/consultar-documento/12.345.678`, {
      headers: { Cookie: cookie },
    });
    const dni = await dniResponse.json();
    assert.equal(dniResponse.status, 200);
    assert.deepEqual(dni.data, {
      tipo_documento: 'DNI',
      documento: '12345678',
      nombre: 'ANA PEREZ',
      direccion: '',
    });
    assert.equal(JSON.stringify(dni).includes('test-decolecta-token'), false);

    const rucResponse = await fetch(`${api}/api/clientes/consultar-documento/20123456789`, {
      headers: { Cookie: cookie },
    });
    const ruc = await rucResponse.json();
    assert.equal(rucResponse.status, 200);
    assert.equal(ruc.data.tipo_documento, 'RUC');
    assert.equal(consultas.length, 2);
    assert.match(consultas[0].url, /\/v1\/reniec\/dni\?numero=12345678$/);
    assert.match(consultas[1].url, /\/v1\/sunat\/ruc\?numero=20123456789$/);
    assert.equal(consultas[0].authorization, 'Bearer test-decolecta-token');
  } finally {
    global.fetch = nativeFetch;
  }
});

test('rejects a comprobante without items', async () => {
  const { cookie } = await login();
  const response = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({ tipo: 'factura', cliente_id: 1, items: [] }),
  });
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.match(result.error, /ítem/i);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM comprobantes').get().total, 1);
});

test('rejects invalid quantities, excessive discounts, unknown products and bad dates atomically', async () => {
  const { cookie } = await login();
  const invalidRequests = [
    { items: [{ producto_id: 1, cantidad: 0 }] },
    { items: [{ producto_id: 1, cantidad: 0.0000001 }] },
    { items: [{ producto_id: 1, cantidad: -1 }] },
    { items: [{ producto_id: 1, cantidad: 1, descuento_item: 100.01 }] },
    { items: [{ producto_id: 1, cantidad: 1 }], descuento: 100.01 },
    { items: [{ producto_id: 999, cantidad: 1 }] },
    {
      items: [{ producto_id: 1, cantidad: 1 }],
      condicion_pago: 'credito',
      fecha_vencimiento: '2026-02-31',
    },
  ];

  for (const invalidRequest of invalidRequests) {
    const response = await fetch(`${api}/api/comprobantes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ tipo: 'factura', cliente_id: 1, ...invalidRequest }),
    });
    assert.ok([400, 404].includes(response.status), `unexpected status ${response.status}`);
  }

  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM comprobantes').get().total, 1);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 9);
  assert.equal(db.prepare("SELECT ultimo_numero FROM series WHERE tipo = 'factura'").get().ultimo_numero, 1);
});

test('caps returns to original sold quantity and reverses stock only once', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };
  const invoice = db.prepare("SELECT id FROM comprobantes WHERE tipo = 'factura'").get();
  const returnBody = {
    tipo: 'nota_devolucion',
    cliente_id: 1,
    comprobante_ref_id: invoice.id,
    motivo_ref: 'Devolución de prueba',
    items: [{ producto_id: 1, cantidad: 1 }],
  };

  const excessiveReturn = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...returnBody, items: [{ producto_id: 1, cantidad: 2 }] }),
  });
  assert.equal(excessiveReturn.status, 400);

  const validReturn = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers,
    body: JSON.stringify(returnBody),
  });
  const returned = await validReturn.json();
  assert.equal(validReturn.status, 201);
  assert.equal(returned.total, 100);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 10);

  const duplicateReturn = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers,
    body: JSON.stringify(returnBody),
  });
  assert.equal(duplicateReturn.status, 400);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 10);

  const cancelReturn = () => fetch(`${api}/api/comprobantes/${returned.id}/estado`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ estado: 'anulado' }),
  });
  assert.equal((await cancelReturn()).status, 200);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 9);
  assert.equal((await cancelReturn()).status, 400);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 9);

  const cancelInvoice = () => fetch(`${api}/api/comprobantes/${invoice.id}/estado`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ estado: 'anulado' }),
  });
  assert.equal((await cancelInvoice()).status, 200);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 10);
  assert.equal((await cancelInvoice()).status, 400);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 10);
});

test('manual stock adjustment validates quantity and never permits negative stock', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  const invalidQuantity = await fetch(`${api}/api/productos/1/stock`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ cantidad: 1.5, operacion: 'sumar' }),
  });
  assert.equal(invalidQuantity.status, 400);

  const insufficientStock = await fetch(`${api}/api/productos/1/stock`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ cantidad: 11, operacion: 'restar' }),
  });
  assert.equal(insufficientStock.status, 400);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 10);

  const invalidProductUpdate = await fetch(`${api}/api/productos/1`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ nombre: 'Producto de prueba', precio: 100, stock: -1 }),
  });
  assert.equal(invalidProductUpdate.status, 400);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 10);
});

test('partial refunds proration preserves the original total to the cent', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };
  const saleResponse = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tipo: 'factura',
      cliente_id: 1,
      descuento: 0.01,
      items: [{ producto_id: 3, cantidad: 3 }],
    }),
  });
  const sale = await saleResponse.json();
  assert.equal(saleResponse.status, 201);
  assert.equal(sale.total, 0.29);

  const refundTotals = [];
  for (let index = 0; index < 3; index += 1) {
    const response = await fetch(`${api}/api/comprobantes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tipo: 'nota_devolucion',
        cliente_id: 1,
        comprobante_ref_id: sale.id,
        motivo_ref: 'Devolución parcial de prueba',
        items: [{ producto_id: 3, cantidad: 1 }],
      }),
    });
    const refund = await response.json();
    assert.equal(response.status, 201);
    refundTotals.push(refund.total);
  }

  assert.deepEqual(refundTotals, [0.09, 0.09, 0.11]);
  assert.equal(Number(refundTotals.reduce((sum, amount) => sum + amount, 0).toFixed(2)), sale.total);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 3').get().stock, 3);
});

test('catalog prices with decimal fractions round half-up to cents', async () => {
  const { cookie } = await login();
  const createdProduct = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ nombre: 'Precio redondeado', precio: 1.005, stock: 1 }),
  });
  const createdProductResult = await createdProduct.json();
  assert.equal(createdProduct.status, 201);
  assert.equal(db.prepare('SELECT precio FROM productos WHERE id = ?')
    .get(createdProductResult.id).precio, 1.01);

  const response = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      tipo: 'factura',
      cliente_id: 1,
      items: [{ producto_id: 4, cantidad: 1 }],
    }),
  });
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.subtotal, 0.86);
  assert.equal(result.igv, 0.15);
  assert.equal(result.total, 1.01);
});

test('sales use the selected product price type', async () => {
  const { cookie } = await login();
  const createdProduct = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      nombre: 'Producto con precios por tipo',
      precio: 100,
      precio_rebaja: 80,
      precio_pase: 60,
      stock: 2,
    }),
  });
  const createdProductResult = await createdProduct.json();
  assert.equal(createdProduct.status, 201);

  const response = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      tipo: 'boleta',
      cliente_id: 1,
      items: [{ producto_id: createdProductResult.id, cantidad: 1, tipo_precio: 'rebaja' }],
    }),
  });
  const result = await response.json();
  const detalle = db.prepare('SELECT precio_unitario, tipo_precio FROM detalle_comprobante WHERE comprobante_id = ?')
    .get(result.id);

  assert.equal(response.status, 201);
  assert.equal(result.subtotal, 67.8);
  assert.equal(result.igv, 12.2);
  assert.equal(result.total, 80);
  assert.equal(detalle.precio_unitario, 80);
  assert.equal(detalle.tipo_precio, 'rebaja');
});

test('catalog products support commercial metadata, filters and duplicate validation', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  const created = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      nombre: 'Producto comercial',
      codigo_interno: 'INT-001',
      sku: 'SKU-001',
      codigo_barras: '7788990012345',
      marca: 'Marca Demo',
      categoria: 'Limpieza',
      unidad_medida: 'UND',
      precio_compra: 18,
      precio: 32,
      precio_rebaja: 28,
      precio_pase: 26,
      stock: 12,
      stock_minimo: 2,
      stock_maximo: 50,
      imagen: 'https://example.com/product.png',
      activo: true,
      igv: true,
      ubicacion: 'A-01',
      descripcion: 'Producto con metadatos comerciales',
    }),
  });
  const createdResult = await created.json();
  assert.equal(created.status, 201);
  assert.equal(createdResult.id > 0, true);

  const saved = db.prepare(`
    SELECT codigo_interno, sku, codigo_barras, marca, unidad_medida, stock_minimo, stock_maximo,
           imagen, activo, igv, ubicacion
    FROM productos WHERE id = ?
  `).get(createdResult.id);
  assert.equal(saved.codigo_interno, 'INT-001');
  assert.equal(saved.sku, 'SKU-001');
  assert.equal(saved.marca, 'Marca Demo');
  assert.equal(saved.stock_minimo, 2);
  assert.equal(saved.activo, 1);
  assert.equal(saved.igv, 1);

  const duplicate = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      nombre: 'Producto duplicado',
      sku: 'SKU-001',
      precio: 40,
      stock: 1,
    }),
  });
  assert.equal(duplicate.status, 409);

  const filtered = await fetch(`${api}/api/productos?search=SKU-001&activo=1&limit=10&offset=0&sort=stock&order=desc`, {
    headers,
  });
  const filteredResult = await filtered.json();
  assert.equal(filtered.status, 200);
  assert.ok(filteredResult.data.some(product => product.sku === 'SKU-001'));
});

test('records warehouse movements and kardex entries with transactional stock validation', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  const createdProduct = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      nombre: 'Producto para kardex',
      precio: 20,
      precio_compra: 12,
      stock: 0,
    }),
  });
  const createdProductResult = await createdProduct.json();
  assert.equal(createdProduct.status, 201);

  const warehouse = await fetch(`${api}/api/inventario/almacenes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ nombre: 'Almacén principal', codigo: 'ALM-01', tipo: 'principal' }),
  });
  const warehouseResult = await warehouse.json();
  assert.equal(warehouse.status, 201);

  const entrada = await fetch(`${api}/api/inventario/movimientos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      producto_id: createdProductResult.id,
      almacen_id: warehouseResult.id,
      tipo: 'ENTRADA',
      cantidad: 10,
      costo_unitario: 15,
      documento_relacionado: 'OC-1001',
      observacion: 'Compra inicial',
    }),
  });
  const entradaResult = await entrada.json();
  assert.equal(entrada.status, 201);
  assert.equal(entradaResult.stock_anterior, 0);
  assert.equal(entradaResult.stock_posterior, 10);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = ?').get(createdProductResult.id).stock, 10);

  const salida = await fetch(`${api}/api/inventario/movimientos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      producto_id: createdProductResult.id,
      almacen_id: warehouseResult.id,
      tipo: 'VENTA',
      cantidad: 4,
      costo_unitario: 15,
      documento_relacionado: 'FV-2001',
      observacion: 'Venta de prueba',
    }),
  });
  const salidaResult = await salida.json();
  assert.equal(salida.status, 201);
  assert.equal(salidaResult.stock_anterior, 10);
  assert.equal(salidaResult.stock_posterior, 6);

  const kardex = await fetch(`${api}/api/inventario/kardex?producto_id=${createdProductResult.id}`, { headers });
  const kardexResult = await kardex.json();
  assert.equal(kardex.status, 200);
  assert.equal(kardexResult.data.length, 2);
  assert.equal(kardexResult.data[0].tipo, 'ENTRADA');
  assert.equal(kardexResult.data[1].tipo, 'VENTA');

  const invalid = await fetch(`${api}/api/inventario/movimientos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      producto_id: createdProductResult.id,
      almacen_id: warehouseResult.id,
      tipo: 'SALIDA',
      cantidad: 20,
      costo_unitario: 15,
      documento_relacionado: 'OV-ERR',
    }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = ?').get(createdProductResult.id).stock, 6);
});

test('filters kardex entries by movement type and date range', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  const product = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ nombre: 'Producto con kardex filtrable', precio: 25, stock: 0 }),
  });
  const productResult = await product.json();
  assert.equal(product.status, 201);

  const warehouse = await fetch(`${api}/api/inventario/almacenes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ nombre: 'Almacén de kardex filtrable', codigo: 'ALM-KARDEX-FILTRO' }),
  });
  const warehouseResult = await warehouse.json();
  assert.equal(warehouse.status, 201);

  for (const [tipo, cantidad] of [['ENTRADA', 5], ['SALIDA', 2]]) {
    const movement = await fetch(`${api}/api/inventario/movimientos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        producto_id: productResult.id,
        almacen_id: warehouseResult.id,
        tipo,
        cantidad,
      }),
    });
    assert.equal(movement.status, 201);
  }

  const kardex = await fetch(
    `${api}/api/inventario/kardex?producto_id=${productResult.id}&tipo=ENTRADA&desde=2000-01-01&hasta=2099-12-31`,
    { headers }
  );
  const kardexResult = await kardex.json();

  assert.equal(kardex.status, 200);
  assert.equal(kardexResult.data.length, 1);
  assert.equal(kardexResult.data[0].tipo, 'ENTRADA');

  const invalidDate = await fetch(`${api}/api/inventario/kardex?desde=2026-02-30`, { headers });
  assert.equal(invalidDate.status, 400);
});

test('manages suppliers with search, duplicate protection and soft deactivation', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  const created = await fetch(`${api}/api/proveedores`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      documento: '20555555551',
      razon_social: 'Distribuidora Central SAC',
      direccion: 'Av. Comercio 100',
      telefono: '999111222',
      email: 'ventas@distribuidor.local',
    }),
  });
  const supplier = await created.json();
  assert.equal(created.status, 201);

  const searched = await fetch(`${api}/api/proveedores?buscar=Central`, { headers });
  const searchResult = await searched.json();
  assert.equal(searched.status, 200);
  assert.ok(searchResult.data.some(item => item.id === supplier.id));

  const duplicate = await fetch(`${api}/api/proveedores`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ documento: '20555555551', razon_social: 'Otro nombre' }),
  });
  assert.equal(duplicate.status, 409);

  const updated = await fetch(`${api}/api/proveedores/${supplier.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ documento: '20555555551', razon_social: 'Distribuidora Central Actualizada' }),
  });
  assert.equal(updated.status, 200);

  const deactivated = await fetch(`${api}/api/proveedores/${supplier.id}/estado`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ activo: false }),
  });
  assert.equal(deactivated.status, 200);

  const activeList = await fetch(`${api}/api/proveedores`, { headers });
  const activeResult = await activeList.json();
  assert.ok(!activeResult.data.some(item => item.id === supplier.id));

  const { cookie: sellerCookie } = await login('vendedor@test.local', 'VendedorSeguro-2026!Pass');
  const sellerRequest = await fetch(`${api}/api/proveedores`, {
    headers: { Cookie: sellerCookie },
  });
  assert.equal(sellerRequest.status, 403);
});

test('records purchase documents and updates stock from receipt', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  const createdProduct = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      nombre: 'Producto para compra',
      precio: 25,
      precio_compra: 15,
      stock: 0,
    }),
  });
  const productResult = await createdProduct.json();
  assert.equal(createdProduct.status, 201);

  const warehouse = await fetch(`${api}/api/inventario/almacenes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ nombre: 'Almacén compras', codigo: 'ALM-02', tipo: 'principal' }),
  });
  const warehouseResult = await warehouse.json();
  assert.equal(warehouse.status, 201);

  const compra = await fetch(`${api}/api/compras`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tipo: 'factura',
      orden_compra: 'OC-2001',
      serie: 'F001',
      numero: '1001',
      condicion_pago: 'contado',
      fecha_factura: '2026-10-01',
      fecha_ingreso: '2026-10-01',
      proveedor_documento: '20456789012',
      proveedor_razon_social: 'Proveedor de compra',
      proveedor_direccion: 'Av. Compra 123',
      moneda: 'PEN',
      tipo_cambio: 1,
      estado: 'pendiente',
      producto_id: productResult.id,
      cantidad: 12,
      costo_unitario: 18,
      almacen_id: warehouseResult.id,
    }),
  });
  const compraResult = await compra.json();
  assert.equal(compra.status, 201);
  assert.equal(compraResult.producto_id, productResult.id);
  assert.equal(compraResult.cantidad, 12);

  const productSaved = db.prepare('SELECT stock, precio_compra FROM productos WHERE id = ?').get(productResult.id);
  assert.equal(productSaved.stock, 12);
  assert.equal(productSaved.precio_compra, 18);

  const kardex = await fetch(`${api}/api/inventario/kardex?producto_id=${productResult.id}`, { headers });
  const kardexResult = await kardex.json();
  assert.equal(kardex.status, 200);
  assert.ok(kardexResult.data.some(item => item.tipo === 'COMPRA' && item.stock_posterior === 12));
});

test('filters purchase history by supplier, payment status and inclusive dates', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  const documents = [
    { proveedor_documento: '20444444441', proveedor_razon_social: 'Proveedor Filtro Norte', condicion_pago: 'credito', estado: 'pendiente', fecha_factura: '2026-10-01' },
    { proveedor_documento: '20444444442', proveedor_razon_social: 'Proveedor Filtro Sur', condicion_pago: 'credito', estado: 'pendiente', fecha_factura: '2026-10-01' },
    { proveedor_documento: '20444444441', proveedor_razon_social: 'Proveedor Filtro Norte', condicion_pago: 'contado', estado: 'pagado', fecha_factura: '2026-09-30' },
  ];
  const ids = [];
  for (const document of documents) {
    const response = await fetch(`${api}/api/compras`, {
      method: 'POST',
      headers,
      body: JSON.stringify(document),
    });
    const result = await response.json();
    assert.equal(response.status, 201);
    ids.push(result.id);
  }

  const response = await fetch(
    `${api}/api/compras?buscar=Filtro%20Norte&condicion_pago=credito&estado=pendiente&desde=2026-10-01&hasta=2026-10-01`,
    { headers: { Cookie: cookie } }
  );
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result.data.map(document => document.id), [ids[0]]);

  const invalidRange = await fetch(`${api}/api/compras?desde=2026-10-01`, {
    headers: { Cookie: cookie },
  });
  assert.equal(invalidRange.status, 400);
});

test('records a payment date only for credit purchases', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  const credit = await fetch(`${api}/api/compras`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tipo: 'factura',
      condicion_pago: 'credito',
      proveedor_documento: '20411111111',
      proveedor_razon_social: 'Proveedor crédito',
      fecha_factura: '2026-10-01',
    }),
  });
  const creditResult = await credit.json();
  assert.equal(credit.status, 201);

  const payment = await fetch(`${api}/api/compras/${creditResult.id}/pago`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ fecha_pago: '2026-10-01' }),
  });
  const paymentResult = await payment.json();
  assert.equal(payment.status, 200);
  assert.equal(paymentResult.data.estado, 'pagado');
  assert.equal(paymentResult.data.fecha_pago, '2026-10-01');

  const invalidDate = await fetch(`${api}/api/compras/${creditResult.id}/pago`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ fecha_pago: '2026-02-30' }),
  });
  assert.equal(invalidDate.status, 400);

  const cash = await fetch(`${api}/api/compras`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tipo: 'factura',
      condicion_pago: 'contado',
      proveedor_documento: '20422222222',
      proveedor_razon_social: 'Proveedor contado',
    }),
  });
  const cashResult = await cash.json();
  assert.equal(cash.status, 201);

  const invalidPayment = await fetch(`${api}/api/compras/${cashResult.id}/pago`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ fecha_pago: '2026-10-01' }),
  });
  assert.equal(invalidPayment.status, 409);
});

test('records partial purchase payments and prevents paying beyond the balance', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  const productResponse = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ nombre: 'Producto cuenta parcial', precio: 30, stock: 0 }),
  });
  const product = await productResponse.json();
  assert.equal(productResponse.status, 201);

  const purchaseResponse = await fetch(`${api}/api/compras`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      condicion_pago: 'credito',
      proveedor_documento: '20433333331',
      proveedor_razon_social: 'Proveedor pagos parciales',
      producto_id: product.id,
      cantidad: 5,
      costo_unitario: 20,
    }),
  });
  const purchase = await purchaseResponse.json();
  assert.equal(purchaseResponse.status, 201);

  const firstPayment = await fetch(`${api}/api/compras/${purchase.id}/pagos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ monto: 30, fecha_pago: '2026-10-01', metodo_pago: 'transferencia' }),
  });
  const firstResult = await firstPayment.json();
  assert.equal(firstPayment.status, 201);
  assert.equal(firstResult.data.estado, 'parcial');
  assert.equal(firstResult.data.saldo_pendiente_pen, 70);

  const payablesResponse = await fetch(
    `${api}/api/reportes/cuentas-por-pagar?desde=2026-10-01&hasta=2026-10-01`,
    { headers: { Cookie: cookie } }
  );
  const payables = await payablesResponse.json();
  const supplierBalance = payables.por_proveedor.find(item => item.proveedor_documento === '20433333331');
  assert.equal(payables.resumen.saldo_estimado_pen, 70);
  assert.equal(payables.resumen.monto_pagado_pen, 30);
  assert.equal(supplierBalance.saldo_estimado_pen, 70);

  const partialHistoryResponse = await fetch(`${api}/api/compras`, { headers: { Cookie: cookie } });
  const partialHistory = await partialHistoryResponse.json();
  const partialDocument = partialHistory.data.find(documento => documento.id === purchase.id);
  assert.equal(partialDocument.pagos.length, 1);
  assert.equal(partialDocument.monto_pagado_pen, 30);
  assert.equal(partialDocument.saldo_pendiente_pen, 70);

  const overpayment = await fetch(`${api}/api/compras/${purchase.id}/pagos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ monto: 71, fecha_pago: '2026-10-02', metodo_pago: 'efectivo' }),
  });
  assert.equal(overpayment.status, 400);

  const finalPayment = await fetch(`${api}/api/compras/${purchase.id}/pagos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ monto: 70, fecha_pago: '2026-10-03', metodo_pago: 'efectivo' }),
  });
  const finalResult = await finalPayment.json();
  assert.equal(finalPayment.status, 201);
  assert.equal(finalResult.data.estado, 'pagado');
  assert.equal(finalResult.data.saldo_pendiente_pen, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM pagos_documento_compra WHERE documento_compra_id = ?').get(purchase.id).total, 2);
  const finalHistoryResponse = await fetch(`${api}/api/compras`, { headers: { Cookie: cookie } });
  const finalHistory = await finalHistoryResponse.json();
  const settledDocument = finalHistory.data.find(documento => documento.id === purchase.id);
  assert.equal(settledDocument.pagos.length, 2);
  assert.equal(settledDocument.saldo_pendiente_pen, 0);
});

test('receives multiple purchase items atomically into stock and kardex', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  const productIds = [];
  for (const nombre of ['Producto lote A', 'Producto lote B']) {
    const response = await fetch(`${api}/api/productos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ nombre, precio: 20, precio_compra: 8, stock: 0 }),
    });
    const result = await response.json();
    assert.equal(response.status, 201);
    productIds.push(result.id);
  }

  const warehouseResponse = await fetch(`${api}/api/inventario/almacenes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ nombre: 'Almacén lote compra', codigo: 'ALM-LOTE-COMPRA' }),
  });
  const warehouse = await warehouseResponse.json();
  assert.equal(warehouseResponse.status, 201);

  const invalidPurchase = await fetch(`${api}/api/compras`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      proveedor_documento: '20400000001',
      proveedor_razon_social: 'Proveedor lote',
      items: [
        { producto_id: productIds[0], cantidad: 4, costo_unitario: 9 },
        { producto_id: 999999, cantidad: 2, costo_unitario: 5 },
      ],
    }),
  });
  assert.equal(invalidPurchase.status, 404);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = ?').get(productIds[0]).stock, 0);

  const purchaseBody = new FormData();
  purchaseBody.set('proveedor_documento', '20400000001');
  purchaseBody.set('proveedor_razon_social', 'Proveedor lote');
  purchaseBody.set('serie', 'F002');
  purchaseBody.set('numero', '1002');
  purchaseBody.set('fecha_ingreso', '2026-10-01');
  purchaseBody.set('condicion_pago', 'credito');
  purchaseBody.set('almacen_id', String(warehouse.id));
  purchaseBody.set('items', JSON.stringify([
    { producto_id: productIds[0], cantidad: 4, costo_unitario: 9 },
    { producto_id: productIds[1], cantidad: 3, costo_unitario: 12 },
  ]));
  const purchase = await fetch(`${api}/api/compras`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: purchaseBody,
  });
  const result = await purchase.json();

  assert.equal(purchase.status, 201);
  assert.equal(result.productos_registrados.length, 2);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = ?').get(productIds[0]).stock, 4);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = ?').get(productIds[1]).stock, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM detalle_documento_compra WHERE documento_compra_id = ?').get(result.id).total, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM kardex_movimientos WHERE documento_relacionado = ? AND tipo = 'COMPRA'").get(`DOC-${result.id}`).total, 2);

  const historyResponse = await fetch(`${api}/api/compras`, { headers: { Cookie: cookie } });
  const history = await historyResponse.json();
  const purchaseHistory = history.data.find(documento => documento.id === result.id);
  assert.equal(historyResponse.status, 200);
  assert.equal(purchaseHistory.items.length, 2);
  assert.equal(purchaseHistory.items[0].producto_nombre, 'Producto lote A');

  const reportResponse = await fetch(
    `${api}/api/reportes/compras?desde=2026-10-01&hasta=2026-10-01`,
    { headers: { Cookie: cookie } }
  );
  const report = await reportResponse.json();
  assert.equal(reportResponse.status, 200);
  assert.ok(report.por_proveedor.some(item => item.proveedor_documento === '20400000001' && item.unidades_recibidas === 7));
  assert.ok(report.por_producto.some(item => item.producto_id === productIds[0] && item.unidades_recibidas === 4));

  const payablesResponse = await fetch(
    `${api}/api/reportes/cuentas-por-pagar?desde=2026-10-01&hasta=2026-10-01`,
    { headers: { Cookie: cookie } }
  );
  const payables = await payablesResponse.json();
  assert.equal(payablesResponse.status, 200);
  assert.equal(payables.resumen.saldo_estimado_pen, 72);
  assert.ok(payables.por_proveedor.some(item => item.proveedor_documento === '20400000001'));

  const exportResponse = await fetch(
    `${api}/api/reportes/compras/exportar?desde=2026-10-01&hasta=2026-10-01`,
    { headers: { Cookie: cookie } }
  );
  assert.equal(exportResponse.status, 200);
  const XLSX = require('xlsx');
  const workbook = XLSX.read(Buffer.from(await exportResponse.arrayBuffer()), { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['Recepciones', 'Cuentas por pagar']);
  const receptionRows = XLSX.utils.sheet_to_json(workbook.Sheets['Recepciones']);
  const payableRows = XLSX.utils.sheet_to_json(workbook.Sheets['Cuentas por pagar']);
  assert.ok(receptionRows.some(item => item.documento_id === result.id && item.producto_nombre === 'Producto lote A'));
  assert.ok(payableRows.some(item => item.documento_id === result.id && item.saldo_pendiente_pen === 72));

  const payment = await fetch(`${api}/api/compras/${result.id}/pago`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ fecha_pago: '2026-10-01' }),
  });
  assert.equal(payment.status, 200);
  const afterPaymentResponse = await fetch(
    `${api}/api/reportes/cuentas-por-pagar?desde=2026-10-01&hasta=2026-10-01`,
    { headers: { Cookie: cookie } }
  );
  const afterPayment = await afterPaymentResponse.json();
  assert.ok(!afterPayment.por_proveedor.some(item => item.proveedor_documento === '20400000001'));

  const invalidRange = await fetch(`${api}/api/reportes/compras?desde=2026-02-30&hasta=2026-03-01`, {
    headers: { Cookie: cookie },
  });
  assert.equal(invalidRange.status, 400);
});

test('supports warehouse transfers and manual stock adjustments without changing total inventory', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  const createdProduct = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      nombre: 'Producto para traslado',
      precio: 30,
      precio_compra: 18,
      stock: 10,
    }),
  });
  const productResult = await createdProduct.json();
  assert.equal(createdProduct.status, 201);

  const origin = await fetch(`${api}/api/inventario/almacenes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ nombre: 'Almacén origen', codigo: 'ALM-ORIGEN', tipo: 'principal' }),
  });
  const originResult = await origin.json();
  assert.equal(origin.status, 201);

  const destiny = await fetch(`${api}/api/inventario/almacenes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ nombre: 'Almacén destino', codigo: 'ALM-DESTINO', tipo: 'secundario' }),
  });
  const destinyResult = await destiny.json();
  assert.equal(destiny.status, 201);

  const transfer = await fetch(`${api}/api/inventario/movimientos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      producto_id: productResult.id,
      origen_almacen_id: originResult.id,
      destino_almacen_id: destinyResult.id,
      tipo: 'TRANSFERENCIA',
      cantidad: 3,
      costo_unitario: 18,
      documento_relacionado: 'TR-1001',
      observacion: 'Traslado entre almacenes',
    }),
  });
  const transferResult = await transfer.json();
  assert.equal(transfer.status, 201);
  assert.equal(transferResult.stock_anterior, 10);
  assert.equal(transferResult.stock_posterior, 10);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = ?').get(productResult.id).stock, 10);

  const adjustment = await fetch(`${api}/api/inventario/movimientos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      producto_id: productResult.id,
      almacen_id: destinyResult.id,
      tipo: 'AJUSTE',
      cantidad: 2,
      costo_unitario: 18,
      documento_relacionado: 'AJ-1001',
      observacion: 'Ajuste manual',
    }),
  });
  const adjustmentResult = await adjustment.json();
  assert.equal(adjustment.status, 201);
  assert.equal(adjustmentResult.stock_posterior, 12);

  const kardex = await fetch(`${api}/api/inventario/kardex?producto_id=${productResult.id}`, { headers });
  const kardexResult = await kardex.json();
  assert.equal(kardex.status, 200);
  assert.ok(kardexResult.data.some(item => item.tipo === 'TRANSFERENCIA'));
  assert.ok(kardexResult.data.some(item => item.tipo === 'AJUSTE'));
});

test('summarizes stock and low-stock alerts by warehouse', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  const product = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      nombre: 'Producto con alertas',
      precio: 40,
      precio_compra: 20,
      stock: 3,
      stock_minimo: 10,
    }),
  });
  const productResult = await product.json();
  assert.equal(product.status, 201);

  const warehouse = await fetch(`${api}/api/inventario/almacenes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ nombre: 'Almacén de alertas', codigo: 'ALM-ALERT', tipo: 'principal' }),
  });
  const warehouseResult = await warehouse.json();
  assert.equal(warehouse.status, 201);

  const movement = await fetch(`${api}/api/inventario/movimientos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      producto_id: productResult.id,
      almacen_id: warehouseResult.id,
      tipo: 'AJUSTE',
      cantidad: 3,
      costo_unitario: 20,
      documento_relacionado: 'AJ-ALERT',
      observacion: 'Nivel bajo',
    }),
  });
  assert.equal(movement.status, 201);

  const summary = await fetch(`${api}/api/inventario/resumen`, { headers });
  const summaryResult = await summary.json();
  assert.equal(summary.status, 200);
  assert.ok(summaryResult.data.stock_total >= 6);
  assert.ok(summaryResult.data.alertas.some(item => item.id === productResult.id && item.stock <= item.stock_minimo));
  assert.ok(summaryResult.data.por_almacen.some(item => item.almacen_id === warehouseResult.id));
});

test('lists low-stock alerts in the reporting module', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  const product = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      nombre: 'Producto en alerta reportada',
      precio: 55,
      precio_compra: 30,
      stock: 4,
      stock_minimo: 8,
    }),
  });
  const productResult = await product.json();
  assert.equal(product.status, 201);

  const response = await fetch(`${api}/api/reportes/alertas-stock`, { headers });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.ok(result.data.some(item => item.id === productResult.id && item.stock <= item.stock_minimo));
  assert.ok(result.resumen.total_alertas >= 1);
});

test('concurrent sales cannot consume the same stock or reserve duplicate numbers', async () => {
  const { cookie } = await login();
  const request = () => fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      tipo: 'factura',
      cliente_id: 1,
      items: [{ producto_id: 2, cantidad: 1 }],
    }),
  });

  const responses = await Promise.all([request(), request()]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 400]);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 2').get().stock, 0);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS total
    FROM detalle_comprobante
    WHERE producto_id = 2
  `).get().total, 1);
  assert.equal(db.prepare("SELECT ultimo_numero FROM series WHERE tipo = 'factura'").get().ultimo_numero, 4);
});

test('seller can perform allowed work but receives 403 for restricted actions', async () => {
  const { cookie } = await login('vendedor@test.local', 'VendedorSeguro-2026!Pass');
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

  const clients = await fetch(`${api}/api/clientes`, { headers });
  assert.equal(clients.status, 200);

  const reports = await fetch(`${api}/api/reportes/resumen`, { headers });
  assert.equal(reports.status, 200);

  const users = await fetch(`${api}/api/auth/usuarios`, { headers });
  assert.equal(users.status, 403);

  const adminSession = await login();
  const adminUsers = await fetch(`${api}/api/auth/usuarios`, {
    headers: { Cookie: adminSession.cookie },
  });
  assert.equal(adminUsers.status, 200);

  const createClient = await fetch(`${api}/api/clientes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      nombre: 'Cliente creado por vendedor',
      documento: '20123456789',
      tipo_documento: 'RUC',
    }),
  });
  assert.equal(createClient.status, 201);
  assert.equal(db.prepare('SELECT tipo_documento FROM clientes WHERE documento = ?').get('20123456789').tipo_documento, 'RUC');

  const createProduct = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ nombre: 'No autorizado', precio: 10 }),
  });
  assert.equal(createProduct.status, 403);

  const adjustStock = await fetch(`${api}/api/productos/1/stock`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ cantidad: 1, operacion: 'sumar' }),
  });
  assert.equal(adjustStock.status, 403);

  const invoiceId = db.prepare('SELECT id FROM comprobantes LIMIT 1').get().id;
  const cancelInvoice = await fetch(`${api}/api/comprobantes/${invoiceId}/estado`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ estado: 'anulado' }),
  });
  assert.equal(cancelInvoice.status, 403);

  const refund = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tipo: 'nota_devolucion',
      cliente_id: 1,
      items: [{ producto_id: 1, cantidad: 1 }],
    }),
  });
  assert.equal(refund.status, 403);
});

test('profile updates cannot change the account role or permissions', async () => {
  const { cookie } = await login('vendedor@test.local', 'VendedorSeguro-2026!Pass');
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  const profile = await fetch(`${api}/api/auth/me`, { headers: { Cookie: cookie } });
  const { usuario } = await profile.json();

  const update = await fetch(`${api}/api/auth/perfil`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      nombre: usuario.nombre,
      email: usuario.email,
      rol: 'admin',
      permisos: ['*'],
    }),
  });
  assert.equal(update.status, 200);
  assert.equal(db.prepare('SELECT rol FROM usuarios WHERE id = ?').get(usuario.id).rol, 'vendedor');

  const restrictedWrite = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ nombre: 'Producto no autorizado', precio: 10 }),
  });
  assert.equal(restrictedWrite.status, 403);
});

test('generates a PDF for a long document with many product rows', async () => {
  const { cookie } = await login();
  const productResponse = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      nombre: 'Producto con una descripción extraordinariamente larga para verificar el salto de línea en impresión térmica',
      precio: 10,
      precio_rebaja: 9,
      precio_pase: 8,
      stock: 30,
    }),
  });
  const product = await productResponse.json();
  assert.equal(productResponse.status, 201);

  const saleResponse = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      tipo: 'boleta',
      cliente_id: 1,
      items: Array.from({ length: 20 }, () => ({ producto_id: product.id, cantidad: 1 })),
    }),
  });
  const sale = await saleResponse.json();
  assert.equal(saleResponse.status, 201);

  const pdf = await fetch(`${api}/api/pdf/${sale.id}?formato=80mm`, { headers: { Cookie: cookie } });
  assert.equal(pdf.status, 200);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});

test('accepts yape and bcp payment methods with optional evidence', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  const productResponse = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ nombre: 'Producto pago digital', precio: 80, stock: 10 }),
  });
  const product = await productResponse.json();
  assert.equal(productResponse.status, 201);

  const invoiceResponse = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tipo: 'factura',
      cliente_id: 1,
      condicion_pago: 'credito',
      fecha_vencimiento: '2026-10-20',
      items: [{ producto_id: product.id, cantidad: 1 }],
    }),
  });
  const invoice = await invoiceResponse.json();
  assert.equal(invoiceResponse.status, 201);

  const yapePayment = await fetch(`${api}/api/comprobantes/${invoice.id}/pagos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ monto: 40, fecha_pago: '2026-10-01', metodo_pago: 'yape' }),
  });
  const yapeResult = await yapePayment.json();
  assert.equal(yapePayment.status, 201);
  assert.equal(yapeResult.data.estado, 'parcial');

  const bcpPayment = await fetch(`${api}/api/comprobantes/${invoice.id}/pagos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      monto: 40,
      fecha_pago: '2026-10-02',
      metodo_pago: 'bcp',
      referencia: 'Evidencia: transferencia 123456',
    }),
  });
  const bcpResult = await bcpPayment.json();
  assert.equal(bcpPayment.status, 201);
  assert.equal(bcpResult.data.estado, 'pagado');
  assert.equal(bcpResult.data.saldo_pendiente, 0);
});

test('collects partial credit-invoice payments and reports net receivables', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  const productResponse = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ nombre: 'Producto por cobrar', precio: 118, stock: 5 }),
  });
  const product = await productResponse.json();
  assert.equal(productResponse.status, 201);

  const invoiceResponse = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tipo: 'factura',
      cliente_id: 1,
      condicion_pago: 'credito',
      fecha_vencimiento: '2026-10-20',
      items: [{ producto_id: product.id, cantidad: 1 }],
    }),
  });
  const invoice = await invoiceResponse.json();
  assert.equal(invoiceResponse.status, 201);

  const firstPayment = await fetch(`${api}/api/comprobantes/${invoice.id}/pagos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ monto: 30, fecha_pago: '2026-10-01', metodo_pago: 'transferencia' }),
  });
  const firstResult = await firstPayment.json();
  assert.equal(firstPayment.status, 201);
  assert.equal(firstResult.data.estado, 'parcial');
  assert.equal(firstResult.data.saldo_pendiente, invoice.total - 30);

  const overpayment = await fetch(`${api}/api/comprobantes/${invoice.id}/pagos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ monto: invoice.total, fecha_pago: '2026-10-02', metodo_pago: 'efectivo' }),
  });
  assert.equal(overpayment.status, 400);

  const today = new Date().toISOString().slice(0, 10);
  const receivablesResponse = await fetch(
    `${api}/api/reportes/cuentas-por-cobrar?desde=${today}&hasta=${today}`,
    { headers: { Cookie: cookie } }
  );
  const receivables = await receivablesResponse.json();
  assert.equal(receivablesResponse.status, 200);
  assert.equal(receivables.resumen.monto_cobrado, 30);
  assert.equal(receivables.resumen.saldo_pendiente, invoice.total - 30);
  assert.ok(receivables.data.some(item => item.comprobante_id === invoice.id && item.vencido === 0));

  const detailResponse = await fetch(`${api}/api/comprobantes/${invoice.id}`, {
    headers: { Cookie: cookie },
  });
  const detail = await detailResponse.json();
  assert.equal(detailResponse.status, 200);
  assert.equal(detail.data.pagos.length, 1);
  assert.equal(detail.data.pagos[0].monto, 30);
  assert.equal(detail.data.saldo_pendiente, invoice.total - 30);

  const exportResponse = await fetch(
    `${api}/api/reportes/cuentas-por-cobrar/exportar?desde=${today}&hasta=${today}`,
    { headers: { Cookie: cookie } }
  );
  assert.equal(exportResponse.status, 200);
  const XLSX = require('xlsx');
  const workbook = XLSX.read(Buffer.from(await exportResponse.arrayBuffer()), { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['Cuentas por cobrar', 'Resumen por cliente']);
  const accounts = XLSX.utils.sheet_to_json(workbook.Sheets['Cuentas por cobrar']);
  assert.ok(accounts.some(item => item.comprobante_id === invoice.id && item.saldo_pendiente === invoice.total - 30));

  const finalPayment = await fetch(`${api}/api/comprobantes/${invoice.id}/pagos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ monto: invoice.total - 30, fecha_pago: '2026-10-03', metodo_pago: 'efectivo' }),
  });
  const finalResult = await finalPayment.json();
  assert.equal(finalPayment.status, 201);
  assert.equal(finalResult.data.estado, 'pagado');
  assert.equal(finalResult.data.saldo_pendiente, 0);

  const annulment = await fetch(`${api}/api/comprobantes/${invoice.id}/estado`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ estado: 'anulado' }),
  });
  assert.equal(annulment.status, 409);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = ?').get(product.id).stock, 4);
});