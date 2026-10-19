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
  status(): Promise<GatewayStatus>;
  /** Bramki, które pozwalają odpytać status (działa bez publicznego adresu na raporty). */
  checkStatus?(messageId: string): Promise<DlrStatus | null>;
}

/** Statusy doręczenia, na które mapujemy raporty bramek. */
export type DlrStatus = 'SENT' | 'DELIVERED' | 'UNDELIVERED' | 'FAILED';
