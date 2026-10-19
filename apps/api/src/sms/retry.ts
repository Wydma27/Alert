// Czyste funkcje kolejki (bez bazy) – łatwe do testowania.

export const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** Czy po tej próbie ponowić i za ile. null = koniec prób. */
export function nextRetryDelay(attemptsSoFar: number, retryable: boolean): number | null {
  if (!retryable || attemptsSoFar >= MAX_ATTEMPTS) return null;
  return RETRY_DELAYS_MS[attemptsSoFar - 1] ?? null;
}

/** Równomierne rozłożenie wysyłek w czasie (limit bramki). */
export function createRateLimiter(perSecond: number, now: () => number = Date.now) {
  const interval = 1000 / perSecond;
  let next = 0;
  return async () => {
    const t = now();
    const at = Math.max(t, next);
    next = at + interval;
    if (at > t) await new Promise((r) => setTimeout(r, at - t));
  };
}
