import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { apiRequest, ApiError } from '../../lib/api';
import { Card, Heading, Message, Page, colors } from '../../components/ui';

const modules = [
  { id: 'ventas', title: 'Ventas', permission: 'comprobantes:ver', icon: '↗', detail: 'Registrar operaciones' },
  { id: 'comprobantes', title: 'Comprobantes', permission: 'comprobantes:ver', icon: '▤', detail: 'Facturas y boletas' },
  { id: 'clientes', title: 'Clientes', permission: 'clientes:ver', icon: '◎', detail: 'Cartera de clientes' },
  { id: 'productos', title: 'Productos', permission: 'productos:ver', icon: '◇', detail: 'Catálogo e inventario' },
  { id: 'compras', title: 'Compras', permission: 'compras:ver', icon: '▣', detail: 'Compras y proveedores' },
  { id: 'reportes', title: 'Reportes', permission: 'reportes:ver', icon: '⌁', detail: 'Indicadores del negocio' },
  { id: 'inventario', title: 'Inventario', permission: 'inventario:ver', icon: '▦', detail: 'Stock y almacenes' },
  { id: 'usuarios', title: 'Usuarios', permission: 'usuarios:administrar', icon: '＋', detail: 'Accesos del equipo' },
];

type Summary = { clientes: number; productos: number; facturas: number; ventas_hoy: number; ventas_mes: number; productos_stock_bajo: number; por_cobrar_credito: number };

export default function Dashboard() {
  const { user, can, signOut } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!can('reportes:ver')) return;
    let active = true;
    apiRequest<{ data: Summary }>('/reportes/resumen')
      .then(result => { if (active) setSummary(result.data); })
      .catch(cause => { if (active) setError(cause instanceof ApiError ? cause.message : 'No se pudo cargar el resumen.'); });
    return () => { active = false; };
  }, [can]);

  async function handleSignOut() {
    setSigningOut(true);
    let signOutError: unknown;
    try {
      await signOut();
    } catch (cause) {
      signOutError = cause;
    } finally {
      router.replace('/login');
      setSigningOut(false);
    }
    if (signOutError) {
      Alert.alert('Sesión cerrada en el dispositivo', signOutError instanceof Error ? signOutError.message : 'No se pudo confirmar la salida con el servidor.');
    }
  }

  return (
    <Page>
      <View style={styles.topline}>
        <View style={styles.brand}>
          <View style={styles.brandMark}><Text style={styles.brandLetter}>F</Text></View>
          <Text style={styles.brandName}>FacturaPro</Text>
        </View>
        <Pressable accessibilityRole="button" disabled={signingOut} onPress={() => { void handleSignOut(); }} style={styles.signOut}>
          <Text style={styles.signOutText}>{signingOut ? 'Saliendo…' : 'Salir'}</Text>
        </Pressable>
      </View>
      <View style={styles.intro}>
        <Text style={styles.eyebrow}>RESUMEN COMERCIAL</Text>
        <Heading title={`Hola, ${user?.nombre || 'usuario'}`} subtitle="Tu operación, de un vistazo." />
        <View style={styles.period}><View style={styles.statusDot} /><Text style={styles.periodText}>Actividad del mes</Text></View>
      </View>
      {summary ? (
        <View style={styles.statsGrid}>
          <Metric label="Ventas hoy" value={`S/ ${Number(summary.ventas_hoy || 0).toFixed(2)}`} sub="IGV incluido" tone="blue" />
          <Metric label="Ventas del mes" value={`S/ ${Number(summary.ventas_mes || 0).toFixed(2)}`} sub="IGV incluido" tone="green" />
          <Metric label="Clientes" value={summary.clientes} sub="registrados" tone="blue" />
          <Metric label="Productos" value={summary.productos} sub="en catálogo" tone="green" />
          <Metric label="Stock bajo" value={summary.productos_stock_bajo} sub="productos ≤ 5 uds" tone="yellow" />
          <Metric label="Facturas totales" value={summary.facturas} sub="emitidas" tone="blue" />
          <Metric label="Por cobrar" value={`S/ ${Number(summary.por_cobrar_credito || 0).toFixed(2)}`} sub="créditos pendientes" tone="yellow" />
        </View>
      ) : error ? <Card><Message error>{error}</Message></Card> : null}
      <View style={styles.sectionIntro}>
        <Text style={styles.eyebrow}>GESTIÓN DEL NEGOCIO</Text>
        <Heading title="Accesos rápidos" subtitle="Las opciones disponibles dependen de tu cuenta." />
      </View>
      <View style={styles.moduleGrid}>
        {modules.filter(module => can(module.permission)).map(module => (
          <Pressable key={module.id} accessibilityRole="button" style={styles.moduleCard} onPress={() => router.push({ pathname: '/(tabs)/[module]', params: { module: module.id } })}>
            <View style={styles.moduleIcon}><Text style={styles.moduleIconText}>{module.icon}</Text></View>
            <Text style={styles.moduleTitle}>{module.title}</Text>
            <Text style={styles.moduleDetail}>{module.detail}</Text>
            <Text style={styles.moduleArrow}>Abrir  ›</Text>
          </Pressable>
        ))}
      </View>
    </Page>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string | number | undefined; sub: string; tone: 'blue' | 'green' | 'yellow' }) {
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricAccent, tone === 'green' && styles.metricAccentGreen, tone === 'yellow' && styles.metricAccentYellow]} />
      <Text style={styles.metricLabel}>{label}</Text>
      <Text numberOfLines={1} style={[styles.metricValue, tone === 'green' && styles.metricValueGreen, tone === 'yellow' && styles.metricValueYellow]}>{value ?? 0}</Text>
      <Text style={styles.metricSub}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  topline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMark: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.primaryStrong, alignItems: 'center', justifyContent: 'center' },
  brandLetter: { color: colors.accent, fontSize: 18, fontWeight: '700' },
  brandName: { color: colors.ink, fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
  signOut: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  signOutText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  intro: { gap: 7, marginTop: 8, marginBottom: 3 },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  period: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: '#d9e2d1', borderRadius: 20 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#8da749' },
  periodText: { color: '#53674a', fontSize: 10, fontWeight: '600' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  metricCard: { width: '47%', minHeight: 112, overflow: 'hidden', padding: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.white, justifyContent: 'center' },
  metricAccent: { position: 'absolute', left: 0, top: 14, width: 3, height: 24, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: '#5c8291' },
  metricAccentGreen: { backgroundColor: colors.primary },
  metricAccentYellow: { backgroundColor: '#bd8b2d' },
  metricLabel: { color: colors.muted, fontSize: 10, fontWeight: '600', marginBottom: 8 },
  metricValue: { color: '#2d5b49', fontSize: 20, fontWeight: '700' },
  metricValueGreen: { color: '#758f32' },
  metricValueYellow: { color: '#a7771d' },
  metricSub: { color: '#9aa49d', fontSize: 9, marginTop: 5 },
  sectionIntro: { gap: 5, marginTop: 7 },
  moduleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  moduleCard: { width: '47%', minHeight: 136, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, justifyContent: 'space-between' },
  moduleIcon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.accentSoft },
  moduleIconText: { color: colors.primaryStrong, fontSize: 19, fontWeight: '600' },
  moduleTitle: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 8 },
  moduleDetail: { color: colors.muted, fontSize: 10, marginTop: 3 },
  moduleArrow: { color: colors.primary, fontSize: 11, fontWeight: '700', marginTop: 10 },
});
