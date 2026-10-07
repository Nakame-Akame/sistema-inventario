const TIPOS = {
  factura:         { label: 'Factura Electrónica',      afecta_igv: true,  mueve_stock: true  },
  boleta:          { label: 'Boleta Electrónica',       afecta_igv: true,  mueve_stock: true  },
  nota_pedido:     { label: 'Nota de Pedido',           afecta_igv: false, mueve_stock: false },
  guia_remision:   { label: 'Guía de Remisión',         afecta_igv: false, mueve_stock: false },
  cotizacion:      { label: 'Cotización',               afecta_igv: false, mueve_stock: false },
  nota_devolucion: { label: 'Nota de Devolución',       afecta_igv: true,  mueve_stock: true  },
  nota_credito_f:  { label: 'Nota de Crédito (Factura)', afecta_igv: true, mueve_stock: false },
  nota_credito_b:  { label: 'Nota de Crédito (Boleta)',   afecta_igv: true, mueve_stock: false },
};

/** @type {Record<TipoComprobante, Record<string, string[]>>} */
const TRANSICIONES = {
  factura: { emitido: ['pagado', 'anulado'], parcial: ['pagado'], pagado: ['anulado'] },
  boleta: { emitido: ['pagado', 'anulado'], parcial: ['pagado'], pagado: ['anulado'] },
  nota_pedido: { pendiente: ['atendido', 'anulado'], atendido: ['anulado'] },
  guia_remision: { emitido: ['anulado'] },
  cotizacion: { borrador: ['enviado', 'aprobado', 'rechazado'], enviado: ['aprobado', 'rechazado'] },
  nota_devolucion: { emitido: ['anulado'] },
  nota_credito_f: { emitido: ['anulado'] },
  nota_credito_b: { emitido: ['anulado'] },
};

/**
 * @typedef {keyof typeof TIPOS} TipoComprobante
 * @typedef {'no_afecta' | 'contado' | 'credito'} CondicionPago
 * @typedef {import('better-sqlite3').Database} Database
 * @typedef {{ productoId: number | null, cantidad: number, cantidadEscalada: number, descuentoItemCentimos: number, descripcion: string | null, unidad: string, tipoPrecio: TipoPrecio }} ItemSolicitud
 * @typedef {'unidad' | 'rebaja' | 'pase'} TipoPrecio
 * @typedef {{ tipo: TipoComprobante, clienteId: number, items: ItemSolicitud[], condicionPago: CondicionPago, fechaVencimiento: string | null, comprobanteReferenciaId: number | null, motivoReferencia: string | null, direccionPartida: string | null, direccionLlegada: string | null, transportista: string | null, fechaTraslado: string | null, descuentoCentimos: number }} SolicitudComprobante
 * @typedef {{ productoId: number | null, descripcion: string | null, cantidad: number, cantidadEscalada: number, unidad: string, tipoPrecio: TipoPrecio, precioCentimos: number, descuentoItemCentimos: number, subtotalCentimos: number, stock?: number }} DetalleComprobante
 * @typedef {{ detalles: DetalleComprobante[], subtotalCentimos: number, totalBrutoCentimos: number }} PreparacionItems
 * @typedef {{ cantidadEscalada: number, subtotalCentimos: number, descripcion: string | null, unidad: string | null }} DetalleOriginal
 * @typedef {{ id: number, tipo: string, estado: string, cliente_id: number, afecta_igv: number, descuento: number, igv: number, subtotal: number }} DatosComprobanteReferencia
 * @typedef {{ comprobante: DatosComprobanteReferencia, detallesPorProducto: Map<number, DetalleOriginal>, cantidadesAjustadas: Map<number, number>, subtotalesAjustadosCentimos: Map<number, number>, descuentoAjustadoCentimos: number, igvAjustadoCentimos: number, subtotalLineasCentimos: number }} ReferenciaComprobante
 * @typedef {{ id: number, nombre: string, precio?: number, precio_rebaja?: number, precio_pase?: number, precio_compra?: number, stock: number, unidad: string }} ProductoFila
 * @typedef {{ id: number, serie: string, ultimo_numero: number }} SerieFila
 * @typedef {{ producto_id: number | null, cantidad: number }} MovimientoStockFila
 */

const TIPOS_AJUSTE = ['nota_devolucion', 'nota_credito_f', 'nota_credito_b'];
const MAX_ITEMS = 100;
const MAX_CANTIDAD = 1000000;
const MAX_IMPORTE = 1000000000;
const ESCALA_CANTIDAD = 1000000;

class ErrorValidacion extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** @param {unknown} value @param {string} label */
function aCentimos(value, label) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim().length > 64 || String(value).trim() === '') {
    throw new ErrorValidacion(`${label} debe ser un importe válido y no negativo`);
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_IMPORTE) {
    throw new ErrorValidacion(`${label} debe ser un importe válido y no negativo`);
  }
  if (amount < 0.005) return 0;

  const decimal = String(value).trim().toLowerCase();
  const match = /^((?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e([+-]?\d+))?$/.exec(decimal);
  if (!match) throw new ErrorValidacion(`${label} debe ser un importe válido y no negativo`);

  const [integerPart = '0', fractionalPart = ''] = match[1].split('.');
  const digits = `${integerPart}${fractionalPart}`.replace(/^0+(?=\d)/, '') || '0';
  const decimalPlaces = fractionalPart.length - Number(match[2] || 0);
  const amountDigits = BigInt(digits);
  if (decimalPlaces <= 2) {
    return Number(amountDigits * (10n ** BigInt(2 - decimalPlaces)));
  }
  const divisor = 10n ** BigInt(decimalPlaces - 2);
  return Number((amountDigits + divisor / 2n) / divisor);
}

/** @param {number} amount */
function desdeCentimos(amount) {
  return Number((amount / 100).toFixed(2));
}

/** @param {unknown} value @param {string} label */
function normalizarCantidad(value, label) {
  const quantity = Number(value);
  const scaled = Math.round(quantity * ESCALA_CANTIDAD);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_CANTIDAD ||
      !Number.isSafeInteger(scaled) || scaled <= 0 ||
      Math.abs(quantity * ESCALA_CANTIDAD - scaled) > 1e-5) {
    throw new ErrorValidacion(`${label} debe ser positiva y tener hasta 6 decimales`);
  }
  return { cantidad: scaled / ESCALA_CANTIDAD, cantidadEscalada: scaled };
}

/** @param {unknown} value @param {string} label */
function unidadesCantidad(value, label) {
  const scaled = Math.round(Number(value) * ESCALA_CANTIDAD);
  if (!Number.isSafeInteger(scaled) || scaled < 0 ||
      Math.abs(Number(value) * ESCALA_CANTIDAD - scaled) > 1e-5) {
    throw new ErrorValidacion(`${label} tiene una precisión no compatible`);
  }
  return scaled;
}

/** @param {number} unitCents @param {number} quantityScaled */
function importePorCantidad(unitCents, quantityScaled) {
  const cents = (BigInt(unitCents) * BigInt(quantityScaled) + BigInt(ESCALA_CANTIDAD / 2)) /
    BigInt(ESCALA_CANTIDAD);
  return validarCentimos(Number(cents), 'El subtotal del ítem');
}

/** @param {number} totalCents @param {number} part @param {number} whole */
function prorratearCentimos(totalCents, part, whole) {
  if (whole <= 0) return 0;
  const numerator = BigInt(totalCents) * BigInt(part);
  const denominator = BigInt(whole);
  return Number((numerator + denominator / 2n) / denominator);
}

/** @param {number} amount @param {string} label */
function validarCentimos(amount, label) {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_IMPORTE * 100) {
    throw new ErrorValidacion(`${label} supera el importe permitido`);
  }
  return amount;
}

/** @param {unknown} value @param {string} label */
function validarFecha(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ErrorValidacion(`${label} debe tener formato AAAA-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ErrorValidacion(`${label} no es una fecha válida`);
  }
  return value;
}

/** @param {unknown} value @param {string} label @param {boolean} [required] */
function textoOpcional(value, label, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ErrorValidacion(`${label} es obligatorio`);
    return null;
  }
  if (typeof value !== 'string' || value.trim().length > 500) {
    throw new ErrorValidacion(`${label} debe ser texto de hasta 500 caracteres`);
  }
  const text = value.trim();
  if (required && !text) throw new ErrorValidacion(`${label} es obligatorio`);
  return text || null;
}

/** @param {unknown} payload @returns {SolicitudComprobante} */
function validarSolicitud(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ErrorValidacion('El contenido del comprobante no es válido');
  }

  const request = /** @type {Record<string, unknown>} */ (payload);
  const rawTipo = request.tipo;
  if (typeof rawTipo !== 'string' || !Object.hasOwn(TIPOS, rawTipo)) {
    throw new ErrorValidacion('Tipo de comprobante inválido');
  }
  const tipo = /** @type {TipoComprobante} */ (rawTipo);

  const clienteId = Number(request.cliente_id);
  if (!Number.isInteger(clienteId) || clienteId <= 0) {
    throw new ErrorValidacion('Cliente requerido');
  }

  if (!Array.isArray(request.items) || request.items.length === 0 || request.items.length > MAX_ITEMS) {
    throw new ErrorValidacion(`Agrega entre 1 y ${MAX_ITEMS} ítems`);
  }

  const rawCondicionPago = request.condicion_pago ?? 'contado';
  if (typeof rawCondicionPago !== 'string' || !['no_afecta', 'contado', 'credito'].includes(rawCondicionPago)) {
    throw new ErrorValidacion('Condición de pago inválida');
  }
  const condicionPago = /** @type {CondicionPago} */ (rawCondicionPago);

  let fechaVencimiento = null;
  if (condicionPago === 'credito') {
    fechaVencimiento = validarFecha(request.fecha_vencimiento, 'La fecha de vencimiento');
    if (fechaVencimiento < new Date().toISOString().slice(0, 10)) {
      throw new ErrorValidacion('La fecha de vencimiento no puede estar en el pasado');
    }
  }

  const fechaTraslado = request.fecha_traslado
    ? validarFecha(request.fecha_traslado, 'La fecha de traslado')
    : null;

  const necesitaReferencia = TIPOS_AJUSTE.includes(tipo);
  const comprobanteReferenciaId = request.comprobante_ref_id == null || request.comprobante_ref_id === ''
    ? null
    : Number(request.comprobante_ref_id);
  if (necesitaReferencia && (!Number.isInteger(comprobanteReferenciaId) || comprobanteReferenciaId <= 0)) {
    throw new ErrorValidacion('Este comprobante requiere una referencia válida');
  }
  if (comprobanteReferenciaId !== null && (!Number.isInteger(comprobanteReferenciaId) || comprobanteReferenciaId <= 0)) {
    throw new ErrorValidacion('La referencia del comprobante no es válida');
  }

  const motivoReferencia = textoOpcional(request.motivo_ref, 'El motivo', necesitaReferencia);
  const descuentoCentimos = necesitaReferencia ? 0 : aCentimos(request.descuento ?? 0, 'El descuento');
  const items = request.items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ErrorValidacion(`El ítem ${index + 1} no es válido`);
    }
    const requestItem = /** @type {Record<string, unknown>} */ (item);
    const { cantidad, cantidadEscalada } = normalizarCantidad(requestItem.cantidad, `La cantidad del ítem ${index + 1}`);

    const productoId = requestItem.producto_id == null || requestItem.producto_id === ''
      ? null
      : Number(requestItem.producto_id);
    if (productoId !== null && (!Number.isInteger(productoId) || productoId <= 0)) {
      throw new ErrorValidacion(`El producto del ítem ${index + 1} no es válido`);
    }
    if (!productoId && tipo !== 'guia_remision') {
      throw new ErrorValidacion(`El ítem ${index + 1} debe seleccionar un producto`);
    }

    const descuentoItemCentimos = necesitaReferencia ? 0 : aCentimos(requestItem.descuento_item ?? 0, 'El descuento por ítem');
    const descripcion = textoOpcional(requestItem.descripcion_libre, 'La descripción del ítem', !productoId);
    const unidad = textoOpcional(requestItem.unidad, 'La unidad') || 'UND';
    const tipoPrecioRaw = requestItem.tipo_precio ?? 'unidad';
    if (typeof tipoPrecioRaw !== 'string' || !['unidad', 'rebaja', 'pase'].includes(tipoPrecioRaw)) {
      throw new ErrorValidacion(`El tipo de precio del ítem ${index + 1} no es válido`);
    }
    const tipoPrecio = /** @type {TipoPrecio} */ (tipoPrecioRaw);

    return { productoId, cantidad, cantidadEscalada, descuentoItemCentimos, descripcion, unidad, tipoPrecio };
  });

  return {
    tipo,
    clienteId,
    items,
    condicionPago,
    fechaVencimiento,
    comprobanteReferenciaId,
    motivoReferencia,
    direccionPartida: textoOpcional(request.direccion_partida, 'La dirección de partida'),
    direccionLlegada: textoOpcional(request.direccion_llegada, 'La dirección de llegada'),
    transportista: textoOpcional(request.transportista, 'El transportista'),
    fechaTraslado,
    descuentoCentimos,
  };
}

/** @param {Database} db @param {SolicitudComprobante} solicitud @param {ReferenciaComprobante | null} referencia @returns {PreparacionItems} */
function prepararItemsNormales(db, solicitud, referencia) {
  if (referencia) {
    const cantidadesSolicitadas = new Map();
    for (const item of solicitud.items) {
      cantidadesSolicitadas.set(
        item.productoId,
        (cantidadesSolicitadas.get(item.productoId) || 0) + item.cantidadEscalada
      );
    }

    const detallesAjuste = [];
    let subtotalAjusteCentimos = 0;
    for (const [productoId, cantidad] of cantidadesSolicitadas) {
      const producto = /** @type {ProductoFila | undefined} */ (db.prepare('SELECT id, nombre, stock, unidad FROM productos WHERE id = ?')
        .get(productoId));
      if (!producto) throw new ErrorValidacion(`Producto ${productoId} no encontrado`, 404);
      const original = referencia.detallesPorProducto.get(productoId);
      if (!original) throw new ErrorValidacion(`El producto ${producto.nombre} no pertenece al comprobante referenciado`);

      const cantidadAjustada = referencia.cantidadesAjustadas.get(productoId) || 0;
      const subtotalAjustadoCentimos = referencia.subtotalesAjustadosCentimos.get(productoId) || 0;
      const cantidadRestante = original.cantidadEscalada - cantidadAjustada;
      const subtotalRestanteCentimos = original.subtotalCentimos - subtotalAjustadoCentimos;
      const subtotalItemCentimos = cantidad >= cantidadRestante
        ? subtotalRestanteCentimos
        : Math.min(subtotalRestanteCentimos, prorratearCentimos(
          original.subtotalCentimos,
          cantidad,
          original.cantidadEscalada
        ));
      validarCentimos(subtotalItemCentimos, 'El subtotal de la devolución');
      const cantidadNormalizada = cantidad / ESCALA_CANTIDAD;

      detallesAjuste.push({
        productoId,
        descripcion: original.descripcion || producto.nombre,
        cantidad: cantidadNormalizada,
        unidad: original.unidad || producto.unidad,
        tipoPrecio: /** @type {TipoPrecio} */ ('unidad'),
        precioCentimos: cantidad > 0
          ? prorratearCentimos(subtotalItemCentimos, ESCALA_CANTIDAD, cantidad)
          : 0,
        descuentoItemCentimos: 0,
        subtotalCentimos: subtotalItemCentimos,
        cantidadEscalada: cantidad,
        stock: producto.stock,
      });
      subtotalAjusteCentimos = validarCentimos(
        subtotalAjusteCentimos + subtotalItemCentimos,
        'El subtotal de la devolución'
      );
    }
    return { detalles: detallesAjuste, subtotalCentimos: subtotalAjusteCentimos, totalBrutoCentimos: subtotalAjusteCentimos };
  }

  let subtotalCentimos = 0;
  let totalBrutoCentimos = 0;
  /** @type {DetalleComprobante[]} */
  const detalles = solicitud.items.map(item => {
    if (!item.productoId) {
      return {
        productoId: /** @type {number | null} */ (null),
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        cantidadEscalada: item.cantidadEscalada,
        unidad: item.unidad,
        tipoPrecio: item.tipoPrecio,
        precioCentimos: 0,
        descuentoItemCentimos: 0,
        subtotalCentimos: 0,
      };
    }

    const producto = /** @type {ProductoFila | undefined} */ (db.prepare('SELECT id, nombre, precio, precio_rebaja, precio_pase, precio_compra, stock, unidad FROM productos WHERE id = ?')
      .get(item.productoId));
    if (!producto) throw new ErrorValidacion(`Producto ${item.productoId} no encontrado`, 404);

    let precioCentimos;
    let descripcion;
    let descuentoItemCentimos;
    let unidad = producto.unidad;
    const precios = { unidad: producto.precio, rebaja: producto.precio_rebaja, pase: producto.precio_pase };
    precioCentimos = aCentimos(precios[item.tipoPrecio], `El precio ${item.tipoPrecio} del producto ${producto.nombre}`);
    descuentoItemCentimos = item.descuentoItemCentimos;
    if (descuentoItemCentimos > precioCentimos) {
      throw new ErrorValidacion(`El descuento supera el precio del producto ${producto.nombre}`);
    }
    descripcion = producto.nombre;

    const precioNetoCentimos = precioCentimos - descuentoItemCentimos;
    const subtotalItemCentimos = importePorCantidad(Math.round(precioNetoCentimos * 100 / 118), item.cantidadEscalada);
    totalBrutoCentimos = validarCentimos(
      totalBrutoCentimos + importePorCantidad(precioNetoCentimos, item.cantidadEscalada),
      'El total de los ítems'
    );
    subtotalCentimos = validarCentimos(subtotalCentimos + subtotalItemCentimos, 'El subtotal');

    return {
      productoId: producto.id,
      descripcion,
      cantidad: item.cantidad,
      cantidadEscalada: item.cantidadEscalada,
      unidad,
      tipoPrecio: item.tipoPrecio,
      precioCentimos,
      descuentoItemCentimos,
      subtotalCentimos: subtotalItemCentimos,
      stock: producto.stock,
    };
  });

  return { detalles, subtotalCentimos, totalBrutoCentimos };
}

/** @param {Database} db @param {SolicitudComprobante} solicitud @returns {ReferenciaComprobante | null} */
function prepararReferencia(db, solicitud) {
  if (!TIPOS_AJUSTE.includes(solicitud.tipo)) return null;

  const comprobante = /** @type {DatosComprobanteReferencia} */ (db.prepare('SELECT * FROM comprobantes WHERE id = ?')
    .get(solicitud.comprobanteReferenciaId));
  if (!comprobante) throw new ErrorValidacion('Comprobante referenciado no encontrado', 404);
  if (comprobante.estado === 'anulado') throw new ErrorValidacion('No se puede ajustar un comprobante anulado');
  if (comprobante.cliente_id !== solicitud.clienteId) {
    throw new ErrorValidacion('El cliente debe coincidir con el comprobante referenciado');
  }

  const tipoEsperado = solicitud.tipo === 'nota_credito_f'
    ? 'factura'
    : solicitud.tipo === 'nota_credito_b'
      ? 'boleta'
      : null;
  if (tipoEsperado && comprobante.tipo !== tipoEsperado) {
    throw new ErrorValidacion('El tipo no coincide con el comprobante referenciado');
  }
  if (!tipoEsperado && !['factura', 'boleta'].includes(comprobante.tipo)) {
    throw new ErrorValidacion('Solo se pueden devolver productos de una factura o boleta');
  }

  /** @type {{ producto_id: number, cantidad: number, subtotal: number, descripcion: string | null, unidad: string | null }[]} */
  const originales = /** @type {{ producto_id: number, cantidad: number, subtotal: number, descripcion: string | null, unidad: string | null }[]} */ (/** @type {unknown} */ (db.prepare(`
    SELECT producto_id, SUM(cantidad) AS cantidad, SUM(subtotal) AS subtotal,
           MAX(descripcion_libre) AS descripcion, MAX(unidad) AS unidad
    FROM detalle_comprobante
    WHERE comprobante_id = ? AND producto_id IS NOT NULL
    GROUP BY producto_id
  `).all(comprobante.id)));
  const detallesPorProducto = new Map(originales.map(item => [item.producto_id, {
    cantidad: Number(item.cantidad),
    cantidadEscalada: unidadesCantidad(item.cantidad, 'La cantidad original'),
    subtotalCentimos: aCentimos(item.subtotal, 'El subtotal original'),
    descripcion: item.descripcion,
    unidad: item.unidad,
  }]));

  /** @type {{ producto_id: number, cantidad: number, subtotal: number, descuento: number, igv: number }[]} */
  const ajustesAnteriores = /** @type {{ producto_id: number, cantidad: number, subtotal: number, descuento: number, igv: number }[]} */ (/** @type {unknown} */ (db.prepare(`
    SELECT d.producto_id, SUM(d.cantidad) AS cantidad, SUM(d.subtotal) AS subtotal,
           SUM(c.descuento) AS descuento, SUM(c.igv) AS igv
    FROM comprobantes c
    JOIN detalle_comprobante d ON d.comprobante_id = c.id
    WHERE c.comprobante_ref_id = ?
      AND c.tipo IN ('nota_devolucion', 'nota_credito_f', 'nota_credito_b')
      AND c.estado != 'anulado'
    GROUP BY d.producto_id
  `).all(comprobante.id)));
  const cantidadesAjustadas = new Map(ajustesAnteriores.map(item => [
    item.producto_id,
    unidadesCantidad(item.cantidad, 'La cantidad ya ajustada'),
  ]));
  const subtotalesAjustadosCentimos = new Map(ajustesAnteriores.map(item => [
    item.producto_id,
    aCentimos(item.subtotal, 'El subtotal ya ajustado'),
  ]));
  const resumenAjustes = /** @type {{ descuento: number, igv: number }} */ (/** @type {unknown} */ (db.prepare(`
    SELECT COALESCE(SUM(descuento), 0) AS descuento, COALESCE(SUM(igv), 0) AS igv
    FROM comprobantes
    WHERE comprobante_ref_id = ?
      AND tipo IN ('nota_devolucion', 'nota_credito_f', 'nota_credito_b')
      AND estado != 'anulado'
  `).get(comprobante.id)));

  return {
    comprobante,
    detallesPorProducto,
    cantidadesAjustadas,
    subtotalesAjustadosCentimos,
    descuentoAjustadoCentimos: aCentimos(resumenAjustes.descuento, 'El descuento ajustado'),
    igvAjustadoCentimos: aCentimos(resumenAjustes.igv, 'El IGV ajustado'),
    subtotalLineasCentimos: [...detallesPorProducto.values()]
      .reduce((sum, item) => sum + item.subtotalCentimos, 0),
  };
}

/** @param {SolicitudComprobante} solicitud @param {ReferenciaComprobante} referencia @param {DetalleComprobante[]} detalles @param {number} subtotalLineasCentimos */
function aplicarLimitesAjuste(solicitud, referencia, detalles, subtotalLineasCentimos) {
  const cantidadesSolicitadas = new Map();
  for (const item of solicitud.items) {
    cantidadesSolicitadas.set(
      item.productoId,
      (cantidadesSolicitadas.get(item.productoId) || 0) + item.cantidadEscalada
    );
  }

  for (const [productoId, cantidadSolicitada] of cantidadesSolicitadas) {
    const original = referencia.detallesPorProducto.get(productoId);
    const cantidadAjustada = referencia.cantidadesAjustadas.get(productoId) || 0;
    if (cantidadSolicitada > original.cantidadEscalada - cantidadAjustada) {
      throw new ErrorValidacion('La cantidad devuelta o acreditada supera lo vendido disponible');
    }
  }

  const subtotalItemsCentimos = detalles.reduce((sum, item) => sum + item.subtotalCentimos, 0);
  validarCentimos(subtotalItemsCentimos, 'El subtotal del ajuste');
  const descuentoRestante = Math.max(
    0,
    aCentimos(referencia.comprobante.descuento, 'El descuento original') - referencia.descuentoAjustadoCentimos
  );
  const completaAjuste = [...referencia.detallesPorProducto.entries()].every(([productoId, original]) => {
    const yaAjustada = referencia.cantidadesAjustadas.get(productoId) || 0;
    const nueva = cantidadesSolicitadas.get(productoId) || 0;
    return yaAjustada + nueva >= original.cantidadEscalada;
  });

  const descuentoCentimos = completaAjuste
    ? descuentoRestante
    : subtotalLineasCentimos > 0
      ? Math.min(descuentoRestante, prorratearCentimos(
        aCentimos(referencia.comprobante.descuento, 'El descuento original'),
        subtotalItemsCentimos,
        subtotalLineasCentimos
      ))
      : 0;
  const subtotalAjustadoAnteriorCentimos = [...referencia.subtotalesAjustadosCentimos.values()]
    .reduce((sum, subtotal) => sum + subtotal, 0);
  const subtotalCentimos = completaAjuste
    ? validarCentimos(
      aCentimos(referencia.comprobante.subtotal, 'El subtotal original') - subtotalAjustadoAnteriorCentimos,
      'El subtotal del ajuste'
    )
    : validarCentimos(subtotalItemsCentimos - descuentoCentimos, 'El subtotal del ajuste');
  if (subtotalCentimos < 0) throw new ErrorValidacion('El descuento supera el subtotal del ajuste');

  const igvRestante = Math.max(
    0,
    aCentimos(referencia.comprobante.igv, 'El IGV original') - referencia.igvAjustadoCentimos
  );
  const igvCentimos = completaAjuste
    ? igvRestante
    : referencia.comprobante.subtotal > 0
      ? Math.min(igvRestante, prorratearCentimos(
        aCentimos(referencia.comprobante.igv, 'El IGV original'),
        subtotalCentimos,
        aCentimos(referencia.comprobante.subtotal, 'El subtotal original')
      ))
      : 0;

  return { subtotalCentimos, descuentoCentimos, igvCentimos };
}

/** @param {Database} db @param {unknown} payload */
function crearComprobante(db, payload) {
  const solicitud = validarSolicitud(payload);
  const transaccion = db.transaction(() => {
    const cliente = db.prepare('SELECT id FROM clientes WHERE id = ?').get(solicitud.clienteId);
    if (!cliente) throw new ErrorValidacion('Cliente no encontrado', 404);

    const referencia = prepararReferencia(db, solicitud);
    const { detalles, subtotalCentimos: subtotalLineasCentimos, totalBrutoCentimos } = prepararItemsNormales(
      db,
      solicitud,
      referencia
    );

    let subtotalCentimos = subtotalLineasCentimos;
    let descuentoCentimos = solicitud.descuentoCentimos;
    let igvCentimos;
    let condicionPago = solicitud.condicionPago;
    let afectaIgv = TIPOS[solicitud.tipo].afecta_igv;

    if (referencia) {
      const ajuste = aplicarLimitesAjuste(
        solicitud,
        referencia,
        detalles,
        referencia.subtotalLineasCentimos
      );
      subtotalCentimos = ajuste.subtotalCentimos;
      descuentoCentimos = ajuste.descuentoCentimos;
      igvCentimos = ajuste.igvCentimos;
      afectaIgv = referencia.comprobante.afecta_igv !== 0;
      condicionPago = afectaIgv ? 'contado' : 'no_afecta';
    } else {
      if (descuentoCentimos > totalBrutoCentimos) {
        throw new ErrorValidacion('El descuento no puede superar el subtotal');
      }
      const brutoConDescuento = totalBrutoCentimos - descuentoCentimos;
      if (TIPOS[solicitud.tipo].afecta_igv && condicionPago !== 'no_afecta') {
        subtotalCentimos = Math.round(brutoConDescuento * 100 / 118);
        igvCentimos = brutoConDescuento - subtotalCentimos;
      } else {
        subtotalCentimos = brutoConDescuento;
        igvCentimos = 0;
      }
    }

    validarCentimos(igvCentimos, 'El IGV');
    const totalCentimos = validarCentimos(subtotalCentimos + igvCentimos, 'El total');
    const serie = /** @type {SerieFila | undefined} */ (db.prepare('SELECT * FROM series WHERE tipo = ?').get(solicitud.tipo));
    if (!serie) throw new Error('No existe una serie configurada para el comprobante');
    const numero = serie.ultimo_numero + 1;
    const actualizacionSerie = db.prepare(
      'UPDATE series SET ultimo_numero = ? WHERE id = ? AND ultimo_numero = ?'
    ).run(numero, serie.id, serie.ultimo_numero);
    if (actualizacionSerie.changes !== 1) throw new Error('No se pudo reservar el número del comprobante');

    const estadoInicial = solicitud.tipo === 'cotizacion'
      ? 'borrador'
      : solicitud.tipo === 'nota_pedido'
        ? 'pendiente'
        : 'emitido';
    const resultado = db.prepare(`
      INSERT INTO comprobantes (
        tipo, serie, numero, cliente_id, condicion_pago, fecha_vencimiento,
        comprobante_ref_id, motivo_ref, direccion_partida, direccion_llegada,
        transportista, fecha_traslado, subtotal, igv, descuento, total,
        afecta_igv, precios_incluyen_igv, estado
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      solicitud.tipo,
      serie.serie,
      numero,
      solicitud.clienteId,
      condicionPago,
      solicitud.condicionPago === 'credito' ? solicitud.fechaVencimiento : null,
      solicitud.comprobanteReferenciaId,
      solicitud.motivoReferencia,
      solicitud.direccionPartida,
      solicitud.direccionLlegada,
      solicitud.transportista,
      solicitud.fechaTraslado,
      desdeCentimos(subtotalCentimos),
      desdeCentimos(igvCentimos),
      desdeCentimos(descuentoCentimos),
      desdeCentimos(totalCentimos),
      afectaIgv ? 1 : 0,
      1,
      estadoInicial
    );

    for (const detalle of detalles) {
      db.prepare(`
        INSERT INTO detalle_comprobante
          (comprobante_id, producto_id, descripcion_libre, cantidad, unidad,
            tipo_precio, precio_unitario, descuento_item, subtotal)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        resultado.lastInsertRowid,
        detalle.productoId,
        detalle.descripcion,
        detalle.cantidad,
        detalle.unidad,
        detalle.tipoPrecio,
        desdeCentimos(detalle.precioCentimos),
        desdeCentimos(detalle.descuentoItemCentimos),
        desdeCentimos(detalle.subtotalCentimos)
      );

      if (!detalle.productoId || !TIPOS[solicitud.tipo].mueve_stock) continue;
      if (solicitud.tipo === 'nota_devolucion') {
        const movimiento = db.prepare('UPDATE productos SET stock = stock + ? WHERE id = ?')
          .run(detalle.cantidad, detalle.productoId);
        if (movimiento.changes !== 1) throw new ErrorValidacion('No se pudo actualizar el stock del producto', 409);
      } else {
        const movimiento = db.prepare(
          'UPDATE productos SET stock = stock - ? WHERE id = ? AND stock >= ?'
        ).run(detalle.cantidad, detalle.productoId, detalle.cantidad);
        if (movimiento.changes !== 1) {
          throw new ErrorValidacion(`Stock insuficiente para "${detalle.descripcion}"`);
        }
      }
    }

    return {
      id: Number(resultado.lastInsertRowid),
      numero: `${serie.serie}-${String(numero).padStart(6, '0')}`,
      subtotal: desdeCentimos(subtotalCentimos),
      igv: desdeCentimos(igvCentimos),
      total: desdeCentimos(totalCentimos),
    };
  });

  return transaccion.immediate();
}

/** @param {Database} db @param {number | string} comprobanteId @param {string} nuevoEstado */
function cambiarEstadoComprobante(db, comprobanteId, nuevoEstado) {
  const id = Number(comprobanteId);
  if (!Number.isInteger(id) || id <= 0) throw new ErrorValidacion('Comprobante no válido');
  const transaccion = db.transaction(() => {
    const comprobante = /** @type {DatosComprobanteReferencia | undefined} */ (db.prepare('SELECT * FROM comprobantes WHERE id = ?').get(id));
    if (!comprobante) throw new ErrorValidacion('Comprobante no encontrado', 404);

    if (typeof comprobante.tipo !== 'string' || !Object.hasOwn(TIPOS, comprobante.tipo)) {
      throw new ErrorValidacion('Tipo de comprobante inválido');
    }
    const tipoComprobante = /** @type {TipoComprobante} */ (comprobante.tipo);
    const estadosPermitidos = TRANSICIONES[tipoComprobante]?.[comprobante.estado] || [];
    if (!estadosPermitidos.includes(nuevoEstado)) {
      throw new ErrorValidacion(`No se permite cambiar de ${comprobante.estado} a ${nuevoEstado}`);
    }

    if (nuevoEstado === 'anulado' && ['factura', 'boleta'].includes(comprobante.tipo)) {
      const pagosRegistrados = /** @type {{ total: number } | undefined} */ (db.prepare(
        'SELECT COUNT(*) AS total FROM pagos_comprobante WHERE comprobante_id = ?'
      ).get(id));
      if (pagosRegistrados?.total > 0) {
        throw new ErrorValidacion('No se puede anular una venta con cobros registrados', 409);
      }
      const ajustesActivos = db.prepare(`
        SELECT COUNT(*) AS total FROM comprobantes
        WHERE comprobante_ref_id = ?
          AND tipo IN ('nota_devolucion', 'nota_credito_f', 'nota_credito_b')
          AND estado != 'anulado'
      `).get(id);
      const cantidadAjustes = /** @type {{ total: number } | undefined} */ (ajustesActivos)?.total || 0;
      if (cantidadAjustes > 0) {
        throw new ErrorValidacion('Anula primero las notas de crédito o devoluciones vinculadas');
      }
    }

    if (nuevoEstado === 'anulado' && TIPOS[tipoComprobante]?.mueve_stock) {
      const detalles = /** @type {MovimientoStockFila[]} */ (/** @type {unknown} */ (db.prepare(
        'SELECT producto_id, cantidad FROM detalle_comprobante WHERE comprobante_id = ?'
      ).all(id)));
      for (const detalle of detalles) {
        if (!detalle.producto_id) continue;
        if (comprobante.tipo === 'nota_devolucion') {
          const movimiento = db.prepare(
            'UPDATE productos SET stock = stock - ? WHERE id = ? AND stock >= ?'
          ).run(detalle.cantidad, detalle.producto_id, detalle.cantidad);
          if (movimiento.changes !== 1) {
            throw new ErrorValidacion('No se puede anular la devolución: el stock ya fue vendido o ajustado');
          }
        } else {
          const movimiento = db.prepare('UPDATE productos SET stock = stock + ? WHERE id = ?')
            .run(detalle.cantidad, detalle.producto_id);
          if (movimiento.changes !== 1) throw new ErrorValidacion('No se pudo restaurar el stock del producto', 409);
        }
      }
    }

    const actualizacion = db.prepare(
      'UPDATE comprobantes SET estado = ? WHERE id = ? AND estado = ?'
    ).run(nuevoEstado, id, comprobante.estado);
    if (actualizacion.changes !== 1) throw new Error('El estado del comprobante cambió durante la operación');
    return { id, estado: nuevoEstado };
  });

  return transaccion.immediate();
}

module.exports = {
  ErrorValidacion,
  TIPOS,
  aCentimos,
  desdeCentimos,
  validarCentimos,
  unidadesCantidad,
  importePorCantidad,
  prorratearCentimos,
  validarSolicitud,
  aplicarLimitesAjuste,
  crearComprobante,
  cambiarEstadoComprobante,
};