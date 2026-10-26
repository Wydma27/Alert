// SMSAPI.pl: POST /sms.do, autoryzacja tokenem OAuth (Bearer).
// Raporty doręczeń: callback GET z parametrami MsgId, status (kod 401–412), odpowiedź "OK".
// Pule: ta sama treść do wielu numerów jednym zapytaniem ("to" po przecinku, zalecane do 10 000 numerów).
import { digitsOnly, failAll, type DlrStatus, type SendResult, type SmsProvider } from './provider';

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
  list?: { id: string; number?: string; submitted_number?: string; status?: string; points?: number; parts?: number }[];
  invalid_numbers?: { number?: string; submitted_number?: string; message?: string }[];
}

/** Zalecany przez SMSAPI limit numerów w jednym zapytaniu. */
export const SMSAPI_MAX_BATCH = 10_000;

export function createSmsApiProvider(opts: {
  token: string;
  baseUrl: string;
  notifyUrl?: string;
  fetchImpl?: typeof fetch;
}): SmsProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${opts.token}` };

  /**
   * Jedna treść do wielu numerów: "to" = numery po przecinku. Wyniki dopasowujemy po numerze
   * (pole "number" / "submitted_number"), odrzucone numery przychodzą w "invalid_numbers".
   */
  async function sendMany(numbers: string[], text: string, from?: string, reference?: string): Promise<SendResult[]> {
    const body = new URLSearchParams({
      to: numbers.map((n) => n.replace(/^\+/, '')).join(','),
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
        signal: AbortSignal.timeout(TIMEOUT_MS + numbers.length * 5),
      });
    } catch {
      return failAll(numbers.length, {
        ok: false,
        error: 'Brak połączenia z bramką SMSAPI (sieć lub limit czasu).',
        code: null,
        retryable: true,
        failover: true,
      });
    }

    const data = (await res.json().catch(() => null)) as SmsApiResponse | null;
    if (data?.error !== undefined && data.error !== null) {
      const code = String(data.error);
      const recipient = RECIPIENT_ERRORS.has(code);
      return failAll(numbers.length, {
        ok: false,
        code,
        error: ERRORS[code] ?? `SMSAPI: ${data.message ?? 'błąd'} (kod ${code})`,
        retryable: false,
        failover: !recipient,
        badRecipient: code === '13',
      });
    }
    if (!res.ok || !data?.list) {
      const transient = res.status === 429 || res.status >= 500;
      return failAll(numbers.length, {
        ok: false,
        code: `HTTP ${res.status}`,
        error: `Bramka SMSAPI zwróciła błąd HTTP ${res.status}.`,
        retryable: transient,
        failover: true,
      });
    }

    const list = data.list;
    const sent = new Map<string, (typeof list)[number]>();
    for (const item of list) {
      for (const n of [item.number, item.submitted_number]) if (n) sent.set(digitsOnly(n), item);
    }
    const invalid = new Map<string, string>();
    for (const item of data.invalid_numbers ?? []) {
      for (const n of [item.number, item.submitted_number]) if (n) invalid.set(digitsOnly(n), item.message ?? 'nieprawidłowy numer');
    }
    // Starsze odpowiedzi (i pojedyncza wysyłka) bywają bez pola "number" – wtedy po kolejności.
    const byIndex = sent.size === 0 && list.length === numbers.length;

    return numbers.map((n, i): SendResult => {
      const item = byIndex ? list[i] : sent.get(digitsOnly(n));
      if (item?.id) {
        return { ok: true, messageId: item.id, status: item.status ?? 'QUEUE', parts: item.parts ?? null, points: item.points ?? null };
      }
      const reason = invalid.get(digitsOnly(n));
      if (reason !== undefined) {
        return {
          ok: false,
          code: '13',
          error: `SMSAPI odrzuciło numer odbiorcy (${reason}).`,
          retryable: false,
          failover: false,
          badRecipient: true,
        };
      }
      return { ok: false, code: null, error: 'SMSAPI nie potwierdziło wysyłki na ten numer.', retryable: false, failover: false };
    });
  }

  return {
    name: 'smsapi',
    live: true,

    async send({ to, text, from, reference }): Promise<SendResult> {
      return (await sendMany([to], text, from, reference))[0]!;
    },

    async sendBatch({ to, text, from }): Promise<SendResult[]> {
      const results: SendResult[] = [];
      for (let i = 0; i < to.length; i += SMSAPI_MAX_BATCH) {
        results.push(...(await sendMany(to.slice(i, i + SMSAPI_MAX_BATCH), text, from)));
      }
      return results;
    },

    async senders() {
      try {
        const res = await doFetch(`${opts.baseUrl}/sms/sendernames`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) return null;
        const data = (await res.json().catch(() => null)) as { collection?: { sender?: string; status?: string }[] } | null;
        if (!Array.isArray(data?.collection)) return null;
        return data.collection.filter((c) => c.status === 'ACTIVE' && c.sender).map((c) => c.sender!);
      } catch {
        return null;
      }
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
