require('dotenv').config();
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { Client } = require('pg');

const TABLES_IN_IMPORT_ORDER = [
  'usuarios',
  'clientes',
  'productos',
  'series',
  'almacenes',
  'proveedores',
  'tipo_cambio_diario',
  'comprobantes',
  'detalle_comprobante',
  'pagos_comprobante',
  'documentos_compra',
  'detalle_documento_compra',
  'pagos_documento_compra',
  'kardex_movimientos',
];

async function main() {
  const apply = process.argv.includes('--apply');
  const configuredPath = process.env.DB_PATH || 'facturacion.db';
  const sourcePath = configuredPath === ':memory:'
    ? configuredPath
    : path.resolve(process.cwd(), configuredPath);

  if (sourcePath === ':memory:' || !fs.existsSync(sourcePath)) {
    throw new Error(`No se encontró la base SQLite en ${sourcePath}`);
  }

  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const counts = {};
  for (const table of TABLES_IN_IMPORT_ORDER) {
    const exists = source.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(table);
    if (!exists) throw new Error(`Falta la tabla SQLite esperada: ${table}`);
    counts[table] = source.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count;
  }

  if (!apply) {
    console.log('Vista previa de migración SQLite -> Supabase PostgreSQL:');
    for (const [table, count] of Object.entries(counts)) console.log(`  ${table}: ${count}`);
    console.log('\nNo se escribió ningún dato. Revisa la vista previa y ejecuta con --apply para importar.');
    source.close();
    return;
  }

  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error('Configura SUPABASE_DB_URL en .env con la conexión PostgreSQL del proyecto Supabase.');
  }

  const schemaPath = path.join(__dirname, '..', 'supabase', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const target = new Client({ connectionString });

  try {
    await target.connect();
    await target.query('BEGIN');
    await target.query(schema);

    const nonEmptyTables = [];
    for (const table of TABLES_IN_IMPORT_ORDER) {
      const result = await target.query(`SELECT COUNT(*)::bigint AS count FROM public."${table}"`);
      if (Number(result.rows[0].count) > 0) nonEmptyTables.push({ table_name: table });
    }
    if (nonEmptyTables.length) {
      throw new Error(`La base Supabase ya contiene datos (${nonEmptyTables.map(row => row.table_name).join(', ')}). No se mezclaron registros.`);
    }

    for (const table of TABLES_IN_IMPORT_ORDER) {
      const sourceColumns = source.pragma(`table_info("${table}")`).map(column => column.name);
      const targetColumnsResult = await target.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
        ['public', table],
      );
      const targetColumns = new Set(targetColumnsResult.rows.map(row => row.column_name));
      const columns = sourceColumns.filter(column => targetColumns.has(column));
      if (!columns.length) {
        throw new Error(`No se pudo validar el esquema de destino para ${table}.`);
      }

      const rows = source.prepare(`SELECT * FROM "${table}"`).all();
      for (let offset = 0; offset < rows.length; offset += 250) {
        const batch = rows.slice(offset, offset + 250);
        const values = [];
        const placeholders = batch.map((row, rowIndex) => `(${columns.map((column, columnIndex) => {
          values.push(row[column] ?? null);
          return `$${rowIndex * columns.length + columnIndex + 1}`;
        }).join(', ')})`);
        await target.query(
          `INSERT INTO public."${table}" (${columns.map(column => `"${column}"`).join(', ')}) VALUES ${placeholders.join(', ')}`,
          values,
        );
      }

      if (targetColumns.has('id')) {
        await target.query(
          `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM public."${table}"`,
          [`public.${table}`],
        );
      }
      console.log(`Importados ${rows.length} registros de ${table}`);
    }

    await target.query('COMMIT');
    console.log('\nMigración completada. La base SQLite original se conservó sin cambios.');
  } catch (error) {
    await target.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    source.close();
    await target.end();
  }
}

main().catch(error => {
  console.error(`Error de migración: ${error.message}`);
  process.exitCode = 1;
});