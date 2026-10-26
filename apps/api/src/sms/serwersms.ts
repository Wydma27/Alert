// SerwerSMS.pl (HTTPS API v2): POST {base}/messages/send_sms.json, JSON, nagłówek Authorization: Bearer <token>.
// Odpowiedź: { success, queued, unsent, items: [{ id, phone, status, parts, error_code?, error_message? }] }
// albo { error: { code, type, message } }. Raport doręczenia: parametr dlr_url z #SMSID#, #STAN#.
// Pule: "phone" może być tablicą numerów – ta sama treść do wielu odbiorców jednym zapytaniem.
import { digitsOnly, failAll, type DlrStatus, type SendResult, type SmsProvider } from './provider';

const TIMEOUT_MS = 15_000;
const MAX_BATCH = 1_000;

interface SerwerSmsResponse {
  success?: boolean;
  queued?: number;
  unsent?: number;
  items?: { id?: string; phone?: string; status?: string; parts?: number; error_code?: number; error_message?: string }[];
  error?: { code?: number; type?: string; message?: string };
}

/** Wartości #STAN# z raportów SerwerSMS (porównujemy bez wielkości liter). */
export function mapSerwerSmsStatus(stan: string | undefined): DlrStatus | null {
  const s = (stan ?? '').toLowerCase();
  if (s.includes('undelivered') || s.includes('niedostarcz')) return 'UNDELIVERED';
  if (s.includes('delivered') || s.includes('dostarcz')) return 'DELIVERED';
  if (s.includes('fail') || s.includes('error') || s.includes('blad')) return 'FAILED';
  if (s.includes('sent') || s.includes('queued') || s.includes('wyslan')) return 'SENT';
  return null;
}

export function createSerwerSmsProvider(opts: {
  token: string;
  baseUrl: string;
  dlrUrl?: string;
  fetchImpl?: typeof fetch;
}): SmsProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const call = (path: string, payload: Record<string, unknown>) =>
    doFetch(`${opts.baseUrl}/${path}.json`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  async function sendMany(numbers: string[], text: string, from?: string): Promise<SendResult[]> {
    const payload: Record<string, unknown> = { phone: numbers.length === 1 ? numbers[0] : numbers, text, details: true };
    if (from) payload.sender = from;
    if (opts.dlrUrl) payload.dlr_url = opts.dlrUrl;

    let res: Response;
    try {
      res = await call('messages/send_sms', payload);
    } catch {
      return failAll(numbers.length, { ok: false, error: 'Brak połączenia z bramką SerwerSMS.', code: null, retryable: true, failover: true });
    }
    const data = (await res.json().catch(() => null)) as SerwerSmsResponse | null;
    if (data?.error) {
      return failAll(numbers.length, {
        ok: false,
        code: String(data.error.code ?? ''),
        error: `SerwerSMS: ${data.error.message ?? 'błąd'}${data.error.code ? ` (kod ${data.error.code})` : ''}`,
        retryable: false,
        failover: true,
      });
    }
    if (!res.ok || !data?.success || !data.items?.length) {
      return failAll(numbers.length, {
        ok: false,
        code: `HTTP ${res.status}`,
        error: `Bramka SerwerSMS zwróciła błąd HTTP ${res.status}.`,
        retryable: res.status === 429 || res.status >= 500,
        failover: true,
      });
    }
    const items = data.items;
    const byPhone = new Map(items.filter((i) => i.phone).map((i) => [digitsOnly(i.phone!), i]));
    return numbers.map((n, idx): SendResult => {
      const item = byPhone.get(digitsOnly(n)) ?? (byPhone.size === 0 ? items[idx] : undefined);
      if (!item) return { ok: false, code: null, error: 'SerwerSMS nie potwierdził wysyłki na ten numer.', retryable: false, failover: false };
      if (item.status === 'unsent' || !item.id) {
        return {
          ok: false,
          code: item.error_code ? String(item.error_code) : null,
          error: `SerwerSMS: ${item.error_message ?? 'wiadomość nie została przyjęta'}`,
          retryable: false,
          failover: false, // np. "Incorrect number" – problem odbiorcy
          badRecipient: /number|numer/i.test(item.error_message ?? ''),
        };
      }
      return { ok: true, messageId: item.id, status: item.status ?? 'queued', parts: item.parts ?? null, points: null };
    });
  }

  return {
    name: 'serwersms',
    live: true,

    async send({ to, text, from }): Promise<SendResult> {
      return (await sendMany([to], text, from))[0]!;
    },

    async sendBatch({ to, text, from }): Promise<SendResult[]> {
      const results: SendResult[] = [];
      for (let i = 0; i < to.length; i += MAX_BATCH) results.push(...(await sendMany(to.slice(i, i + MAX_BATCH), text, from)));
      return results;
    },

    async status() {
      // Wywołanie testowe: nic nie wysyła, sprawdza token i połączenie.
      try {
        const res = await call('messages/send_sms', { phone: '+48500600700', text: 'test', test: true });
        const data = (await res.json().catch(() => null)) as SerwerSmsResponse | null;
        if (!res.ok || !data || data.error) {
          return {
            provider: 'serwersms',
            live: true,
            ok: false,
            points: null,
            message: `SerwerSMS: ${data?.error?.message ?? `błąd HTTP ${res.status}`}`,
          };
        }
        return { provider: 'serwersms', live: true, ok: true, points: null, message: 'połączenie działa.' };
      } catch {
        return { provider: 'serwersms', live: true, ok: false, points: null, message: 'Brak połączenia z bramką SerwerSMS.' };
      }
    },
  };
}
