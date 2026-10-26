const express = require('express');
const router  = express.Router();
const db      = require('../../database-postgres');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium').default;
const { requierePermiso } = require('../../middleware/permisos');

function escaparHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function chromeLocal() {
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const candidates = [
    process.env.CHROME_EXECUTABLE_PATH,
    programFilesX86 && path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate));
}

async function generarPdf(html, formato) {
  let browser;
  if (process.platform === 'win32' || process.env.CHROME_EXECUTABLE_PATH) {
    const executablePath = chromeLocal();
    if (!executablePath) {
      throw new Error('Chrome no encontrado. Configura CHROME_EXECUTABLE_PATH.');
    }
    browser = await puppeteer.launch({ executablePath, headless: true });
  } else {
    browser = await puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: 'shell',
    });
  }

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    if (formato === 'a4') {
      return await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
      });
    }

    const ancho = formato === '58mm' ? '58mm' : '80mm';
    const alturaContenidoPx = await page.evaluate(() => Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    ));
    const alturaMm = Math.max(70, Math.ceil(alturaContenidoPx * 25.4 / 96) + 6);
    return await page.pdf({
      width: ancho,
      height: `${alturaMm}mm`,
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: '3mm', bottom: '3mm', left: '3mm', right: '3mm' },
    });
  } finally {
    await browser.close();
  }
}

const TIPOS_LABEL = {
  factura:         'Factura Electrónica',
  boleta:          'Boleta Electrónica',
  nota_pedido:     'Nota de Pedido',
  guia_remision:   'Guía de Remisión Electrónica',
  cotizacion:      'Cotización',
  nota_devolucion: 'Nota de Devolución',
  nota_credito_f:  'Nota de Crédito (Factura)',
  nota_credito_b:  'Nota de Crédito (Boleta)',
};

const CONDICION_LABEL = {
  no_afecta: 'No afecta',
  contado:   'Contado',
  credito:   'Crédito',
};

router.get('/:id', requierePermiso('comprobantes:ver'), async (req, res) => {
  try {
    const resultadoComprobante = await db.query(`
      SELECT c.*, cl.nombre as cliente_nombre, cl.documento as cliente_documento,
             cl.tipo_documento, cl.direccion as cliente_direccion,
             cl.email as cliente_email, cl.telefono as cliente_telefono,
             cr.serie as ref_serie, cr.numero as ref_numero, cr.tipo as ref_tipo
      FROM comprobantes c
      JOIN clientes cl ON c.cliente_id = cl.id
      LEFT JOIN comprobantes cr ON c.comprobante_ref_id = cr.id
      WHERE c.id = $1
    `, [req.params.id]);
    const filaComprobante = resultadoComprobante.rows[0];

    if (!filaComprobante) return res.status(404).json({ ok: false, error: 'Comprobante no encontrado' });
    const comp = {
      ...filaComprobante,
      subtotal: Number(filaComprobante.subtotal || 0),
      descuento: Number(filaComprobante.descuento || 0),
      igv: Number(filaComprobante.igv || 0),
      total: Number(filaComprobante.total || 0),
    };

    const resultadoDetalle = await db.query(`
      SELECT d.*, p.nombre as producto_nombre
      FROM detalle_comprobante d
      LEFT JOIN productos p ON d.producto_id = p.id
      WHERE d.comprobante_id = $1
    `, [req.params.id]);
    const detalle = resultadoDetalle.rows.map(item => ({
      ...item,
      cantidad: Number(item.cantidad),
      precio_unitario: Number(item.precio_unitario),
      descuento_item: Number(item.descuento_item || 0),
      subtotal: Number(item.subtotal || 0),
    }));

    const num    = `${comp.serie}-${String(comp.numero).padStart(6, '0')}`;
    const formato = ['a4', '80mm', '58mm'].includes(req.query.formato)
      ? req.query.formato
      : 'a4';
    const termica = formato !== 'a4';
    const termica58 = formato === '58mm';
    const numHtml = escaparHtml(num);
    const label  = escaparHtml(TIPOS_LABEL[comp.tipo] || comp.tipo);
    const fecha  = new Date(comp.fecha).toLocaleDateString('es-PE', { year:'numeric', month:'long', day:'numeric' });
    const aplicaIgv = comp.igv && comp.igv > 0;

    // Estado
    const estadoColor = { emitido:'#2563eb', pagado:'#1a9974', anulado:'#d63660', borrador:'#a87c00', pendiente:'#a87c00', atendido:'#1a9974', aprobado:'#1a9974', rechazado:'#d63660' };
    const estadoBg    = { emitido:'#e8f0ff', pagado:'#e6f9f4', anulado:'#fde8ee', borrador:'#fff7e0', pendiente:'#fff7e0', atendido:'#e6f9f4', aprobado:'#e6f9f4', rechazado:'#fde8ee' };
    const ec = { fg: estadoColor[comp.estado] || '#2563eb', bg: estadoBg[comp.estado] || '#e8f0ff' };

    // Bloque condición de pago
    const condicionHtml = `
      <div style="margin-bottom:12px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#888;font-weight:700;margin-bottom:4px;">Condición de pago</div>
        <div style="font-weight:600;">${escaparHtml(CONDICION_LABEL[comp.condicion_pago] || comp.condicion_pago)}</div>
        ${comp.condicion_pago === 'credito' && comp.fecha_vencimiento
          ? `<div style="color:#555;font-size:12px;">Vence: ${new Date(comp.fecha_vencimiento).toLocaleDateString('es-PE')}</div>`
          : ''}
      </div>`;

    // Bloque referencia (notas de crédito / devolución)
    let referenciaHtml = '';
    if (comp.comprobante_ref_id && comp.ref_tipo) {
      const refLabel = escaparHtml(TIPOS_LABEL[comp.ref_tipo] || comp.ref_tipo);
      const refNum   = escaparHtml(`${comp.ref_serie}-${String(comp.ref_numero).padStart(6,'0')}`);
      referenciaHtml = `
        <div style="background:#f8f9ff;border:1px solid #e0e8ff;border-radius:8px;padding:12px;margin-bottom:14px;">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#888;font-weight:700;margin-bottom:4px;">Comprobante referenciado</div>
          <div style="font-weight:600;">${refLabel} ${refNum}</div>
          ${comp.motivo_ref ? `<div style="color:#555;font-size:12px;margin-top:2px;">Motivo: ${escaparHtml(comp.motivo_ref)}</div>` : ''}
        </div>`;
    }

    // Bloque guía de remisión
    let guiaHtml = '';
    if (comp.tipo === 'guia_remision') {
      guiaHtml = `
        <div style="background:#f8f9ff;border:1px solid #e0e8ff;border-radius:8px;padding:12px;margin-bottom:14px;">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#888;font-weight:700;margin-bottom:6px;">Datos del traslado</div>
          <div style="line-height:1.8;color:#333;">
            ${comp.direccion_partida ? `<strong>Partida:</strong> ${escaparHtml(comp.direccion_partida)}<br>` : ''}
            ${comp.direccion_llegada ? `<strong>Llegada:</strong> ${escaparHtml(comp.direccion_llegada)}<br>` : ''}
            ${comp.transportista     ? `<strong>Transportista:</strong> ${escaparHtml(comp.transportista)}<br>` : ''}
            ${comp.fecha_traslado    ? `<strong>Fecha:</strong> ${new Date(comp.fecha_traslado).toLocaleDateString('es-PE')}` : ''}
          </div>
        </div>`;
    }

    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <style>
        * { box-sizing:border-box; margin:0; padding:0; }
        @page { margin: 0; }
        body { font-family: Arial, sans-serif; font-size:13px; color:#111; padding:40px; }
        .header { display:flex; justify-content:space-between; margin-bottom:24px; padding-bottom:16px; border-bottom:3px solid #1a1a2e; }
        .logo { font-size:22px; font-weight:900; color:#1a1a2e; }
        .logo .tipo { display:block; font-size:12px; color:#4f8ef7; font-weight:700; margin-top:4px; letter-spacing:0.3px; }
        .logo small { display:block; font-size:10px; color:#888; font-weight:400; margin-top:2px; }
        .num { text-align:right; }
        .num .serie { font-size:18px; font-weight:700; color:#4f8ef7; font-family:monospace; }
        .num .fecha { font-size:11px; color:#666; margin-top:4px; }
        .estado { display:inline-block; margin-top:8px; padding:3px 12px; border-radius:20px; font-size:11px; font-weight:700; }
        .cliente-bloque { margin-bottom:16px; }
        .label-sec { font-size:10px; text-transform:uppercase; letter-spacing:0.8px; color:#888; font-weight:700; margin-bottom:4px; }
        .cliente-nombre { font-size:15px; font-weight:700; }
        .cliente-info { color:#555; line-height:1.7; font-size:12px; }
        table { width:100%; border-collapse:collapse; margin:16px 0; }
        thead { background:#1a1a2e; color:#fff; }
        th { padding:9px 12px; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.4px; }
        td { padding:9px 12px; border-bottom:1px solid #eee; font-size:12px; }
        tr:last-child td { border-bottom:none; }
        tr:nth-child(even) td { background:#f8f9ff; }
        .totales { margin-left:auto; width:260px; margin-top:8px; }
        .tot-row { display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid #eee; }
        .tot-row.final { font-size:16px; font-weight:900; color:#1a1a2e; border-bottom:none; border-top:3px solid #1a1a2e; margin-top:4px; padding-top:8px; }
        .footer { margin-top:32px; padding-top:14px; border-top:1px solid #eee; text-align:center; font-size:11px; color:#aaa; }
        thead { display: table-header-group; }
        tfoot { display: table-footer-group; }
        tr, img, .cliente-bloque, .totales, .footer { break-inside: avoid; page-break-inside: avoid; }
        h1, h2, h3 { break-after: avoid; page-break-after: avoid; }
        ${termica ? `
        body { width:${termica58 ? '52mm' : '74mm'}; padding:2mm; font-size:${termica58 ? '8px' : '9px'}; }
        .header { display:block; margin-bottom:10px; padding-bottom:8px; border-bottom:1px dashed #222; }
        .logo { font-size:${termica58 ? '12px' : '15px'}; text-align:center; }
        .logo .tipo { font-size:${termica58 ? '8px' : '10px'}; }
        .logo small { font-size:7px; }
        .num { margin-top:7px; text-align:center; }
        .num .serie { font-size:13px; }
        .num .fecha { font-size:9px; }
        .estado { display:none; }
        .cliente-bloque { margin-bottom:9px; }
        .cliente-nombre { font-size:${termica58 ? '9px' : '11px'}; overflow-wrap:anywhere; }
        .cliente-info { font-size:${termica58 ? '8px' : '9px'}; line-height:1.4; overflow-wrap:anywhere; }
        table { margin:8px 0; }
        th { padding:5px 2px; font-size:${termica58 ? '7px' : '8px'}; }
        td { padding:5px 2px; font-size:${termica58 ? '8px' : '9px'}; overflow-wrap:anywhere; }
        .totales { width:100%; margin-top:8px; }
        .tot-row { padding:3px 0; }
        .tot-row.final { font-size:12px; border-top:1px dashed #222; }
        .footer { margin-top:16px; padding-top:8px; font-size:8px; }
        ` : ''}
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div class="logo">
            ⚡ FacturaPro
            <span class="tipo">${label}</span>
            <small>Sistema de Facturación</small>
          </div>
        </div>
        <div class="num">
          <div class="serie">${numHtml}</div>
          <div class="fecha">${fecha}</div>
          <span class="estado" style="background:${ec.bg};color:${ec.fg};">${escaparHtml(comp.estado.toUpperCase())}</span>
        </div>
      </div>

      <div class="cliente-bloque">
        <div class="label-sec">Cliente</div>
        <div class="cliente-nombre">${escaparHtml(comp.cliente_nombre)}</div>
        <div class="cliente-info">
          ${comp.cliente_documento ? `${escaparHtml(comp.tipo_documento || 'Doc')}: ${escaparHtml(comp.cliente_documento)}<br>` : ''}
          ${comp.cliente_direccion ? `${escaparHtml(comp.cliente_direccion)}<br>` : ''}
          ${comp.cliente_email     ? `${escaparHtml(comp.cliente_email)}<br>` : ''}
          ${comp.cliente_telefono  ? `Tel: ${escaparHtml(comp.cliente_telefono)}` : ''}
        </div>
      </div>

      ${condicionHtml}
      ${referenciaHtml}
      ${guiaHtml}

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Descripción</th>
            <th>Cant.</th>
            <th style="text-align:right">P. Unit.</th>
            <th style="text-align:right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${detalle.map((d, i) => `
            <tr>
              <td style="color:#888">${i + 1}</td>
              <td><strong>${escaparHtml(d.producto_nombre || d.descripcion_libre || '—')}</strong></td>
              <td>${d.cantidad} ${d.unidad && d.unidad !== 'UND' ? escaparHtml(d.unidad) : ''}</td>
              <td style="text-align:right">S/ ${d.precio_unitario.toFixed(2)}</td>
              <td style="text-align:right"><strong>S/ ${(comp.precios_incluyen_igv ? (d.precio_unitario * d.cantidad - d.descuento_item) : d.subtotal).toFixed(2)}</strong></td>
            </tr>`).join('')}
        </tbody>
      </table>

      <div class="totales">
        <div class="tot-row"><span style="color:#666">Subtotal</span><span>S/ ${comp.subtotal.toFixed(2)}</span></div>
        ${comp.descuento > 0 ? `<div class="tot-row"><span style="color:#666">Descuento</span><span>- S/ ${comp.descuento.toFixed(2)}</span></div>` : ''}
        ${aplicaIgv ? `<div class="tot-row"><span style="color:#666">IGV (18%)</span><span>S/ ${comp.igv.toFixed(2)}</span></div>` : ''}
        <div class="tot-row final"><span>TOTAL</span><span>S/ ${comp.total.toFixed(2)}</span></div>
      </div>

      <div class="footer">
        Documento generado por FacturaPro &nbsp;|&nbsp; ${fecha} &nbsp;|&nbsp; Gracias por su preferencia
      </div>
    </body>
    </html>`;

    const pdfBuffer = await generarPdf(html, formato);

    res.setHeader('Content-Type', 'application/pdf');
    const filename = `${num}${termica ? `-ticket-${formato}` : ''}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    res.send(pdfBuffer);

  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

module.exports = router;