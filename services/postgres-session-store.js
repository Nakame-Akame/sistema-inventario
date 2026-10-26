const session = require('express-session');

class PostgresSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;

    this.cleanupTimer = setInterval(() => {
      this.database.query('DELETE FROM app_sessions WHERE expires_at <= $1', [Date.now()])
        .catch(error => {
          console.error('No se pudieron limpiar sesiones expiradas:', error.message);
        });
    }, 60 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  get(sid, callback) {
    this.database.query(
      'SELECT data FROM app_sessions WHERE sid = $1 AND expires_at > $2',
      [sid, Date.now()],
    ).then(({ rows }) => {
      const data = rows[0]?.data;
      callback(null, data == null ? null : (typeof data === 'string' ? JSON.parse(data) : data));
    }).catch(callback);
  }

  set(sid, sessionData, callback) {
    this.database.query(`
      INSERT INTO app_sessions (sid, expires_at, data)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (sid) DO UPDATE
      SET expires_at = EXCLUDED.expires_at, data = EXCLUDED.data
    `, [sid, this.expiry(sessionData), JSON.stringify(sessionData)])
      .then(() => callback?.(null))
      .catch(error => callback?.(error));
  }

  touch(sid, sessionData, callback) {
    this.database.query(
      'UPDATE app_sessions SET expires_at = $1, data = $2::jsonb WHERE sid = $3',
      [this.expiry(sessionData), JSON.stringify(sessionData), sid],
    ).then(() => callback?.(null)).catch(error => callback?.(error));
  }

  destroy(sid, callback) {
    this.database.query('DELETE FROM app_sessions WHERE sid = $1', [sid])
      .then(() => callback?.(null))
      .catch(error => callback?.(error));
  }

  expiry(sessionData) {
    const expires = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : Date.now() + Number(sessionData.cookie?.maxAge || 8 * 60 * 60 * 1000);
    if (!Number.isFinite(expires)) throw new Error('La expiración de la sesión no es válida.');
    return expires;
  }
}

module.exports = PostgresSessionStore;
