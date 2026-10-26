// Stan bazy danych: czy odpowiada. Przy awarii serwer przechodzi w tryb awaryjny
// (logowanie z kopii sesji, wysyłka SMS z kopii kontaktów), a po powrocie bazy dopisuje zaległe dane.
import { Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { EventEmitter } from 'node:events';
import { prisma } from '../db';

const CHECK_INTERVAL_MS = 5_000;
const CHECK_TIMEOUT_MS = 4_000;

let healthy = true;
let downSince: Date | null = null;
const emitter = new EventEmitter();

export function dbHealthy(): boolean {
  return healthy;
}

export function dbDownSince(): Date | null {
  return downSince;
}

/** Wywoływane przy zmianie stanu (true = baza wróciła). */
export function onDbStateChange(listener: (ok: boolean) => void): () => void {
  emitter.on('change', listener);
  return () => emitter.off('change', listener);
}

function set(ok: boolean) {
  if (ok === healthy) return;
  healthy = ok;
  downSince = ok ? null : new Date();
  emitter.emit('change', ok);
}

export function markDbDown() {
  set(false);
}

/** Błąd "baza nie odpowiada" (a nie np. naruszenie unikalności). */
export function isDbConnectionError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError || err instanceof Prisma.PrismaClientRustPanicError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) return ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(err.code);
  const message = err instanceof Error ? err.message : '';
  return /Can't reach database server|Server has closed the connection|Connection refused|ECONNREFUSED|Timed out fetching a new connection/i.test(message);
}

/** Baza odpowiada, ale nie może zapisać (np. brak miejsca na dysku). */
export function isDbWriteFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : '';
  return /No space left on device|could not extend file|disk full|53100|read-only transaction/i.test(message);
}

export async function checkDb(): Promise<boolean> {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out fetching a new connection')), CHECK_TIMEOUT_MS).unref()),
    ]);
    set(true);
  } catch {
    set(false);
  }
  return healthy;
}

export function startDbMonitor(log: FastifyBaseLogger): () => void {
  const unsubscribe = onDbStateChange((ok) => {
    if (ok) log.warn('Baza danych znów odpowiada – koniec trybu awaryjnego');
    else log.error('Baza danych nie odpowiada – tryb awaryjny (wysyłka z kopii kontaktów)');
  });
  const timer = setInterval(() => void checkDb(), CHECK_INTERVAL_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
    unsubscribe();
  };
}
