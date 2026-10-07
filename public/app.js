const API = '/api';

// Helper: todas las llamadas a la API deben enviar la cookie de sesión
function apiFetch(url, options = {}) {
  return fetch(url, { ...options, credentials: 'include' });
}

let facturasData = [];
let usuarioActual = null;
let clientesData = [];
let clientesFacturaData = [];
let productosData = [];
let productosVentaData = [];
let clientesVentaData = [];
let carritoVenta = [];
let tipoVentaActual = 'boleta';
let itemsFactura = [];
let facturaIdActual = null;
let gruposPermisosUsuarios = [];
let permisosPredeterminadosVendedor = [];

// ===== NAVEGACIÓN =====
function goTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick') === `goTo('${page}')`) n.classList.add('active');
  });
  const titles = { dashboard: 'Dashboard', ventas: 'Ventas', facturas: 'Comprobantes', clientes: 'Clientes', productos: 'Productos', compras: 'Compras', reportes: 'Reportes', usuarios: 'Usuarios' };
  document.getElementById('page-title').textContent = titles[page] || page;

  if (page === 'dashboard') cargarDashboard();
  if (page === 'ventas') cargarVentas();
  if (page === 'facturas') cargarFacturas();
  if (page === 'clientes') cargarClientes();
  if (page === 'productos') cargarProductos();
  if (page === 'compras') cargarCompras();
  if (page === 'reportes') cargarReportes();
  if (page === 'usuarios') cargarUsuarios();
}

// ===== TOAST =====
function toast(msg, tipo = 'success') {
  const t = document.getElementById('toast');
  t.textContent = (tipo === 'success' ? '✓ ' : '✕ ') + msg;
  t.className = 'show ' + tipo;
  setTimeout(() => t.className = '', 3000);
}

// ===== MODAL =====
function cerrarModal(id) { document.getElementById(id).classList.remove('open'); }
function abrirModal(id) { document.getElementById(id).classList.add('open'); }

// ===== FECHA =====
document.getElementById('fecha-top').textContent = new Date().toLocaleDateString('es-PE', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

// ===== DASHBOARD =====
async function cargarDashboard() {
  try {
    const r = await apiFetch(`${API}/reportes/resumen`);
    const d = await r.json();
    if (!d.ok) return;
    const { ventas_hoy, ventas_mes, clientes, productos, facturas, productos_stock_bajo, por_cobrar_credito } = d.data;
    document.getElementById('stat-hoy').textContent = 'S/ ' + ventas_hoy.toFixed(2);
    document.getElementById('stat-mes').textContent = 'S/ ' + ventas_mes.toFixed(2);
    document.getElementById('stat-clientes').textContent = clientes;
    document.getElementById('stat-productos').textContent = productos;
    document.getElementById('stat-facturas').textContent = facturas;
    document.getElementById('stat-stock').textContent = productos_stock_bajo;
    document.getElementById('stat-por-cobrar').textContent = 'S/ ' + (por_cobrar_credito || 0).toFixed(2);

    const rTop = await apiFetch(`${API}/reportes/productos-mas-vendidos`);
    const dTop = await rTop.json();
    const tbody = document.getElementById('top-productos-body');
    if (dTop.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3"><div class="empty"><p>Sin ventas aún</p></div></td></tr>';
    } else {
      tbody.innerHTML = dTop.data.map(p => `
        <tr>
          <td>${p.nombre}</td>
          <td><span class="badge badge-blue">${p.unidades_vendidas}</span></td>
          <td class="mono">S/ ${p.ingresos_generados.toFixed(2)}</td>
        </tr>`).join('');
    }

    const rCli = await apiFetch(`${API}/reportes/mejores-clientes`);
    const dCli = await rCli.json();
    const tcli = document.getElementById('top-clientes-body');
    if (dCli.data.length === 0) {
      tcli.innerHTML = '<tr><td colspan="3"><div class="empty"><p>Sin datos aún</p></div></td></tr>';
    } else {
      tcli.innerHTML = dCli.data.map(c => `
        <tr>
          <td>${c.nombre}</td>
          <td><span class="badge badge-green">${c.total_facturas}</span></td>
          <td class="mono">S/ ${c.total_compras.toFixed(2)}</td>
        </tr>`).join('');
    }

    // Créditos pendientes
    const rCred = await apiFetch(`${API}/reportes/creditos-pendientes`);
    const dCred = await rCred.json();
    const tCred = document.getElementById('creditos-pendientes-body');
    if (!dCred.ok || dCred.data.length === 0) {
      tCred.innerHTML = '<tr><td colspan="5"><div class="empty"><p>Sin créditos pendientes</p></div></td></tr>';
      document.getElementById('stat-por-cobrar-sub').textContent = 'pendiente';
    } else {
      const vencidos = dCred.data.filter(c => c.vencido).length;
      document.getElementById('stat-por-cobrar-sub').textContent = vencidos > 0 ? `${vencidos} vencido(s)` : 'pendiente';
      tCred.innerHTML = dCred.data.map(c => {
        const cfg = TIPOS_COMPROBANTE[c.tipo] || { label: c.tipo };
        const num = `${c.serie}-${String(c.numero).padStart(6,'0')}`;
        const fechaVto = c.fecha_vencimiento ? new Date(c.fecha_vencimiento).toLocaleDateString('es-PE') : '—';
        return `<tr>
          <td><span class="mono">${num}</span><br><small style="color:var(--muted)">${cfg.label}</small></td>
          <td>${c.cliente_nombre}</td>
          <td>${fechaVto}</td>
          <td class="mono">S/ ${c.total.toFixed(2)}</td>
          <td>${c.vencido ? '<span class="badge badge-red">⚠️ Vencido</span>' : '<span class="badge badge-yellow">Pendiente</span>'}</td>
        </tr>`;
      }).join('');
    }
  } catch(e) { toast('Error conectando con el servidor', 'error'); }
}

// ===== CLIENTES =====
async function cargarClientes() {
  const r = await apiFetch(`${API}/clientes`);
  const d = await r.json();
  clientesData = d.data || [];
  renderClientes(clientesData);
}

function renderClientes(lista) {
  const tbody = document.getElementById('clientes-body');
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty"><span class="icon">👥</span><p>No hay clientes aún</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(c => `
    <tr>
      <td><strong>${c.nombre}</strong></td>
      <td class="mono">${c.documento || '—'}</td>
      <td>${c.email || '—'}</td>
      <td>${c.telefono || '—'}</td>
      <td>
        <div class="actions-group">
          <button class="btn btn-ghost btn-sm" onclick="editarCliente(${c.id})">✏️ Editar</button>
          <button class="btn btn-danger btn-sm" onclick="eliminarCliente(${c.id}, '${c.nombre}')">🗑️</button>
        </div>
      </td>
    </tr>`).join('');
}

function filtrarClientes() {
  const q = document.getElementById('buscar-cliente').value.toLowerCase();
  renderClientes(clientesData.filter(c => c.nombre.toLowerCase().includes(q) || (c.documento||'').includes(q)));
}

function abrirModalCliente(id = null) {
  document.getElementById('cliente-id').value = '';
  document.getElementById('cliente-nombre').value = '';
  document.getElementById('cliente-doc').value = '';
  document.getElementById('cliente-tel').value = '';
  document.getElementById('cliente-email').value = '';
  document.getElementById('cliente-dir').value = '';
  document.getElementById('modal-cliente-title').textContent = 'Nuevo Cliente';
  abrirModal('modal-cliente');
}

async function editarCliente(id) {
  const r = await apiFetch(`${API}/clientes/${id}`);
  const d = await r.json();
  const c = d.data;
  document.getElementById('cliente-id').value = c.id;
  document.getElementById('cliente-nombre').value = c.nombre;
  document.getElementById('cliente-doc').value = c.documento || '';
  document.getElementById('cliente-tel').value = c.telefono || '';
  document.getElementById('cliente-email').value = c.email || '';
  document.getElementById('cliente-dir').value = c.direccion || '';
  document.getElementById('modal-cliente-title').textContent = 'Editar Cliente';
  abrirModal('modal-cliente');
}

async function guardarCliente() {
  const id = document.getElementById('cliente-id').value;
  const body = {
    nombre: document.getElementById('cliente-nombre').value,
    documento: document.getElementById('cliente-doc').value,
    telefono: document.getElementById('cliente-tel').value,
    email: document.getElementById('cliente-email').value,
    direccion: document.getElementById('cliente-dir').value,
  };
  if (!body.nombre) return toast('El nombre es obligatorio', 'error');
  const url = id ? `${API}/clientes/${id}` : `${API}/clientes`;
  const method = id ? 'PUT' : 'POST';
  const r = await apiFetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const d = await r.json();
  if (d.ok) { toast(id ? 'Cliente actualizado' : 'Cliente creado'); cerrarModal('modal-cliente'); cargarClientes(); }
  else toast(d.error, 'error');
}

async function eliminarCliente(id, nombre) {
  if (!confirm(`¿Eliminar a "${nombre}"?`)) return;
  const r = await apiFetch(`${API}/clientes/${id}`, { method: 'DELETE' });
  const d = await r.json();
  if (d.ok) { toast('Cliente eliminado'); cargarClientes(); }
  else toast(d.error, 'error');
}

// ===== PRODUCTOS =====
async function cargarProductos() {
  const r = await apiFetch(`${API}/productos`);
  const d = await r.json();
  productosData = d.data || [];
  renderProductos(productosData);
}

async function cargarVentas() {
  try {
    const [respuestaClientes, respuestaProductos] = await Promise.all([
      apiFetch(`${API}/clientes`),
      apiFetch(`${API}/productos`),
    ]);
    const [clientes, productos] = await Promise.all([
      respuestaClientes.json(),
      respuestaProductos.json(),
    ]);
    if (!respuestaClientes.ok || !clientes.ok || !respuestaProductos.ok || !productos.ok) {
      throw new Error(clientes.error || productos.error || 'No se pudieron cargar los datos de venta');
    }

    productosVentaData = productos.data || [];
    clientesVentaData = deduplicarClientesVenta(clientes.data || []);
    renderProductosVenta();
    renderClientesVenta();
    renderCarritoVenta();
  } catch (error) {
    toast(error.message || 'No se pudieron cargar los datos de venta', 'error');
  }
}

async function cargarCompras(mostrarErrores = false) {
  cargarTipoCambio();
  const desde = document.getElementById('compras-desde').value;
  const hasta = document.getElementById('compras-hasta').value;
  if (Boolean(desde) !== Boolean(hasta) || (desde && desde > hasta)) {
    if (mostrarErrores) toast('Indica un rango completo de fechas y verifica el orden.', 'error');
    return;
  }
  const filtros = new URLSearchParams();
  for (const [id, nombre] of [
    ['compras-buscar', 'buscar'],
    ['compras-condicion', 'condicion_pago'],
    ['compras-estado', 'estado'],
    ['compras-desde', 'desde'],
    ['compras-hasta', 'hasta'],
  ]) {
    const valor = document.getElementById(id).value.trim();
    if (valor) filtros.set(nombre, valor);
  }
  const respuesta = await apiFetch(`${API}/compras${filtros.size ? `?${filtros}` : ''}`);
  const resultado = await respuesta.json();
  if (!respuesta.ok || !resultado.ok) {
    if (mostrarErrores) toast(resultado.error || 'No se pudieron cargar las compras', 'error');
    return;
  }
  await Promise.all([cargarProveedores(), cargarCatalogosCompra()]);
  const cuerpo = document.getElementById('compras-body');
  cuerpo.innerHTML = (resultado.data || []).map(documento => {
    const items = (documento.items || []).map(item =>
      `${escaparHTML(item.producto_nombre)} · ${item.cantidad} × S/ ${Number(item.costo_unitario).toFixed(2)} = S/ ${Number(item.subtotal).toFixed(2)} (${escaparHTML(item.almacen_nombre)})`
    ).join('<br>') || '—';
    return `
      <tr>
        <td>${documento.tipo === 'guia' ? 'Guía de remisión' : 'Factura'}</td>
        <td>${escaparHTML(documento.serie || '')}${documento.numero ? '-' + escaparHTML(documento.numero) : ''}</td>
        <td><strong>${escaparHTML(documento.proveedor_razon_social)}</strong><br><small>${escaparHTML(documento.proveedor_documento)}</small></td>
        <td>${items}</td>
        <td>${escaparHTML(documento.fecha_factura || '—')}</td>
        <td><span class="badge badge-blue">${escaparHTML(documento.estado)}</span></td>
        <td>${documento.condicion_pago === 'credito' && documento.saldo_pendiente_pen > 0
          ? `<div class="purchase-payment-control"><input id="monto-pago-${documento.id}" type="number" min="0.01" step="0.01" value="${Number(documento.saldo_pendiente_pen).toFixed(2)}" aria-label="Monto del abono"><input id="fecha-pago-${documento.id}" type="date" aria-label="Fecha del abono"><select id="metodo-pago-${documento.id}" aria-label="Método de pago"><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="otro">Otro</option></select><button class="btn btn-sm" type="button" onclick="registrarAbonoCompra(${documento.id})">Registrar abono</button></div>`
          : (documento.fecha_pago ? escaparHTML(documento.fecha_pago) : '—')}</td>
        <td>${(documento.pagos || []).map(pago => `${escaparHTML(pago.fecha_pago)} · S/ ${Number(pago.monto).toFixed(2)} · ${escaparHTML(pago.metodo_pago)}`).join('<br>') || '—'}</td>
        <td class="mono">${documento.condicion_pago === 'credito' ? `S/ ${Number(documento.saldo_pendiente_pen || 0).toFixed(2)}<br><small>Abonado S/ ${Number(documento.monto_pagado_pen || 0).toFixed(2)}</small>` : '—'}</td>
        <td>${documento.factura_archivo_ruta ? `<a href="${API}/compras/${documento.id}/archivo?tipo=factura" target="_blank">Factura</a>` : '—'}${documento.guia_archivo_ruta ? ` <a href="${API}/compras/${documento.id}/archivo?tipo=guia" target="_blank">Guía</a>` : ''}</td>
      </tr>`;
  }).join('') || '<tr><td colspan="10"><div class="empty"><p>No hay documentos registrados</p></div></td></tr>';
}

function limpiarFiltrosCompras() {
  for (const id of ['compras-buscar', 'compras-condicion', 'compras-estado', 'compras-desde', 'compras-hasta']) {
    document.getElementById(id).value = '';
  }
  cargarCompras();
}

  async function registrarAbonoCompra(id) {
    const fechaPago = document.getElementById(`fecha-pago-${id}`).value;
    const monto = Number(document.getElementById(`monto-pago-${id}`).value);
    const metodoPago = document.getElementById(`metodo-pago-${id}`).value;
    if (!fechaPago || !Number.isFinite(monto) || monto <= 0) return toast('Indica un monto y una fecha válida para el abono.', 'error');
    const respuesta = await apiFetch(`${API}/compras/${id}/pagos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monto, fecha_pago: fechaPago, metodo_pago: metodoPago }),
    });
    const resultado = await respuesta.json();
    if (!respuesta.ok || !resultado.ok) return toast(resultado.error || 'No se pudo registrar el abono', 'error');
    toast(resultado.data.estado === 'pagado' ? 'Compra liquidada' : 'Abono de compra registrado');
    await cargarCompras();
    await cargarReporteCompras();
  }

let proveedoresCompraData = [];
let productosCompraData = [];

function escaparHTML(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, caracter => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[caracter]);
}

async function cargarProveedores() {
  const respuesta = await apiFetch(`${API}/proveedores?incluir_inactivos=true`);
  const resultado = await respuesta.json();
  if (!respuesta.ok || !resultado.ok) return toast(resultado.error || 'No se pudieron cargar los proveedores', 'error');

  proveedoresCompraData = resultado.data || [];
  const selector = document.getElementById('compra-proveedor-select');
  selector.innerHTML = '<option value="">Ingreso manual</option>' + proveedoresCompraData
    .filter(proveedor => proveedor.activo)
    .map(proveedor => `<option value="${proveedor.id}">${escaparHTML(proveedor.documento)} · ${escaparHTML(proveedor.razon_social)}</option>`)
    .join('');

  const cuerpo = document.getElementById('proveedores-body');
  cuerpo.innerHTML = proveedoresCompraData.map(proveedor => `
    <tr>
      <td class="mono">${escaparHTML(proveedor.documento)}</td>
      <td><strong>${escaparHTML(proveedor.razon_social)}</strong><br><small>${escaparHTML(proveedor.direccion || '')}</small></td>
      <td>${escaparHTML(proveedor.telefono || proveedor.email || '—')}</td>
      <td><span class="badge ${proveedor.activo ? 'badge-green' : 'badge-gray'}">${proveedor.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td><button class="btn btn-sm" type="button" onclick="editarProveedor(${proveedor.id})">Editar</button>
        <button class="btn btn-sm" type="button" onclick="cambiarEstadoProveedor(${proveedor.id})">${proveedor.activo ? 'Desactivar' : 'Activar'}</button></td>
    </tr>`).join('') || '<tr><td colspan="5"><div class="empty"><p>No hay proveedores registrados</p></div></td></tr>';
}

async function cargarCatalogosCompra() {
  const [productosResponse, almacenesResponse] = await Promise.all([
    apiFetch(`${API}/productos?activo=true&limit=200&sort=nombre&order=asc`),
    apiFetch(`${API}/inventario/almacenes`),
  ]);
  const [productosResult, almacenesResult] = await Promise.all([
    productosResponse.json(),
    almacenesResponse.json(),
  ]);
  if (!productosResponse.ok || !productosResult.ok) {
    toast(productosResult.error || 'No se pudieron cargar los productos', 'error');
    return;
  }
  if (!almacenesResponse.ok || !almacenesResult.ok) {
    toast(almacenesResult.message || 'No se pudieron cargar los almacenes', 'error');
    return;
  }

  productosCompraData = productosResult.data || [];
  if (!document.querySelector('#compra-items-list .purchase-item-row')) agregarItemCompra();
  document.querySelectorAll('#compra-items-list .purchase-item-product').forEach(selector => {
    const seleccionado = selector.value;
    selector.innerHTML = '<option value="">Solo registrar documento</option>' +
      productosCompraData.map(producto => `<option value="${producto.id}">${escaparHTML(producto.nombre)}</option>`).join('');
    selector.value = seleccionado;
  });
  document.getElementById('compra-almacen-id').innerHTML = '<option value="">Almacén predeterminado</option>' +
    (almacenesResult.data || []).map(almacen => `<option value="${almacen.id}">${escaparHTML(almacen.nombre)}</option>`).join('');
}

function agregarItemCompra() {
  const lista = document.getElementById('compra-items-list');
  if (lista.querySelectorAll('.purchase-item-row').length >= 100) {
    return toast('Cada documento admite hasta 100 productos.', 'error');
  }

  const fila = document.createElement('div');
  fila.className = 'purchase-item-row';
  const selector = document.createElement('select');
  selector.className = 'purchase-item-product';
  selector.setAttribute('aria-label', 'Producto recibido');
  selector.innerHTML = '<option value="">Solo registrar documento</option>' +
    productosCompraData.map(producto => `<option value="${producto.id}">${escaparHTML(producto.nombre)}</option>`).join('');

  const cantidad = document.createElement('input');
  cantidad.className = 'purchase-item-quantity';
  cantidad.type = 'number';
  cantidad.min = '1';
  cantidad.step = '1';
  cantidad.placeholder = 'Cantidad';
  cantidad.setAttribute('aria-label', 'Cantidad recibida');

  const costo = document.createElement('input');
  costo.className = 'purchase-item-cost';
  costo.type = 'number';
  costo.min = '0';
  costo.step = '0.0001';
  costo.placeholder = 'Costo unitario';
  costo.setAttribute('aria-label', 'Costo unitario');

  const quitar = document.createElement('button');
  quitar.className = 'btn btn-sm';
  quitar.type = 'button';
  quitar.textContent = 'Quitar';
  quitar.setAttribute('aria-label', 'Quitar producto de la compra');
  quitar.addEventListener('click', () => fila.remove());

  for (const [label, control] of [['Producto', selector], ['Cantidad', cantidad], ['Costo unitario', costo]]) {
    const campo = document.createElement('label');
    campo.className = 'purchase-item-field';
    const texto = document.createElement('span');
    texto.textContent = label;
    campo.append(texto, control);
    fila.append(campo);
  }
  fila.append(quitar);
  lista.append(fila);
}

function seleccionarProveedor() {
  const id = Number(document.getElementById('compra-proveedor-select').value);
  const proveedor = proveedoresCompraData.find(item => item.id === id && item.activo);
  if (!proveedor) return;
  const formulario = document.getElementById('form-compra');
  formulario.elements.namedItem('proveedor_documento').value = proveedor.documento;
  formulario.elements.namedItem('proveedor_razon_social').value = proveedor.razon_social;
  formulario.elements.namedItem('proveedor_direccion').value = proveedor.direccion || '';
}

function editarProveedor(id) {
  const proveedor = proveedoresCompraData.find(item => item.id === id);
  if (!proveedor) return;
  const formulario = document.getElementById('form-proveedor');
  for (const campo of ['id', 'documento', 'razon_social', 'direccion', 'telefono', 'email']) {
    formulario.elements.namedItem(campo).value = proveedor[campo] || '';
  }
  formulario.elements.namedItem('documento').focus();
}

function limpiarFormularioProveedor() {
  document.getElementById('form-proveedor').reset();
}

async function guardarProveedor(event) {
  event.preventDefault();
  const formulario = event.currentTarget;
  const datos = Object.fromEntries(new FormData(formulario).entries());
  const id = datos.id;
  delete datos.id;
  const respuesta = await apiFetch(`${API}/proveedores${id ? `/${id}` : ''}`, {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok || !resultado.ok) return toast(resultado.error || 'No se pudo guardar el proveedor', 'error');
  limpiarFormularioProveedor();
  toast(id ? 'Proveedor actualizado' : 'Proveedor registrado');
  await cargarProveedores();
}

async function cambiarEstadoProveedor(id) {
  const proveedor = proveedoresCompraData.find(item => item.id === id);
  if (!proveedor) return;
  const accion = proveedor.activo ? 'desactivar' : 'activar';
  if (!window.confirm(`¿Deseas ${accion} a ${proveedor.razon_social}?`)) return;
  const respuesta = await apiFetch(`${API}/proveedores/${id}/estado`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activo: !proveedor.activo }),
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok || !resultado.ok) return toast(resultado.error || 'No se pudo cambiar el estado', 'error');
  toast(`Proveedor ${proveedor.activo ? 'desactivado' : 'activado'}`);
  await cargarProveedores();
}

async function cargarTipoCambio() {
  const respuesta = await apiFetch(`${API}/tipo-cambio`);
  const resultado = await respuesta.json();
  if (!respuesta.ok || !resultado.ok) {
    document.getElementById('compra-cambio-fecha').textContent = 'No disponible';
    return;
  }
  const cambio = resultado.data;
  document.getElementById('compra-cambio-fecha').textContent = `${cambio.fecha}${cambio.vencido ? ' · último guardado' : ''}`;
  document.getElementById('compra-cambio-compra').textContent = `S/ ${Number(cambio.compra).toFixed(3)}`;
  document.getElementById('compra-cambio-venta').textContent = `S/ ${Number(cambio.venta).toFixed(3)}`;
  document.getElementById('compra-tipo-cambio').value = Number(cambio.venta).toFixed(3);
}

async function actualizarTipoCambio() {
  const boton = document.querySelector('.purchase-sunat-button');
  boton.disabled = true;
  boton.classList.add('loading');
  try {
    const respuesta = await apiFetch(`${API}/tipo-cambio?actualizar=1`);
    const resultado = await respuesta.json();
    if (!respuesta.ok || !resultado.ok) return toast(resultado.error || 'No se pudo consultar SUNAT', 'error');
    const cambio = resultado.data;
    document.getElementById('compra-cambio-fecha').textContent = `${cambio.fecha} · actualizado ahora`;
    document.getElementById('compra-cambio-compra').textContent = `S/ ${Number(cambio.compra).toFixed(3)}`;
    document.getElementById('compra-cambio-venta').textContent = `S/ ${Number(cambio.venta).toFixed(3)}`;
    document.getElementById('compra-tipo-cambio').value = Number(cambio.venta).toFixed(3);
    toast('Tipo de cambio actualizado desde SUNAT');
  } finally {
    boton.disabled = false;
    boton.classList.remove('loading');
  }
}

async function guardarCompra(event) {
  event.preventDefault();
  const formulario = event.currentTarget;
  const formData = new FormData(formulario);
  const filas = [...document.querySelectorAll('#compra-items-list .purchase-item-row')];
  const productos = [];
  for (const fila of filas) {
    const productoId = fila.querySelector('.purchase-item-product').value;
    const cantidadValor = fila.querySelector('.purchase-item-quantity').value.trim();
    const costoValor = fila.querySelector('.purchase-item-cost').value.trim();
    if (!productoId && !cantidadValor && !costoValor) continue;
    if (!productoId) return toast('Selecciona un producto para cada línea con cantidad o costo.', 'error');

    const cantidad = Number(cantidadValor);
    const costoUnitario = costoValor === '' ? 0 : Number(costoValor);
    if (!Number.isInteger(cantidad) || cantidad <= 0 || !Number.isFinite(costoUnitario) || costoUnitario < 0) {
      return toast('Cada producto requiere cantidad entera positiva y costo unitario válido.', 'error');
    }
    productos.push({ producto_id: Number(productoId), cantidad, costo_unitario: costoUnitario });
  }

  if (formData.get('moneda') === 'USD' && productos.length) {
    const tipoCambio = Number(document.getElementById('compra-tipo-cambio').value);
    if (!Number.isFinite(tipoCambio) || tipoCambio <= 0) {
      return toast('Actualiza el tipo de cambio antes de registrar una compra en USD.', 'error');
    }
    for (const producto of productos) {
      producto.costo_unitario = Number((producto.costo_unitario * tipoCambio).toFixed(2));
    }
  }
  if (productos.length) formData.set('items', JSON.stringify(productos));
  const respuesta = await apiFetch(`${API}/compras`, { method: 'POST', body: formData });
  const resultado = await respuesta.json();
  if (!respuesta.ok || !resultado.ok) return toast(resultado.error || 'No se pudo guardar la compra', 'error');
  toast('Documento de compra guardado');
  formulario.reset();
  document.getElementById('compra-items-list').replaceChildren();
  agregarItemCompra();
  cargarCompras();
}

function renderProductosVenta() {
  const catalogo = document.getElementById('ventas-productos-body');
  const query = (document.getElementById('buscar-producto-venta').value || '').trim().toLocaleLowerCase('es');
  const productos = productosVentaData.filter(producto =>
    `${producto.nombre || ''} ${producto.categoria || ''} ${producto.descripcion || ''}`.toLocaleLowerCase('es').includes(query)
  );
  catalogo.replaceChildren();

  if (productos.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<span class="icon">📦</span><p>Sin productos coincidentes</p>';
    catalogo.appendChild(empty);
    return;
  }

  productos.forEach(producto => {
    const card = document.createElement('article');

    card.className = 'sales-product-card';
    const top = document.createElement('div');
    top.className = 'sales-product-top';
    const name = document.createElement('div');
    name.className = 'sales-product-name';
    const productName = document.createElement('strong');
    productName.textContent = producto.nombre;
    const details = document.createElement('small');
    details.className = 'sales-product-description';
    details.textContent = producto.descripcion || 'Producto del catálogo';
    name.append(productName, details);
    top.appendChild(name);
    if (producto.categoria) {
      const category = document.createElement('span');
      category.className = 'badge badge-blue sales-product-category';
      category.textContent = producto.categoria;
      top.appendChild(category);
    }

    const bottom = document.createElement('div');
    bottom.className = 'sales-product-bottom';
    const productInfo = document.createElement('div');
    const price = document.createElement('div');
    price.className = 'sales-product-price';
    price.textContent = `S/ ${Number(producto.precio).toFixed(2)}`;
    const priceType = document.createElement('select');
    priceType.id = `venta-precio-${producto.id}`;
    priceType.className = 'sales-price-type';
    [['unidad', 'Unidad'], ['rebaja', 'Rebaja'], ['pase', 'Pase']].forEach(([value, label]) => {
      priceType.add(new Option(label, value));
    });
    priceType.addEventListener('change', () => {
      price.textContent = `S/ ${obtenerPrecioProducto(producto, priceType.value).toFixed(2)}`;
    });
    const stock = document.createElement('div');
    stock.className = `sales-product-availability${Number(producto.stock) <= 5 ? ' low' : ''}`;
    stock.textContent = Number(producto.stock) > 0 ? `Disponible: ${producto.stock}` : 'Sin stock';
    productInfo.append(price, priceType, stock);

    const controls = document.createElement('div');
    controls.className = 'sales-add-controls';
    const quantity = document.createElement('input');
    quantity.type = 'number';
    quantity.id = `venta-cantidad-${producto.id}`;
    quantity.className = 'sales-quantity';
    quantity.min = '0.000001';
    quantity.max = String(producto.stock);
    quantity.step = '0.000001';
    quantity.value = '1';
    quantity.setAttribute('aria-label', `Cantidad de ${producto.nombre}`);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn-success btn-sm';
    add.textContent = '+';
    add.title = 'Agregar al carrito';
    add.setAttribute('aria-label', `Agregar ${producto.nombre} al carrito`);
    add.disabled = Number(producto.stock) <= 0;
    add.addEventListener('click', () => agregarProductoAVenta(producto.id));
    controls.append(quantity, add);
    bottom.append(productInfo, controls);
    card.append(top, bottom);
    catalogo.appendChild(card);
  });
}

function obtenerPrecioProducto(producto, tipoPrecio) {
  const precios = {
    unidad: Number(producto.precio),
    rebaja: Number(producto.precio_rebaja),
    pase: Number(producto.precio_pase),
  };
  return precios[tipoPrecio] > 0 ? precios[tipoPrecio] : precios.unidad;
}

function deduplicarClientesVenta(clientes) {
  const unicos = new Map();
  clientes.forEach(cliente => {
    const documento = String(cliente.documento || '').replace(/\D/g, '');
    const clave = documento ? `${cliente.tipo_documento || ''}:${documento}` : `id:${cliente.id}`;
    if (!unicos.has(clave)) unicos.set(clave, cliente);
  });
  return [...unicos.values()];
}

function agregarProductoAVenta(productoId) {
  const producto = productosVentaData.find(item => item.id === productoId);
  const cantidad = Number(document.getElementById(`venta-cantidad-${productoId}`).value);
  const tipoPrecio = document.getElementById(`venta-precio-${productoId}`).value;
  const precio = obtenerPrecioProducto(producto, tipoPrecio);
  if (!producto || !Number.isFinite(cantidad) || cantidad <= 0) {
    return toast('Indica una cantidad válida', 'error');
  }

  const existente = carritoVenta.find(item => item.producto_id === productoId && item.tipo_precio === tipoPrecio);
  if (cantidad + (existente?.cantidad || 0) > Number(producto.stock)) {
    return toast(`Stock insuficiente. Disponible: ${producto.stock}`, 'error');
  }
  if (existente) existente.cantidad += cantidad;
  else carritoVenta.push({ producto_id: producto.id, nombre: producto.nombre, tipo_precio: tipoPrecio, precio, cantidad });
  renderCarritoVenta();
}

function quitarProductoVenta(index) {
  carritoVenta.splice(index, 1);
  renderCarritoVenta();
}

function renderCarritoVenta() {
  const container = document.getElementById('ventas-carrito-body');
  container.replaceChildren();
  if (carritoVenta.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'sales-subtitle';
    empty.textContent = 'Aún no agregas productos.';
    container.appendChild(empty);
  } else {
    carritoVenta.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'sales-cart-row';
      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'sales-cart-name';
      name.textContent = item.nombre;
      const meta = document.createElement('div');
      meta.className = 'sales-cart-meta';
      meta.textContent = `${item.cantidad} × S/ ${item.precio.toFixed(2)} (${item.tipo_precio})`;
      info.append(name, meta);

      const action = document.createElement('div');
      action.className = 'sales-add-controls';
      const subtotal = document.createElement('strong');
      subtotal.className = 'mono';
      subtotal.textContent = `S/ ${(item.cantidad * item.precio).toFixed(2)}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-danger btn-sm';
      remove.textContent = '×';
      remove.title = 'Quitar producto';
      remove.setAttribute('aria-label', `Quitar ${item.nombre}`);
      remove.addEventListener('click', () => quitarProductoVenta(index));
      action.append(subtotal, remove);
      row.append(info, action);
      container.appendChild(row);
    });
  }
  actualizarResumenVenta();
}

function actualizarResumenVenta() {
  const totalCentimos = carritoVenta.reduce((total, item) => total + Math.round(item.precio * item.cantidad * 100), 0);
  const subtotalCentimos = Math.round(totalCentimos * 100 / 118);
  const igvCentimos = totalCentimos - subtotalCentimos;
  document.getElementById('venta-subtotal').textContent = `S/ ${(subtotalCentimos / 100).toFixed(2)}`;
  document.getElementById('venta-igv').textContent = `S/ ${(igvCentimos / 100).toFixed(2)}`;
  document.getElementById('venta-total').textContent = `S/ ${(totalCentimos / 100).toFixed(2)}`;
  document.getElementById('venta-grupo-vencimiento').style.display =
    document.getElementById('venta-condicion').value === 'credito' ? 'flex' : 'none';
}

function seleccionarTipoVenta(tipo) {
  tipoVentaActual = tipo;
  const esBoleta = tipo === 'boleta';
  document.getElementById('venta-tipo-boleta').classList.toggle('active', esBoleta);
  document.getElementById('venta-tipo-boleta').setAttribute('aria-pressed', String(esBoleta));
  document.getElementById('venta-tipo-factura').classList.toggle('active', !esBoleta);
  document.getElementById('venta-tipo-factura').setAttribute('aria-pressed', String(!esBoleta));
  document.getElementById('btn-emitir-venta').textContent = `Emitir ${esBoleta ? 'boleta' : 'factura'}`;
}

function renderClientesVenta() {
  const select = document.getElementById('venta-cliente');
  const seleccionado = select.value;
  select.replaceChildren(new Option('-- Selecciona un cliente --', ''));
  clientesVentaData.forEach(cliente => {
    select.add(new Option(`${cliente.nombre} (${cliente.documento || 'S/D'})`, cliente.id));
  });
  if (clientesVentaData.some(cliente => String(cliente.id) === seleccionado)) select.value = seleccionado;
}

function mostrarAvisoClienteVenta(mensaje, tipo = 'info') {
  const aviso = document.getElementById('resultado-cliente-venta');
  aviso.className = `alert alert-${tipo}`;
  aviso.textContent = mensaje;
  aviso.style.display = 'block';
}

async function consultarClienteVenta() {
  const input = document.getElementById('buscar-cliente-venta');
  const boton = document.getElementById('btn-consultar-cliente-venta');
  const documento = input.value.replace(/\D/g, '');
  if (![8, 11].includes(documento.length)) {
    return mostrarAvisoClienteVenta('Ingresa un DNI de 8 dígitos o un RUC de 11 dígitos.', 'warn');
  }

  boton.disabled = true;
  mostrarAvisoClienteVenta('Consultando identidad...', 'info');
  try {
    const response = await apiFetch(`${API}/clientes/consultar-documento/${documento}`);
    const result = await response.json();
    if (!response.ok || !result.ok || !result.data) {
      return mostrarAvisoClienteVenta(result.error || 'No se pudo consultar el documento.', 'danger');
    }

    const identity = result.data;
    input.value = identity.documento;
    const existente = clientesVentaData.find(cliente => String(cliente.documento || '').replace(/\D/g, '') === identity.documento);
    if (existente) {
      document.getElementById('venta-cliente').value = String(existente.id);
      return mostrarAvisoClienteVenta(`Verificado: ${identity.nombre}. Cliente seleccionado.`, 'info');
    }

    const aviso = document.getElementById('resultado-cliente-venta');
    aviso.className = 'alert alert-info';
    aviso.replaceChildren();
    aviso.style.display = 'flex';
    aviso.style.alignItems = 'center';
    aviso.style.justifyContent = 'space-between';
    aviso.style.gap = '10px';
    const detalle = document.createElement('span');
    detalle.textContent = `Verificado: ${identity.nombre} (${identity.documento}).`;
    const registrar = document.createElement('button');
    registrar.type = 'button';
    registrar.className = 'btn btn-success btn-sm';
    registrar.textContent = 'Registrar';
    registrar.addEventListener('click', () => registrarClienteVenta(identity, registrar));
    aviso.append(detalle, registrar);
  } catch {
    mostrarAvisoClienteVenta('No se pudo conectar con el servicio de consulta.', 'danger');
  } finally {
    boton.disabled = false;
  }
}

async function registrarClienteVenta(identity, boton) {
  boton.disabled = true;
  try {
    const response = await apiFetch(`${API}/clientes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: identity.nombre,
        documento: identity.documento,
        tipo_documento: identity.tipo_documento,
        direccion: identity.direccion,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      return mostrarAvisoClienteVenta(result.error || 'No se pudo registrar el cliente.', 'danger');
    }

    clientesVentaData = deduplicarClientesVenta([...clientesVentaData, { id: result.id, ...identity }]);
    renderClientesVenta();
    document.getElementById('venta-cliente').value = String(result.id);
    mostrarAvisoClienteVenta('Cliente registrado y seleccionado.', 'info');
  } catch {
    mostrarAvisoClienteVenta('No se pudo registrar el cliente.', 'danger');
  } finally {
    boton.disabled = false;
  }
}

function abrirConfirmacionVenta() {
  if (!document.getElementById('venta-cliente').value) return toast('Selecciona un cliente', 'error');
  if (carritoVenta.length === 0) return toast('Agrega al menos un producto', 'error');
  abrirModal('modal-confirmar-venta');
}

async function procesarVentaConfirmada(imprimir) {
  cerrarModal('modal-confirmar-venta');
  const formatoImpresion = document.getElementById('formato-confirmacion').value;
  const clienteId = Number(document.getElementById('venta-cliente').value);
  const condicionPago = document.getElementById('venta-condicion').value;
  const fechaVencimiento = condicionPago === 'credito'
    ? document.getElementById('venta-vencimiento').value
    : null;
  if (!clienteId) return toast('Selecciona un cliente', 'error');
  if (carritoVenta.length === 0) return toast('Agrega al menos un producto', 'error');
  if (condicionPago === 'credito' && !fechaVencimiento) return toast('Indica la fecha de vencimiento', 'error');

  const boton = document.getElementById('btn-emitir-venta');
  boton.disabled = true;
  try {
    const response = await apiFetch(`${API}/comprobantes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo: tipoVentaActual,
        cliente_id: clienteId,
        condicion_pago: condicionPago,
        fecha_vencimiento: fechaVencimiento,
        items: carritoVenta.map(item => ({ producto_id: item.producto_id, cantidad: item.cantidad, tipo_precio: item.tipo_precio })),
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      return toast(result.error || 'No se pudo emitir la venta', 'error');
    }

    toast(`${tipoVentaActual === 'boleta' ? 'Boleta' : 'Factura'} ${result.numero} emitida por S/ ${result.total.toFixed(2)}`);
    if (imprimir) {
      window.location.href = `${API}/pdf/${result.id}?formato=${encodeURIComponent(formatoImpresion)}`;
    } else {
    }
    carritoVenta = [];
    document.getElementById('venta-cliente').value = '';
    document.getElementById('buscar-cliente-venta').value = '';
    document.getElementById('resultado-cliente-venta').style.display = 'none';
    document.getElementById('venta-condicion').value = 'contado';
    document.getElementById('venta-vencimiento').value = '';
    seleccionarTipoVenta('boleta');
    await Promise.all([cargarVentas(), cargarFacturas()]);
  } catch {
    toast('No se pudo conectar con el servidor', 'error');
  } finally {
    boton.disabled = false;
  }
}

function renderProductos(lista) {
  const tbody = document.getElementById('productos-body');
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty"><span class="icon">📦</span><p>No hay productos aún</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(p => `
    <tr>
      <td><strong>${p.nombre}</strong><br><small style="color:var(--muted)">${p.descripcion||''}</small></td>
      <td>${p.categoria ? `<span class="badge badge-blue">${p.categoria}</span>` : '—'}</td>
      <td class="mono">U: S/ ${p.precio.toFixed(2)}<br><small>R: S/ ${p.precio_rebaja.toFixed(2)} | P: S/ ${p.precio_pase.toFixed(2)}<br>C: S/ ${Number(p.precio_compra || 0).toFixed(2)}</small></td>
      <td>${p.stock <= 5
        ? `<span class="badge badge-red">⚠️ ${p.stock}</span>`
        : `<span class="badge badge-green">${p.stock}</span>`}
      </td>
      <td>
        <div class="actions-group">
          <button class="btn btn-ghost btn-sm" onclick="editarProducto(${p.id})">✏️ Editar</button>
          <button class="btn btn-danger btn-sm" onclick="eliminarProducto(${p.id}, '${p.nombre}')">🗑️</button>
        </div>
      </td>
    </tr>`).join('');
}

function filtrarProductos() {
  const q = document.getElementById('buscar-producto').value.toLowerCase();
  renderProductos(productosData.filter(p => p.nombre.toLowerCase().includes(q) || (p.categoria||'').toLowerCase().includes(q)));
}

function abrirModalProducto() {
  document.getElementById('producto-id').value = '';
  document.getElementById('producto-nombre').value = '';
  document.getElementById('producto-precio').value = '';
  document.getElementById('producto-precio-rebaja').value = '';
  document.getElementById('producto-precio-pase').value = '';
  document.getElementById('producto-precio-compra').value = '';
  document.getElementById('producto-stock').value = '';
  document.getElementById('producto-cat').value = '';
  document.getElementById('producto-desc').value = '';
  document.getElementById('modal-producto-title').textContent = 'Nuevo Producto';
  abrirModal('modal-producto');
}

async function editarProducto(id) {
  const r = await apiFetch(`${API}/productos/${id}`);
  const d = await r.json();
  const p = d.data;
  document.getElementById('producto-id').value = p.id;
  document.getElementById('producto-nombre').value = p.nombre;
  document.getElementById('producto-precio').value = p.precio;
  document.getElementById('producto-precio-rebaja').value = p.precio_rebaja;
  document.getElementById('producto-precio-pase').value = p.precio_pase;
  document.getElementById('producto-precio-compra').value = p.precio_compra || 0;
  document.getElementById('producto-stock').value = p.stock;
  document.getElementById('producto-cat').value = p.categoria || '';
  document.getElementById('producto-desc').value = p.descripcion || '';
  document.getElementById('modal-producto-title').textContent = 'Editar Producto';
  abrirModal('modal-producto');
}

async function guardarProducto() {
  const id = document.getElementById('producto-id').value;
  const body = {
    nombre: document.getElementById('producto-nombre').value,
    precio: parseFloat(document.getElementById('producto-precio').value),
    precio_rebaja: parseFloat(document.getElementById('producto-precio-rebaja').value),
    precio_pase: parseFloat(document.getElementById('producto-precio-pase').value),
    precio_compra: parseFloat(document.getElementById('producto-precio-compra').value) || 0,
    stock: parseInt(document.getElementById('producto-stock').value) || 0,
    categoria: document.getElementById('producto-cat').value,
    descripcion: document.getElementById('producto-desc').value,
  };

  if (!body.nombre) return toast('El nombre es obligatorio', 'error');
  if ([body.precio, body.precio_rebaja, body.precio_pase].some(precio => !precio || precio <= 0)) return toast('Los tres precios deben ser mayores a 0', 'error');
  const url = id ? `${API}/productos/${id}` : `${API}/productos`;
  const method = id ? 'PUT' : 'POST';
  const r = await apiFetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const d = await r.json();
  if (d.ok) { toast(id ? 'Producto actualizado' : 'Producto creado'); cerrarModal('modal-producto'); cargarProductos(); }
  else toast(d.error, 'error');
}

async function eliminarProducto(id, nombre) {
  if (!confirm(`¿Eliminar "${nombre}"?`)) return;
  const r = await apiFetch(`${API}/productos/${id}`, { method: 'DELETE' });
  const d = await r.json();
  if (d.ok) { toast('Producto eliminado'); cargarProductos(); }
  else toast(d.error, 'error');
}

// ===== FACTURAS =====
// ===== CONFIGURACIÓN DE TIPOS DE COMPROBANTE =====
const TIPOS_COMPROBANTE = {
  todos:           { label: 'Todos',                    color: '#7a86a0' },
  boleta:          { label: 'Boleta electrónica',        color: '#4f8ef7' },
  factura:         { label: 'Factura electrónica',       color: '#38d9a9' },
  nota_pedido:     { label: 'Nota de pedido',            color: '#f7c948' },
  guia_remision:   { label: 'Guía de remisión',          color: '#a78bfa' },
  cotizacion:      { label: 'Cotización',                color: '#7a86a0' },
  nota_devolucion: { label: 'Nota de devolución',        color: '#f06585' },
  nota_credito_f:  { label: 'Nota crédito (Factura)',    color: '#38d9a9' },
  nota_credito_b:  { label: 'Nota crédito (Boleta)',     color: '#4f8ef7' },
};
let tipoActivo = 'todos';

function toggleDropdownNuevo() {
  document.getElementById('dropdown-nuevo').classList.toggle('open');
}
// Cerrar el dropdown si se hace clic fuera
document.addEventListener('click', (e) => {
  const dd = document.getElementById('dropdown-nuevo');
  if (dd && !e.target.closest('.dropdown')) dd.classList.remove('open');
});

async function cargarFacturas() {
  const r = await apiFetch(`${API}/comprobantes`);
  const d = await r.json();
  if (!r.ok || !d.ok) return toast(d.error || 'No se pudieron cargar los comprobantes', 'error');
  facturasData = d.data || [];
  renderTabsComprobantes();
  aplicarFiltroTipo();
}

function renderTabsComprobantes() {
  const cont = document.getElementById('tabs-comprobantes');
  cont.innerHTML = Object.entries(TIPOS_COMPROBANTE).map(([key, cfg]) => {
    const count = key === 'todos' ? facturasData.length : facturasData.filter(f => f.tipo === key).length;
    return `<button class="tab-item ${tipoActivo === key ? 'active' : ''}" onclick="seleccionarTipo('${key}')">
      ${cfg.label} <span class="tab-count">${count}</span>
    </button>`;
  }).join('');
}

function seleccionarTipo(tipo) {
  tipoActivo = tipo;
  renderTabsComprobantes();
  aplicarFiltroTipo();
}

function normalizarFechaLocal(valor) {
  if (!valor) return null;
  const raw = String(valor).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [anio, mes, dia] = raw.split('-').map(Number);
    return new Date(anio, mes - 1, dia);
  }
  const fecha = new Date(raw);
  if (Number.isNaN(fecha.getTime())) return null;
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
}

function formatearFechaLocal(valor) {
  const fecha = normalizarFechaLocal(valor);
  if (!fecha) return '—';
  return fecha.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getRangoFechaComprobantes() {
  return {
    desde: document.getElementById('fecha-desde')?.value || '',
    hasta: document.getElementById('fecha-hasta')?.value || '',
  };
}

function resetearFechas() {
  const desde = document.getElementById('fecha-desde');
  const hasta = document.getElementById('fecha-hasta');
  if (desde) desde.value = '';
  if (hasta) hasta.value = '';
  aplicarFiltroTipo();
}

function aplicarFiltroTipo() {
  const q = (document.getElementById('buscar-factura').value || '').toLowerCase();
  const documentoQuery = q.replace(/\D/g, '');
  const { desde, hasta } = getRangoFechaComprobantes();
  const fechaDesde = desde ? normalizarFechaLocal(desde) : null;
  const fechaHasta = hasta ? normalizarFechaLocal(hasta) : null;

  let lista = tipoActivo === 'todos' ? facturasData : facturasData.filter(f => f.tipo === tipoActivo);

  if (fechaDesde) {
    lista = lista.filter(f => {
      const fecha = normalizarFechaLocal(f.fecha);
      return fecha && fecha >= fechaDesde;
    });
  }

  if (fechaHasta) {
    lista = lista.filter(f => {
      const fecha = normalizarFechaLocal(f.fecha);
      return fecha && fecha <= fechaHasta;
    });
  }

  if (q) lista = lista.filter(f => {
    const cliente = String(f.cliente_nombre || '').toLowerCase();
    const documento = String(f.cliente_documento || '').replace(/\D/g, '');
    const comprobante = `${f.serie || ''}-${f.numero || ''}`.toLowerCase();
    return cliente.includes(q) || comprobante.includes(q) || (documentoQuery && documento.includes(documentoQuery));
  });

  document.getElementById('comprobantes-titulo').textContent = tipoActivo === 'todos'
    ? 'Todos los comprobantes'
    : TIPOS_COMPROBANTE[tipoActivo].label + 's';
  renderFacturas(lista);
}

function renderFacturas(lista) {
  const tbody = document.getElementById('facturas-body');
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty"><span class="icon">🧾</span><p>No hay comprobantes aún</p></div></td></tr>';
    return;
  }
  const condicionLabel = { no_afecta: 'No afecta', contado: 'Contado', credito: 'Crédito' };
  tbody.innerHTML = lista.map(f => {
    const estadoBadge = { emitido: 'badge-blue', parcial: 'badge-yellow', pagado: 'badge-green', anulado: 'badge-red', borrador: 'badge-yellow', enviado: 'badge-blue', aprobado: 'badge-green', rechazado: 'badge-red', pendiente: 'badge-yellow', atendido: 'badge-green' };
    const cfg = TIPOS_COMPROBANTE[f.tipo] || { label: f.tipo, color: '#7a86a0' };
    const num = `${f.serie}-${String(f.numero).padStart(6,'0')}`;
    const fecha = formatearFechaLocal(f.fecha);
    const credVencido = f.condicion_pago === 'credito' && f.fecha_vencimiento && normalizarFechaLocal(f.fecha_vencimiento) < new Date() && f.estado !== 'pagado';
    const fechaVencimiento = f.condicion_pago === 'credito' && f.fecha_vencimiento ? formatearFechaLocal(f.fecha_vencimiento) : null;
    return `<tr>
      <td>
        <span class="mono">${num}</span><br>
        <small style="color:${cfg.color}">${cfg.label}</small>
      </td>
      <td><strong>${f.cliente_nombre}</strong><br><small style="color:var(--muted)">${f.cliente_documento||''}</small></td>
      <td>${fecha}</td>
      <td>
        <span class="badge ${f.condicion_pago === 'credito' ? (credVencido ? 'badge-red' : 'badge-yellow') : f.condicion_pago === 'contado' ? 'badge-green' : 'badge-blue'}">
          ${condicionLabel[f.condicion_pago] || f.condicion_pago}
        </span>
        ${fechaVencimiento ? `<br><small style="color:${credVencido?'var(--danger)':'var(--muted)'}">${credVencido?'⚠️ Venció: ':'Vence: '}${fechaVencimiento}</small>` : ''}
      </td>
      <td class="mono">S/ ${f.subtotal.toFixed(2)}</td>
      <td class="mono">S/ ${f.igv.toFixed(2)}</td>
      <td class="mono"><strong>S/ ${f.total.toFixed(2)}</strong></td>
      <td><span class="badge ${estadoBadge[f.estado]||'badge-blue'}">${f.estado}</span></td>
      <td>
        <div class="actions-group">
          <button class="btn btn-ghost btn-sm" onclick="verFactura(${f.id})">👁️ Ver</button>
          ${f.estado !== 'anulado' ? `
            ${['factura', 'boleta'].includes(f.tipo) && f.condicion_pago === 'credito' && ['emitido', 'parcial'].includes(f.estado) ? `<button class="btn btn-success btn-sm" onclick="abrirModalCobroFactura(${f.id})">Cobrar</button>` : ''}
            ${f.estado === 'emitido' && ['factura', 'boleta'].includes(f.tipo) && f.condicion_pago !== 'credito' ? `<button class="btn btn-success btn-sm" onclick="cambiarEstado(${f.id},'pagado')">✓ Pagar</button>` : ''}
            ${Number(f.monto_cobrado || 0) === 0 ? `<button class="btn btn-danger btn-sm" onclick="cambiarEstado(${f.id},'anulado')" aria-label="Anular comprobante">✕</button>` : ''}
          ` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

function filtrarFacturas() {
  aplicarFiltroTipo();
}

function abrirModalCobroFactura(id) {
  const comprobante = facturasData.find(item => item.id === id);
  if (!comprobante) return;
  const saldo = Number(comprobante.saldo_pendiente ?? comprobante.total);
  if (saldo <= 0) return toast('El comprobante ya está pagado.', 'error');
  document.getElementById('cobro-comprobante-id').value = String(id);
  document.getElementById('cobro-factura-info').textContent =
    `${comprobante.cliente_nombre} · ${comprobante.serie}-${String(comprobante.numero).padStart(6, '0')} · Saldo S/ ${saldo.toFixed(2)}`;
  const monto = document.getElementById('cobro-monto');
  monto.max = saldo.toFixed(2);
  monto.value = saldo.toFixed(2);
  const hoy = new Date();
  document.getElementById('cobro-fecha').value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  document.getElementById('cobro-metodo').value = 'efectivo';
  document.getElementById('cobro-referencia').value = '';
  abrirModal('modal-cobro-factura');
}

async function guardarCobroFactura(event) {
  event.preventDefault();
  const id = document.getElementById('cobro-comprobante-id').value;
  const monto = Number(document.getElementById('cobro-monto').value);
  const fechaPago = document.getElementById('cobro-fecha').value;
  const metodoPago = document.getElementById('cobro-metodo').value;
  const referencia = document.getElementById('cobro-referencia').value.trim();
  if (!id || !Number.isFinite(monto) || monto <= 0 || !fechaPago) {
    return toast('Completa el monto y la fecha del cobro.', 'error');
  }

  try {
    const respuesta = await apiFetch(`${API}/comprobantes/${id}/pagos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monto, fecha_pago: fechaPago, metodo_pago: metodoPago, referencia }),
    });
    const resultado = await respuesta.json();
    if (!respuesta.ok || !resultado.ok) return toast(resultado.error || 'No se pudo registrar el cobro.', 'error');
    cerrarModal('modal-cobro-factura');
    toast(resultado.data.estado === 'pagado' ? 'Comprobante liquidado' : 'Cobro parcial registrado');
    await Promise.all([cargarFacturas(), cargarReporteCuentasCobrar(), cargarDashboard()]);
  } catch (error) {
    toast('No se pudo registrar el cobro.', 'error');
  }
}

// Config de qué campos mostrar según el tipo de comprobante
const CONFIG_TIPO = {
  boleta:          { afecta_igv: true,  necesita_ref: false, es_guia: false, condicion_default: 'contado' },
  factura:         { afecta_igv: true,  necesita_ref: false, es_guia: false, condicion_default: 'contado' },
  nota_pedido:     { afecta_igv: false, necesita_ref: false, es_guia: false, condicion_default: 'no_afecta' },
  guia_remision:   { afecta_igv: false, necesita_ref: false, es_guia: true,  condicion_default: 'no_afecta' },
  cotizacion:      { afecta_igv: false, necesita_ref: false, es_guia: false, condicion_default: 'no_afecta' },
  nota_devolucion: { afecta_igv: true,  necesita_ref: true,   es_guia: false, condicion_default: 'no_afecta' },
  nota_credito_f:  { afecta_igv: true,  necesita_ref: true,   es_guia: false, condicion_default: 'no_afecta' },
  nota_credito_b:  { afecta_igv: true,  necesita_ref: true,   es_guia: false, condicion_default: 'no_afecta' },
};

function filtrarClientesFactura() {
  const consulta = document.getElementById('buscar-cliente-factura').value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');
  const consultaDocumento = consulta.replace(/\D/g, '');
  const select = document.getElementById('factura-cliente');
  const coincidencias = clientesFacturaData.filter(cliente => {
    const nombre = String(cliente.nombre || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es');
    const documento = String(cliente.documento || '').replace(/\D/g, '');
    return nombre.includes(consulta) || (consultaDocumento && documento.includes(consultaDocumento));
  });

  select.innerHTML = '<option value="">-- Selecciona un cliente --</option>';
  if (coincidencias.length === 0) {
    select.innerHTML += '<option value="" disabled>Sin clientes coincidentes</option>';
    return;
  }

  coincidencias.forEach(cliente => {
    const option = document.createElement('option');
    option.value = cliente.id;
    option.textContent = `${cliente.nombre} (${cliente.documento || 'S/D'})`;
    select.appendChild(option);
  });
}

function mostrarResultadoConsultaDocumento(mensaje, tipo = 'info') {
  const resultado = document.getElementById('resultado-consulta-documento');
  resultado.className = `alert alert-${tipo}`;
  resultado.textContent = mensaje;
  resultado.style.display = 'block';
}

async function consultarClienteDocumento() {
  const campo = document.getElementById('buscar-cliente-factura');
  const boton = document.getElementById('btn-consultar-documento');
  const documento = campo.value.replace(/\D/g, '');
  if (![8, 11].includes(documento.length)) {
    mostrarResultadoConsultaDocumento('Ingresa un DNI de 8 dígitos o un RUC de 11 dígitos.', 'warn');
    return;
  }

  boton.disabled = true;
  mostrarResultadoConsultaDocumento('Consultando el documento...', 'info');
  try {
    const response = await apiFetch(`${API}/clientes/consultar-documento/${documento}`);
    const result = await response.json();
    if (!response.ok || !result.ok || !result.data) {
      mostrarResultadoConsultaDocumento(result.error || 'No se pudo consultar el documento.', 'danger');
      return;
    }

    const identity = result.data;
    const cliente = clientesFacturaData.find(item => String(item.documento || '').replace(/\D/g, '') === identity.documento);
    campo.value = identity.documento;
    filtrarClientesFactura();

    if (cliente) {
      document.getElementById('factura-cliente').value = String(cliente.id);
      mostrarResultadoConsultaDocumento(`Verificado en ${identity.tipo_documento === 'DNI' ? 'RENIEC' : 'SUNAT'}: ${identity.nombre}. Cliente local seleccionado.`, 'info');
      return;
    }

    const resultado = document.getElementById('resultado-consulta-documento');
    resultado.replaceChildren();
    resultado.className = 'alert alert-info';
    resultado.style.display = 'flex';
    resultado.style.alignItems = 'center';
    resultado.style.justifyContent = 'space-between';
    resultado.style.gap = '12px';
    const detalle = document.createElement('span');
    detalle.textContent = `Verificado en ${identity.tipo_documento === 'DNI' ? 'RENIEC' : 'SUNAT'}: ${identity.nombre} (${identity.documento}).`;
    const registrar = document.createElement('button');
    registrar.className = 'btn btn-success btn-sm';
    registrar.type = 'button';
    registrar.textContent = 'Registrar y seleccionar';
    registrar.addEventListener('click', () => registrarClienteConsultado(identity, registrar));
    resultado.append(detalle, registrar);
  } catch {
    mostrarResultadoConsultaDocumento('No se pudo conectar con el servicio de consulta.', 'danger');
  } finally {
    boton.disabled = false;
  }
}

async function registrarClienteConsultado(identity, boton) {
  boton.disabled = true;
  try {
    const response = await apiFetch(`${API}/clientes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: identity.nombre,
        documento: identity.documento,
        tipo_documento: identity.tipo_documento,
        direccion: identity.direccion,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      mostrarResultadoConsultaDocumento(result.error || 'No se pudo registrar el cliente.', 'danger');
      return;
    }

    const cliente = { id: result.id, ...identity };
    clientesFacturaData.push(cliente);
    filtrarClientesFactura();
    document.getElementById('factura-cliente').value = String(cliente.id);
    mostrarResultadoConsultaDocumento(`Cliente ${identity.nombre} registrado y seleccionado.`, 'info');
  } catch {
    mostrarResultadoConsultaDocumento('No se pudo registrar el cliente.', 'danger');
  } finally {
    boton.disabled = false;
  }
}

async function abrirModalFactura(tipoPreseleccionado) {
  document.getElementById('dropdown-nuevo').classList.remove('open');
  const tipo = tipoPreseleccionado || 'boleta';
  const cfg = CONFIG_TIPO[tipo];

  document.getElementById('factura-tipo').value = tipo;
  document.getElementById('modal-factura-title').textContent = 'Nuevo: ' + TIPOS_COMPROBANTE[tipo].label;
  document.getElementById('btn-emitir').textContent = '✓ Emitir ' + TIPOS_COMPROBANTE[tipo].label;

  itemsFactura = [];
  renderItems();

  // Condición de pago: preseleccionar según el tipo, pero el usuario puede cambiarla
  document.getElementById('factura-condicion').value = cfg.condicion_default;
  onCambioCondicionPago();

  // Mostrar/ocultar bloque de Guía de Remisión
  document.getElementById('campos-guia').style.display = cfg.es_guia ? 'block' : 'none';

  // Mostrar/ocultar bloque de referencia (notas de crédito / devolución)
  document.getElementById('campos-referencia').style.display = cfg.necesita_ref ? 'block' : 'none';
  document.getElementById('ref-motivo').value = '';

  // Cargar clientes
  const rc = await apiFetch(`${API}/clientes`);
  const dc = await rc.json();
  clientesFacturaData = dc.data || [];
  document.getElementById('buscar-cliente-factura').value = '';
  const resultadoConsulta = document.getElementById('resultado-consulta-documento');
  resultadoConsulta.style.display = 'none';
  resultadoConsulta.replaceChildren();
  filtrarClientesFactura();

  // Cargar productos
  const rp = await apiFetch(`${API}/productos`);
  const dp = await rp.json();
  const selProd = document.getElementById('item-producto');
  selProd.innerHTML = '<option value="">-- Selecciona producto --</option>';
  (dp.data || []).forEach(p => {
    selProd.innerHTML += `<option value="${p.id}" data-precio-unidad="${p.precio}" data-precio-rebaja="${p.precio_rebaja}" data-precio-pase="${p.precio_pase}" data-stock="${p.stock}">${p.nombre} — S/ ${p.precio.toFixed(2)} (stock: ${p.stock})</option>`;
  });
  mostrarPreciosProducto();

  // Cargar comprobantes de referencia si aplica (facturas/boletas para vincular notas)
  if (cfg.necesita_ref) {
    const tipoRef = tipo === 'nota_credito_b' ? 'boleta' : tipo === 'nota_credito_f' ? 'factura' : null;
    const r = await apiFetch(`${API}/comprobantes${tipoRef ? '?tipo=' + tipoRef : ''}`);
    const d = await r.json();
    const selRef = document.getElementById('ref-comprobante');
    selRef.innerHTML = '<option value="">-- Selecciona comprobante --</option>';
    (d.data || []).filter(c => c.estado !== 'anulado').forEach(c => {
      const num = `${c.serie}-${String(c.numero).padStart(6,'0')}`;
      selRef.innerHTML += `<option value="${c.id}">${num} — ${c.cliente_nombre} (S/ ${c.total.toFixed(2)})</option>`;
    });
  }

  abrirModal('modal-factura');
}

function onCambioCondicionPago() {
  const condicion = document.getElementById('factura-condicion').value;
  document.getElementById('grupo-fecha-vencimiento').style.display = condicion === 'credito' ? 'block' : 'none';
}

function mostrarPreciosProducto() {
  const sel = document.getElementById('item-producto');
  const precios = document.getElementById('item-precios-disponibles');
  const opt = sel?.options[sel.selectedIndex];
  if (!precios || !opt || !sel.value) {
    if (precios) precios.textContent = 'Unidad: S/ 0.00 · Rebaja: S/ 0.00 · Pase: S/ 0.00';
    return;
  }
  precios.textContent = `Unidad: S/ ${Number(opt.dataset.precioUnidad).toFixed(2)} · Rebaja: S/ ${Number(opt.dataset.precioRebaja).toFixed(2)} · Pase: S/ ${Number(opt.dataset.precioPase).toFixed(2)}`;
}

function agregarItem() {
  const sel = document.getElementById('item-producto');
  const tipoPrecio = document.getElementById('item-tipo-precio').value;
  const cantidad = parseInt(document.getElementById('item-cantidad').value);
  const opt = sel.options[sel.selectedIndex];
  if (!sel.value) return toast('Selecciona un producto', 'error');
  if (!cantidad || cantidad < 1) return toast('La cantidad debe ser mayor a 0', 'error');
  const tipo = document.getElementById('factura-tipo').value;
  const stock = parseInt(opt.dataset.stock);
  if (CONFIG_TIPO[tipo]?.es_guia === false && tipo !== 'nota_devolucion' && tipo !== 'cotizacion' && tipo !== 'nota_pedido' && cantidad > stock) {
    return toast(`Stock insuficiente. Disponible: ${stock}`, 'error');
  }
  const precio = parseFloat(opt.dataset[`precio${tipoPrecio[0].toUpperCase()}${tipoPrecio.slice(1)}`]);
  const existe = itemsFactura.find(i => i.producto_id == sel.value && i.tipo_precio === tipoPrecio);
  if (existe) { existe.cantidad += cantidad; existe.subtotal = existe.precio * existe.cantidad; }
  else {
    itemsFactura.push({ producto_id: sel.value, nombre: opt.text.split('—')[0].trim(), tipo_precio: tipoPrecio, cantidad, precio, subtotal: precio * cantidad });
  }
  renderItems();
}

function quitarItem(idx) { itemsFactura.splice(idx, 1); renderItems(); }

function renderItems() {
  const lista = document.getElementById('items-lista');
  const totDiv = document.getElementById('items-total');
  lista.innerHTML = '<div class="item-row header"><span>Producto</span><span>Cant.</span><span>Subtotal</span><span></span></div>';
  if (itemsFactura.length === 0) { totDiv.style.display = 'none'; return; }
  itemsFactura.forEach((it, i) => {
    lista.innerHTML += `<div class="item-row">
      <span>${it.nombre} <small>(${it.tipo_precio})</small></span>
      <span class="mono">${it.cantidad}</span>
      <span class="mono">S/ ${it.subtotal.toFixed(2)}</span>
      <button class="btn btn-danger btn-sm" onclick="quitarItem(${i})">✕</button>
    </div>`;
  });

  const tipo = document.getElementById('factura-tipo').value;
  const condicion = document.getElementById('factura-condicion').value;
  const cfg = CONFIG_TIPO[tipo] || {};
  const aplicaIgv = cfg.afecta_igv && condicion !== 'no_afecta';

  const total = itemsFactura.reduce((a,i) => a + i.subtotal, 0);
  const sub = aplicaIgv ? total * 100 / 118 : total;
  const igv = aplicaIgv ? total - sub : 0;

  document.getElementById('fila-igv').style.display = aplicaIgv ? 'flex' : 'none';
  document.getElementById('tot-sub').textContent = 'S/ ' + sub.toFixed(2);
  document.getElementById('tot-igv').textContent = 'S/ ' + igv.toFixed(2);
  document.getElementById('tot-total').textContent = 'S/ ' + total.toFixed(2);
  totDiv.style.display = 'block';
}

async function emitirFactura() {
  const tipo = document.getElementById('factura-tipo').value;
  const cliente_id = document.getElementById('factura-cliente').value;
  const condicion_pago = document.getElementById('factura-condicion').value;
  const cfg = CONFIG_TIPO[tipo] || {};

  if (!cliente_id) return toast('Selecciona un cliente', 'error');
  if (itemsFactura.length === 0) return toast('Agrega al menos un producto', 'error');

  let fecha_vencimiento = null;
  if (condicion_pago === 'credito') {
    fecha_vencimiento = document.getElementById('factura-vencimiento').value;
    if (!fecha_vencimiento) return toast('Indica la fecha de caducación del crédito', 'error');
  }

  const body = {
    tipo,
    cliente_id: parseInt(cliente_id),
    condicion_pago,
    fecha_vencimiento,
    items: itemsFactura.map(i => ({ producto_id: parseInt(i.producto_id), cantidad: i.cantidad, tipo_precio: i.tipo_precio })),
  };

  if (cfg.es_guia) {
    body.direccion_partida = document.getElementById('guia-partida').value;
    body.direccion_llegada = document.getElementById('guia-llegada').value;
    body.transportista     = document.getElementById('guia-transportista').value;
    body.fecha_traslado    = document.getElementById('guia-fecha-traslado').value;
  }

  if (cfg.necesita_ref) {
    const ref = document.getElementById('ref-comprobante').value;
    const motivo = document.getElementById('ref-motivo').value;
    if (!ref) return toast('Selecciona el comprobante que referencia', 'error');
    if (!motivo) return toast('Indica el motivo', 'error');
    body.comprobante_ref_id = parseInt(ref);
    body.motivo_ref = motivo;
  }

  const r = await apiFetch(`${API}/comprobantes`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const d = await r.json();
  if (d.ok) {
    toast(`${TIPOS_COMPROBANTE[tipo].label} ${d.numero} emitida por S/ ${d.total.toFixed(2)}`);
    window.location.href = `${API}/pdf/${d.id}?formato=80mm`;
    cerrarModal('modal-factura');
    cargarFacturas();
  } else {
    toast(d.error, 'error');
  }
}

async function verFactura(id) {
  facturaIdActual = id;
  const r = await apiFetch(`${API}/comprobantes/${id}`);
  const d = await r.json();
  if (!r.ok || !d.ok || !d.data) return toast(d.error || 'No se pudo cargar el comprobante', 'error');
  const f = d.data;
  const cfg = TIPOS_COMPROBANTE[f.tipo] || { label: f.tipo, color: '#4f8ef7' };
  const num = `${f.serie}-${String(f.numero).padStart(6,'0')}`;
  const fecha = new Date(f.fecha).toLocaleDateString('es-PE', { year:'numeric', month:'long', day:'numeric' });

  const estadoColores = {
    emitido:   { bg:'#e8f0ff', fg:'#2563eb' },
    parcial:   { bg:'#fff7e0', fg:'#a87c00' },
    pagado:    { bg:'#e6f9f4', fg:'#1a9974' },
    anulado:   { bg:'#fde8ee', fg:'#d63660' },
    borrador:  { bg:'#fff7e0', fg:'#a87c00' },
    enviado:   { bg:'#e8f0ff', fg:'#2563eb' },
    aprobado:  { bg:'#e6f9f4', fg:'#1a9974' },
    rechazado: { bg:'#fde8ee', fg:'#d63660' },
    pendiente: { bg:'#fff7e0', fg:'#a87c00' },
    atendido:  { bg:'#e6f9f4', fg:'#1a9974' },
  };
  const ec = estadoColores[f.estado] || estadoColores.emitido;

  const condicionLabel = { no_afecta: 'No afecta', contado: 'Contado', credito: 'Crédito' };

  // Bloque: condición de pago + vencimiento
  let condicionHtml = `
    <div class="fp-section">
      <div class="fp-label">Condición de pago</div>
      <div style="font-weight:600;">${condicionLabel[f.condicion_pago] || f.condicion_pago}</div>
      ${f.condicion_pago === 'credito' && f.fecha_vencimiento ? `<div style="color:#555;">Vence: ${new Date(f.fecha_vencimiento).toLocaleDateString('es-PE')}</div>` : ''}
    </div>`;

  // Bloque: referencia (notas de crédito / devolución)
  let referenciaHtml = '';
  if (f.comprobante_ref_id && f.ref_tipo) {
    const refCfg = TIPOS_COMPROBANTE[f.ref_tipo] || { label: f.ref_tipo };
    const refNum = `${f.ref_serie}-${String(f.ref_numero).padStart(6,'0')}`;
    referenciaHtml = `
      <div class="fp-section" style="background:#f8f9ff;padding:12px 14px;border-radius:8px;border:1px solid #e8edff;">
        <div class="fp-label">Comprobante referenciado</div>
        <div style="font-weight:600;">${refCfg.label} ${refNum}</div>
        ${f.motivo_ref ? `<div style="color:#555;margin-top:2px;">Motivo: ${f.motivo_ref}</div>` : ''}
      </div>`;
  }

  // Bloque: datos de traslado (guía de remisión)
  let guiaHtml = '';
  if (f.tipo === 'guia_remision') {
    guiaHtml = `
      <div class="fp-section" style="background:#f8f9ff;padding:12px 14px;border-radius:8px;border:1px solid #e8edff;">
        <div class="fp-label">Datos del traslado</div>
        <div style="color:#333;line-height:1.7;">
          ${f.direccion_partida ? `<strong>Partida:</strong> ${f.direccion_partida}<br>` : ''}
          ${f.direccion_llegada ? `<strong>Llegada:</strong> ${f.direccion_llegada}<br>` : ''}
          ${f.transportista ? `<strong>Transportista:</strong> ${f.transportista}<br>` : ''}
          ${f.fecha_traslado ? `<strong>Fecha de traslado:</strong> ${new Date(f.fecha_traslado).toLocaleDateString('es-PE')}` : ''}
        </div>
      </div>`;
  }

  const aplicaIgv = f.igv && f.igv > 0;
  const pagosHtml = f.pagos?.length ? `
    <div class="fp-section payment-history">
      <div class="fp-label">Cobros registrados</div>
      <table class="fp-table"><thead><tr><th>Fecha</th><th>Método</th><th>Referencia</th><th style="text-align:right;">Monto</th></tr></thead>
        <tbody>${f.pagos.map(pago => `<tr><td>${escaparHTML(pago.fecha_pago)}</td><td>${escaparHTML(pago.metodo_pago)}</td><td>${escaparHTML(pago.referencia || '—')}</td><td style="text-align:right;">S/ ${Number(pago.monto).toFixed(2)}</td></tr>`).join('')}</tbody>
      </table>
      <div class="payment-history-totals"><span>Abonado S/ ${Number(f.monto_cobrado).toFixed(2)}</span><strong>Saldo S/ ${Number(f.saldo_pendiente).toFixed(2)}</strong></div>
    </div>` : '';

  document.getElementById('factura-preview-content').innerHTML = `
    <div class="factura-preview">
      <div class="fp-header">
        <div>
          <div class="fp-title">⚡ FacturaPro</div>
          <div style="font-size:11px;color:#888;margin-top:4px;">${cfg.label}</div>
        </div>
        <div style="text-align:right;">
          <div class="fp-num">${num}</div>
          <div style="font-size:12px;color:#888;">${fecha}</div>
          <div style="margin-top:6px;"><span style="background:${ec.bg};color:${ec.fg};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">${f.estado.toUpperCase()}</span></div>
        </div>
      </div>
      <hr style="border:none;border-top:1px solid #eee;margin:0 0 16px;">

      <div class="fp-section">
        <div class="fp-label">Cliente</div>
        <div style="font-weight:600;font-size:15px;">${f.cliente_nombre}</div>
        <div style="color:#555;">${f.cliente_documento ? 'RUC/DNI: ' + f.cliente_documento : ''}</div>
        <div style="color:#555;">${f.cliente_direccion || ''}</div>
        <div style="color:#555;">${f.cliente_email || ''}</div>
      </div>

      ${condicionHtml}
      ${referenciaHtml}
      ${guiaHtml}

      <table class="fp-table">
        <thead><tr><th>Producto</th><th>Cant.</th><th style="text-align:right;">P. Unit.</th><th style="text-align:right;">Subtotal</th></tr></thead>
        <tbody>
          ${f.detalle.map(d => `<tr>
            <td>${d.producto_nombre || d.descripcion_libre || '—'}</td>
            <td>${d.cantidad} ${d.unidad && d.unidad !== 'UND' ? d.unidad : ''}</td>
            <td style="text-align:right;">S/ ${d.precio_unitario.toFixed(2)}</td>
            <td style="text-align:right;">S/ ${(f.precios_incluyen_igv ? (d.precio_unitario * d.cantidad - d.descuento_item) : d.subtotal).toFixed(2)}</td>
          </tr>`).join('')}
        </tbody>
      </table>

      <div class="fp-totals">
        <div class="fp-total-row"><span style="color:#888">Subtotal</span><span>S/ ${f.subtotal.toFixed(2)}</span></div>
        ${f.descuento > 0 ? `<div class="fp-total-row"><span style="color:#888">Descuento</span><span>- S/ ${f.descuento.toFixed(2)}</span></div>` : ''}
        ${aplicaIgv ? `<div class="fp-total-row"><span style="color:#888">IGV (18%)</span><span>S/ ${f.igv.toFixed(2)}</span></div>` : ''}
        <div class="fp-total-row final"><span>TOTAL</span><span>S/ ${f.total.toFixed(2)}</span></div>
      </div>

      ${pagosHtml}

      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#aaa;text-align:center;">
        Generado por FacturaPro — Gracias por su preferencia
      </div>
    </div>`;
  abrirModal('modal-ver-factura');
}

function descargarPDF() {
  if (!facturaIdActual) return toast('No hay comprobante seleccionado', 'error');
  window.open(`${API}/pdf/${facturaIdActual}`, '_blank');
}

function descargarTicket80mm() {
  if (!facturaIdActual) return toast('No hay comprobante seleccionado', 'error');
  window.open(`${API}/pdf/${facturaIdActual}?formato=80mm`, '_blank');
}

function imprimirFormatoSeleccionado() {
  if (!facturaIdActual) return toast('No hay comprobante seleccionado', 'error');
  const formato = document.getElementById('formato-impresion').value;
  window.location.href = `${API}/pdf/${facturaIdActual}?formato=${encodeURIComponent(formato)}`;
}

let estadoCambioPendiente = null;

function abrirConfirmacionCambioEstado(id, estado) {
  const msgs = {
    pagado: { titulo: 'Cobro crédito' },
    anulado: { titulo: 'Anular comprobante', texto: '¿Anular este comprobante? El stock será devuelto si aplica.' },
  };

  const config = msgs[estado] || { titulo: 'Confirmar acción' };
  estadoCambioPendiente = { id, estado };

  document.getElementById('confirmar-estado-titulo').textContent = config.titulo;

  const pagoForm = document.getElementById('confirmar-pago-form');
  const metodo = document.getElementById('confirmar-metodo');
  const fecha = document.getElementById('confirmar-fecha');
  const monto = document.getElementById('confirmar-monto');
  const nro = document.getElementById('confirmar-nro-operacion');
  const evidencia = document.getElementById('confirmar-evidencia');

  if (estado === 'pagado') {
    pagoForm.style.display = 'block';
    const metodoActual = 'efectivo';
    metodo.value = metodoActual;
    fecha.value = new Date().toISOString().slice(0, 10);
    monto.value = '0';
    nro.value = '';
    evidencia.value = '';

    const comprobante = facturasData.find(item => item.id === id);
    const total = Number(comprobante?.total || 0);
    const saldo = Number(comprobante?.saldo_pendiente ?? total);
    const metodoButtons = document.querySelectorAll('.payment-method-option');
    metodoButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.method === metodoActual);
    });
    document.getElementById('confirmar-total').textContent = `S/ ${total.toFixed(2)}`;
    document.getElementById('confirmar-pendiente').textContent = `S/ ${saldo.toFixed(2)}`;
    document.getElementById('confirmar-selection-box').textContent = 'Método seleccionado: Efectivo';
  } else {
    pagoForm.style.display = 'none';
  }

  const selector = document.getElementById('payment-method-list');
  if (selector) {
    selector.querySelectorAll('.payment-method-option').forEach(button => {
      button.onclick = () => {
        selector.querySelectorAll('.payment-method-option').forEach(item => item.classList.remove('active'));
        button.classList.add('active');
        const method = button.dataset.method;
        document.getElementById('confirmar-metodo').value = method;
        document.getElementById('confirmar-selection-box').textContent = `Método seleccionado: ${method.toUpperCase()}`;
        const comprobante = facturasData.find(item => item.id === estadoCambioPendiente?.id);
        const saldo = Number(comprobante?.saldo_pendiente ?? (comprobante?.total ?? 0));
        document.getElementById('confirmar-pendiente').textContent = `S/ ${saldo.toFixed(2)}`;
      };
    });
  }

  abrirModal('modal-confirmar-estado');
}

async function confirmarCambioEstado() {
  const payload = estadoCambioPendiente;
  if (!payload) return;

  const metodoPago = document.getElementById('confirmar-metodo')?.value || 'efectivo';
  const fechaPago = document.getElementById('confirmar-fecha')?.value || new Date().toISOString().slice(0, 10);
  const comprobante = facturasData.find(item => item.id === payload.id);
  const monto = Number(document.getElementById('confirmar-monto')?.value ?? comprobante?.saldo_pendiente ?? comprobante?.total ?? 0);
  const referencia = document.getElementById('confirmar-nro-operacion')?.value.trim() || `${metodoPago.toUpperCase()}-${Date.now().toString().slice(-6)}`;
  const evidencia = document.getElementById('confirmar-evidencia')?.files?.[0];

  if (payload.estado === 'pagado') {
    if (!Number.isFinite(monto) || monto <= 0) {
      return toast('El monto debe ser mayor a cero.', 'error');
    }
    if (evidencia && !evidencia.type.startsWith('image/')) {
      return toast('La evidencia debe ser una imagen.', 'error');
    }
  }

  cerrarModal('modal-confirmar-estado');
  const body = { estado: payload.estado };
  if (payload.estado === 'pagado') {
    body.metodo_pago = metodoPago;
    body.monto = monto;
    body.fecha_pago = fechaPago;
    if (referencia) body.referencia = referencia;
    if (evidencia) body.evidencia = evidencia.name;
  }

  const r = await apiFetch(`${API}/comprobantes/${payload.id}/estado`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (d.ok) { toast(d.mensaje); cargarFacturas(); }
  else toast(d.error, 'error');
  estadoCambioPendiente = null;
}

async function cambiarEstado(id, estado) {
  abrirConfirmacionCambioEstado(id, estado);
}

// ===== REPORTES =====
async function cargarReportes() {
  try {
    const r1 = await apiFetch(`${API}/reportes/igv-mes`);
    const d1 = await r1.json();
    if (d1.ok && d1.data) {
      document.getElementById('rep-subtotal').textContent = 'S/ ' + (d1.data.base_imponible||0).toFixed(2);
      document.getElementById('rep-igv').textContent = 'S/ ' + (d1.data.igv_total||0).toFixed(2);
      document.getElementById('rep-total').textContent = 'S/ ' + (d1.data.total_con_igv||0).toFixed(2);
    }

    const r2 = await apiFetch(`${API}/reportes/ventas-por-dia`);
    const d2 = await r2.json();
    const tdias = document.getElementById('rep-dias-body');
    if (d2.data.length === 0) { tdias.innerHTML = '<tr><td colspan="3"><div class="empty"><p>Sin ventas aún</p></div></td></tr>'; }
    else { tdias.innerHTML = d2.data.map(v => `<tr><td class="mono">${v.dia}</td><td><span class="badge badge-blue">${v.cantidad_facturas}</span></td><td class="mono">S/ ${v.total.toFixed(2)}</td></tr>`).join(''); }

    const r3 = await apiFetch(`${API}/reportes/ventas-por-categoria`);
    const d3 = await r3.json();
    const tcat = document.getElementById('rep-cat-body');
    if (d3.data.length === 0) { tcat.innerHTML = '<tr><td colspan="3"><div class="empty"><p>Sin datos</p></div></td></tr>'; }
    else { tcat.innerHTML = d3.data.map(c => `<tr><td><span class="badge badge-blue">${c.categoria}</span></td><td>${c.unidades_vendidas}</td><td class="mono">S/ ${c.ingresos.toFixed(2)}</td></tr>`).join(''); }

    const r4 = await apiFetch(`${API}/reportes/facturas-por-estado`);
    const d4 = await r4.json();
    const badgeMap = { emitida:'badge-blue', pagada:'badge-green', anulada:'badge-red' };
    const test = document.getElementById('rep-estados-body');
    if (d4.data.length === 0) { test.innerHTML = '<tr><td colspan="3"><div class="empty"><p>Sin datos</p></div></td></tr>'; }
    else { test.innerHTML = d4.data.map(e => `<tr><td><span class="badge ${badgeMap[e.estado]||'badge-blue'}">${e.estado}</span></td><td>${e.cantidad}</td><td class="mono">S/ ${(e.monto_total||0).toFixed(2)}</td></tr>`).join(''); }

    await cargarReporteCompras();
    await cargarReporteCuentasCobrar();
  } catch(e) { toast('Error cargando reportes', 'error'); }
}

async function cargarReporteCuentasCobrar(mostrarErrores = false) {
  const desdeInput = document.getElementById('reporte-cobrar-desde');
  const hastaInput = document.getElementById('reporte-cobrar-hasta');
  const hoy = new Date();
  const hastaDefault = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  const desdeDefault = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
  if (!hastaInput.value) hastaInput.value = hastaDefault;
  if (!desdeInput.value) desdeInput.value = desdeDefault;
  if (desdeInput.value > hastaInput.value) {
    if (mostrarErrores) toast('La fecha inicial no puede ser posterior a la final.', 'error');
    return;
  }

  const query = new URLSearchParams({ desde: desdeInput.value, hasta: hastaInput.value });
  const respuesta = await apiFetch(`${API}/reportes/cuentas-por-cobrar?${query}`);
  const resultado = await respuesta.json();
  if (!respuesta.ok || !resultado.ok) {
    if (mostrarErrores) toast(resultado.error || 'No se pudo cargar cuentas por cobrar.', 'error');
    return;
  }

  const resumen = resultado.resumen;
  document.getElementById('reporte-cobrar-resumen').textContent =
    `${resumen.cantidad_documentos} documentos · cobrado S/ ${Number(resumen.monto_cobrado).toFixed(2)} · pendiente S/ ${Number(resumen.saldo_pendiente).toFixed(2)} · vencido S/ ${Number(resumen.monto_vencido).toFixed(2)}`;
  document.getElementById('reporte-cobrar-body').innerHTML = resultado.data.map(item => `
    <tr><td><strong>${escaparHTML(item.cliente_nombre)}</strong><br><small>${escaparHTML(item.cliente_documento || '')}</small></td>
      <td>${escaparHTML(item.serie)}-${String(item.numero).padStart(6, '0')}</td>
      <td>${escaparHTML(item.fecha_vencimiento || '—')}</td>
      <td>${item.vencido ? `<span class="badge badge-red">${item.dias_vencido} días</span>` : 'Al día'}</td>
      <td class="mono">S/ ${Number(item.total).toFixed(2)}</td>
      <td class="mono">S/ ${Number(item.monto_cobrado).toFixed(2)}</td>
      <td class="mono">S/ ${Number(item.saldo_pendiente).toFixed(2)}</td></tr>`).join('') ||
    '<tr><td colspan="7"><div class="empty"><p>Sin cuentas por cobrar en este periodo</p></div></td></tr>';
}

async function descargarCuentasCobrarExcel() {
  const desde = document.getElementById('reporte-cobrar-desde').value;
  const hasta = document.getElementById('reporte-cobrar-hasta').value;
  if (!desde || !hasta || desde > hasta) return toast('Selecciona un rango válido antes de exportar.', 'error');
  const query = new URLSearchParams({ desde, hasta });
  const respuesta = await apiFetch(`${API}/reportes/cuentas-por-cobrar/exportar?${query}`);
  if (!respuesta.ok) {
    const resultado = await respuesta.json();
    return toast(resultado.error || 'No se pudo descargar el Excel', 'error');
  }
  const archivo = URL.createObjectURL(await respuesta.blob());
  const enlace = document.createElement('a');
  enlace.href = archivo;
  enlace.download = `cuentas_por_cobrar_${desde}_${hasta}.xlsx`;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(archivo), 1000);
}

async function cargarReporteCompras(mostrarErrores = false) {
  const desdeInput = document.getElementById('reporte-compras-desde');
  const hastaInput = document.getElementById('reporte-compras-hasta');
  const hoy = new Date();
  const fechaHasta = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  const fechaDesde = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
  if (!hastaInput.value) hastaInput.value = fechaHasta;
  if (!desdeInput.value) desdeInput.value = fechaDesde;
  if (desdeInput.value > hastaInput.value) {
    if (mostrarErrores) toast('La fecha inicial no puede ser posterior a la fecha final.', 'error');
    return;
  }

  const query = new URLSearchParams({ desde: desdeInput.value, hasta: hastaInput.value });
  const [respuesta, cuentasResponse] = await Promise.all([
    apiFetch(`${API}/reportes/compras?${query}`),
    apiFetch(`${API}/reportes/cuentas-por-pagar?${query}`),
  ]);
  const [resultado, cuentas] = await Promise.all([respuesta.json(), cuentasResponse.json()]);
  if (!respuesta.ok || !resultado.ok || !cuentasResponse.ok || !cuentas.ok) {
    if (mostrarErrores) toast(resultado.error || cuentas.error || 'No se pudo cargar el reporte de compras', 'error');
    return;
  }

  document.getElementById('reporte-compras-resumen').textContent =
    `${resultado.resumen.total_documentos} documentos · ${resultado.resumen.total_lineas} líneas · ${resultado.resumen.unidades_recibidas} unidades recibidas`;
  document.getElementById('reporte-compras-proveedores').innerHTML = resultado.por_proveedor.map(item => `
    <tr><td><strong>${escaparHTML(item.proveedor_razon_social)}</strong><br><small>${escaparHTML(item.proveedor_documento)}</small></td>
      <td>${item.documentos}</td><td>${item.unidades_recibidas}</td></tr>`).join('') ||
    '<tr><td colspan="3"><div class="empty"><p>Sin recepciones en este periodo</p></div></td></tr>';
  document.getElementById('reporte-compras-productos').innerHTML = resultado.por_producto.map(item => `
    <tr><td>${escaparHTML(item.producto_nombre)}</td><td>${item.documentos}</td><td>${item.unidades_recibidas}</td></tr>`).join('') ||
    '<tr><td colspan="3"><div class="empty"><p>Sin recepciones en este periodo</p></div></td></tr>';
  document.getElementById('reporte-cuentas-resumen').textContent =
    `${cuentas.resumen.total_documentos} documentos pendientes · abonado S/ ${Number(cuentas.resumen.monto_pagado_pen).toFixed(2)} · saldo estimado S/ ${Number(cuentas.resumen.saldo_estimado_pen).toFixed(2)}`;
  document.getElementById('reporte-cuentas-proveedores').innerHTML = cuentas.por_proveedor.map(item => `
    <tr><td><strong>${escaparHTML(item.proveedor_razon_social)}</strong><br><small>${escaparHTML(item.proveedor_documento)}</small></td>
      <td>${item.documentos}</td><td class="mono">S/ ${Number(item.monto_pagado_pen).toFixed(2)}</td><td class="mono">S/ ${Number(item.saldo_estimado_pen).toFixed(2)}</td></tr>`).join('') ||
    '<tr><td colspan="4"><div class="empty"><p>Sin cuentas pendientes en este periodo</p></div></td></tr>';
}

async function descargarComprasExcel() {
  const desde = document.getElementById('reporte-compras-desde').value;
  const hasta = document.getElementById('reporte-compras-hasta').value;
  if (!desde || !hasta || desde > hasta) {
    return toast('Selecciona un rango válido antes de exportar.', 'error');
  }
  const query = new URLSearchParams({ desde, hasta });
  const respuesta = await apiFetch(`${API}/reportes/compras/exportar?${query}`);
  if (!respuesta.ok) {
    const resultado = await respuesta.json();
    return toast(resultado.error || 'No se pudo descargar el Excel', 'error');
  }
  const archivo = URL.createObjectURL(await respuesta.blob());
  const enlace = document.createElement('a');
  enlace.href = archivo;
  enlace.download = `compras_${desde}_${hasta}.xlsx`;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(archivo), 1000);
}

// ===== LOGIN / SESIÓN =====
async function verificarSesion() {
  try {
    const r = await apiFetch(`${API}/auth/me`);
    const d = await r.json();
    if (d.ok) {
      mostrarApp(d.usuario);
    } else {
      document.getElementById('login-screen').style.display = 'flex';
    }
  } catch (e) {
    document.getElementById('login-screen').style.display = 'flex';
  }
}

function mostrarApp(usuario) {
  usuarioActual = usuario;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'flex';
  document.getElementById('user-pill').style.display = 'flex';
  actualizarVistaPerfil();
  const permisos = new Set(usuario.permisos || []);
  const accesoTotal = usuario.rol === 'admin' || permisos.has('*');
  const permisosPorPagina = {
    dashboard: ['reportes:ver'],
    ventas: ['clientes:ver', 'productos:ver'],
    facturas: ['comprobantes:ver'],
    clientes: ['clientes:ver'],
    productos: ['productos:ver'],
    compras: ['compras:ver'],
    reportes: ['reportes:ver'],
    usuarios: ['usuarios:administrar'],
  };
  let primeraPagina = null;
  for (const boton of document.querySelectorAll('.nav-item')) {
    const pagina = boton.getAttribute('onclick')?.match(/goTo\('([^']+)'\)/)?.[1];
    if (!pagina) continue;
    const requisitos = permisosPorPagina[pagina] || [];
    const puedeCrearVenta = ['comprobantes:crear_factura', 'comprobantes:crear_boleta']
      .some(permiso => permisos.has(permiso));
    const permitida = accesoTotal || (requisitos.every(permiso => permisos.has(permiso)) &&
      (pagina !== 'ventas' || puedeCrearVenta));
    boton.style.display = permitida ? '' : 'none';
    if (permitida && !primeraPagina) primeraPagina = pagina;
  }
  if (primeraPagina) goTo(primeraPagina);
}

function actualizarVistaPerfil() {
  if (!usuarioActual) return;
  const nombre = usuarioActual.nombre || 'Usuario';
  const inicial = nombre.charAt(0).toUpperCase();
  const avatarEl = document.getElementById('user-avatar');
  const avatarPerfil = document.getElementById('perfil-avatar');
  const placeholder = document.getElementById('perfil-avatar-placeholder');
  const preview = document.getElementById('perfil-avatar-preview');

  if (usuarioActual.avatar && usuarioActual.avatar.startsWith('data:image/')) {
    avatarEl.style.backgroundImage = `url("${usuarioActual.avatar}")`;
    avatarEl.style.backgroundSize = 'cover';
    avatarEl.style.backgroundPosition = 'center';
    avatarEl.textContent = '';
    if (avatarPerfil) {
      avatarPerfil.style.backgroundImage = `url("${usuarioActual.avatar}")`;
      avatarPerfil.style.backgroundSize = 'cover';
      avatarPerfil.style.backgroundPosition = 'center';
      avatarPerfil.textContent = '';
    }
    if (preview) {
      preview.src = usuarioActual.avatar;
      preview.style.display = 'block';
      if (placeholder) placeholder.style.display = 'none';
    }
  } else {
    avatarEl.style.backgroundImage = 'none';
    avatarEl.textContent = inicial;
    if (avatarPerfil) {
      avatarPerfil.style.backgroundImage = 'none';
      avatarPerfil.textContent = inicial;
    }
    if (preview) {
      preview.src = '';
      preview.style.display = 'none';
      preview.dataset.avatar = '';
      if (placeholder) placeholder.style.display = 'block';
      placeholder.textContent = inicial;
    }
  }

  document.getElementById('user-nombre').textContent = nombre;
  document.getElementById('user-rol').textContent = usuarioActual.rol;
  document.getElementById('perfil-card-name').textContent = nombre;
  document.getElementById('perfil-card-email').textContent = usuarioActual.email || 'Sin correo';
  document.getElementById('perfil-card-role').textContent = usuarioActual.rol === 'admin' ? 'Administrador' : 'Vendedor';
}

function abrirModalPerfil() {
  if (!usuarioActual) return;
  document.getElementById('perfil-nombre').value = usuarioActual.nombre || '';
  document.getElementById('perfil-email').value = usuarioActual.email || '';
  document.getElementById('perfil-password').value = '';
  document.getElementById('perfil-password').type = 'password';
  document.getElementById('perfil-password-toggle').textContent = 'Mostrar';
  const preview = document.getElementById('perfil-avatar-preview');
  const placeholder = document.getElementById('perfil-avatar-placeholder');
  preview.dataset.avatar = usuarioActual.avatar || '';
  preview.src = usuarioActual.avatar || '';
  preview.style.display = usuarioActual.avatar && usuarioActual.avatar.startsWith('data:image/') ? 'block' : 'none';
  placeholder.style.display = preview.style.display === 'block' ? 'none' : 'block';
  placeholder.textContent = (usuarioActual.nombre || 'U').charAt(0).toUpperCase();
  actualizarVistaPerfil();
  abrirModal('modal-perfil');
}

function handlePerfilArchivo(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  const preview = document.getElementById('perfil-avatar-preview');
  const placeholder = document.getElementById('perfil-avatar-placeholder');
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    toast('Solo se permiten imágenes', 'error');
    input.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || '');
    preview.src = result;
    preview.style.display = 'block';
    preview.dataset.avatar = result;
    if (placeholder) placeholder.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function togglePerfilPassword() {
  const input = document.getElementById('perfil-password');
  const button = document.getElementById('perfil-password-toggle');
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  button.textContent = visible ? 'Mostrar' : 'Ocultar';
}

async function guardarPerfil(event) {
  event.preventDefault();
  const nombre = document.getElementById('perfil-nombre').value.trim();
  const email = document.getElementById('perfil-email').value.trim();
  const password = document.getElementById('perfil-password').value;
  const preview = document.getElementById('perfil-avatar-preview');
  const avatar = preview && preview.dataset.avatar ? preview.dataset.avatar : (usuarioActual?.avatar || '');

  if (!nombre || !email) {
    return toast('Nombre y correo son obligatorios', 'error');
  }

  const respuesta = await apiFetch(`${API}/auth/perfil`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre, email, password, avatar }),
  });
  const resultado = await respuesta.json();

  if (!respuesta.ok || !resultado.ok) {
    return toast(resultado.error || 'No se pudo actualizar el perfil', 'error');
  }

  usuarioActual = resultado.usuario;
  actualizarVistaPerfil();
  cerrarModal('modal-perfil');
  toast('Perfil actualizado');
}

async function cargarUsuarios() {
  const [respuesta, permisosResponse] = await Promise.all([
    apiFetch(`${API}/auth/usuarios`),
    apiFetch(`${API}/auth/usuarios/permisos`),
  ]);
  const [resultado, permisosResult] = await Promise.all([respuesta.json(), permisosResponse.json()]);
  if (!respuesta.ok || !resultado.ok || !permisosResponse.ok || !permisosResult.ok) {
    return toast(resultado.error || permisosResult.error || 'No se pudieron cargar los usuarios.', 'error');
  }
  gruposPermisosUsuarios = permisosResult.data;
  permisosPredeterminadosVendedor = permisosResult.permisos_predeterminados_vendedor || [];
  renderOpcionesPermisosUsuario(permisosPredeterminadosVendedor);
  const nombresPermisos = new Map(gruposPermisosUsuarios.flatMap(grupo =>
    grupo.permisos.map(permiso => [permiso.id, permiso.nombre])
  ));
  document.getElementById('usuarios-body').innerHTML = resultado.data.map(usuario => `
    <tr>
      <td><strong>${escaparHTML(usuario.nombre)}</strong></td>
      <td>${escaparHTML(usuario.email)}</td>
      <td><span class="badge ${usuario.rol === 'admin' ? 'badge-blue' : 'badge-green'}">${usuario.rol === 'admin' ? 'Administrador' : 'Vendedor'}</span></td>
      <td>${usuario.rol === 'admin' ? 'Acceso total' : (usuario.permisos || []).map(permiso => escaparHTML(nombresPermisos.get(permiso) || permiso)).join(', ') || 'Sin accesos'}</td>
      <td>${escaparHTML(usuario.created_at || '—')}</td>
      <td>${usuario.id === usuarioActual?.id ? '<span class="muted">Sesión actual</span>' : `<button class="btn btn-sm btn-danger" type="button" onclick="eliminarUsuario(${usuario.id})">Eliminar</button>`}</td>
    </tr>`).join('') || '<tr><td colspan="6"><div class="empty"><p>No hay usuarios.</p></div></td></tr>';
}

function renderOpcionesPermisosUsuario(permisosSeleccionados = []) {
  const seleccionados = new Set(permisosSeleccionados);
  document.getElementById('usuario-permisos').innerHTML = gruposPermisosUsuarios.map(grupo => `
    <fieldset class="user-permission-group"><legend>${escaparHTML(grupo.grupo)}</legend>
      ${grupo.permisos.map(permiso => `
        <label class="user-permission-option"><input type="checkbox" name="permisos" value="${escaparHTML(permiso.id)}" ${seleccionados.has(permiso.id) ? 'checked' : ''}><span>${escaparHTML(permiso.nombre)}</span></label>`).join('')}
    </fieldset>`).join('');
  actualizarPermisosUsuario();
}

function actualizarPermisosUsuario() {
  const esAdmin = document.getElementById('usuario-rol').value === 'admin';
  document.getElementById('usuario-permisos-panel').hidden = esAdmin;
  document.getElementById('usuario-admin-notice').hidden = !esAdmin;
}

function permisosSeleccionadosUsuario() {
  return [...document.querySelectorAll('#usuario-permisos input[name="permisos"]:checked')]
    .map(control => control.value);
}

async function guardarUsuario(event) {
  event.preventDefault();
  const formulario = event.currentTarget;
  const usuario = Object.fromEntries(new FormData(formulario).entries());
  usuario.permisos = usuario.rol === 'admin' ? ['*'] : permisosSeleccionadosUsuario();
  const respuesta = await apiFetch(`${API}/auth/usuarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(usuario),
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok || !resultado.ok) return toast(resultado.error || 'No se pudo crear el usuario.', 'error');
  formulario.reset();
  toast('Usuario creado');
  await cargarUsuarios();
}

async function eliminarUsuario(id) {
  if (!window.confirm('¿Eliminar esta cuenta? El usuario perderá acceso al sistema.')) return;
  const respuesta = await apiFetch(`${API}/auth/usuarios/${id}`, { method: 'DELETE' });
  const resultado = await respuesta.json();
  if (!respuesta.ok || !resultado.ok) return toast(resultado.error || 'No se pudo eliminar el usuario.', 'error');
  toast('Usuario eliminado');
  await cargarUsuarios();
}

async function hacerLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  const errDiv = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  errDiv.style.display = 'none';

  if (!email || !pass) {
    errDiv.textContent = 'Completa email y contraseña';
    errDiv.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="login-loader"></span> Ingresando...';

  try {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password: pass })
    });
    const d = await r.json();

    if (d.ok) {
      document.getElementById('login-pass').value = '';
      mostrarApp(d.usuario);
    } else {
      errDiv.textContent = d.error || 'No se pudo iniciar sesión';
      errDiv.style.display = 'block';
    }
  } catch (e) {
    errDiv.textContent = 'No se pudo conectar con el servidor';
    errDiv.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Iniciar sesión';
  }
}

async function cerrarSesion() {
  await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('user-pill').style.display = 'none';
  document.getElementById('login-email').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-screen').style.display = 'flex';
}

// Verificar sesión al cargar la página
verificarSesion();
