const readline = require('node:readline/promises');
const bcrypt = require('bcryptjs');
const useSqlite = process.env.DATABASE_BACKEND === 'sqlite' || process.env.DB_PATH === ':memory:';
const db = useSqlite ? require('../database') : require('../database-postgres');

async function createAdmin({ nombre, email, password, replaceExisting = false }) {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!nombre || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Debes indicar un nombre y un correo válido.');
  }
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('La contraseña debe tener al menos 12 caracteres.');
  }

  const existing = useSqlite
    ? db.prepare('SELECT id, rol FROM usuarios WHERE email = ?').get(normalizedEmail)
    : (await db.query('SELECT id, rol FROM usuarios WHERE email = $1', [normalizedEmail])).rows[0];
  const hash = await bcrypt.hash(password, 12);
  if (existing) {
    if (existing.rol !== 'admin' || !replaceExisting) {
      throw new Error('Ese correo ya está registrado.');
    }
    if (useSqlite) {
      db.prepare('UPDATE usuarios SET nombre = ?, password = ?, rol = ? WHERE id = ?')
        .run(nombre.trim(), hash, 'admin', existing.id);
    } else {
      await db.query(
        "UPDATE usuarios SET nombre = $1, password = $2, rol = 'admin' WHERE id = $3",
        [nombre.trim(), hash, existing.id],
      );
    }
    return existing.id;
  }

  if (useSqlite) {
    const result = db.prepare(`
      INSERT INTO usuarios (nombre, email, password, rol)
      VALUES (?, ?, ?, 'admin')
    `).run(nombre.trim(), normalizedEmail, hash);
    return result.lastInsertRowid;
  }
  const result = await db.query(`
    INSERT INTO usuarios (nombre, email, password, rol)
    VALUES ($1, $2, $3, 'admin')
    ON CONFLICT (email) DO NOTHING
    RETURNING id
  `, [nombre.trim(), normalizedEmail, hash]);
  if (!result.rowCount) throw new Error('Ese correo ya está registrado.');
  return result.rows[0].id;
}

async function main() {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const nombre = await prompt.question('Nombre del administrador: ');
    const email = await prompt.question('Correo del administrador: ');
    const normalizedEmail = email.trim().toLowerCase();
    const existing = useSqlite
      ? db.prepare('SELECT id, rol FROM usuarios WHERE email = ?').get(normalizedEmail)
      : (await db.query('SELECT id, rol FROM usuarios WHERE email = $1', [normalizedEmail])).rows[0];
    let replaceExisting = false;
    if (existing) {
      if (existing.rol !== 'admin') throw new Error('El correo ya pertenece a un usuario que no es administrador.');
      replaceExisting = (await prompt.question('La cuenta existe. ¿Restablecer su contraseña? (s/N): ')).trim().toLowerCase() === 's';
      if (!replaceExisting) return;
    }
    const password = await prompt.question('Nueva contraseña (mínimo 12 caracteres): ');
    const confirmation = await prompt.question('Repite la contraseña: ');
    if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');

    const id = await createAdmin({ nombre, email, password, replaceExisting });
    console.log(`Administrador listo (id ${id}).`);
  } finally {
    prompt.close();
    if (useSqlite) db.close();
    else await db.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createAdmin };