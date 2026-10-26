const db = require('../database-postgres');
const {
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
} = require('./comprobantes');

const TIPOS_AJUSTE = ['nota_devolucion', 'nota_credito_f', 'nota_credito_b'];
const ESCALA_CANTIDAD = 1000000;

async function prepararReferencia(client, solicitud) {
  if (!TIPOS_AJUSTE.includes(solicitud.tipo)) return null;

  const resultadoComprobante = await client.query(
    'SELECT * FROM comprobantes WHERE id = $1 FOR UPDATE',
    [solicitud.comprobanteReferenciaId],
  );
  const comprobante = resultadoComprobante.rows[0];
  if (!comprobante) throw new ErrorValidacion('Comprobante referenciado no encontrado', 404);
  if (comprobante.estado === 'anulado') throw new ErrorValidacion('No se puede ajustar un comprobante anulado');
  if (Number(comprobante.cliente_id) !== solicitud.clienteId) {
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

  const originalsResult = await client.query(`
    SELECT producto_id, SUM(cantidad) AS cantidad, SUM(subtotal) AS subtotal,
      MAX(descripcion_libre) AS descripcion, MAX(unidad) AS unidad
    FROM detalle_comprobante
    WHERE comprobante_id = $1 AND producto_id IS NOT NULL
    GROUP BY producto_id
  `, [comprobante.id]);
  const detallesPorProducto = new Map(originalsResult.rows.map(item => [Number(item.producto_id), {
    cantidad: Number(item.cantidad),
    cantidadEscalada: unidadesCantidad(item.cantidad, 'La cantidad original'),
    subtotalCentimos: aCentimos(item.subtotal, 'El subtotal original'),
    descripcion: item.descripcion,
    unidad: item.unidad,
  }]));

  const adjustmentsResult = await client.query(`
    SELECT d.producto_id, SUM(d.cantidad) AS cantidad, SUM(d.subtotal) AS subtotal
    FROM comprobantes c
    JOIN detalle_comprobante d ON d.comprobante_id = c.id
    WHERE c.comprobante_ref_id = $1
      AND c.tipo = ANY($2::text[])
      AND c.estado <> 'anulado'
    GROUP BY d.producto_id
  `, [comprobante.id, TIPOS_AJUSTE]);
  const cantidadesAjustadas = new Map(adjustmentsResult.rows.map(item => [
    Number(item.producto_id),
    unidadesCantidad(item.cantidad, 'La cantidad ya ajustada'),
  ]));
  const subtotalesAjustadosCentimos = new Map(adjustmentsResult.rows.map(item => [
    Number(item.producto_id),
    aCentimos(item.subtotal, 'El subtotal ya ajustado'),
  ]));
  const sumsResult = await client.query(`
    SELECT COALESCE(SUM(descuento), 0) AS descuento, COALESCE(SUM(igv), 0) AS igv
    FROM comprobantes
    WHERE comprobante_ref_id = $1
      AND tipo = ANY($2::text[])
      AND estado <> 'anulado'
  `, [comprobante.id, TIPOS_AJUSTE]);
  const sums = sumsResult.rows[0];

  return {
    comprobante,
    detallesPorProducto,
    cantidadesAjustadas,
    subtotalesAjustadosCentimos,
    descuentoAjustadoCentimos: aCentimos(sums.descuento, 'El descuento ajustado'),
    igvAjustadoCentimos: aCentimos(sums.igv, 'El IGV ajustado'),
    subtotalLineasCentimos: [...detallesPorProducto.values()]
      .reduce((sum, item) => sum + item.subtotalCentimos, 0),
  };
}

async function prepararItemsNormales(client, solicitud, referencia) {
  if (referencia) {
    const cantidadesSolicitadas = new Map();
    for (const item of solicitud.items) {
      cantidadesSolicitadas.set(
        item.productoId,
        (cantidadesSolicitadas.get(item.productoId) || 0) + item.cantidadEscalada,
      );
    }

    const detalles = [];
    let subtotalCentimos = 0;
    for (const [productoId, cantidad] of cantidadesSolicitadas) {
      const result = await client.query(
        'SELECT id, nombre, stock, unidad FROM productos WHERE id = $1 FOR UPDATE',
        [productoId],
      );
      const producto = result.rows[0];
      if (!producto) throw new ErrorValidacion(`Producto ${productoId} no encontrado`, 404);
      const original = referencia.detallesPorProducto.get(productoId);
      if (!original) throw new ErrorValidacion(`El producto ${producto.nombre} no pertenece al comprobante referenciado`);

      const cantidadAjustada = referencia.cantidadesAjustadas.get(productoId) || 0;
      const subtotalAjustado = referencia.subtotalesAjustadosCentimos.get(productoId) || 0;
      const cantidadRestante = original.cantidadEscalada - cantidadAjustada;
      const subtotalRestante = original.subtotalCentimos - subtotalAjustado;
      const itemSubtotal = cantidad >= cantidadRestante
        ? subtotalRestante
        : Math.min(subtotalRestante, prorratearCentimos(original.subtotalCentimos, cantidad, original.cantidadEscalada));
      validarCentimos(itemSubtotal, 'El subtotal de la devolución');
      detalles.push({
        productoId,
        descripcion: original.descripcion || producto.nombre,
        cantidad: cantidad / ESCALA_CANTIDAD,
        unidad: original.unidad || producto.unidad,
        tipoPrecio: 'unidad',
        precioCentimos: prorratearCentimos(itemSubtotal, ESCALA_CANTIDAD, cantidad),
        descuentoItemCentimos: 0,
        subtotalCentimos: itemSubtotal,
        cantidadEscalada: cantidad,
        stock: Number(producto.stock),
      });
      subtotalCentimos = validarCentimos(subtotalCentimos + itemSubtotal, 'El subtotal de la devolución');
    }
    return { detalles, subtotalCentimos, totalBrutoCentimos: subtotalCentimos };
  }

  let subtotalCentimos = 0;
  let totalBrutoCentimos = 0;
  const detalles = [];
  for (const item of solicitud.items) {
    if (!item.productoId) {
      detalles.push({
        productoId: null,
        descripcion: item.descripcion,
        cantidad: item.cantidad,
        cantidadEscalada: item.cantidadEscalada,
        unidad: item.unidad,
        tipoPrecio: item.tipoPrecio,
        precioCentimos: 0,
        descuentoItemCentimos: 0,
        subtotalCentimos: 0,
      });
      continue;
    }

    const result = await client.query(`
      SELECT id, nombre, precio, precio_rebaja, precio_pase, stock, unidad
      FROM productos WHERE id = $1 FOR UPDATE
    `, [item.productoId]);
    const producto = result.rows[0];
    if (!producto) throw new ErrorValidacion(`Producto ${item.productoId} no encontrado`, 404);

    const precios = { unidad: producto.precio, rebaja: producto.precio_rebaja, pase: producto.precio_pase };
    const precioCentimos = aCentimos(precios[item.tipoPrecio], `El precio ${item.tipoPrecio} del producto ${producto.nombre}`);
    const descuentoItemCentimos = item.descuentoItemCentimos;
    if (descuentoItemCentimos > precioCentimos) {
      throw new ErrorValidacion(`El descuento supera el precio del producto ${producto.nombre}`);
    }
    const precioNetoCentimos = precioCentimos - descuentoItemCentimos;
    const itemSubtotalCentimos = importePorCantidad(Math.round(precioNetoCentimos * 100 / 118), item.cantidadEscalada);
    totalBrutoCentimos = validarCentimos(
      totalBrutoCentimos + importePorCantidad(precioNetoCentimos, item.cantidadEscalada),
      'El total de los ítems',
    );
    subtotalCentimos = validarCentimos(subtotalCentimos + itemSubtotalCentimos, 'El subtotal');
    detalles.push({
      productoId: Number(producto.id),
      descripcion: producto.nombre,
      cantidad: item.cantidad,
      cantidadEscalada: item.cantidadEscalada,
      unidad: producto.unidad,
      tipoPrecio: item.tipoPrecio,
      precioCentimos,
      descuentoItemCentimos,
      subtotalCentimos: itemSubtotalCentimos,
      stock: Number(producto.stock),
    });
  }
  return { detalles, subtotalCentimos, totalBrutoCentimos };
}

async function crearComprobante(payload) {
  const solicitud = validarSolicitud(payload);
  return db.transaction(async client => {
    const cliente = await client.query('SELECT id FROM clientes WHERE id = $1', [solicitud.clienteId]);
    if (!cliente.rowCount) throw new ErrorValidacion('Cliente no encontrado', 404);

    const referencia = await prepararReferencia(client, solicitud);
    const { detalles, subtotalCentimos: subtotalLineasCentimos, totalBrutoCentimos } =
      await prepararItemsNormales(client, solicitud, referencia);
    let subtotalCentimos = subtotalLineasCentimos;
    let descuentoCentimos = solicitud.descuentoCentimos;
    let igvCentimos;
    let condicionPago = solicitud.condicionPago;
    let afectaIgv = TIPOS[solicitud.tipo].afecta_igv;

    if (referencia) {
      const ajuste = aplicarLimitesAjuste(solicitud, referencia, detalles, referencia.subtotalLineasCentimos);
      subtotalCentimos = ajuste.subtotalCentimos;
      descuentoCentimos = ajuste.descuentoCentimos;
      igvCentimos = ajuste.igvCentimos;
      afectaIgv = Number(referencia.comprobante.afecta_igv) !== 0;
      condicionPago = afectaIgv ? 'contado' : 'no_afecta';
    } else {
      if (descuentoCentimos > totalBrutoCentimos) throw new ErrorValidacion('El descuento no puede superar el subtotal');
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
    const seriesResult = await client.query('SELECT * FROM series WHERE tipo = $1 FOR UPDATE', [solicitud.tipo]);
    const serie = seriesResult.rows[0];
    if (!serie) throw new Error('No existe una serie configurada para el comprobante');
    const numero = Number(serie.ultimo_numero) + 1;
    const seriesUpdate = await client.query(
      'UPDATE series SET ultimo_numero = $1 WHERE id = $2 AND ultimo_numero = $3',
      [numero, serie.id, serie.ultimo_numero],
    );
    if (seriesUpdate.rowCount !== 1) throw new Error('No se pudo reservar el número del comprobante');

    const estado = solicitud.tipo === 'cotizacion' ? 'borrador' : solicitud.tipo === 'nota_pedido' ? 'pendiente' : 'emitido';
    const inserted = await client.query(`
      INSERT INTO comprobantes (
        tipo, serie, numero, cliente_id, condicion_pago, fecha_vencimiento,
        comprobante_ref_id, motivo_ref, direccion_partida, direccion_llegada,
        transportista, fecha_traslado, subtotal, igv, descuento, total,
        afecta_igv, precios_incluyen_igv, estado
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING id
    `, [
      solicitud.tipo, serie.serie, numero, solicitud.clienteId, condicionPago,
      solicitud.condicionPago === 'credito' ? solicitud.fechaVencimiento : null,
      solicitud.comprobanteReferenciaId, solicitud.motivoReferencia,
      solicitud.direccionPartida, solicitud.direccionLlegada, solicitud.transportista,
      solicitud.fechaTraslado, desdeCentimos(subtotalCentimos), desdeCentimos(igvCentimos),
      desdeCentimos(descuentoCentimos), desdeCentimos(totalCentimos), afectaIgv ? 1 : 0, 1, estado,
    ]);
    const comprobanteId = inserted.rows[0].id;

    for (const detalle of detalles) {
      await client.query(`
        INSERT INTO detalle_comprobante
          (comprobante_id, producto_id, descripcion_libre, cantidad, unidad, tipo_precio,
           precio_unitario, descuento_item, subtotal)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        comprobanteId, detalle.productoId, detalle.descripcion, detalle.cantidad, detalle.unidad,
        detalle.tipoPrecio, desdeCentimos(detalle.precioCentimos),
        desdeCentimos(detalle.descuentoItemCentimos), desdeCentimos(detalle.subtotalCentimos),
      ]);
      if (!detalle.productoId || !TIPOS[solicitud.tipo].mueve_stock) continue;
      const delta = solicitud.tipo === 'nota_devolucion' ? detalle.cantidad : -detalle.cantidad;
      const stockResult = await client.query(`
        UPDATE productos SET stock = stock + $1
        WHERE id = $2 AND ($1 >= 0 OR stock >= -$1)
      `, [delta, detalle.productoId]);
      if (stockResult.rowCount !== 1) {
        if (solicitud.tipo === 'nota_devolucion') {
          throw new ErrorValidacion('No se pudo actualizar el stock del producto', 409);
        }
        throw new ErrorValidacion(`Stock insuficiente para "${detalle.descripcion}"`);
      }
    }

    return {
      id: Number(comprobanteId),
      numero: `${serie.serie}-${String(numero).padStart(6, '0')}`,
      subtotal: desdeCentimos(subtotalCentimos),
      igv: desdeCentimos(igvCentimos),
      total: desdeCentimos(totalCentimos),
    };
  });
}

async function cambiarEstadoComprobante(comprobanteId, nuevoEstado) {
  const id = Number(comprobanteId);
  if (!Number.isInteger(id) || id <= 0) throw new ErrorValidacion('Comprobante no válido');
  return db.transaction(async client => {
    const result = await client.query('SELECT * FROM comprobantes WHERE id = $1 FOR UPDATE', [id]);
    const comprobante = result.rows[0];
    if (!comprobante) throw new ErrorValidacion('Comprobante no encontrado', 404);
    if (!Object.hasOwn(TIPOS, comprobante.tipo)) throw new ErrorValidacion('Tipo de comprobante inválido');

    const transitions = {
      factura: { emitido: ['pagado', 'anulado'], parcial: ['pagado'], pagado: ['anulado'] },
      boleta: { emitido: ['pagado', 'anulado'], parcial: ['pagado'], pagado: ['anulado'] },
      nota_pedido: { pendiente: ['atendido', 'anulado'], atendido: ['anulado'] },
      guia_remision: { emitido: ['anulado'] },
      cotizacion: { borrador: ['enviado', 'aprobado', 'rechazado'], enviado: ['aprobado', 'rechazado'] },
      nota_devolucion: { emitido: ['anulado'] },
      nota_credito_f: { emitido: ['anulado'] },
      nota_credito_b: { emitido: ['anulado'] },
    };
    if (!(transitions[comprobante.tipo]?.[comprobante.estado] || []).includes(nuevoEstado)) {
      throw new ErrorValidacion(`No se permite cambiar de ${comprobante.estado} a ${nuevoEstado}`);
    }

    if (nuevoEstado === 'anulado' && ['factura', 'boleta'].includes(comprobante.tipo)) {
      const payments = await client.query(
        'SELECT COUNT(*)::int AS total FROM pagos_comprobante WHERE comprobante_id = $1',
        [id],
      );
      if (payments.rows[0].total > 0) throw new ErrorValidacion('No se puede anular una venta con cobros registrados', 409);
      const adjustments = await client.query(`
        SELECT COUNT(*)::int AS total FROM comprobantes
        WHERE comprobante_ref_id = $1
          AND tipo = ANY($2::text[]) AND estado <> 'anulado'
      `, [id, TIPOS_AJUSTE]);
      if (adjustments.rows[0].total > 0) {
        throw new ErrorValidacion('Anula primero las notas de crédito o devoluciones vinculadas');
      }
    }

    if (nuevoEstado === 'anulado' && TIPOS[comprobante.tipo].mueve_stock) {
      const details = await client.query(
        'SELECT producto_id, cantidad FROM detalle_comprobante WHERE comprobante_id = $1',
        [id],
      );
      for (const detalle of details.rows) {
        if (!detalle.producto_id) continue;
        const delta = comprobante.tipo === 'nota_devolucion' ? -Number(detalle.cantidad) : Number(detalle.cantidad);
        const update = await client.query(`
          UPDATE productos SET stock = stock + $1
          WHERE id = $2 AND ($1 >= 0 OR stock >= -$1)
        `, [delta, detalle.producto_id]);
        if (!update.rowCount) {
          if (comprobante.tipo === 'nota_devolucion') {
            throw new ErrorValidacion('No se puede anular la devolución: el stock ya fue vendido o ajustado');
          }
          throw new ErrorValidacion('No se pudo restaurar el stock del producto', 409);
        }
      }
    }

    const update = await client.query(
      'UPDATE comprobantes SET estado = $1 WHERE id = $2 AND estado = $3',
      [nuevoEstado, id, comprobante.estado],
    );
    if (update.rowCount !== 1) throw new Error('El estado del comprobante cambió durante la operación');
    return { id, estado: nuevoEstado };
  });
}

module.exports = { crearComprobante, cambiarEstadoComprobante };
