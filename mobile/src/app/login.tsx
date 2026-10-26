import { useState } from 'react';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Button, Card, Field, Heading, Message, Page, colors } from '../components/ui';

export default function Login() {
  const { baseUrl, authError, setServerUrl, signIn } = useAuth();
  const [url, setUrl] = useState(baseUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    setBusy(true);
    try {
      await signIn(url, email.trim(), password);
      router.replace('/(tabs)');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo iniciar sesión.');
    } finally {
      setBusy(false);
    }
  }

  async function saveUrl() {
    setError('');
    try {
      await setServerUrl(url);
      setError('Dirección guardada. Ahora puedes iniciar sesión.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No se pudo guardar la dirección del servidor.');
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Page>
        <View style={{ gap: 10, marginBottom: 4 }}>
          <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: colors.primaryStrong, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.accent, fontSize: 23, fontWeight: '700' }}>F</Text>
          </View>
          <Heading title="FacturaPro" subtitle="Accede a tu espacio de trabajo." />
        </View>
        <Card>
          <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 17 }}>Conexión con tu servidor</Text>
          <Field label="URL del servidor" value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" placeholder="http://192.168.1.10:3000" />
          <Message>Usa la IP local de tu computadora y el puerto de la API. Ambos dispositivos deben estar en la misma Wi-Fi.</Message>
          <Button title="Guardar dirección" secondary onPress={saveUrl} />
        </Card>
        <Card>
          <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 17 }}>Iniciar sesión</Text>
          <Field label="Correo electrónico" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="nombre@empresa.com" />
          <Field label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" placeholder="Ingresa tu contraseña" />
          {authError ? <Message error>{authError}</Message> : null}
          {error ? <Message error={error.includes('No se pudo') || error.includes('contraseña') || error.includes('conectar')}>{error}</Message> : null}
          <Button title="Ingresar" onPress={submit} disabled={busy} />
        </Card>
      </Page>
    </KeyboardAvoidingView>
  );
}
