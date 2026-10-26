// Kopia kontaktów na tym urządzeniu – do wysyłki, gdy serwer albo baza danych nie działają.
// Szyfrowanie w przeglądarce (WebCrypto):
// - przy włączeniu powstaje para kluczy RSA; klucz prywatny jest zaszyfrowany kluczem z hasła do konta
//   (PBKDF2, 600 000 iteracji; hasło ma min. 12 znaków – krótkiego PIN-u nie używamy, bo dałoby się go odgadnąć),
// - każda synchronizacja szyfruje kontakty nowym kluczem AES, zaszyfrowanym kluczem publicznym – działa w tle, bez hasła,
// - odczyt wymaga hasła. Bez niego kopia w telefonie jest nieczytelna.
import { useEffect } from 'react';
import type { Directory, MeResponse, OfflineJournalEntry } from '@alert/shared';
import { api } from './api';

const DB_NAME = 'alert-offline';
const STORE = 'kv';
const PBKDF2_ITERATIONS = 600_000;
const SYNC_EVERY_MS = 15 * 60 * 1000;
export const CHANGE_EVENT = 'offline:change';

interface KeyRecord {
  userId: number;
  userName: string;
  publicKey: CryptoKey;
  wrappedPrivate: ArrayBuffer;
  salt: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  iterations: number;
}

interface CopyRecord {
  userId: number;
  syncedAt: string;
  people: number;
  schoolName: string | null;
  wrappedKey: ArrayBuffer;
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

export interface OfflineMeta {
  userId: number;
  userName: string;
  syncedAt: string | null;
  people: number;
  schoolName: string | null;
}

export interface OfflineData {
  directory: Directory;
  school: { name: string; smsName: string; senderName: string } | null;
  syncedAt: string;
}

/** WebCrypto działa tylko w bezpiecznym kontekście (HTTPS albo localhost). */
export function offlineSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && !!window.crypto?.subtle && typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

const get = <T>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
const put = (key: string, value: unknown) => tx('readwrite', (s) => s.put(value, key));
const del = (key: string) => tx('readwrite', (s) => s.delete(key));

function changed() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

async function passwordKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, [
    'wrapKey',
    'unwrapKey',
  ]);
}

export async function getMeta(): Promise<OfflineMeta | null> {
  if (!offlineSupported()) return null;
  try {
    const keys = await get<KeyRecord>('keys');
    if (!keys) return null;
    const copy = await get<CopyRecord>('copy');
    return {
      userId: keys.userId,
      userName: keys.userName,
      syncedAt: copy?.userId === keys.userId ? copy.syncedAt : null,
      people: copy?.userId === keys.userId ? copy.people : 0,
      schoolName: copy?.schoolName ?? null,
    };
  } catch {
    return null;
  }
}

/** Pobranie kontaktów z serwera i zaszyfrowanie ich na urządzeniu (bez hasła – kluczem publicznym). */
export async function syncOffline(userId: number): Promise<OfflineMeta | null> {
  const keys = await get<KeyRecord>('keys');
  if (!keys || keys.userId !== userId) return null;
  const res = await api.get<{ directory: Directory; school: OfflineData['school']; userId: number }>('/offline/directory');
  const syncedAt = new Date().toISOString();
  const payload: OfflineData = { directory: res.directory, school: res.school, syncedAt };
  const dataKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, new TextEncoder().encode(JSON.stringify(payload)));
  const wrappedKey = await crypto.subtle.wrapKey('raw', dataKey, keys.publicKey, { name: 'RSA-OAEP' });
  const copy: CopyRecord = {
    userId,
    syncedAt,
    people: res.directory.people.length,
    schoolName: res.school?.name ?? null,
    wrappedKey,
    iv,
    data,
  };
  await put('copy', copy);
  changed();
  return getMeta();
}

/** Włączenie kopii: hasło sprawdza serwer (to samo hasło do konta), potem nowe klucze i pierwsza synchronizacja. */
export async function enableOffline(password: string, user: MeResponse['user']): Promise<OfflineMeta | null> {
  await api.post('/offline/enable', { password });
  const pair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['wrapKey', 'unwrapKey'],
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedPrivate = await crypto.subtle.wrapKey('pkcs8', pair.privateKey, await passwordKey(password, salt, PBKDF2_ITERATIONS), { name: 'AES-GCM', iv });
  const record: KeyRecord = {
    userId: user.id,
    userName: user.fullName,
    publicKey: pair.publicKey,
    wrappedPrivate,
    salt,
    iv,
    iterations: PBKDF2_ITERATIONS,
  };
  await del('copy');
  await put('keys', record);
  return syncOffline(user.id);
}

export async function disableOffline() {
  await del('copy');
  await del('keys');
  changed();
  await api.post('/offline/disable').catch(() => undefined);
}

/** Odczyt kopii hasłem do konta. Błędne hasło = błąd odszyfrowania. */
export async function unlockOffline(password: string): Promise<OfflineData> {
  const keys = await get<KeyRecord>('keys');
  const copy = await get<CopyRecord>('copy');
  if (!keys || !copy || copy.userId !== keys.userId) throw new Error('Na tym urządzeniu nie ma kopii kontaktów.');
  let privateKey: CryptoKey;
  try {
    privateKey = await crypto.subtle.unwrapKey(
      'pkcs8',
      keys.wrappedPrivate,
      await passwordKey(password, keys.salt, keys.iterations),
      { name: 'AES-GCM', iv: keys.iv },
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['unwrapKey'],
    );
  } catch {
    throw new Error('Błędne hasło. Kopię zabezpiecza hasło do konta z chwili jej włączenia na tym urządzeniu (po zmianie hasła – także poprzednie).');
  }
  const dataKey = await crypto.subtle.unwrapKey('raw', copy.wrappedKey, privateKey, { name: 'RSA-OAEP' }, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: copy.iv }, dataKey, copy.data);
  return JSON.parse(new TextDecoder().decode(plain)) as OfflineData;
}

// --- Dziennik działań bez połączenia (wysyłka z aplikacji SMS, kopiowanie numerów) ---

export async function addJournal(entry: Omit<OfflineJournalEntry, 'id' | 'at'>) {
  try {
    const list = (await get<OfflineJournalEntry[]>('journal')) ?? [];
    list.push({ ...entry, id: crypto.randomUUID(), at: new Date().toISOString() });
    await put('journal', list.slice(-500));
  } catch {
    /* brak IndexedDB – wpis przepada, wysyłka i tak działa */
  }
  void flushJournal();
}

let flushing = false;
export async function flushJournal() {
  if (flushing || !offlineSupported()) return;
  flushing = true;
  try {
    const list = (await get<OfflineJournalEntry[]>('journal')) ?? [];
    if (list.length === 0) return;
    await api.post('/offline/journal', { entries: list });
    const now = (await get<OfflineJournalEntry[]>('journal')) ?? [];
    await put('journal', now.filter((e) => !list.some((x) => x.id === e.id)));
  } catch {
    /* bez sieci albo bez logowania – spróbujemy później */
  } finally {
    flushing = false;
  }
}

/** W tle: odświeżanie kopii (co 15 minut) i wysyłka dziennika, gdy jest połączenie. */
export function useOfflineAutoSync(me: MeResponse | null) {
  const userId = me?.mfa === 'ok' && (me.user.role === 'ADMIN' || me.user.role === 'DYREKCJA') ? me.user.id : null;
  useEffect(() => {
    if (!userId || !offlineSupported()) return;
    const run = async () => {
      const meta = await getMeta();
      if (meta?.userId !== userId) return;
      void flushJournal();
      if (!meta.syncedAt || Date.now() - new Date(meta.syncedAt).getTime() > SYNC_EVERY_MS) {
        await syncOffline(userId).catch(() => undefined);
      }
    };
    void run();
    const timer = setInterval(() => void run(), 60_000);
    window.addEventListener('online', run);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', run);
    };
  }, [userId]);
}

// --- Wysyłka z telefonu (aplikacja SMS) ---

/** Ile numerów w jednej wiadomości grupowej z telefonu (telefony ograniczają liczbę odbiorców). */
export const PHONE_BATCH = 20;

export function smsAppLink(numbers: string[], body: string): string {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const list = numbers.join(',');
  return ios ? `sms:/open?addresses=${list}&body=${encodeURIComponent(body)}` : `sms:${list}?body=${encodeURIComponent(body)}`;
}
