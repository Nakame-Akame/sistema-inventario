import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { ApiError, apiRequest } from '../../lib/api';
import { Button, Card, Field, Heading, Message, Page, colors } from '../../components/ui';

type Item = Record<string, any>;
type ApiList = { data: Item[] } & Record<string, any>;
type ModuleName = 'ventas' | 'comprobantes' | 'clientes' | 'productos' | 'compras' | 'reportes' | 'usuarios' | 'inventario';

const titles: Record<ModuleName, string> = {
  ventas: 'Ventas', comprobantes: 'Comprobantes', clientes: 'Clientes', productos: 'Productos',
  compras: 'Compras', reportes: 'Reportes', usuarios: 'Usuarios', inventario: 'Inventario',
};

const modulePermissions: Record<ModuleName, string> = {
  ventas: 'comprobantes:ver', comprobantes: 'comprobantes:ver', clientes: 'clientes:ver',
  productos: 'productos:ver', compras: 'compras:ver', reportes: 'reportes:ver',
  usuarios: 'usuarios:administrar', inventario: 'inventario:ver',
};

export default function ModuleScreen() {
  const params = useLocalSearchParams<{ module: string }>();
  const moduleName = (Array.isArray(params.module) ? params.module[0] : params.module) as ModuleName;
  const { can } = useAuth();
  const [data, setData] = useState<Item[]>([]);
  const [summary, setSummary] = useState<Item | null>(null);
  const [customers, setCustomers] = useState<Item[]>([]);
  const [products, setProducts] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Item[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Item | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Item | null>(null);
  const [cart, setCart] = useState<{ producto_id: number; cantidad: number; tipo_precio: string }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [paymentId, setPaymentId] = useState<number | null>(null);
  const [purchaseCart, setPurchaseCart] = useState<{ producto_id: number; cantidad: number; costo_unitario: number }[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const loadSequence = useRef(0);

  const allowed = useMemo(() => moduleName in modulePermissions && can(modulePermissions[moduleName]), [moduleName, can]);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      if (moduleName === 'ventas') {
        const [clients, catalog] = await Promise.all([
          apiRequest<ApiList>('/clientes'),
          apiRequest<ApiList>('/productos?limit=100'),
        ]);
        const customerData = requireList(clients, 'clientes');
        const productData = requireList(catalog, 'productos');
        if (sequence !== loadSequence.current) return false;
        setError('');
        setCustomers(customerData);
        setProducts(productData);
        return true;
      }
      if (moduleName === 'compras') {
        const [purchases, catalog] = await Promise.all([
          apiRequest<ApiList>('/compras'),
          apiRequest<ApiList>('/productos?limit=100'),
        ]);
        const purchaseData = requireList(purchases, 'compras');
        const productData = requireList(catalog, 'productos');
        if (sequence !== loadSequence.current) return false;
        setError('');
        setData(purchaseData);
        setProducts(productData);
        return true;
      }
      if (moduleName === 'reportes') {
        const [result, lowStock] = await Promise.all([
          apiRequest<{ data: Item }>('/reportes/resumen'),
          apiRequest<ApiList>('/reportes/alertas-stock'),
        ]);
        if (!isItem(result.data)) throw new ApiError('El resumen del servidor tiene un formato inválido.', 0);
        const alertData = requireList(lowStock, 'alertas de stock');
        if (sequence !== loadSequence.current) return false;
        setError('');
        setSummary(result.data);
        setData(alertData);
        return true;
      }
      if (moduleName === 'inventario') {
        const [result, warehouseResult, catalog] = await Promise.all([
          apiRequest<{ data: Item }>('/inventario/resumen'),
          apiRequest<ApiList>('/inventario/almacenes'),
          apiRequest<ApiList>('/productos?limit=100'),
        ]);
        if (!isItem(result.data)) throw new ApiError('El resumen del servidor tiene un formato inválido.', 0);
        const warehouseData = requireList(warehouseResult, 'almacenes');
        const productData = requireList(catalog, 'productos');
        const alertData = result.data.alertas === undefined ? [] : requireItems(result.data.alertas, 'alertas de inventario');
        if (sequence !== loadSequence.current) return false;
        setError('');
        setSummary(result.data);
        setData(alertData);
        setWarehouses(warehouseData);
        setProducts(productData);
        return true;
      }
      const endpoint: Record<string, string> = {
        comprobantes: '/comprobantes',
        clientes: '/clientes',
        productos: '/productos?limit=100',
        compras: '/compras',
        usuarios: '/auth/usuarios',
      };
      const result = await apiRequest<ApiList>(endpoint[moduleName]);
      const records = requireList(result, titles[moduleName]);
      if (sequence !== loadSequence.current) return false;
      setError('');
      setData(records);
      return true;
    } catch (cause) {
      if (sequence === loadSequence.current) {
        setError(cause instanceof ApiError ? cause.message : 'No se pudieron cargar los datos.');
      }
      return false;
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [moduleName]);

  useEffect(() => {
    if (!allowed) return;
    const request = setTimeout(() => {
      setLoading(true);
      void load();
    }, 0);
    return () => {
      clearTimeout(request);
      loadSequence.current += 1;
    };
  }, [allowed, load]);

  function setValue(key: string, value: string) {
    setForm(current => ({ ...current, [key]: value }));
  }

  async function submit(body: unknown, endpoint: string, method = 'POST') {
    setBusy(true);
    setError('');
    try {
      await apiRequest(endpoint, { method, json: body });
      setForm({});
      setEditingId(null);
      setPaymentId(null);
      setSelectedCustomer(null);
      setSelectedProduct(null);
      setCart([]);
      setPurchaseCart([]);
      setLoading(true);
      const refreshed = await load();
      Alert.alert('Listo', refreshed
        ? 'La operación se completó correctamente.'
        : 'La operación se guardó, pero no pudimos actualizar los datos. Pulsa Actualizar para volver a intentarlo.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo completar la operación.');
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) {
    return <Page><Heading title="Acceso no disponible" /><Message>Tu cuenta no tiene permiso para consultar este módulo.</Message><Button title="Volver" secondary onPress={() => router.back()} /></Page>;
  }

  const canCreate = {
    clientes: can('clientes:crear'),
    productos: can('productos:crear'),
    ventas: can('comprobantes:crear_factura') || can('comprobantes:crear_boleta'),
    compras: can('compras:crear'),
    usuarios: can('usuarios:administrar'),
  }[moduleName as 'clientes' | 'productos' | 'ventas' | 'compras' | 'usuarios'] || false;
  const canEdit = moduleName === 'clientes'
    ? can('clientes:editar')
    : moduleName === 'productos' && can('productos:editar');
  const canDelete = moduleName === 'clientes'
    ? can('clientes:eliminar')
    : moduleName === 'productos' && can('productos:eliminar');
  const visibleData = data.filter(item => Object.values(item).some(value =>
    (typeof value === 'string' || typeof value === 'number') &&
    String(value).toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es')),
  ));

  function confirmDelete(message: string, endpoint: string) {
    Alert.alert('Confirmar eliminación', message, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void apiRequest(endpoint, { method: 'DELETE' })
            .then(async () => {
              setLoading(true);
              const refreshed = await load();
              if (!refreshed) Alert.alert('Eliminado', 'El registro se eliminó, pero no pudimos actualizar la lista.');
            })
            .catch(cause => setError(cause instanceof ApiError ? cause.message : 'No se pudo eliminar el registro.'))
            .finally(() => setBusy(false));
        },
      },
    ]);
  }

  return (
    <Page>
      <Heading title={titles[moduleName] || 'Módulo'} subtitle="Información conectada a la base de datos del sistema." />
      {error ? <Card><Message error>{error}</Message></Card> : null}
      {moduleName === 'ventas' && canCreate ? (
        <Card>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionMark}><Text style={styles.sectionMarkText}>＋</Text></View>
            <View style={styles.flex}><Text style={styles.cardTitle}>Nueva venta</Text><Text style={styles.cardSubtitle}>Selecciona cliente y agrega productos</Text></View>
          </View>
          <Text style={styles.label}>Tipo de comprobante</Text>
          <View style={styles.choiceRow}>
            {(['boleta', 'factura'] as const).map(type => <Choice key={type} label={type === 'boleta' ? 'Boleta' : 'Factura'} selected={(form.tipo || 'boleta') === type} onPress={() => setValue('tipo', type)} />)}
          </View>
          <Field label="Buscar cliente" value={customerSearch} onChangeText={setCustomerSearch} placeholder="Nombre o documento" autoCapitalize="none" />
          <View style={styles.selectionList}>
            {customers.filter(customer => `${customer.nombre} ${customer.documento || ''}`.toLocaleLowerCase('es').includes(customerSearch.trim().toLocaleLowerCase('es'))).slice(0, 8).map(customer => (
              <Choice key={customer.id} label={`${customer.nombre} · ${customer.documento || 'Sin documento'}`} selected={selectedCustomer?.id === customer.id} onPress={() => setSelectedCustomer(customer)} />
            ))}
            {!customers.length ? <Message>No hay clientes para seleccionar.</Message> : null}
          </View>
          {selectedCustomer ? <View style={styles.selectedPill}><Text style={styles.selectedText}>Cliente: {selectedCustomer.nombre}</Text><Pressable onPress={() => setSelectedCustomer(null)}><Text style={styles.removeText}>Quitar</Text></Pressable></View> : null}
          <Field label="Cantidad para agregar" value={form.cantidad || '1'} onChangeText={value => setValue('cantidad', value)} keyboardType="number-pad" />
          <Text style={styles.label}>Lista de precios</Text>
          <View style={styles.choiceRow}>
            {(['unidad', 'rebaja', 'pase'] as const).map(priceType => <Choice key={priceType} label={humanize(priceType)} selected={(form.price_type || 'unidad') === priceType} onPress={() => setValue('price_type', priceType)} />)}
          </View>
          <Field label="Buscar producto" value={productSearch} onChangeText={setProductSearch} placeholder="Nombre o categoría" autoCapitalize="none" />
          <View style={styles.selectionList}>
            {products.filter(product => Number(product.stock) > 0 && `${product.nombre} ${product.categoria || ''}`.toLocaleLowerCase('es').includes(productSearch.trim().toLocaleLowerCase('es'))).slice(0, 8).map(product => (
              <Pressable key={product.id} style={styles.productOption} onPress={() => {
                const currentQuantity = Number(form.cantidad || 1);
                if (!Number.isInteger(currentQuantity) || currentQuantity < 1) return setError('La cantidad debe ser un entero positivo.');
                const quantityInCart = cart.filter(line => line.producto_id === Number(product.id)).reduce((total, line) => total + line.cantidad, 0);
                if (quantityInCart + currentQuantity > Number(product.stock)) return setError(`No hay suficiente stock de ${product.nombre}. Disponible: ${product.stock}.`);
                setCart(current => {
                  const priceType = form.price_type || 'unidad';
                  const existing = current.find(line => line.producto_id === Number(product.id) && line.tipo_precio === priceType);
                  return existing
                    ? current.map(line => line.producto_id === Number(product.id) && line.tipo_precio === priceType ? { ...line, cantidad: line.cantidad + currentQuantity } : line)
                    : [...current, { producto_id: Number(product.id), cantidad: currentQuantity, tipo_precio: priceType }];
                });
                setValue('cantidad', '1');
                setError('');
              }}>
                <View style={styles.flex}><Text style={styles.productName}>{product.nombre}</Text><Text style={styles.productMeta}>Stock {product.stock} · {product.categoria || 'General'}</Text></View>
                <Text style={styles.productPrice}>S/ {productPrice(product, form.price_type || 'unidad').toFixed(2)}</Text>
                <Text style={styles.addMark}>＋</Text>
              </Pressable>
            ))}
            {products.length > 0 && products.every(product => Number(product.stock) <= 0) ? <Message>No hay productos con stock disponible.</Message> : null}
          </View>
          <View style={styles.cartHeader}><Text style={styles.label}>Detalle de venta</Text><Text style={styles.countPill}>{cart.reduce((total, line) => total + line.cantidad, 0)} uds.</Text></View>
          {cart.length ? cart.map((line, index) => {
            const product = products.find(item => Number(item.id) === line.producto_id);
            const unitPrice = productPrice(product, line.tipo_precio);
            return <View key={`${line.producto_id}-${index}`} style={styles.cartLine}>
              <View style={styles.flex}><Text style={styles.productName}>{product?.nombre || `Producto ${line.producto_id}`}</Text><Text style={styles.productMeta}>{line.cantidad} × S/ {unitPrice.toFixed(2)} · {humanize(line.tipo_precio)}</Text></View>
              <Text style={styles.productPrice}>S/ {(line.cantidad * unitPrice).toFixed(2)}</Text>
              <Pressable accessibilityRole="button" onPress={() => setCart(current => current.filter((_, lineIndex) => lineIndex !== index))}><Text style={styles.removeText}>Quitar</Text></Pressable>
            </View>;
          }) : <Text style={styles.emptyText}>Todavía no agregas productos.</Text>}
          {cart.length ? <View style={styles.totalRow}><Text style={styles.totalLabel}>Total estimado</Text><Text style={styles.totalValue}>S/ {cart.reduce((total, line) => total + line.cantidad * productPrice(products.find(product => Number(product.id) === line.producto_id), line.tipo_precio), 0).toFixed(2)}</Text></View> : null}
          <Text style={styles.label}>Condición de pago</Text>
          <View style={styles.choiceRow}>
            {(['contado', 'credito'] as const).map(condition => <Choice key={condition} label={condition === 'contado' ? 'Contado' : 'Crédito'} selected={(form.condicion_pago || 'contado') === condition} onPress={() => setValue('condicion_pago', condition)} />)}
          </View>
          {(form.condicion_pago || 'contado') === 'credito' ? <Field label="Fecha de vencimiento" value={form.fecha_vencimiento || ''} onChangeText={value => setValue('fecha_vencimiento', value)} placeholder="AAAA-MM-DD" /> : null}
          <Button title={busy ? 'Emitiendo…' : 'Emitir comprobante'} onPress={() => {
            if (!selectedCustomer) return setError('Selecciona un cliente.');
            if (!cart.length) return setError('Agrega al menos un producto.');
            const tipo = (form.tipo || 'boleta').toLowerCase();
            if (!['boleta', 'factura'].includes(tipo)) return setError('Por ahora elige boleta o factura.');
            if (!can(`comprobantes:crear_${tipo}`)) return setError(`Tu rol no puede crear ${tipo}s.`);
            if ((form.condicion_pago || 'contado') === 'credito' && !form.fecha_vencimiento) return setError('Indica la fecha de vencimiento.');
            void submit({ tipo, cliente_id: Number(selectedCustomer.id), condicion_pago: form.condicion_pago || 'contado', fecha_vencimiento: form.fecha_vencimiento || null, items: cart }, '/comprobantes');
          }} disabled={busy} />
        </Card>
      ) : moduleName === 'ventas' ? <Card><Text style={styles.emptyTitle}>Solo consulta</Text><Text style={styles.emptyText}>Tu cuenta no tiene permiso para emitir comprobantes desde la app.</Text></Card> : null}
      {moduleName === 'clientes' ? (
        <FormCard title={editingId ? 'Editar cliente' : 'Registrar cliente'} visible={canCreate || Boolean(editingId)}>
          <Field label="Nombre o razón social" value={form.nombre || ''} onChangeText={value => setValue('nombre', value)} />
          <Field label="Documento" value={form.documento || ''} onChangeText={value => setValue('documento', value)} keyboardType="number-pad" />
          <Field label="Tipo de documento (DNI, RUC o CE)" value={form.tipo_documento || 'DNI'} onChangeText={value => setValue('tipo_documento', value.toUpperCase())} autoCapitalize="characters" />
          <Field label="Teléfono" value={form.telefono || ''} onChangeText={value => setValue('telefono', value)} keyboardType="phone-pad" />
          <Field label="Correo" value={form.email || ''} onChangeText={value => setValue('email', value)} keyboardType="email-address" autoCapitalize="none" />
          <Field label="Dirección" value={form.direccion || ''} onChangeText={value => setValue('direccion', value)} />
          <Button title={busy ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Guardar cliente'} onPress={() => {
            if (!form.nombre?.trim()) return setError('El nombre del cliente es obligatorio.');
            if (!['DNI', 'RUC', 'CE'].includes(form.tipo_documento || 'DNI')) return setError('Selecciona DNI, RUC o CE como tipo de documento.');
            void submit({ ...form }, editingId ? `/clientes/${editingId}` : '/clientes', editingId ? 'PUT' : 'POST');
          }} disabled={busy || !form.nombre?.trim()} />
          {editingId ? <Button title="Cancelar edición" secondary onPress={() => { setEditingId(null); setForm({}); }} /> : null}
        </FormCard>
      ) : null}
      {moduleName === 'productos' ? (
        <FormCard title={editingId ? 'Editar producto' : 'Registrar producto'} visible={canCreate || Boolean(editingId)}>
          <Field label="Nombre" value={form.nombre || ''} onChangeText={value => setValue('nombre', value)} />
          <Field label="Descripción" value={form.descripcion || ''} onChangeText={value => setValue('descripcion', value)} />
          <Field label="Código interno" value={form.codigo_interno || ''} onChangeText={value => setValue('codigo_interno', value)} autoCapitalize="characters" />
          <Field label="Precio de venta" value={form.precio || ''} onChangeText={value => setValue('precio', value)} keyboardType="decimal-pad" />
          <Field label="Precio rebaja" value={form.precio_rebaja || form.precio || ''} onChangeText={value => setValue('precio_rebaja', value)} keyboardType="decimal-pad" />
          <Field label="Precio pase" value={form.precio_pase || form.precio || ''} onChangeText={value => setValue('precio_pase', value)} keyboardType="decimal-pad" />
          <Field label="Precio de compra" value={form.precio_compra || '0'} onChangeText={value => setValue('precio_compra', value)} keyboardType="decimal-pad" />
          <Field label="Stock" value={form.stock || '0'} onChangeText={value => setValue('stock', value)} keyboardType="number-pad" />
          <Field label="Stock mínimo" value={form.stock_minimo || '0'} onChangeText={value => setValue('stock_minimo', value)} keyboardType="number-pad" />
          <Field label="Categoría" value={form.categoria || ''} onChangeText={value => setValue('categoria', value)} />
          <Button title={busy ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Guardar producto'} onPress={() => {
            const precio = Number(form.precio);
            const stock = Number(form.stock || 0);
            const stockMinimo = Number(form.stock_minimo || 0);
            if (!form.nombre?.trim() || !Number.isFinite(precio) || precio <= 0) return setError('Indica un nombre y un precio válido.');
            if (!Number.isSafeInteger(stock) || stock < 0 || !Number.isSafeInteger(stockMinimo) || stockMinimo < 0) return setError('El stock y el stock mínimo deben ser enteros no negativos.');
            void submit({
              ...form,
              precio,
              precio_rebaja: Number(form.precio_rebaja || precio),
              precio_pase: Number(form.precio_pase || precio),
              precio_compra: Number(form.precio_compra || 0),
              stock,
              stock_minimo: stockMinimo,
              stock_maximo: Number(form.stock_maximo || 0),
            }, editingId ? `/productos/${editingId}` : '/productos', editingId ? 'PUT' : 'POST');
          }} disabled={busy} />
          {editingId ? <Button title="Cancelar edición" secondary onPress={() => { setEditingId(null); setForm({}); }} /> : null}
        </FormCard>
      ) : null}
      {moduleName === 'compras' ? (
        <FormCard title="Registrar compra" visible={canCreate}>
          <Field label="RUC o documento del proveedor" value={form.proveedor_documento || ''} onChangeText={value => setValue('proveedor_documento', value)} keyboardType="number-pad" />
          <Field label="Razón social del proveedor" value={form.proveedor_razon_social || ''} onChangeText={value => setValue('proveedor_razon_social', value)} />
          <Field label="Número del documento" value={form.numero || ''} onChangeText={value => setValue('numero', value)} />
          <Text style={styles.label}>Tipo de documento</Text>
          <View style={styles.choiceRow}>
            {(['factura', 'guia'] as const).map(type => <Choice key={type} label={type === 'factura' ? 'Factura' : 'Guía'} selected={(form.tipo || 'factura') === type} onPress={() => setValue('tipo', type)} />)}
          </View>
          <Field label="Buscar producto" value={productSearch} onChangeText={setProductSearch} placeholder="Nombre, categoría o código" autoCapitalize="none" />
          <Field label="Cantidad para agregar" value={form.cantidad || '1'} onChangeText={value => setValue('cantidad', value)} keyboardType="number-pad" />
          <Field label="Costo unitario" value={form.costo_unitario || ''} onChangeText={value => setValue('costo_unitario', value)} keyboardType="decimal-pad" />
          <View style={styles.selectionList}>
            {products.filter(product => `${product.nombre} ${product.categoria || ''} ${product.codigo_interno || ''}`.toLocaleLowerCase('es').includes(productSearch.trim().toLocaleLowerCase('es'))).slice(0, 8).map(product => (
              <Pressable key={product.id} style={styles.productOption} onPress={() => {
                const quantity = Number(form.cantidad || 1);
                const cost = Number(form.costo_unitario || product.precio_compra || 0);
                if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(cost) || cost < 0) return setError('Revisa la cantidad y el costo unitario.');
                setPurchaseCart(current => {
                  const existing = current.find(line => line.producto_id === Number(product.id));
                  return existing
                    ? current.map(line => line.producto_id === Number(product.id) ? { ...line, cantidad: line.cantidad + quantity, costo_unitario: cost } : line)
                    : [...current, { producto_id: Number(product.id), cantidad: quantity, costo_unitario: cost }];
                });
                setForm(current => ({ ...current, cantidad: '1', costo_unitario: '' }));
                setError('');
              }}>
                <View style={styles.flex}><Text style={styles.productName}>{product.nombre}</Text><Text style={styles.productMeta}>Stock actual {product.stock} · S/ {Number(product.precio_compra || 0).toFixed(2)} costo</Text></View>
                <Text style={styles.addMark}>＋</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>Productos de la compra ({purchaseCart.length})</Text>
          {purchaseCart.length ? purchaseCart.map((line, index) => {
            const product = products.find(item => Number(item.id) === line.producto_id);
            return <View key={`${line.producto_id}-${index}`} style={styles.cartLine}>
              <View style={styles.flex}><Text style={styles.productName}>{product?.nombre || `Producto ${line.producto_id}`}</Text><Text style={styles.productMeta}>{line.cantidad} × S/ {line.costo_unitario.toFixed(2)}</Text></View>
              <Text style={styles.productPrice}>S/ {(line.cantidad * line.costo_unitario).toFixed(2)}</Text>
              <Pressable accessibilityRole="button" onPress={() => setPurchaseCart(current => current.filter((_, lineIndex) => lineIndex !== index))}><Text style={styles.removeText}>Quitar</Text></Pressable>
            </View>;
          }) : <Text style={styles.emptyText}>Agrega al menos un producto para registrar la compra.</Text>}
          <Text style={styles.label}>Condición de pago</Text>
          <View style={styles.choiceRow}>
            {(['contado', 'credito'] as const).map(condition => <Choice key={condition} label={condition === 'contado' ? 'Contado' : 'Crédito'} selected={(form.condicion_pago || 'contado') === condition} onPress={() => setValue('condicion_pago', condition)} />)}
          </View>
          <Button title="Guardar compra" onPress={() => {
            if (!form.proveedor_documento?.trim() || !form.proveedor_razon_social?.trim()) return setError('Completa el documento y la razón social del proveedor.');
            if (!purchaseCart.length) return setError('Agrega al menos un producto a la compra.');
            if (!['contado', 'credito'].includes(form.condicion_pago || 'contado')) return setError('Selecciona contado o crédito.');
            void submit({ ...form, tipo: form.tipo || 'factura', items: purchaseCart }, '/compras');
          }} disabled={busy} />
        </FormCard>
      ) : null}
      {moduleName === 'usuarios' ? (
        <FormCard title="Crear usuario" visible={canCreate}>
          <Field label="Nombre" value={form.nombre || ''} onChangeText={value => setValue('nombre', value)} />
          <Field label="Correo" value={form.email || ''} onChangeText={value => setValue('email', value)} keyboardType="email-address" autoCapitalize="none" />
          <Field label="Contraseña (mínimo 12 caracteres)" value={form.password || ''} onChangeText={value => setValue('password', value)} secureTextEntry />
          <Text style={styles.label}>Rol</Text>
          <View style={styles.choiceRow}>
            {(['vendedor', 'admin'] as const).map(role => <Choice key={role} label={role === 'admin' ? 'Administrador' : 'Vendedor'} selected={(form.rol || 'vendedor') === role} onPress={() => setValue('rol', role)} />)}
          </View>
          <Button title="Crear usuario" onPress={() => {
            if (!form.nombre || !form.email || (form.password || '').length < 12) return setError('Completa los datos; la contraseña debe tener al menos 12 caracteres.');
            void submit({ ...form }, '/auth/usuarios');
          }} disabled={busy} />
        </FormCard>
      ) : null}
      {moduleName === 'inventario' && can('inventario:gestionar') ? (
        <>
          <FormCard title="Registrar movimiento" visible>
            <Text style={styles.label}>Tipo de movimiento</Text>
            <View style={styles.choiceRow}>
              {(['ENTRADA', 'SALIDA', 'AJUSTE'] as const).map(type => <Choice key={type} label={humanize(type)} selected={(form.movimiento_tipo || 'ENTRADA') === type} onPress={() => setValue('movimiento_tipo', type)} />)}
            </View>
            <Field label="Buscar producto" value={productSearch} onChangeText={setProductSearch} placeholder="Nombre o código" autoCapitalize="none" />
            <View style={styles.selectionList}>
              {products.filter(product => `${product.nombre} ${product.codigo_interno || ''}`.toLocaleLowerCase('es').includes(productSearch.trim().toLocaleLowerCase('es'))).slice(0, 8).map(product => (
                <Choice key={product.id} label={`${product.nombre} · Stock ${product.stock}`} selected={selectedProduct?.id === product.id} onPress={() => setSelectedProduct(product)} />
              ))}
            </View>
            <Field label="Cantidad (usa negativo para disminuir un ajuste)" value={form.movimiento_cantidad || ''} onChangeText={value => setValue('movimiento_cantidad', value)} keyboardType="numbers-and-punctuation" />
            <Text style={styles.label}>Almacén</Text>
            <View style={styles.selectionList}>
              {warehouses.map(warehouse => <Choice key={warehouse.id} label={`${warehouse.nombre} · ${warehouse.codigo}`} selected={form.almacen_id === String(warehouse.id)} onPress={() => setValue('almacen_id', String(warehouse.id))} />)}
              {!warehouses.length ? <Message>Crea un almacén para poder registrar movimientos.</Message> : null}
            </View>
            <Field label="Observación (opcional)" value={form.observacion || ''} onChangeText={value => setValue('observacion', value)} />
            <Button title={busy ? 'Guardando…' : 'Registrar movimiento'} onPress={() => {
              const quantity = Number(form.movimiento_cantidad);
              if (!selectedProduct) return setError('Selecciona un producto.');
              if (!Number.isInteger(quantity) || quantity === 0) return setError('La cantidad debe ser un entero distinto de cero.');
              if (!form.almacen_id) return setError('Selecciona un almacén.');
              const type = form.movimiento_tipo || 'ENTRADA';
              if (type !== 'AJUSTE' && quantity < 0) return setError('Para entradas y salidas, ingresa una cantidad positiva.');
              void submit({ tipo: type, producto_id: Number(selectedProduct.id), cantidad: quantity, almacen_id: Number(form.almacen_id), observacion: form.observacion || '' }, '/inventario/movimientos');
            }} disabled={busy || !warehouses.length} />
          </FormCard>
          <FormCard title="Crear almacén" visible>
            <Field label="Nombre" value={form.almacen_nombre || ''} onChangeText={value => setValue('almacen_nombre', value)} placeholder="Almacén principal" />
            <Field label="Código" value={form.almacen_codigo || ''} onChangeText={value => setValue('almacen_codigo', value.toUpperCase())} autoCapitalize="characters" placeholder="ALM-01" />
            <Button title="Guardar almacén" secondary onPress={() => {
              if (!form.almacen_nombre?.trim() || !form.almacen_codigo?.trim()) return setError('Completa el nombre y código del almacén.');
              void submit({ nombre: form.almacen_nombre, codigo: form.almacen_codigo }, '/inventario/almacenes');
            }} disabled={busy} />
          </FormCard>
        </>
      ) : null}
      {moduleName === 'comprobantes' && paymentId ? (
        <FormCard title="Registrar cobro" visible>
          <Field label="Monto recibido (S/)" value={form.payment_amount || ''} onChangeText={value => setValue('payment_amount', value)} keyboardType="decimal-pad" />
          <Text style={styles.label}>Método de pago</Text>
          <View style={styles.choiceRow}>
            {(['efectivo', 'transferencia', 'tarjeta', 'yape', 'bcp', 'otro'] as const).map(method => <Choice key={method} label={humanize(method)} selected={(form.payment_method || 'efectivo') === method} onPress={() => setValue('payment_method', method)} />)}
          </View>
          <Field label="Referencia (opcional)" value={form.payment_reference || ''} onChangeText={value => setValue('payment_reference', value)} />
          <Button title={busy ? 'Guardando…' : 'Confirmar cobro'} onPress={() => {
            const amount = Number(form.payment_amount);
            if (!Number.isFinite(amount) || amount <= 0) return setError('Ingresa un monto válido.');
            void submit({ monto: amount, fecha_pago: localDateString(), metodo_pago: form.payment_method || 'efectivo', referencia: form.payment_reference || '' }, `/comprobantes/${paymentId}/pagos`);
          }} disabled={busy} />
          <Button title="Cancelar" secondary onPress={() => { setPaymentId(null); setForm({}); }} />
        </FormCard>
      ) : null}
      {summary && moduleName === 'reportes' ? (
        <View style={styles.statsGrid}>
          <SummaryMetric label="Ventas hoy" value={`S/ ${Number(summary.ventas_hoy || 0).toFixed(2)}`} />
          <SummaryMetric label="Ventas del mes" value={`S/ ${Number(summary.ventas_mes || 0).toFixed(2)}`} />
          <SummaryMetric label="Clientes" value={summary.clientes || 0} />
          <SummaryMetric label="Productos" value={summary.productos || 0} />
          <SummaryMetric label="Stock bajo" value={summary.productos_stock_bajo || 0} />
          <SummaryMetric label="Por cobrar" value={`S/ ${Number(summary.por_cobrar_credito || 0).toFixed(2)}`} />
        </View>
      ) : null}
      {summary && moduleName === 'inventario' ? (
        <>
          <View style={styles.statsGrid}>
            <SummaryMetric label="Productos" value={summary.total_productos || 0} />
            <SummaryMetric label="Unidades en stock" value={summary.stock_total || 0} />
            <SummaryMetric label="Valor del inventario" value={`S/ ${Number(summary.valor_total || 0).toFixed(2)}`} />
          </View>
          {Array.isArray(summary.por_almacen) && summary.por_almacen.map((warehouse: Item) => (
            <View key={warehouse.almacen_id} style={styles.warehouseCard}>
              <Text style={styles.productName}>{warehouse.almacen_nombre}</Text>
              <Text style={styles.productMeta}>{warehouse.total_stock} unidades · S/ {Number(warehouse.total_valor || 0).toFixed(2)}</Text>
            </View>
          ))}
        </>
      ) : null}
      {moduleName === 'ventas' ? null : (
        <>
          <View style={styles.recordsHeader}>
            <View style={styles.flex}><Text style={styles.sectionEyebrow}>{moduleName === 'reportes' ? 'ATENCIÓN' : 'REGISTROS'}</Text><Text style={styles.recordsTitle}>{moduleName === 'reportes' ? 'Alertas de stock' : titles[moduleName]}</Text></View>
            <Text style={styles.countPill}>{loading ? '…' : `${visibleData.length}`}</Text>
          </View>
          {moduleName !== 'inventario' && moduleName !== 'reportes' ? <Field label="Buscar" value={search} onChangeText={setSearch} placeholder="Filtra por nombre, documento o estado" autoCapitalize="none" /> : null}
          {loading ? <Card><Message>Cargando información…</Message></Card> : null}
          {!loading && visibleData.length === 0 ? <Card><Text style={styles.emptyTitle}>No encontramos registros</Text><Text style={styles.emptyText}>{search ? 'Prueba con otro término de búsqueda.' : 'Cuando haya información disponible aparecerá aquí.'}</Text></Card> : null}
          {!loading && visibleData.map((item, index) => (
            <ItemCard
              key={item.id ?? index}
              item={item}
              onEdit={canEdit ? () => {
                setEditingId(Number(item.id));
                setForm(Object.fromEntries(Object.entries(item).filter(([, value]) => value !== null && value !== undefined && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')).map(([key, value]) => [key, String(value)])));
                setError('');
              } : undefined}
              onDelete={moduleName === 'usuarios' && can('usuarios:administrar')
                ? () => confirmDelete(`¿Eliminar el usuario ${item.nombre || ''}?`, `/auth/usuarios/${item.id}`)
                : canDelete
                  ? () => confirmDelete(`¿Eliminar ${moduleName === 'clientes' ? 'el cliente' : 'el producto'} ${item.nombre || ''}?`, `/${moduleName}/${item.id}`)
                  : undefined}
              onPay={moduleName === 'comprobantes' && can('comprobantes:pagar') && item.condicion_pago === 'credito' && ['emitido', 'parcial'].includes(String(item.estado)) && Number(item.saldo_pendiente) > 0
                ? () => { setPaymentId(Number(item.id)); setForm({ payment_method: 'efectivo' }); setError(''); }
                : undefined}
            />
          ))}
        </>
      )}
      <Button title={loading ? 'Cargando…' : 'Actualizar'} secondary onPress={() => { setLoading(true); void load(); }} disabled={loading} />
      <Button title="Volver al panel" secondary onPress={() => router.replace('/(tabs)')} />
    </Page>
  );
}

function FormCard({ title, visible, children }: { title: string; visible: boolean; children: ReactNode }) {
  return visible ? <Card><View style={styles.sectionHeader}><View style={styles.sectionMark}><Text style={styles.sectionMarkText}>＋</Text></View><Text style={styles.cardTitle}>{title}</Text></View>{children}</Card> : null;
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.choice, selected && styles.choiceSelected]}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text></Pressable>;
}

function ItemCard({ item, onEdit, onDelete, onPay }: { item: Item; onEdit?: () => void; onDelete?: () => void; onPay?: () => void }) {
  const receiptNumber = item.serie && item.numero ? `${item.serie}-${item.numero}` : item.numero;
  const title = String(item.nombre || item.proveedor_razon_social || receiptNumber || item.producto_nombre || `Registro #${item.id ?? ''}`);
  const subtitle = [item.documento, item.proveedor_documento, item.email, item.categoria, item.tipo, item.rol].filter(Boolean).map(String).join(' · ');
  const details = Object.entries(item)
    .filter(([key, value]) => !['id', 'nombre', 'proveedor_razon_social', 'numero', 'producto_nombre', 'documento', 'email', 'categoria', 'tipo', 'rol', 'permisos', 'items', 'pagos', 'detalle', 'data'].includes(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
    .slice(0, 3);
  return (
    <Card>
      <View style={styles.recordTop}>
        <View style={styles.flex}><Text style={styles.recordTitle}>{title}</Text>{subtitle ? <Text style={styles.recordSubtitle}>{subtitle}</Text> : null}</View>
        {item.stock !== undefined ? <Text style={styles.stockPill}>{`Stock ${item.stock}`}</Text> : null}
      </View>
      {details.length ? <View style={styles.recordDetails}>{details.map(([key, value]) => <View key={key} style={styles.recordDetail}><Text style={styles.detailLabel}>{humanize(key)}</Text><Text numberOfLines={2} style={styles.detailValue}>{String(value)}</Text></View>)}</View> : null}
      {item.items?.length ? <Text style={styles.productMeta}>{item.items.length} producto(s) · S/ {Number(item.importe_estimado_pen || 0).toFixed(2)}</Text> : null}
      {item.cliente_nombre ? <Text style={styles.productMeta}>Cliente: {item.cliente_nombre}</Text> : null}
      {item.saldo_pendiente !== undefined && Number(item.saldo_pendiente) > 0 ? <Text style={styles.balanceText}>Saldo pendiente · S/ {Number(item.saldo_pendiente).toFixed(2)}</Text> : null}
      {onEdit || onDelete || onPay ? <View style={styles.recordActions}>{onEdit ? <Pressable accessibilityRole="button" onPress={onEdit} style={styles.actionButton}><Text style={styles.actionText}>Editar</Text></Pressable> : null}{onPay ? <Pressable accessibilityRole="button" onPress={onPay} style={styles.actionButton}><Text style={styles.actionText}>Registrar cobro</Text></Pressable> : null}{onDelete ? <Pressable accessibilityRole="button" onPress={onDelete} style={[styles.actionButton, styles.deleteAction]}><Text style={styles.deleteText}>Eliminar</Text></Pressable> : null}</View> : null}
    </Card>
  );
}

function humanize(value: string) {
  return value.replaceAll('_', ' ').replace(/^\w/, letter => letter.toUpperCase());
}

function isItem(value: unknown): value is Item {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireItems(value: unknown, label: string): Item[] {
  if (!Array.isArray(value) || !value.every(isItem)) {
    throw new ApiError(`El servidor devolvió una lista inválida para ${label}.`, 0);
  }
  return value;
}

function requireList(response: ApiList, label: string): Item[] {
  return requireItems(response?.data, label);
}

function productPrice(product: Item | undefined, type: string) {
  const field = type === 'rebaja' ? 'precio_rebaja' : type === 'pase' ? 'precio_pase' : 'precio';
  return Number(product?.[field] ?? product?.precio ?? 0);
}

function localDateString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function SummaryMetric({ label, value }: { label: string; value: string | number }) {
  return <View style={styles.summaryMetric}><Text style={styles.metricLabel}>{label}</Text><Text numberOfLines={1} style={styles.metricValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionMark: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  sectionMarkText: { color: colors.primaryStrong, fontSize: 19, fontWeight: '600' },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: colors.muted, fontSize: 11, marginTop: 2 },
  label: { color: '#52675a', fontSize: 12, fontWeight: '600' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 40, paddingVertical: 10, paddingHorizontal: 13, borderRadius: 9, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, justifyContent: 'center' },
  choiceSelected: { borderColor: colors.primary, backgroundColor: colors.accentSoft },
  choiceText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  choiceTextSelected: { color: colors.primaryStrong },
  selectionList: { gap: 7 },
  productOption: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  productName: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  productMeta: { color: colors.muted, fontSize: 10, marginTop: 3 },
  productPrice: { color: colors.primaryStrong, fontSize: 12, fontWeight: '700' },
  addMark: { color: colors.primary, fontSize: 20, fontWeight: '600' },
  selectedPill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, borderRadius: 9, backgroundColor: colors.accentSoft },
  selectedText: { color: colors.primaryStrong, fontSize: 12, fontWeight: '600' },
  removeText: { color: colors.danger, fontSize: 11, fontWeight: '700' },
  cartHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  countPill: { overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, backgroundColor: colors.accentSoft, color: colors.primaryStrong, fontSize: 10, fontWeight: '700' },
  cartLine: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  emptyText: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 13, borderRadius: 10, backgroundColor: '#f8faf8' },
  totalLabel: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  totalValue: { color: colors.primaryStrong, fontSize: 17, fontWeight: '700' },
  recordsHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 3 },
  sectionEyebrow: { color: colors.primary, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  recordsTitle: { color: colors.ink, fontSize: 19, fontWeight: '700', marginTop: 3 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  summaryMetric: { width: '47%', minHeight: 82, justifyContent: 'center', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  metricLabel: { color: colors.muted, fontSize: 10, fontWeight: '600', marginBottom: 7 },
  metricValue: { color: colors.primaryStrong, fontSize: 18, fontWeight: '700' },
  warehouseCard: { padding: 13, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  emptyTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  recordTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  recordTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  recordSubtitle: { color: colors.muted, fontSize: 11, marginTop: 4 },
  balanceText: { color: '#a7771d', fontSize: 11, fontWeight: '700' },
  stockPill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20, backgroundColor: colors.accentSoft, color: colors.primaryStrong, fontSize: 10, fontWeight: '700' },
  recordDetails: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recordDetail: { minWidth: '45%', flex: 1, padding: 9, borderRadius: 8, backgroundColor: '#f8faf8' },
  detailLabel: { color: colors.muted, fontSize: 9 },
  detailValue: { color: colors.ink, fontSize: 11, fontWeight: '600', marginTop: 3 },
  recordActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  actionButton: { flexGrow: 1, minHeight: 44, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.accentSoft },
  actionText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  deleteAction: { backgroundColor: colors.dangerSoft },
  deleteText: { color: colors.danger, fontSize: 11, fontWeight: '700' },
});
