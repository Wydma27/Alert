import { describe, expect, it, vi } from 'vitest';
import { createSmsApiProvider } from '../src/sms/smsapi';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
}

describe('SMSAPI', () => {
  it('wysyła poprawne zapytanie i zwraca id wiadomości', async () => {
    const fetchImpl = mockFetch(200, { count: 1, list: [{ id: 'ABC123', status: 'QUEUE', points: 0.32, parts: 2 }] });
    const provider = createSmsApiProvider({ token: 'tajny', baseUrl: 'https://api.smsapi.pl', fetchImpl });

    const result = await provider.send({ to: '+48600100200', text: 'TEST, NIE ALARM: treść', from: 'SP12-ALERT' });

    expect(result).toEqual({ ok: true, messageId: 'ABC123', status: 'QUEUE', parts: 2, points: 0.32 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.smsapi.pl/sms.do');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer tajny');
    const body = new URLSearchParams(String(init!.body));
    expect(body.get('to')).toBe('48600100200');
    expect(body.get('from')).toBe('SP12-ALERT');
    expect(body.get('message')).toBe('TEST, NIE ALARM: treść');
    expect(body.get('format')).toBe('json');
  });

  it('bez nadawcy nie wysyła pola from', async () => {
    const fetchImpl = mockFetch(200, { list: [{ id: 'X' }] });
    const provider = createSmsApiProvider({ token: 't', baseUrl: 'https://api.smsapi.pl', fetchImpl });
    await provider.send({ to: '+48600100200', text: 'x' });
    expect(new URLSearchParams(String(fetchImpl.mock.calls[0]![1]!.body)).has('from')).toBe(false);
  });

  it('tłumaczy znane kody błędów', async () => {
    const provider = createSmsApiProvider({
      token: 't',
      baseUrl: 'https://api.smsapi.pl',
      fetchImpl: mockFetch(200, { error: 14, message: 'Invalid from field' }),
    });
    const result = await provider.send({ to: '+48600100200', text: 'x', from: 'NIEZNANY' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/Nazwa nadawcy nie jest zarejestrowana/);
  });

  it('błąd sieci = do ponowienia', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const provider = createSmsApiProvider({ token: 't', baseUrl: 'https://api.smsapi.pl', fetchImpl });
    const result = await provider.send({ to: '+48600100200', text: 'x' });
    expect(result).toMatchObject({ ok: false, retryable: true });
  });

  it('saldo z profilu konta', async () => {
    const provider = createSmsApiProvider({ token: 't', baseUrl: 'https://api.smsapi.pl', fetchImpl: mockFetch(200, { points: 12.5 }) });
    expect(await provider.status()).toMatchObject({ ok: true, live: true, points: 12.5 });
  });
});
