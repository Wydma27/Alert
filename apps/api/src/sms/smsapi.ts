// SMSAPI.pl: POST /sms.do, autoryzacja tokenem OAuth (Bearer).
// Raporty doręczeń: callback GET z parametrami MsgId, status (kod 401–412), odpowiedź "OK".
import type { DlrStatus, SendResult, SmsProvider } from './provider';

const TIMEOUT_MS = 15_000;

/** Komunikaty dla kodów błędów SMSAPI (dokumentacja, sekcja "Kody błędów"). */
const ERRORS: Record<string, string> = {
  '11': 'Treść wiadomości jest nieprawidłowa (np. znaki specjalne przy nounicode).',
  '12': 'Wiadomość ma za dużo części.',
  '13': 'Bramka nie przyjęła numeru odbiorcy (nieprawidłowy lub zablokowany numer).',
  '14': 'Nazwa nadawcy nie jest zarejestrowana w SMSAPI – zarejestruj ją w panelu SMSAPI albo wyślij z domyślnym nadawcą konta.',
  '101': 'Nieprawidłowy token SMSAPI – sprawdź SMSAPI_TOKEN w pliku .env.',
  '102': 'Nieprawidłowe dane logowania SMSAPI.',
  '103': 'Brak środków na koncie SMSAPI – doładuj konto.',
  '105': 'Adres IP serwera nie jest dozwolony w ustawieniach konta SMSAPI.',
  '112': 'Wysyłka do tego kraju jest zablokowana na koncie SMSAPI.',
};
/** Błędy dotyczące konkretnego odbiorcy lub treści – bramka zapasowa nic tu nie pomoże. */
const RECIPIENT_ERRORS = new Set(['11', '12', '13']);

/** Kody statusów z raportów doręczeń SMSAPI. */
export function mapSmsApiStatus(code: string | number | undefined, name?: string): DlrStatus | null {
  const key = String(code ?? '');
  switch (key) {
    case '404':
      return 'DELIVERED';
    case '402': // EXPIRED
    case '405': // UNDELIVERED
    case '407': // REJECTED
      return 'UNDELIVERED';
    case '406': // FAILED
      return 'FAILED';
    case '403': // SENT
    case '409': // QUEUE
    case '410': // ACCEPTED
      return 'SENT';
  }
  switch ((name ?? '').toUpperCase()) {
    case 'DELIVERED':
      return 'DELIVERED';
    case 'EXPIRED':
    case 'UNDELIVERED':
    case 'REJECTED':
      return 'UNDELIVERED';
    case 'FAILED':
      return 'FAILED';
    case 'SENT':
    case 'QUEUE':
    case 'ACCEPTED':
      return 'SENT';
  }
  return null; // NOT_FOUND / UNKNOWN – bez zmiany
}

interface SmsApiResponse {
  error?: number | string;
  message?: string;
  list?: { id: string; status?: string; points?: number; parts?: number }[];
}

export function createSmsApiProvider(opts: {
  token: string;
  baseUrl: string;
  notifyUrl?: string;
  fetchImpl?: typeof fetch;
}): SmsProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${opts.token}` };

  return {
    name: 'smsapi',
    live: true,

    async send({ to, text, from, reference }): Promise<SendResult> {
      const body = new URLSearchParams({
        to: to.replace(/^\+/, ''),
        message: text,
        format: 'json',
        encoding: 'utf-8',
        details: '1',
      });
      if (from) body.set('from', from);
      if (reference) body.set('idx', reference);
      if (opts.notifyUrl) body.set('notify_url', opts.notifyUrl);

      let res: Response;
      try {
        res = await doFetch(`${opts.baseUrl}/sms.do`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        return { ok: false, error: 'Brak połączenia z bramką SMSAPI (sieć lub limit czasu).', code: null, retryable: true, failover: true };
      }

      const data = (await res.json().catch(() => null)) as SmsApiResponse | null;
      if (data?.error !== undefined && data.error !== null) {
        const code = String(data.error);
        const recipient = RECIPIENT_ERRORS.has(code);
        return {
          ok: false,
          code,
          error: ERRORS[code] ?? `SMSAPI: ${data.message ?? 'błąd'} (kod ${code})`,
          retryable: false,
          failover: !recipient,
        };
      }
      if (!res.ok || !data?.list?.[0]) {
        const transient = res.status === 429 || res.status >= 500;
        return {
          ok: false,
          code: `HTTP ${res.status}`,
          error: `Bramka SMSAPI zwróciła błąd HTTP ${res.status}.`,
          retryable: transient,
          failover: true,
        };
      }
      const item = data.list[0];
      return { ok: true, messageId: item.id, status: item.status ?? 'QUEUE', parts: item.parts ?? null, points: item.points ?? null };
    },

    async status() {
      try {
        const res = await doFetch(`${opts.baseUrl}/profile`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
        const data = (await res.json().catch(() => null)) as { points?: number; error?: number; message?: string } | null;
        if (!res.ok || !data || data.error) {
          const code = data?.error ? String(data.error) : `HTTP ${res.status}`;
          return { provider: 'smsapi', live: true, ok: false, points: null, message: ERRORS[code] ?? `SMSAPI: błąd ${code}` };
        }
        return {
          provider: 'smsapi',
          live: true,
          ok: true,
          points: typeof data.points === 'number' ? data.points : null,
          message: 'połączenie działa, SMS-y trafiają do odbiorców.',
        };
      } catch {
        return { provider: 'smsapi', live: true, ok: false, points: null, message: 'Brak połączenia z bramką SMSAPI.' };
      }
    },
  };
}
