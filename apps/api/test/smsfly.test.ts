import { describe, expect, it, vi } from 'vitest';
import { createSmsFlyProvider, mapSmsFlyStatus } from '../src/sms/smsfly';

const URL_PL = 'https://sms-fly.pl/api/v2/api.php';

/** Atrapa API: odpowiedź zależna od akcji w zapytaniu. */
function mockApi(responses: Record<string, { status?: number; body: unknown }>) {
  return vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
    const action = JSON.parse(String(init!.body)).action as string;
    const r = responses[action] ?? { status: 400, body: { success: 0, error: { code: 'INVACTION' } } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
}
const provider = (fetchImpl: typeof fetch) => createSmsFlyProvider({ apiKey: 'klucz-36-znakow', url: URL_PL, ttlMinutes: 240, fetchImpl });
const body = (fetchImpl: ReturnType<typeof mockApi>, i = 0) => JSON.parse(String(fetchImpl.mock.calls[i]![1]!.body));

describe('SMS-fly', () => {
  it('SENDMESSAGE: format zgodny z dokumentacją v2.04', async () => {
    const fetchImpl = mockApi({
      SENDMESSAGE: { body: { success: 1, date: '2026-10-19 15:00:00', data: { messageID: 'FAPI0001', sms: { status: 'ACCEPTD', cost: '0.12' } } } },
    });
    const result = await provider(fetchImpl).send({ to: '+48600100200', text: 'ALERT SZKOLNY: test', from: 'PTI-ALERT' });
    expect(result).toEqual({ ok: true, messageId: 'FAPI0001', status: 'ACCEPTD', parts: null, points: 0.12 });
    expect(fetchImpl.mock.calls[0]![0]).toBe(URL_PL);
    expect(body(fetchImpl)).toEqual({
      auth: { key: 'klucz-36-znakow' },
      action: 'SENDMESSAGE',
      data: { recipient: '48600100200', channels: ['sms'], sms: { source: 'PTI-ALERT', ttl: 240, text: 'ALERT SZKOLNY: test' } },
    });
  });

  it('bez nazwy nadawcy bierze pierwszą zatwierdzoną z konta (GETSOURCES)', async () => {
    const fetchImpl = mockApi({
      GETSOURCES: { body: { success: 1, data: { sms: ['SZKOLA', 'INNY'] } } },
      SENDMESSAGE: { body: { success: 1, data: { messageID: 'X1', sms: { status: 'ACCEPTD' } } } },
    });
    await provider(fetchImpl).send({ to: '+48600100200', text: 'x' });
    expect(body(fetchImpl, 0).action).toBe('GETSOURCES');
    expect(body(fetchImpl, 1).data.sms.source).toBe('SZKOLA');
  });

  it('zły klucz -> komunikat o .env i próba bramki zapasowej', async () => {
    const fetchImpl = mockApi({ SENDMESSAGE: { status: 403, body: { success: 0, error: { code: 'FORBIDDEN', description: '2' } } } });
    const result = await provider(fetchImpl).send({ to: '+48600100200', text: 'x', from: 'A' });
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN', failover: true, retryable: false });
    expect(!result.ok && result.error).toMatch(/SMSFLY_API_KEY/);
  });

  it('niezatwierdzony nadawca', async () => {
    const fetchImpl = mockApi({ SENDMESSAGE: { status: 400, body: { success: 0, error: { code: 'INVSOURCE' } } } });
    const result = await provider(fetchImpl).send({ to: '+48600100200', text: 'x', from: 'NIEZNANY' });
    expect(!result.ok && result.error).toMatch(/nazwa nadawcy nie jest zatwierdzona/);
  });

  it('zły numer = błąd odbiorcy (bez przełączania bramki)', async () => {
    const fetchImpl = mockApi({ SENDMESSAGE: { status: 400, body: { success: 0, error: { code: 'INVRECIPIENT' } } } });
    expect(await provider(fetchImpl).send({ to: '+48600', text: 'x', from: 'A' })).toMatchObject({ ok: false, failover: false });
  });

  it('brak środków zgłoszony w statusie wiadomości', async () => {
    const fetchImpl = mockApi({ SENDMESSAGE: { body: { success: 1, data: { messageID: 'X', sms: { status: 'INSUFFICIENTFUNDS' } } } } });
    const result = await provider(fetchImpl).send({ to: '+48600100200', text: 'x', from: 'A' });
    expect(result).toMatchObject({ ok: false, code: 'INSUFFICIENTFUNDS' });
  });

  it('błąd serwera = do ponowienia', async () => {
    const fetchImpl = mockApi({ SENDMESSAGE: { status: 502, body: { success: 0 } } });
    expect(await provider(fetchImpl).send({ to: '+48600100200', text: 'x', from: 'A' })).toMatchObject({ ok: false, retryable: true });
  });

  it('GETMESSAGESTATUS -> status doręczenia', async () => {
    const fetchImpl = mockApi({ GETMESSAGESTATUS: { body: { success: 1, data: { messageID: 'X', sms: { status: 'DELIVRD' } } } } });
    expect(await provider(fetchImpl).checkStatus!('X')).toBe('DELIVERED');
    expect(body(fetchImpl).data).toEqual({ messageID: 'X' });
  });

  it('saldo i zatwierdzeni nadawcy', async () => {
    const fetchImpl = mockApi({
      GETBALANCE: { body: { success: 1, data: { balance: '91.477' } } },
      GETSOURCES: { body: { success: 1, data: { sms: ['PTI-ALERT'] } } },
    });
    expect(await provider(fetchImpl).status()).toMatchObject({ ok: true, live: true, points: 91.477, message: expect.stringContaining('PTI-ALERT') });
  });

  it('mapowanie statusów z tabeli', () => {
    expect(mapSmsFlyStatus('DELIVRD')).toBe('DELIVERED');
    expect(mapSmsFlyStatus('VIEWED')).toBe('DELIVERED');
    expect(mapSmsFlyStatus('UNDELIV')).toBe('UNDELIVERED');
    expect(mapSmsFlyStatus('EXPIRED')).toBe('UNDELIVERED');
    expect(mapSmsFlyStatus('ERROR')).toBe('FAILED');
    expect(mapSmsFlyStatus('PENDING')).toBe('SENT');
    expect(mapSmsFlyStatus('cos')).toBeNull();
  });
});
