import { describe, expect, it, vi } from 'vitest';
import { createSenderChain } from '../src/sms/failover';
import type { SendResult, SmsProvider } from '../src/sms/provider';
import { MAX_ATTEMPTS, createRateLimiter, nextRetryDelay } from '../src/sms/retry';
import { createSerwerSmsProvider, mapSerwerSmsStatus } from '../src/sms/serwersms';
import { mapSmsApiStatus } from '../src/sms/smsapi';

function provider(name: string, results: SendResult[]): SmsProvider & { calls: number } {
  const p = {
    name,
    live: true,
    calls: 0,
    async send() {
      p.calls++;
      return results[Math.min(p.calls - 1, results.length - 1)]!;
    },
    async status() {
      return { provider: name, live: true, ok: true, points: null, message: '' };
    },
  };
  return p;
}
const OK: SendResult = { ok: true, messageId: 'x', status: 'QUEUE', parts: 1, points: null };
const GATEWAY_DOWN: SendResult = { ok: false, error: 'awaria', code: null, retryable: true, failover: true };
const BAD_NUMBER: SendResult = { ok: false, error: 'zły numer', code: '13', retryable: false, failover: false };

describe('łańcuch bramek (failover)', () => {
  it('używa zapasowej, gdy główna ma awarię', async () => {
    const primary = provider('smsapi', [GATEWAY_DOWN]);
    const backup = provider('serwersms', [OK]);
    const result = await createSenderChain([primary, backup]).send({ to: '+48600100200', text: 'x' });
    expect(result).toMatchObject({ ok: true, provider: 'serwersms' });
  });

  it('nie przełącza przy złym numerze odbiorcy', async () => {
    const primary = provider('smsapi', [BAD_NUMBER]);
    const backup = provider('serwersms', [OK]);
    const result = await createSenderChain([primary, backup]).send({ to: '+48600100200', text: 'x' });
    expect(result).toMatchObject({ ok: false, provider: 'smsapi', code: '13' });
    expect(backup.calls).toBe(0);
  });

  it('bezpiecznik: po 3 awariach główna jest pomijana do końca przerwy', async () => {
    let now = 0;
    const primary = provider('smsapi', [GATEWAY_DOWN]);
    const backup = provider('serwersms', [OK]);
    const chain = createSenderChain([primary, backup], { threshold: 3, cooldownMs: 60_000, now: () => now });
    for (let i = 0; i < 5; i++) await chain.send({ to: '+48600100200', text: 'x' });
    expect(primary.calls).toBe(3);
    now = 61_000;
    await chain.send({ to: '+48600100200', text: 'x' });
    expect(primary.calls).toBe(4);
  });
});

describe('kolejka', () => {
  it('ponawia błędy przejściowe z rosnącym odstępem, potem koniec', () => {
    expect(nextRetryDelay(1, true)).toBe(2_000);
    expect(nextRetryDelay(2, true)).toBe(5_000);
    expect(nextRetryDelay(MAX_ATTEMPTS - 1, true)).toBe(60_000);
    expect(nextRetryDelay(MAX_ATTEMPTS, true)).toBeNull();
    expect(nextRetryDelay(1, false)).toBeNull();
  });

  it('limit wysyłki rozkłada SMS-y w czasie', async () => {
    vi.useFakeTimers();
    let t = 0;
    const limit = createRateLimiter(10, () => t);
    const done: number[] = [];
    for (let i = 0; i < 3; i++) void limit().then(() => done.push(i));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toEqual([0]);
    t = 100;
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toEqual([0, 1]);
    vi.useRealTimers();
  });
});

describe('raporty doręczeń', () => {
  it('SMSAPI: kody 401–412', () => {
    expect(mapSmsApiStatus('404')).toBe('DELIVERED');
    expect(mapSmsApiStatus('405')).toBe('UNDELIVERED');
    expect(mapSmsApiStatus('402')).toBe('UNDELIVERED');
    expect(mapSmsApiStatus('407')).toBe('UNDELIVERED');
    expect(mapSmsApiStatus('406')).toBe('FAILED');
    expect(mapSmsApiStatus('403')).toBe('SENT');
    expect(mapSmsApiStatus('401')).toBeNull();
    expect(mapSmsApiStatus(undefined, 'DELIVERED')).toBe('DELIVERED');
  });

  it('SerwerSMS: stany', () => {
    expect(mapSerwerSmsStatus('delivered')).toBe('DELIVERED');
    expect(mapSerwerSmsStatus('undelivered')).toBe('UNDELIVERED');
    expect(mapSerwerSmsStatus('sent')).toBe('SENT');
    expect(mapSerwerSmsStatus('???')).toBeNull();
  });
});

describe('SerwerSMS', () => {
  it('wysyła JSON z tokenem i odczytuje id', async () => {
    const fetchImpl = vi.fn(
      async (_u: string | URL | Request, _i?: RequestInit) =>
        new Response(JSON.stringify({ success: true, queued: 1, unsent: 0, items: [{ id: 'ab12', phone: '+48600100200', status: 'queued', parts: 2 }] })),
    );
    const p = createSerwerSmsProvider({ token: 'tok', baseUrl: 'https://api2.serwersms.pl', fetchImpl });
    const result = await p.send({ to: '+48600100200', text: 'treść', from: 'SP12-ALERT' });
    expect(result).toEqual({ ok: true, messageId: 'ab12', status: 'queued', parts: 2, points: null });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api2.serwersms.pl/messages/send_sms.json');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(String(init!.body))).toMatchObject({ phone: '+48600100200', text: 'treść', sender: 'SP12-ALERT', details: true });
  });

  it('zły numer = błąd odbiorcy (bez przełączania bramki)', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ success: true, queued: 0, unsent: 1, items: [{ phone: '+48600', status: 'unsent', error_code: 3103, error_message: 'Incorrect number' }] }),
        ),
    );
    const p = createSerwerSmsProvider({ token: 'tok', baseUrl: 'https://api2.serwersms.pl', fetchImpl });
    expect(await p.send({ to: '+48600', text: 'x' })).toMatchObject({ ok: false, failover: false, code: '3103' });
  });
});
