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

function normalizarValor(valor) {
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'string') {
    const timestamp = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?$/.exec(valor);
    if (timestamp) {
      const milisegundos = (timestamp[3] || '').padEnd(3, '0').slice(0, 3);
      return `${timestamp[1]}T${timestamp[2]}.${milisegundos}Z`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return `${valor}T00:00:00.000Z`;
  }
  return valor;
}

function valoresEquivalentes(origen, destino) {
  const valorOrigen = normalizarValor(origen);
  const valorDestino = normalizarValor(destino);
  if (typeof valorOrigen === 'number' && typeof valorDestino === 'number') {
    return Math.abs(valorOrigen - valorDestino) <= 1e-9;
  }
  return valorOrigen === valorDestino;
}

async function obtenerComparacion(source, target) {
  const resumen = [];
  for (const table of TABLES_IN_IMPORT_ORDER) {
    const sourceColumns = source.pragma(`table_info("${table}")`);
    if (!sourceColumns.length) throw new Error(`Falta la tabla SQLite esperada: ${table}`);
    const columns = sourceColumns.map(column => column.name);
    const primaryKeyColumns = sourceColumns
      .filter(column => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map(column => column.name);
    if (primaryKeyColumns.length !== 1) {
      throw new Error(`La comparación requiere una clave primaria simple en ${table}.`);
    }
    const primaryKey = primaryKeyColumns[0];
    if (!columns.includes(primaryKey)) throw new Error(`No se encontró la clave primaria de ${table}.`);

    const targetColumnsResult = await target.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
      ['public', table],
    );
    const targetColumns = new Set(targetColumnsResult.rows.map(row => row.column_name));
    const missingColumns = columns.filter(column => !targetColumns.has(column));
    if (missingColumns.length) {
      throw new Error(`Faltan columnas en public.${table}: ${missingColumns.join(', ')}.`);
    }

    const sourceRows = source.prepare(`SELECT * FROM "${table}"`).all();
    const targetCountResult = await target.query(`SELECT COUNT(*)::bigint AS count FROM public."${table}"`);
    const targetCount = Number(targetCountResult.rows[0].count);
    let coincidentes = 0;
    let filasDiferentes = 0;
    const columnasDiferentes = new Set();

    for (let offset = 0; offset < sourceRows.length; offset += 250) {
      const batch = sourceRows.slice(offset, offset + 250);
      const keys = batch.map(row => row[primaryKey]);
      if (!keys.length) continue;
      const matches = await target.query(
        `SELECT ${columns.map(column => `"${column}"`).join(', ')} FROM public."${table}" WHERE "${primaryKey}" = ANY($1)`,
        [keys],
      );
      const targetRows = new Map(matches.rows.map(row => [String(row[primaryKey]), row]));

      for (const sourceRow of batch) {
        const targetRow = targetRows.get(String(sourceRow[primaryKey]));
        if (!targetRow) continue;
        coincidentes++;
        const changedColumns = columns.filter(column =>
          !valoresEquivalentes(sourceRow[column] ?? null, targetRow[column] ?? null));
        if (changedColumns.length) {
          filasDiferentes++;
          for (const column of changedColumns) columnasDiferentes.add(column);
        }
      }
    }

    resumen.push({
      tabla: table,
      sqlite: sourceRows.length,
      supabase: targetCount,
      misma_clave: coincidentes,
      solo_sqlite: sourceRows.length - coincidentes,
      solo_supabase: targetCount - coincidentes,
      filas_con_diferencias: filasDiferentes,
      columnas_con_diferencias: [...columnasDiferentes].sort(),
    });
  }

  return resumen;
}

async function compararTablas(source, target) {
  await target.query('BEGIN READ ONLY');
  try {
    const resumen = await obtenerComparacion(source, target);
    await target.query('COMMIT');
    return resumen;
  } catch (error) {
    await target.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const compare = process.argv.includes('--compare');
  if (apply && compare) throw new Error('Usa --compare o --apply, no ambos a la vez.');
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

  if (!apply && !compare) {
    console.log('Vista previa de migración SQLite -> Supabase PostgreSQL:');
    for (const [table, count] of Object.entries(counts)) console.log(`  ${table}: ${count}`);
    console.log('\nNo se escribió ningún dato. Revisa la vista previa y ejecuta con --apply para importar.');
    source.close();
    return;
  }

  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    source.close();
    throw new Error('Configura SUPABASE_DB_URL en .env con la conexión PostgreSQL del proyecto Supabase.');
  }

  if (compare) {
    const target = new Client({
      connectionString,
      application_name: 'sistema-facturacion-migration-compare',
      options: '-c default_transaction_read_only=on',
    });
    try {
      await target.connect();
      const resumen = await compararTablas(source, target);
      console.log('Comparación de solo lectura SQLite -> Supabase (no se modificó ninguna base):');
      for (const fila of resumen) {
        console.log(
          `  ${fila.tabla}: SQLite=${fila.sqlite}, Supabase=${fila.supabase}, ` +
          `misma clave=${fila.misma_clave}, solo SQLite=${fila.solo_sqlite}, ` +
          `solo Supabase=${fila.solo_supabase}, filas distintas=${fila.filas_con_diferencias}` +
          (fila.columnas_con_diferencias.length
            ? `, columnas distintas=${fila.columnas_con_diferencias.join(', ')}`
            : ''),
        );
      }
      console.log('\nLa comparación no muestra valores de registros ni modifica los datos.');
    } finally {
      source.close();
      await target.end();
    }
    return;
  }

  const schemaPath = path.join(__dirname, '..', 'supabase', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const target = new Client({ connectionString });

  try {
    await target.connect();
    await target.query('BEGIN');

    const targetTables = await target.query(
      'SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2::text[])',
      ['public', TABLES_IN_IMPORT_ORDER],
    );
    let resumen = null;
    if (targetTables.rows[0].count === TABLES_IN_IMPORT_ORDER.length) {
      resumen = await obtenerComparacion(source, target);
      const conflictos = resumen.filter(fila => fila.solo_sqlite > 0 || fila.filas_con_diferencias > 0);
      if (!conflictos.length) {
        await target.query('COMMIT');
        console.log('Los registros de SQLite ya están presentes en Supabase y coinciden exactamente.');
        const extras = resumen.filter(fila => fila.solo_supabase > 0);
        if (extras.length) {
          console.log(`Se conservaron registros adicionales de Supabase en: ${extras.map(fila => fila.tabla).join(', ')}.`);
        }
        console.log('No se modificó el esquema ni se insertaron o sobrescribieron registros.');
        return;
      }

      if (resumen.some(fila => fila.supabase > 0)) {
        const tableNames = conflictos.map(row => row.tabla).join(', ');
        throw new Error(
          `Supabase contiene registros que faltan en SQLite o difieren de su origen (${tableNames}). ` +
          'No se mezclaron ni sobrescribieron registros; ejecuta --compare para revisar el resumen.',
        );
      }
    }

    await target.query(schema);
    resumen = await obtenerComparacion(source, target);
    const conflictos = resumen.filter(fila => fila.solo_sqlite > 0 || fila.filas_con_diferencias > 0);
    if (!conflictos.length) {
      await target.query('COMMIT');
      console.log('Los registros de SQLite ya están presentes en Supabase y coinciden exactamente.');
      const extras = resumen.filter(fila => fila.solo_supabase > 0);
      if (extras.length) {
        console.log(`Se conservaron registros adicionales de Supabase en: ${extras.map(fila => fila.tabla).join(', ')}.`);
      }
      console.log('No se insertaron ni sobrescribieron registros.');
      return;
    }

    if (resumen.some(fila => fila.supabase > 0)) {
      const tableNames = conflictos.map(row => row.tabla).join(', ');
      throw new Error(
        `Supabase contiene registros que faltan en SQLite o difieren de su origen (${tableNames}). ` +
        'No se mezclaron ni sobrescribieron registros; ejecuta --compare para revisar el resumen.',
      );
    }

    for (const table of TABLES_IN_IMPORT_ORDER) {
      const sourceColumns = source.pragma(`table_info("${table}")`).map(column => column.name);
      const targetColumnsResult = await target.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
        ['public', table],
      );
      const targetColumns = new Set(targetColumnsResult.rows.map(row => row.column_name));
      const missingColumns = sourceColumns.filter(column => !targetColumns.has(column));
      if (missingColumns.length) {
        throw new Error(
          `Faltan columnas en public.${table}: ${missingColumns.join(', ')}. Aplica la versión actual de supabase/schema.sql y vuelve a intentar.`,
        );
      }
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