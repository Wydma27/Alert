// SMS-fly (sms-fly.pl) – REST API v2.04: POST JSON na adres z panelu ("Ustawienia API"),
// { auth: { key }, action, data }. Odpowiedź: { success: 1, date, data } albo { success: 0, error: { code, description } }.
// Wysyłka: SENDMESSAGE (recipient bez "+", channels ["sms"], sms: { source, ttl, text }) -> data.messageID, data.sms.status.
// Status: GETMESSAGESTATUS (messageID) -> data.sms.status. Saldo: GETBALANCE. Nadawcy: GETSOURCES.
import type { DlrStatus, GatewayStatus, SendResult, SmsProvider } from './provider';

const TIMEOUT_MS = 15_000;

/** Kody błędów z tabeli "Table of error codes during request processing". */
const ERRORS: Record<string, string> = {
  FORBIDDEN: 'SMS-fly odrzucił klucz API – sprawdź SMSFLY_API_KEY w pliku .env (panel SMS-fly → Integracja / Ustawienia API).',
  INVREQUEST: 'SMS-fly: nieprawidłowy format zapytania.',
  INVACTION: 'SMS-fly: nieobsługiwana operacja.',
  INVRECIPIENT: 'SMS-fly: nieprawidłowy numer odbiorcy.',
  INVTEXT: 'SMS-fly: brak treści lub treść niezgodna z wymaganiami.',
  INVROUTE: 'SMS-fly: wiadomości nie można wysłać do tego odbiorcy (brak trasy).',
  INVSOURCE: 'SMS-fly: nazwa nadawcy nie jest zatwierdzona na koncie – zmień „Nadawca SMS” w „Dane szkoły” albo ustaw SMS_USE_DEFAULT_SENDER=true.',
  INVCHANNELS: 'SMS-fly: nieprawidłowy kanał wysyłki.',
  INVSMSMESSAGE: 'SMS-fly: brak treści SMS.',
  INVMSGID: 'SMS-fly: nie znaleziono wiadomości.',
  INSUFFICIENTFUNDS: 'Brak środków na koncie SMS-fly – doładuj konto.',
  ERROR: 'SMS-fly: błąd wysyłki wiadomości.',
};
/** Problem z odbiorcą lub treścią – bramka zapasowa nic tu nie pomoże. */
const RECIPIENT_ERRORS = new Set(['INVRECIPIENT', 'INVTEXT', 'INVSMSMESSAGE']);

/** Statusy z tabeli "Message Status Table". */
export function mapSmsFlyStatus(status: string | undefined): DlrStatus | null {
  switch ((status ?? '').toUpperCase()) {
    case 'DELIVRD':
    case 'VIEWED':
      return 'DELIVERED';
    case 'UNDELIV':
    case 'EXPIRED':
    case 'STOPED':
    case 'REFUND':
      return 'UNDELIVERED';
    case 'ERROR':
    case 'INSUFFICIENTFUNDS':
      return 'FAILED';
    case 'ACCEPTD':
    case 'PENDING':
    case 'INPROGRESS':
    case 'SENT':
    case 'MODERATION':
    case 'RESERVED':
      return 'SENT';
    default:
      return null;
  }
}

interface SmsFlyResponse {
  success?: number;
  data?: {
    messageID?: string;
    balance?: string;
    sms?: { status?: string; cost?: number | string } | string[];
  };
  error?: { code?: string; description?: string };
}

export function createSmsFlyProvider(opts: {
  apiKey: string;
  url: string;
  ttlMinutes: number;
  fetchImpl?: typeof fetch;
}): SmsProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  let sources: { list: string[]; at: number } | null = null;

  async function call(action: string, data: Record<string, unknown>): Promise<{ http: number; body: SmsFlyResponse | null }> {
    const res = await doFetch(opts.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ auth: { key: opts.apiKey }, action, data }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { http: res.status, body: (await res.json().catch(() => null)) as SmsFlyResponse | null };
  }

  /** Zatwierdzone nazwy nadawcy SMS na koncie (pamiętane 10 minut). */
  async function smsSources(): Promise<string[]> {
    if (sources && Date.now() - sources.at < 600_000) return sources.list;
    const { body } = await call('GETSOURCES', { channels: ['sms'] });
    const list = body?.success === 1 && Array.isArray(body.data?.sms) ? body.data.sms : [];
    sources = { list, at: Date.now() };
    return list;
  }

  return {
    name: 'smsfly',
    live: true,

    async send({ to, text, from }): Promise<SendResult> {
      let response: { http: number; body: SmsFlyResponse | null };
      try {
        // Bez wskazanej nazwy – pierwszy zatwierdzony nadawca z konta (SMS-fly wymaga pola source).
        const source = from ?? (await smsSources())[0];
        response = await call('SENDMESSAGE', {
          recipient: to.replace(/^\+/, ''),
          channels: ['sms'],
          sms: { ...(source ? { source } : {}), ttl: opts.ttlMinutes, text },
        });
      } catch {
        return { ok: false, error: 'Brak połączenia z bramką SMS-fly (sieć lub limit czasu).', code: null, retryable: true, failover: true };
      }
      const { http, body } = response;

      if (!body || body.success !== 1) {
        const code = body?.error?.code ?? `HTTP ${http}`;
        const transient = http === 429 || http >= 500;
        return {
          ok: false,
          code,
          error: ERRORS[code] ?? `SMS-fly: ${code}${body?.error?.description ? ` (${body.error.description})` : ''}`,
          retryable: transient,
          failover: !RECIPIENT_ERRORS.has(code),
        };
      }

      const sms = Array.isArray(body.data?.sms) ? undefined : body.data?.sms;
      const status = sms?.status ?? 'ACCEPTD';
      const mapped = mapSmsFlyStatus(status);
      if (!body.data?.messageID || mapped === 'FAILED' || mapped === 'UNDELIVERED') {
        return {
          ok: false,
          code: status,
          error: ERRORS[status] ?? `SMS-fly: wiadomość nie została przyjęta (${status}).`,
          retryable: false,
          failover: true,
        };
      }
      const cost = sms?.cost !== undefined ? Number(sms.cost) : null;
      return { ok: true, messageId: body.data.messageID, status, parts: null, points: Number.isFinite(cost) ? cost : null };
    },

    async checkStatus(messageId: string): Promise<DlrStatus | null> {
      const { body } = await call('GETMESSAGESTATUS', { messageID: messageId });
      if (!body || body.success !== 1 || Array.isArray(body.data?.sms)) return null;
      return mapSmsFlyStatus(body.data?.sms?.status);
    },

    async status(): Promise<GatewayStatus> {
      try {
        const { http, body } = await call('GETBALANCE', {});
        if (!body || body.success !== 1) {
          const code = body?.error?.code ?? `HTTP ${http}`;
          return { provider: 'smsfly', live: true, ok: false, points: null, message: ERRORS[code] ?? `SMS-fly: błąd ${code}` };
        }
        const balance = Number(body.data?.balance);
        const names = await smsSources().catch(() => []);
        return {
          provider: 'smsfly',
          live: true,
          ok: true,
          points: Number.isFinite(balance) ? balance : null,
          message: names.length
            ? `połączenie działa. Zatwierdzone nazwy nadawcy: ${names.join(', ')}.`
            : 'połączenie działa, ale na koncie nie ma zatwierdzonej nazwy nadawcy SMS.',
        };
      } catch {
        return { provider: 'smsfly', live: true, ok: false, points: null, message: 'Brak połączenia z bramką SMS-fly.' };
      }
    },
  };
}
