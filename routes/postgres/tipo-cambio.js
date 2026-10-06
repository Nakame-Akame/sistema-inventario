const express = require('express');
const router = express.Router();
const db = require('../../database-postgres');
const { requierePermiso } = require('../../middleware/permisos');

const API_SUNAT = 'https://api.apis.net.pe/v1/tipo-cambio-sunat';

async function obtenerCambioActual(forzar = false) {
  const fecha = new Date().toISOString().slice(0, 10);
  const guardadoResult = await db.query('SELECT * FROM tipo_cambio_diario WHERE fecha = $1', [fecha]);
  const guardado = guardadoResult.rows[0];
  if (guardado && !forzar) return { ...guardado, cacheado: true };

  const respuesta = await fetch(API_SUNAT, { signal: AbortSignal.timeout(5000) });
  if (!respuesta.ok) throw new Error(`SUNAT respondió ${respuesta.status}`);
  const datos = await respuesta.json();
  const compra = Number(datos.compra);
  const venta = Number(datos.venta);
  if (!Number.isFinite(compra) || !Number.isFinite(venta) || compra <= 0 || venta <= 0) {
    throw new Error('Respuesta de tipo de cambio inválida');
  }
  await db.query(`
    INSERT INTO tipo_cambio_diario (fecha, compra, venta, fuente)
    VALUES ($1, $2, $3, 'SUNAT')
    ON CONFLICT (fecha) DO UPDATE SET
      compra = EXCLUDED.compra,
      venta = EXCLUDED.venta,
      fuente = EXCLUDED.fuente,
      actualizado_at = CURRENT_TIMESTAMP
  `, [fecha, compra, venta]);
  return { fecha, compra, venta, fuente: 'SUNAT', cacheado: false };
}

router.get('/', requierePermiso('compras:ver'), async (req, res) => {
  try {
    res.json({ ok: true, data: await obtenerCambioActual(req.query.actualizar === '1') });
  } catch {
    const ultimoResult = await db.query('SELECT * FROM tipo_cambio_diario ORDER BY fecha DESC LIMIT 1');
    const ultimo = ultimoResult.rows[0];
    if (ultimo) return res.json({ ok: true, data: { ...ultimo, vencido: true } });
    res.status(503).json({ ok: false, error: 'No se pudo obtener el tipo de cambio actual' });
  }
});

module.exports = router;