const PERMISOS_POR_ROL = Object.freeze({
	admin: ['*'],
	vendedor: [
		'clientes:ver',
		'clientes:crear',
		'productos:ver',
		'comprobantes:ver',
		'comprobantes:crear_factura',
		'comprobantes:crear_boleta',
		'comprobantes:crear_nota_pedido',
		'comprobantes:crear_guia_remision',
		'comprobantes:crear_cotizacion',
		'comprobantes:pagar',
		'reportes:ver',
	],
});

const GRUPOS_PERMISOS = Object.freeze([
	{ grupo: 'Usuarios', permisos: [
		{ id: 'usuarios:administrar', nombre: 'Administrar usuarios' },
	] },
	{ grupo: 'Clientes', permisos: [
		{ id: 'clientes:ver', nombre: 'Ver clientes' },
		{ id: 'clientes:crear', nombre: 'Crear clientes' },
		{ id: 'clientes:editar', nombre: 'Editar clientes' },
		{ id: 'clientes:eliminar', nombre: 'Eliminar clientes' },
	] },
	{ grupo: 'Productos', permisos: [
		{ id: 'productos:ver', nombre: 'Ver productos' },
		{ id: 'productos:crear', nombre: 'Crear productos' },
		{ id: 'productos:editar', nombre: 'Editar productos' },
		{ id: 'productos:eliminar', nombre: 'Eliminar productos' },
		{ id: 'productos:ajustar_stock', nombre: 'Ajustar stock' },
	] },
	{ grupo: 'Comprobantes', permisos: [
		{ id: 'comprobantes:ver', nombre: 'Ver comprobantes' },
		{ id: 'comprobantes:crear_factura', nombre: 'Crear facturas' },
		{ id: 'comprobantes:crear_boleta', nombre: 'Crear boletas' },
		{ id: 'comprobantes:crear_nota_pedido', nombre: 'Crear notas de pedido' },
		{ id: 'comprobantes:crear_guia_remision', nombre: 'Crear guías de remisión' },
		{ id: 'comprobantes:crear_cotizacion', nombre: 'Crear cotizaciones' },
		{ id: 'comprobantes:crear_nota_credito_f', nombre: 'Crear notas de crédito de factura' },
		{ id: 'comprobantes:crear_nota_credito_b', nombre: 'Crear notas de crédito de boleta' },
		{ id: 'comprobantes:pagar', nombre: 'Registrar pagos y cobros' },
		{ id: 'comprobantes:anular', nombre: 'Anular comprobantes' },
		{ id: 'comprobantes:devolver', nombre: 'Registrar devoluciones' },
	] },
	{ grupo: 'Compras e inventario', permisos: [
		{ id: 'compras:ver', nombre: 'Ver compras y proveedores' },
		{ id: 'compras:crear', nombre: 'Registrar compras' },
		{ id: 'inventario:ver', nombre: 'Ver inventario y kardex' },
		{ id: 'inventario:gestionar', nombre: 'Gestionar almacenes y movimientos' },
	] },
	{ grupo: 'Reportes', permisos: [
		{ id: 'reportes:ver', nombre: 'Ver reportes' },
	] },
]);

const PERMISOS_DISPONIBLES = new Set(GRUPOS_PERMISOS.flatMap(grupo => grupo.permisos.map(permiso => permiso.id)));

const ROLES_VALIDOS = Object.keys(PERMISOS_POR_ROL);

function tienePermiso(rol, permiso, permisosUsuario) {
	const permisos = Array.isArray(permisosUsuario) ? permisosUsuario : PERMISOS_POR_ROL[rol] || [];
	return rol === 'admin' || permisos.includes('*') || permisos.includes(permiso);
}

function requierePermiso(permiso) {
	return (req, res, next) => {
		if (!req.session?.usuario) {
			return res.status(401).json({ ok: false, error: 'Debes iniciar sesión' });
		}
		if (!tienePermiso(req.session.usuario.rol, permiso, req.session.usuario.permisos)) {
			return res.status(403).json({ ok: false, error: 'Acceso denegado' });
		}
		next();
	};
}

module.exports = { PERMISOS_POR_ROL, GRUPOS_PERMISOS, PERMISOS_DISPONIBLES, ROLES_VALIDOS, tienePermiso, requierePermiso };
