const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../database-postgres');
const {
  GRUPOS_PERMISOS,
  PERMISOS_DISPONIBLES,
  PERMISOS_POR_ROL,
  ROLES_VALIDOS,
  requierePermiso,
} = require('../../middleware/permisos');
const {
  esEmailValido,
  sanitizarTexto,
  registrarAuditoria,
} = require('../../middleware/seguridad');

const router = express.Router();

function permisosDeUsuario(usuario) {
  if (usuario.rol === 'admin') return ['*'];
  if (typeof usuario.permisos !== 'string') return undefined;
  try {
    const permisos = JSON.parse(usuario.permisos);
    if (Array.isArray(permisos) && permisos.every(permiso => PERMISOS_DISPONIBLES.has(permiso))) {
      return [...new Set(permisos)];
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function usuarioDeSesion(usuario) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
    avatar: usuario.avatar || null,
    permisos: permisosDeUsuario(usuario) ?? PERMISOS_POR_ROL[usuario.rol] ?? [],
  };
}

router.post('/login', async (req, res) => {
  try {
    const email = sanitizarTexto(typeof req.body?.email === 'string' ? req.body.email : '', 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password || password.length < 8 || password.length > 128 || !esEmailValido(email)) {
      return res.status(400).json({ ok: false, error: 'Email y contraseña son requeridos' });
    }

    const result = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    const usuario = result.rows[0];
    if (!usuario) {
      registrarAuditoria({ req, accion: 'login_fallido', detalle: { email }, ok: false });
      return res.status(401).json({ ok: false, error: 'Correo o contraseña incorrectos' });
    }

    if (!await bcrypt.compare(password, usuario.password)) {
      registrarAuditoria({ req, accion: 'login_fallido', detalle: { email, usuarioId: usuario.id }, ok: false });
      return res.status(401).json({ ok: false, error: 'Correo o contraseña incorrectos' });
    }

    req.session.regenerate(error => {
      if (error) return res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión' });
      req.session.usuario = usuarioDeSesion(usuario);
      req.session.save(saveError => {
        if (saveError) return res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión' });
        registrarAuditoria({ req, accion: 'login_exitoso', detalle: { usuarioId: usuario.id, rol: usuario.rol } });
        res.json({ ok: true, usuario: req.session.usuario, mensaje: 'Sesión iniciada' });
      });
    });
  } catch {
    registrarAuditoria({ req, accion: 'login_error', ok: false, detalle: { error: 'login_exception' } });
    res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión' });
  }
});

router.post('/logout', (req, res) => {
  const usuarioId = req.session?.usuario?.id ?? null;
  req.session.destroy(error => {
    if (error) return res.status(500).json({ ok: false, error: 'No se pudo cerrar sesión' });
    res.clearCookie('connect.sid', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    registrarAuditoria({ req, accion: 'logout', detalle: { usuarioId } });
    res.json({ ok: true, mensaje: 'Sesión cerrada' });
  });
});

router.get('/me', (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ ok: false, error: 'No autenticado' });
  res.json({ ok: true, usuario: req.session.usuario });
});

router.post('/usuarios', requierePermiso('usuarios:administrar'), async (req, res) => {
  try {
    const nombre = sanitizarTexto(typeof req.body?.nombre === 'string' ? req.body.nombre : '', 120);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const email = sanitizarTexto(typeof req.body?.email === 'string' ? req.body.email : '', 254).toLowerCase();
    const rol = typeof req.body?.rol === 'string' ? req.body.rol.trim() : 'vendedor';
    if (!nombre || !email || !password) {
      return res.status(400).json({ ok: false, error: 'Nombre, email y contraseña son requeridos' });
    }
    if (password.length < 12 || password.length > 128 || !esEmailValido(email)) {
      return res.status(400).json({ ok: false, error: 'Datos de usuario no válidos' });
    }
    if (!ROLES_VALIDOS.includes(rol)) return res.status(400).json({ ok: false, error: 'Rol inválido' });

    const permisosSolicitados = req.body.permisos;
    if (rol !== 'admin' && permisosSolicitados !== undefined &&
        (!Array.isArray(permisosSolicitados) || permisosSolicitados.some(permiso => !PERMISOS_DISPONIBLES.has(permiso)))) {
      return res.status(400).json({ ok: false, error: 'La selección de permisos contiene opciones inválidas' });
    }
    const permisos = rol === 'admin'
      ? ['*']
      : [...new Set(permisosSolicitados ?? PERMISOS_POR_ROL[rol] ?? [])];

    const hash = await bcrypt.hash(password, 12);
    const result = await db.query(`
      INSERT INTO usuarios (nombre, email, password, rol, permisos)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `, [nombre, email, hash, rol, JSON.stringify(permisos)]);
    if (!result.rowCount) return res.status(400).json({ ok: false, error: 'Ya existe un usuario con ese email' });

    registrarAuditoria({ req, accion: 'usuario_creado', detalle: { usuarioId: result.rows[0].id, rol } });
    res.status(201).json({ ok: true, id: result.rows[0].id, mensaje: 'Usuario creado' });
  } catch {
    res.status(500).json({ ok: false, error: 'No se pudo crear el usuario' });
  }
});

router.get('/usuarios', requierePermiso('usuarios:administrar'), async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT id, nombre, email, rol, permisos, created_at FROM usuarios ORDER BY nombre ASC');
    res.json({ ok: true, data: rows.map(usuario => ({
      ...usuario,
      permisos: permisosDeUsuario(usuario) ?? PERMISOS_POR_ROL[usuario.rol] ?? [],
    })) });
  } catch {
    res.status(500).json({ ok: false, error: 'No se pudo listar usuarios' });
  }
});

router.get('/usuarios/permisos', requierePermiso('usuarios:administrar'), (_req, res) => {
  res.json({ ok: true, data: GRUPOS_PERMISOS, permisos_predeterminados_vendedor: PERMISOS_POR_ROL.vendedor });
});

router.delete('/usuarios/:id', requierePermiso('usuarios:administrar'), async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.usuario.id) return res.status(400).json({ ok: false, error: 'No puedes eliminarte a ti mismo' });
  try {
    const result = await db.transaction(async client => {
      const usuarioResult = await client.query('SELECT id, rol FROM usuarios WHERE id = $1 FOR UPDATE', [id]);
      const usuario = usuarioResult.rows[0];
      if (!usuario) return { status: 404, error: 'Usuario no encontrado' };
      if (usuario.rol === 'admin') {
        const admins = await client.query("SELECT COUNT(*)::int AS total FROM usuarios WHERE rol = 'admin'");
        if (admins.rows[0].total <= 1) return { status: 400, error: 'No se puede eliminar el último administrador' };
      }
      await client.query('DELETE FROM usuarios WHERE id = $1', [id]);
      return { usuario };
    });
    if (result.error) return res.status(result.status).json({ ok: false, error: result.error });
    registrarAuditoria({ req, accion: 'usuario_eliminado', detalle: { usuarioId: result.usuario.id, eliminadoPor: req.session.usuario.id } });
    res.json({ ok: true, mensaje: 'Usuario eliminado' });
  } catch {
    res.status(500).json({ ok: false, error: 'No se pudo eliminar el usuario' });
  }
});

router.put('/perfil', async (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ ok: false, error: 'No autenticado' });
  try {
    const nombre = sanitizarTexto(typeof req.body?.nombre === 'string' ? req.body.nombre : '', 120);
    const email = sanitizarTexto(typeof req.body?.email === 'string' ? req.body.email : '', 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const avatar = typeof req.body?.avatar === 'string' ? req.body.avatar.trim() : '';
    if (!nombre || !email) return res.status(400).json({ ok: false, error: 'Nombre y correo son requeridos' });
    if (!esEmailValido(email)) return res.status(400).json({ ok: false, error: 'Ingresa un correo electrónico válido' });

    const currentResult = await db.query('SELECT * FROM usuarios WHERE id = $1', [req.session.usuario.id]);
    const usuario = currentResult.rows[0];
    if (!usuario) return res.status(401).json({ ok: false, error: 'No autenticado' });
    const duplicate = await db.query('SELECT id FROM usuarios WHERE email = $1 AND id <> $2', [email, usuario.id]);
    if (duplicate.rowCount) return res.status(400).json({ ok: false, error: 'Ya existe otro usuario con ese correo' });

    const fields = [];
    const values = [];
    const addField = (column, value) => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };
    if (nombre !== usuario.nombre) addField('nombre', nombre);
    if (email !== usuario.email) addField('email', email);
    if (password) {
      if (password.length < 12) return res.status(400).json({ ok: false, error: 'La nueva contraseña debe tener al menos 12 caracteres' });
      addField('password', await bcrypt.hash(password, 12));
    }
    if (avatar.startsWith('data:image/')) addField('avatar', avatar);
    if (fields.length) {
      values.push(usuario.id);
      await db.query(`UPDATE usuarios SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
    }

    const updatedResult = await db.query('SELECT * FROM usuarios WHERE id = $1', [usuario.id]);
    const actualizado = updatedResult.rows[0];
    req.session.usuario = usuarioDeSesion(actualizado);
    registrarAuditoria({ req, accion: 'perfil_actualizado', detalle: { usuarioId: usuario.id } });
    req.session.save(saveError => {
      if (saveError) return res.status(500).json({ ok: false, error: 'No se pudo guardar el perfil actualizado' });
      res.json({ ok: true, usuario: req.session.usuario, mensaje: 'Perfil actualizado' });
    });
  } catch {
    res.status(500).json({ ok: false, error: 'No se pudo actualizar el perfil' });
  }
});

router.put('/cambiar-password', async (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ ok: false, error: 'No autenticado' });
  const { password_actual, password_nuevo } = req.body;
  if (!password_actual || !password_nuevo) return res.status(400).json({ ok: false, error: 'Ambas contraseñas son requeridas' });
  if (typeof password_nuevo !== 'string' || password_nuevo.length < 12 || password_nuevo.length > 128) {
    return res.status(400).json({ ok: false, error: 'La nueva contraseña debe tener al menos 12 caracteres' });
  }
  try {
    const result = await db.query('SELECT * FROM usuarios WHERE id = $1', [req.session.usuario.id]);
    const usuario = result.rows[0];
    if (!usuario) return res.status(401).json({ ok: false, error: 'No autenticado' });
    if (!await bcrypt.compare(password_actual, usuario.password)) {
      return res.status(401).json({ ok: false, error: 'La contraseña actual es incorrecta' });
    }
    const nuevoHash = await bcrypt.hash(password_nuevo, 12);
    await db.query('UPDATE usuarios SET password = $1 WHERE id = $2', [nuevoHash, usuario.id]);
    registrarAuditoria({ req, accion: 'password_cambiada', detalle: { usuarioId: usuario.id } });
    res.json({ ok: true, mensaje: 'Contraseña actualizada' });
  } catch {
    res.status(500).json({ ok: false, error: 'No se pudo cambiar la contraseña' });
  }
});

module.exports = router;