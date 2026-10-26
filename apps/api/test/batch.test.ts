import { describe, expect, it, vi } from 'vitest';
import { createSenderChain } from '../src/sms/failover';
import type { BatchRequest, SendResult, SmsProvider } from '../src/sms/provider';
import { runPool } from '../src/sms/retry';
import { createSerwerSmsProvider } from '../src/sms/serwersms';
import { createSmsApiProvider } from '../src/sms/smsapi';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
}

describe('SMSAPI – pule (wiele numerów w jednym zapytaniu)', () => {
  it('jedno zapytanie, wyniki dopasowane po numerze, odrzucone numery oznaczone', async () => {
    const fetchImpl = mockFetch(200, {
      count: 2,
      list: [
        { id: 'B', number: '48600100300', submitted_number: '48600100300', status: 'QUEUE', points: 0.16 },
        { id: 'A', number: '48600100200', submitted_number: '48600100200', status: 'QUEUE', points: 0.16 },
      ],
      invalid_numbers: [{ number: '48111222333', submitted_number: '48111222333', message: 'Invalid phone number' }],
    });
    const provider = createSmsApiProvider({ token: 't', baseUrl: 'https://api.smsapi.pl', fetchImpl });

    const results = await provider.sendBatch!({ to: ['+48600100200', '+48111222333', '+48600100300'], text: 'Zebranie o 17', from: 'SP12' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(String(fetchImpl.mock.calls[0]![1]!.body)).get('to')).toBe('48600100200,48111222333,48600100300');
    expect(results[0]).toMatchObject({ ok: true, messageId: 'A' });
    expect(results[1]).toMatchObject({ ok: false, badRecipient: true, failover: false, retryable: false });
    expect(results[2]).toMatchObject({ ok: true, messageId: 'B' });
  });

  it('błąd całego zapytania dotyczy wszystkich numerów', async () => {
    const provider = createSmsApiProvider({ token: 't', baseUrl: 'https://api.smsapi.pl', fetchImpl: mockFetch(200, { error: 103, message: 'No points' }) });
    const results = await provider.sendBatch!({ to: ['+48600100200', '+48600100300'], text: 'x' });
    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.ok && r.failover && /Brak środków/.test(r.error))).toBe(true);
  });

  it('kod 13 (wszystkie numery złe) = błędne numery', async () => {
    const provider = createSmsApiProvider({ token: 't', baseUrl: 'https://api.smsapi.pl', fetchImpl: mockFetch(200, { error: 13, message: 'Invalid number' }) });
    const [r] = await provider.sendBatch!({ to: ['+48111222333'], text: 'x' });
    expect(r).toMatchObject({ ok: false, badRecipient: true, failover: false });
  });

  it('lista zatwierdzonych nadawców', async () => {
    const fetchImpl = mockFetch(200, {
      collection: [
        { sender: 'SP12', status: 'ACTIVE', is_default: true },
        { sender: 'Szkola', status: 'INACTIVE', is_default: false },
      ],
      size: 2,
    });
    const provider = createSmsApiProvider({ token: 't', baseUrl: 'https://api.smsapi.pl', fetchImpl });
    expect(await provider.senders!()).toEqual(['SP12']);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://api.smsapi.pl/sms/sendernames');
  });
});

describe('SerwerSMS – pule', () => {
  it('tablica numerów w jednym zapytaniu, wynik po numerze', async () => {
    const fetchImpl = mockFetch(200, {
      success: true,
      queued: 1,
      unsent: 1,
      items: [
        { id: 'X1', phone: '+48600100200', status: 'queued', parts: 1 },
        { phone: '+48111222333', status: 'unsent', error_code: 13, error_message: 'Incorrect number' },
      ],
    });
    const provider = createSerwerSmsProvider({ token: 't', baseUrl: 'https://api2.serwersms.pl', fetchImpl });
    const results = await provider.sendBatch!({ to: ['+48600100200', '+48111222333'], text: 'x' });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body)).phone).toEqual(['+48600100200', '+48111222333']);
    expect(results[0]).toMatchObject({ ok: true, messageId: 'X1' });
    expect(results[1]).toMatchObject({ ok: false, badRecipient: true, failover: false });
  });
});

const OK: SendResult = { ok: true, messageId: 'x', status: 'QUEUE', parts: 1, points: null };
const DOWN: SendResult = { ok: false, error: 'awaria', code: null, retryable: true, failover: true };
const BAD: SendResult = { ok: false, error: 'zły numer', code: '13', retryable: false, failover: false, badRecipient: true };

function batchProvider(name: string, answer: (req: BatchRequest) => SendResult[]): SmsProvider & { batches: BatchRequest[] } {
  const p = {
    name,
    live: true,
    batches: [] as BatchRequest[],
    async send() {
      return OK;
    },
    async sendBatch(req: BatchRequest) {
      p.batches.push(req);
      return answer(req);
    },
    async status() {
      return { provider: name, live: true, ok: true, points: null, message: '' };
    },
  };
  return p;
}

describe('łańcuch bramek – paczki', () => {
  it('awaria głównej: cała paczka idzie zapasową, błędne numery nie są ponawiane', async () => {
    const primary = batchProvider('smsapi', (req) => req.to.map((n) => (n.endsWith('3') ? BAD : DOWN)));
    const backup = batchProvider('serwersms', (req) => req.to.map(() => OK));
    const results = await createSenderChain([primary, backup]).sendBatch({ to: ['+48600000001', '+48600000002', '+48600000003'], text: 'x' });
    expect(backup.batches[0]!.to).toEqual(['+48600000001', '+48600000002']);
    expect(results.map((r) => [r.provider, r.ok])).toEqual([
      ['serwersms', true],
      ['serwersms', true],
      ['smsapi', false],
    ]);
  });

  it('bramka bez paczek: równoległe pojedyncze zapytania z limitem', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const single: SmsProvider = {
      name: 'smsfly',
      live: true,
      async send() {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return OK;
      },
      async status() {
        return { provider: 'smsfly', live: true, ok: true, points: null, message: '' };
      },
    };
    const limit = vi.fn(async () => undefined);
    const to = Array.from({ length: 12 }, (_, i) => `+486000000${String(i).padStart(2, '0')}`);
    const results = await createSenderChain([single]).sendBatch({ to, text: 'x' }, { limit, concurrency: 4 });
    expect(results.every((r) => r.ok)).toBe(true);
    expect(limit).toHaveBeenCalledTimes(12);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('bezpiecznik liczy całe paczki', async () => {
    let now = 0;
    const primary = batchProvider('smsapi', (req) => req.to.map(() => DOWN));
    const backup = batchProvider('serwersms', (req) => req.to.map(() => OK));
    const chain = createSenderChain([primary, backup], { threshold: 2, cooldownMs: 60_000, now: () => now });
    for (let i = 0; i < 4; i++) await chain.sendBatch({ to: ['+48600000001', '+48600000002'], text: 'x' });
    expect(primary.batches).toHaveLength(2);
    now = 61_000;
    await chain.sendBatch({ to: ['+48600000001', '+48600000002'], text: 'x' });
    expect(primary.batches).toHaveLength(3);
  });
});

describe('pula zadań', () => {
  it('kolejność wyników jak na wejściu, ograniczona równoległość', async () => {
    let inFlight = 0;
    let max = 0;
    const out = await runPool([30, 10, 20, 5, 1], 2, async (ms, i) => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight--;
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3, 4]);
    expect(max).toBe(2);
  });
});
