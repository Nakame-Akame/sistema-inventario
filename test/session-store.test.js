const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const test = require('node:test');
const SQLiteSessionStore = require('../services/sqlite-session-store');
const PostgresSessionStore = require('../services/postgres-session-store');

function invoke(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (error, result) => error ? reject(error) : resolve(result));
  });
}

test('stores sessions persistently and supports touch and destroy', async () => {
  const database = new Database(':memory:');
  const store = new SQLiteSessionStore(database);
  const sessionData = {
    cookie: { expires: new Date(Date.now() + 60_000), maxAge: 60_000 },
    usuario: { id: 7, rol: 'admin' },
  };

  try {
    await invoke(store, 'set', 'session-1', sessionData);
    assert.deepEqual(await invoke(store, 'get', 'session-1'), JSON.parse(JSON.stringify(sessionData)));
    const restartedStore = new SQLiteSessionStore(database);
    assert.deepEqual(await invoke(restartedStore, 'get', 'session-1'), JSON.parse(JSON.stringify(sessionData)));
    clearInterval(restartedStore.cleanupTimer);

    const laterSession = { ...sessionData, cookie: { expires: new Date(Date.now() + 120_000), maxAge: 120_000 } };
    await invoke(store, 'touch', 'session-1', laterSession);
    assert.deepEqual(await invoke(store, 'get', 'session-1'), JSON.parse(JSON.stringify(laterSession)));

    await invoke(store, 'destroy', 'session-1');
    assert.equal(await invoke(store, 'get', 'session-1'), null);
  } finally {
    clearInterval(store.cleanupTimer);
    database.close();
  }
});

test('does not return expired sessions', async () => {
  const database = new Database(':memory:');
  const store = new SQLiteSessionStore(database);

  try {
    await invoke(store, 'set', 'expired-session', {
      cookie: { expires: new Date(Date.now() - 1) },
      usuario: { id: 7 },
    });
    assert.equal(await invoke(store, 'get', 'expired-session'), null);
  } finally {
    clearInterval(store.cleanupTimer);
    database.close();
  }
});

test('PostgreSQL session store persists, refreshes and deletes sessions', async () => {
  let storedSession = null;
  const database = {
    async query(sql, values) {
      if (sql.includes('INSERT INTO app_sessions')) {
        storedSession = { sid: values[0], expiresAt: values[1], data: JSON.parse(values[2]) };
      } else if (sql.includes('UPDATE app_sessions')) {
        storedSession = { sid: values[2], expiresAt: values[0], data: JSON.parse(values[1]) };
      } else if (sql.includes('SELECT data FROM app_sessions')) {
        return { rows: storedSession?.sid === values[0] && storedSession.expiresAt > values[1]
          ? [{ data: storedSession.data }]
          : [] };
      } else if (sql.includes('DELETE FROM app_sessions WHERE sid')) {
        storedSession = null;
      }
      return { rows: [] };
    },
  };
  const store = new PostgresSessionStore(database);
  const sessionData = {
    cookie: { expires: new Date(Date.now() + 60_000), maxAge: 60_000 },
    usuario: { id: 7, rol: 'admin' },
  };

  try {
    await invoke(store, 'set', 'session-1', sessionData);
    assert.deepEqual(await invoke(store, 'get', 'session-1'), JSON.parse(JSON.stringify(sessionData)));

    const laterSession = { ...sessionData, cookie: { expires: new Date(Date.now() + 120_000), maxAge: 120_000 } };
    await invoke(store, 'touch', 'session-1', laterSession);
    assert.deepEqual(await invoke(store, 'get', 'session-1'), JSON.parse(JSON.stringify(laterSession)));

    await invoke(store, 'destroy', 'session-1');
    assert.equal(await invoke(store, 'get', 'session-1'), null);
  } finally {
    clearInterval(store.cleanupTimer);
  }
});
