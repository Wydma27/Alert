import { randomUUID } from 'node:crypto';
import type { SmsProvider } from './provider';

/** Bramka udawana: nic nie wysyła, tylko przyjmuje wiadomość. Domyślna lokalnie i w testach. */
export function createFakeProvider(): SmsProvider {
  return {
    name: 'fake',
    live: false,
    async send() {
      return { ok: true, messageId: `fake-${randomUUID()}`, status: 'FAKE', parts: null, points: null };
    },
    async sendBatch({ to }) {
      return to.map(() => ({ ok: true as const, messageId: `fake-${randomUUID()}`, status: 'FAKE', parts: null, points: null }));
    },
    async senders() {
      return null;
    },
    async status() {
      return {
        provider: 'fake',
        live: false,
        ok: true,
        points: null,
        message: 'SMS-y nie są wysyłane do telefonów.',
      };
    },
  };
}
