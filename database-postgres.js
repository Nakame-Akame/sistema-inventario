require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  throw new Error('Falta SUPABASE_DB_URL. Configura la conexión PostgreSQL de Supabase.');
}

const pool = new Pool({
  connectionString,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'sistema-facturacion',
});

pool.on('error', error => {
  console.error(JSON.stringify({
    level: 'error',
    timestamp: new Date().toISOString(),
    event: 'postgres_pool_error',
    error: error.name || 'Error',
  }));
});

async function query(text, values = []) {
  return pool.query(text, values);
}

async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function healthCheck() {
  await pool.query('SELECT 1');
}

async function initialize() {
  await pool.query(`
    INSERT INTO series (tipo, serie, ultimo_numero) VALUES
      ('factura', 'F001', 0),
      ('boleta', 'B001', 0),
      ('nota_pedido', 'NP01', 0),
      ('guia_remision', 'GR01', 0),
      ('cotizacion', 'COT1', 0),
      ('nota_devolucion', 'ND01', 0),
      ('nota_credito_f', 'NCF1', 0),
      ('nota_credito_b', 'NCB1', 0)
    ON CONFLICT (tipo) DO NOTHING
  `);
}

async function close() {
  await pool.end();
}

module.exports = { close, healthCheck, initialize, pool, query, transaction };