/** Wspólny interfejs bramek SMS. */
export interface SendRequest {
  /** Numer E.164, np. +48600100200 */
  to: string;
  text: string;
  /** Nazwa nadawcy; brak = domyślny nadawca konta w bramce. */
  from?: string;
  /** Nasz identyfikator – wraca w raporcie doręczenia. */
  reference?: string;
}

/** Ta sama treść do wielu odbiorców – jedno zapytanie do bramki (pula). */
export interface BatchRequest {
  to: string[];
  text: string;
  from?: string;
}

export type SendResult =
  | { ok: true; messageId: string; status: string; parts: number | null; points: number | null }
  | {
      ok: false;
      error: string;
      code: string | null;
      /** Błąd przejściowy (sieć, przeciążenie) – warto ponowić później. */
      retryable: boolean;
      /** Problem po stronie bramki (token, środki, nadawca, awaria) – spróbuj bramki zapasowej. */
      failover: boolean;
      /** Bramka odrzuciła numer odbiorcy (nieprawidłowy / nieistniejący) – numer do poprawy w danych. */
      badRecipient?: boolean;
    };

export interface GatewayStatus {
  provider: string;
  /** true = prawdziwe SMS-y wychodzą do odbiorców */
  live: boolean;
  ok: boolean;
  /** Saldo w bramce (jeśli bramka je udostępnia). */
  points: number | null;
  message: string;
}

export interface SmsProvider {
  readonly name: string;
  readonly live: boolean;
  send(req: SendRequest): Promise<SendResult>;
  /** Wysyłka do wielu numerów jednym zapytaniem. Wyniki w tej samej kolejności co `to`. */
  sendBatch?(req: BatchRequest): Promise<SendResult[]>;
  status(): Promise<GatewayStatus>;
  /** Bramki, które pozwalają odpytać status (działa bez publicznego adresu na raporty). */
  checkStatus?(messageId: string): Promise<DlrStatus | null>;
  /** Nazwy nadawcy zatwierdzone na koncie; null = bramka nie podaje listy. */
  senders?(): Promise<string[] | null>;
}

/** Statusy doręczenia, na które mapujemy raporty bramek. */
export type DlrStatus = 'SENT' | 'DELIVERED' | 'UNDELIVERED' | 'FAILED';

/** Same cyfry numeru – bramki zwracają numery w różnych formatach (z "+" lub bez). */
export function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Ten sam błąd dla wszystkich numerów z paczki (np. awaria sieci). */
export function failAll(count: number, result: Extract<SendResult, { ok: false }>): SendResult[] {
  return Array.from({ length: count }, () => ({ ...result }));
}
