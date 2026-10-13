/**
 * Web Push helpers (staff notifications). The browser keeps the subscription; the server only stores the
 * endpoint + keys for the signed-in user. Every entry point degrades gracefully when unsupported.
 */
import { api } from '@/lib/api';

export type PushPermission = NotificationPermission | 'unsupported';

/** VAPID public keys are URL-safe base64; PushManager wants the raw bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushPermission(): PushPermission {
  return pushSupported() ? Notification.permission : 'unsupported';
}

/** The app registers /sw.js on load in production; in development (or before load) register it on demand. */
export async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function fetchPushConfig() {
  return api.get<{ enabled: boolean; publicKey: string | null }>('/notifications/push/public-key');
}

/** Asks for permission, subscribes this device and registers it with the server. */
export async function enablePush(publicKey: string): Promise<PushSubscription> {
  if (!pushSupported()) throw new Error('unsupported');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('denied');
  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  await api.post('/notifications/push/subscribe', sub.toJSON());
  return sub;
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  await api.request('/notifications/push/subscribe', { method: 'DELETE', body: { endpoint } });
}
