import { EventEmitter } from 'node:events';

/**
 * Powiadomienia o zmianach w alercie (statusy SMS, obecność) – dla odświeżania ekranów na żywo (SSE).
 * Jeden proces serwera; przy kilku instancjach trzeba tu dołożyć Postgres LISTEN/NOTIFY.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(500);

export function notifyAlertChanged(alertId: number) {
  emitter.emit('alert', alertId);
}

export function onAlertChanged(listener: (alertId: number) => void): () => void {
  emitter.on('alert', listener);
  return () => emitter.off('alert', listener);
}
