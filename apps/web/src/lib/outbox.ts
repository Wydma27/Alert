// Kolejka zmian obecności zapisywana w telefonie – działa bez zasięgu, wysyła się po jego odzyskaniu.
// Każda zmiana ma czas z telefonu; serwer odrzuca starsze niż już zapisane (synchronizacja bez konfliktów).
import { useEffect, useState } from 'react';
import type { AttendanceValue } from '@alert/shared';
import { api, ApiError } from './api';

export interface OutboxItem {
  alertStudentId: number;
  attendance: AttendanceValue;
  pickedUpByGuardianId: number | null;
  pickedUpByName: string | null;
  clientTime: string;
}

const KEY = 'alert-outbox-v1';
const EVENT = 'outbox:change';

function read(): OutboxItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as OutboxItem[];
  } catch {
    return [];
  }
}

function write(items: OutboxItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* brak miejsca / tryb prywatny – zmiana i tak trafi do pamięci strony */
  }
  window.dispatchEvent(new Event(EVENT));
}

let memoryFallback: OutboxItem[] = [];

export function enqueue(item: OutboxItem) {
  const items = [...read().filter((i) => i.alertStudentId !== item.alertStudentId), item];
  memoryFallback = items;
  write(items);
}

export function pending(): OutboxItem[] {
  const stored = read();
  return stored.length ? stored : memoryFallback;
}

let flushing: Promise<{ rejected: string[] }> | null = null;

/** Wysyła zaległe zmiany. Przy braku sieci przerywa; odrzucone przez serwer (np. alert zakończony) usuwa. */
export function flush(): Promise<{ rejected: string[] }> {
  flushing ??= (async () => {
    const rejected: string[] = [];
    try {
      for (const item of pending()) {
        try {
          await api.post('/attendance/mark', item);
        } catch (err) {
          if (err instanceof ApiError && err.status === 0) break; // nadal brak sieci
          rejected.push(err instanceof Error ? err.message : 'Błąd zapisu');
        }
        const rest = pending().filter((i) => !(i.alertStudentId === item.alertStudentId && i.clientTime === item.clientTime));
        memoryFallback = rest;
        write(rest);
      }
    } finally {
      flushing = null;
    }
    return { rejected };
  })();
  return flushing;
}

export function usePendingCount() {
  const [count, setCount] = useState(() => pending().length);
  useEffect(() => {
    const update = () => setCount(pending().length);
    window.addEventListener(EVENT, update);
    window.addEventListener('storage', update);
    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    const timer = setInterval(() => {
      if (pending().length) void flush();
    }, 5_000);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener('storage', update);
      window.removeEventListener('online', onOnline);
      clearInterval(timer);
    };
  }, []);
  return count;
}

/** Ostatnio pobrane dane – pokazywane, gdy nie ma sieci. */
export function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`cache:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function cacheSet(key: string, value: unknown) {
  try {
    localStorage.setItem(`cache:${key}`, JSON.stringify(value));
  } catch {
    /* ignorujemy */
  }
}

/** Pobierz z sieci, a przy jej braku – z pamięci telefonu. */
export async function fetchWithCache<T>(key: string, path: string): Promise<T> {
  try {
    const data = await api.get<T>(path);
    cacheSet(key, data);
    return data;
  } catch (err) {
    const cached = err instanceof ApiError && err.status === 0 ? cacheGet<T>(key) : null;
    if (cached) return cached;
    throw err;
  }
}
