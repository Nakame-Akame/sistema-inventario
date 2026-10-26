import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const BASE_URL_KEY = 'facturapro-api-url';
const COOKIE_KEY = 'facturapro-session-cookie';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function normalizeBaseUrl(value: string) {
  const normalized = value.trim().replace(/\/+$/, '').replace(/\/api$/i, '');
  if (!normalized) return '';

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new ApiError('Ingresa una dirección válida, por ejemplo http://192.168.1.10:3000.', 0);
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new ApiError('La dirección debe usar HTTP o HTTPS y no incluir rutas adicionales.', 0);
  }
  return normalized;
}

export async function getSavedBaseUrl() {
  return (await AsyncStorage.getItem(BASE_URL_KEY)) || '';
}

export async function saveBaseUrl(value: string) {
  const baseUrl = normalizeBaseUrl(value);
  await AsyncStorage.setItem(BASE_URL_KEY, baseUrl);
  return baseUrl;
}

export async function clearSessionCookie() {
  await SecureStore.deleteItemAsync(COOKIE_KEY);
}

type ApiOptions = RequestInit & { json?: unknown };
const REQUEST_TIMEOUT_MS = 20_000;

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const baseUrl = await getSavedBaseUrl();
  if (!baseUrl) {
    throw new ApiError('Configura la dirección del servidor antes de continuar.', 0);
  }

  const cookie = await SecureStore.getItemAsync(COOKIE_KEY);
  const headers = new Headers(options.headers);
  if (options.json !== undefined) headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', cookie);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const externalSignal = options.signal;
  const abortRequest = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener('abort', abortRequest, { once: true });

  let response: Response;
  let responseText: string;
  try {
    response = await fetch(`${baseUrl}/api${path}`, {
      ...options,
      credentials: 'include',
      signal: controller.signal,
      headers,
      body: options.json === undefined ? options.body : JSON.stringify(options.json),
    });
    responseText = await response.text();
  } catch (cause) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new ApiError('El servidor tardó demasiado en responder. Comprueba la conexión e inténtalo de nuevo.', 0);
    }
    if (externalSignal?.aborted) throw new ApiError('La solicitud fue cancelada.', 0);
    if (cause instanceof Error && cause.name !== 'TypeError') throw cause;
    throw new ApiError(`No se pudo conectar con ${baseUrl}. Revisa la IP, el puerto y la red Wi-Fi.`, 0);
  } finally {
    externalSignal?.removeEventListener('abort', abortRequest);
    clearTimeout(timeout);
  }

  const setCookie = response.headers.get('set-cookie');
  const sessionMatch = setCookie?.match(/(?:^|,\s*)connect\.sid=([^;,\s]+)/i);
  if (sessionMatch) {
    await SecureStore.setItemAsync(COOKIE_KEY, `connect.sid=${sessionMatch[1]}`);
  }

  let parsed: unknown;
  try {
    parsed = responseText ? JSON.parse(responseText) : {};
  } catch {
    if (!response.ok) {
      if (response.status === 401) await clearSessionCookie();
      throw new ApiError(`Error del servidor (${response.status}).`, response.status);
    }
    throw new ApiError('El servidor devolvió una respuesta inválida. Inténtalo de nuevo.', response.status);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    if (!response.ok) {
      if (response.status === 401) await clearSessionCookie();
      throw new ApiError(`Error del servidor (${response.status}).`, response.status);
    }
    throw new ApiError('El servidor devolvió una respuesta inválida. Inténtalo de nuevo.', response.status);
  }
  const body = parsed as { ok?: boolean; error?: string; message?: string } & T;

  if (!response.ok || body.ok === false) {
    if (response.status === 401) await clearSessionCookie();
    throw new ApiError(body.error || body.message || `Error del servidor (${response.status}).`, response.status);
  }
  return body;
}
