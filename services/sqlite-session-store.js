const session = require('express-session');

class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;
    database.exec(`
      CREATE TABLE IF NOT EXISTS app_sessions (
        sid TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_app_sessions_expires_at ON app_sessions(expires_at);
    `);
    this.getSession = database.prepare('SELECT data FROM app_sessions WHERE sid = ? AND expires_at > ?');
    this.deleteSession = database.prepare('DELETE FROM app_sessions WHERE sid = ?');
    this.upsertSession = database.prepare(`
      INSERT INTO app_sessions (sid, expires_at, data) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET expires_at = excluded.expires_at, data = excluded.data
    `);
    this.updateExpiry = database.prepare('UPDATE app_sessions SET expires_at = ?, data = ? WHERE sid = ?');
    this.deleteExpired = database.prepare('DELETE FROM app_sessions WHERE expires_at <= ?');

    this.cleanupTimer = setInterval(() => {
      try {
        this.deleteExpired.run(Date.now());
      } catch (error) {
        console.error('No se pudieron limpiar sesiones expiradas:', error.message);
      }
    }, 60 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  get(sid, callback) {
    try {
      const row = this.getSession.get(sid, Date.now());
      callback(null, row ? JSON.parse(row.data) : null);
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sessionData, callback) {
    try {
      this.upsertSession.run(sid, this.expiry(sessionData), JSON.stringify(sessionData));
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  touch(sid, sessionData, callback) {
    try {
      this.updateExpiry.run(this.expiry(sessionData), JSON.stringify(sessionData), sid);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  destroy(sid, callback) {
    try {
      this.deleteSession.run(sid);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  expiry(sessionData) {
    const expires = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : Date.now() + Number(sessionData.cookie?.maxAge || 8 * 60 * 60 * 1000);
    if (!Number.isFinite(expires)) throw new Error('La expiración de la sesión no es válida.');
    return expires;
  }
}

module.exports = SQLiteSessionStore;
