const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const db       = require('../database');
const {
  GRUPOS_PERMISOS,
  PERMISOS_DISPONIBLES,
  PERMISOS_POR_ROL,
  ROLES_VALIDOS,
  requierePermiso,
} = require('../middleware/permisos');
const {
  esEmailValido,
  sanitizarTexto,
  registrarAuditoria,
} = require('../middleware/seguridad');

// Crear tabla de usuarios si no existe
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    rol TEXT DEFAULT 'vendedor',
    permisos TEXT,
    avatar TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const columnasUsuarios = db.pragma('table_info(usuarios)');
if (!columnasUsuarios.some(columna => columna.name === 'permisos')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN permisos TEXT');
}
if (!columnasUsuarios.some(columna => columna.name === 'avatar')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN avatar TEXT');
}
if (!columnasUsuarios.some(columna => columna.name === 'created_at')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN created_at DATETIME');
}

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

// POST - Login
router.post('/login', (req, res) => {
  try {
    const email = sanitizarTexto(typeof req.body?.email === 'string' ? req.body.email : '', 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password || password.length < 8 || password.length > 128 || !esEmailValido(email)) {
      return res.status(400).json({ ok: false, error: 'Email y contraseña son requeridos' });
    }

    const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (!usuario) {
      registrarAuditoria({ req, accion: 'login_fallido', detalle: { email }, ok: false });
      return res.status(401).json({ ok: false, error: 'Correo o contraseña incorrectos' });
    }

    const valido = bcrypt.compareSync(password, usuario.password);
    if (!valido) {
      registrarAuditoria({ req, accion: 'login_fallido', detalle: { email, usuarioId: usuario.id }, ok: false });
      return res.status(401).json({ ok: false, error: 'Correo o contraseña incorrectos' });
    }

    req.session.regenerate(err => {
      if (err) return res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión' });
      req.session.usuario = {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
        avatar: usuario.avatar || null,
        permisos: permisosDeUsuario(usuario) ?? PERMISOS_POR_ROL[usuario.rol] ?? [],
      };
      req.session.save(saveError => {
        if (saveError) return res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión' });
        registrarAuditoria({ req, accion: 'login_exitoso', detalle: { usuarioId: usuario.id, rol: usuario.rol } });
        res.json({ ok: true, usuario: req.session.usuario, mensaje: 'Sesión iniciada' });
      });
    });
  } catch (err) {
    registrarAuditoria({ req, accion: 'login_error', ok: false, detalle: { error: 'login_exception' } });
    res.status(500).json({ ok: false, error: 'No se pudo iniciar sesión' });
  }
});

// POST - Logout
router.post('/logout', (req, res) => {
  const usuarioId = req.session?.usuario?.id ?? null;
  req.session.destroy(err => {
    if (err) return res.status(500).json({ ok: false, error: 'No se pudo cerrar sesión' });
    res.clearCookie('connect.sid', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    registrarAuditoria({ req, accion: 'logout', detalle: { usuarioId } });
    res.json({ ok: true, mensaje: 'Sesión cerrada' });
  });
});

// GET - Verificar sesión activa
router.get('/me', (req, res) => {
  if (!req.session.usuario)
    return res.status(401).json({ ok: false, error: 'No autenticado' });
  res.json({ ok: true, usuario: req.session.usuario });
});

// POST - Crear nuevo usuario (solo admin)
router.post('/usuarios', requierePermiso('usuarios:administrar'), (req, res) => {
  try {
    const nombre = sanitizarTexto(typeof req.body?.nombre === 'string' ? req.body.nombre : '', 120);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const email = sanitizarTexto(typeof req.body?.email === 'string' ? req.body.email : '', 254).toLowerCase();
    const rol = typeof req.body?.rol === 'string' ? req.body.rol.trim() : 'vendedor';
    if (!nombre || !email || !password)
      return res.status(400).json({ ok: false, error: 'Nombre, email y contraseña son requeridos' });
    if (password.length < 12 || password.length > 128 || !esEmailValido(email))
      return res.status(400).json({ ok: false, error: 'Datos de usuario no válidos' });
    if (!ROLES_VALIDOS.includes(rol))
      return res.status(400).json({ ok: false, error: 'Rol inválido' });

    const permisosSolicitados = req.body.permisos;
    if (rol !== 'admin' && permisosSolicitados !== undefined &&
        (!Array.isArray(permisosSolicitados) || permisosSolicitados.some(permiso => !PERMISOS_DISPONIBLES.has(permiso)))) {
      return res.status(400).json({ ok: false, error: 'La selección de permisos contiene opciones inválidas' });
    }
    const permisos = rol === 'admin'
      ? ['*']
      : [...new Set(permisosSolicitados ?? PERMISOS_POR_ROL[rol] ?? [])];

    const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    if (existe)
      return res.status(400).json({ ok: false, error: 'Ya existe un usuario con ese email' });

    const hash = bcrypt.hashSync(password, 12);
    const result = db.prepare(`
      INSERT INTO usuarios (nombre, email, password, rol, permisos)
      VALUES (?, ?, ?, ?, ?)
    `).run(nombre, email, hash, rol, JSON.stringify(permisos));

    registrarAuditoria({ req, accion: 'usuario_creado', detalle: { usuarioId: result.lastInsertRowid, rol } });
    res.status(201).json({ ok: true, id: result.lastInsertRowid, mensaje: 'Usuario creado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'No se pudo crear el usuario' });
  }
});

// GET - Listar usuarios (solo admin)
router.get('/usuarios', requierePermiso('usuarios:administrar'), (req, res) => {
  try {
    const usuarios = db.prepare(`
      SELECT id, nombre, email, rol, permisos, created_at FROM usuarios ORDER BY nombre ASC
    `).all();
    res.json({ ok: true, data: usuarios.map(usuario => ({
      ...usuario,
      permisos: permisosDeUsuario(usuario) ?? PERMISOS_POR_ROL[usuario.rol] ?? [],
    })) });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'No se pudo listar usuarios' });
  }
});

router.get('/usuarios/permisos', requierePermiso('usuarios:administrar'), (_req, res) => {
  res.json({
    ok: true,
    data: GRUPOS_PERMISOS,
    permisos_predeterminados_vendedor: PERMISOS_POR_ROL.vendedor,
  });
});

// DELETE - Eliminar usuario (solo admin, no puede eliminarse a sí mismo)
router.delete('/usuarios/:id', requierePermiso('usuarios:administrar'), (req, res) => {
  try {
    if (parseInt(req.params.id) === req.session.usuario.id)
      return res.status(400).json({ ok: false, error: 'No puedes eliminarte a ti mismo' });

    const usuario = db.prepare('SELECT id, rol FROM usuarios WHERE id = ?').get(req.params.id);
    if (!usuario) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    if (usuario.rol === 'admin' && db.prepare("SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'admin'").get().total <= 1) {
      return res.status(400).json({ ok: false, error: 'No se puede eliminar el último administrador' });
    }

    db.prepare('DELETE FROM usuarios WHERE id = ?').run(usuario.id);
    registrarAuditoria({ req, accion: 'usuario_eliminado', detalle: { usuarioId: usuario.id, eliminadoPor: req.session.usuario.id } });
    res.json({ ok: true, mensaje: 'Usuario eliminado' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'No se pudo eliminar el usuario' });
  }
});

// PUT - Editar perfil del usuario autenticado
router.put('/perfil', (req, res) => {
  try {
    if (!req.session.usuario)
      return res.status(401).json({ ok: false, error: 'No autenticado' });

    const nombre = sanitizarTexto(typeof req.body?.nombre === 'string' ? req.body.nombre : '', 120);
    const email = sanitizarTexto(typeof req.body?.email === 'string' ? req.body.email : '', 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const avatar = typeof req.body?.avatar === 'string' ? req.body.avatar.trim() : '';

    if (!nombre || !email)
      return res.status(400).json({ ok: false, error: 'Nombre y correo son requeridos' });

    if (!esEmailValido(email))
      return res.status(400).json({ ok: false, error: 'Ingresa un correo electrónico válido' });

    const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.session.usuario.id);
    if (!usuario)
      return res.status(401).json({ ok: false, error: 'No autenticado' });

    const emailDuplicado = db.prepare('SELECT id FROM usuarios WHERE email = ? AND id != ?').get(email, usuario.id);
    if (emailDuplicado)
      return res.status(400).json({ ok: false, error: 'Ya existe otro usuario con ese correo' });

    const campos = [];
    const valores = [];

    if (nombre !== usuario.nombre) {
      campos.push('nombre = ?');
      valores.push(nombre);
    }
    if (email !== usuario.email) {
      campos.push('email = ?');
      valores.push(email);
    }

    if (password) {
      if (password.length < 12)
        return res.status(400).json({ ok: false, error: 'La nueva contraseña debe tener al menos 12 caracteres' });
      campos.push('password = ?');
      valores.push(bcrypt.hashSync(password, 12));
    }

    if (avatar && avatar.startsWith('data:image/')) {
      campos.push('avatar = ?');
      valores.push(avatar);
    }

    if (campos.length > 0) {
      db.prepare(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = ?`).run(...valores, usuario.id);
    }

    registrarAuditoria({ req, accion: 'perfil_actualizado', detalle: { usuarioId: usuario.id } });
    const usuarioActualizado = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuario.id);
    req.session.usuario = {
      id: usuarioActualizado.id,
      nombre: usuarioActualizado.nombre,
      email: usuarioActualizado.email,
      rol: usuarioActualizado.rol,
      avatar: usuarioActualizado.avatar || null,
      permisos: permisosDeUsuario(usuarioActualizado) ?? PERMISOS_POR_ROL[usuarioActualizado.rol] ?? [],
    };

    req.session.save(saveError => {
      if (saveError)
        return res.status(500).json({ ok: false, error: 'No se pudo guardar el perfil actualizado' });
      res.json({ ok: true, usuario: req.session.usuario, mensaje: 'Perfil actualizado' });
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'No se pudo actualizar el perfil' });
  }
});

// PUT - Cambiar contraseña
router.put('/cambiar-password', (req, res) => {
  try {
    if (!req.session.usuario)
      return res.status(401).json({ ok: false, error: 'No autenticado' });

    const { password_actual, password_nuevo } = req.body;
    if (!password_actual || !password_nuevo)
      return res.status(400).json({ ok: false, error: 'Ambas contraseñas son requeridas' });
    if (typeof password_nuevo !== 'string' || password_nuevo.length < 12 || password_nuevo.length > 128)
      return res.status(400).json({ ok: false, error: 'La nueva contraseña debe tener al menos 12 caracteres' });

    const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.session.usuario.id);
    if (!usuario) return res.status(401).json({ ok: false, error: 'No autenticado' });
    const valido  = bcrypt.compareSync(password_actual, usuario.password);
    if (!valido)
      return res.status(401).json({ ok: false, error: 'La contraseña actual es incorrecta' });

    const nuevoHash = bcrypt.hashSync(password_nuevo, 12);
    db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(nuevoHash, usuario.id);
    registrarAuditoria({ req, accion: 'password_cambiada', detalle: { usuarioId: usuario.id } });
    res.json({ ok: true, mensaje: 'Contraseña actualizada' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'No se pudo cambiar la contraseña' });
  }
});

module.exports = router;