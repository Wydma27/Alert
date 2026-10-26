// Łańcuch bramek: główna, a przy jej awarii zapasowa ("bezpiecznik" wyłącza na chwilę bramkę,
// która kilka razy z rzędu zawiodła). Przy przekroczeniu czasu odpowiedzi możliwy jest duplikat SMS-a
// – świadomie: w alarmie lepiej dwa SMS-y niż żaden.
import type { BatchRequest, GatewayStatus, SendRequest, SendResult, SmsProvider } from './provider';
import { runPool } from './retry';

export type ChainResult = SendResult & { provider: string };

export interface BatchOptions {
  /** Wywoływane przed każdym zapytaniem do bramki (limit zapytań na sekundę). */
  limit?: () => Promise<void>;
  /** Ile pojedynczych zapytań naraz, gdy bramka nie przyjmuje paczek. */
  concurrency?: number;
}

export interface SenderChain {
  readonly live: boolean;
  readonly providers: readonly SmsProvider[];
  send(req: SendRequest): Promise<ChainResult>;
  /** Ta sama treść do wielu numerów: paczką (jeśli bramka pozwala) albo pulą pojedynczych zapytań. Wyniki w kolejności `to`. */
  sendBatch(req: BatchRequest, opts?: BatchOptions): Promise<ChainResult[]>;
  /** Nazwy nadawcy zatwierdzone w bramce głównej; null = bramka nie podaje listy. */
  senders(): Promise<string[] | null>;
  status(): Promise<GatewayStatus[]>;
}

export function createSenderChain(
  providers: SmsProvider[],
  opts: { threshold?: number; cooldownMs?: number; now?: () => number } = {},
): SenderChain {
  if (providers.length === 0) throw new Error('Brak skonfigurowanej bramki SMS');
  const threshold = opts.threshold ?? 3;
  const cooldownMs = opts.cooldownMs ?? 60_000;
  const now = opts.now ?? Date.now;
  const failures = new Map<string, number>();
  const openUntil = new Map<string, number>();

  const available = () => {
    const ready = providers.filter((p) => (openUntil.get(p.name) ?? 0) <= now());
    // Gdy wszystkie mają otwarty bezpiecznik – próbujemy mimo to (lepiej spróbować niż nie wysłać).
    return ready.length ? ready : providers;
  };

  /** Wynik całej próby u jednej bramki – do bezpiecznika. */
  const record = (provider: SmsProvider, results: SendResult[]) => {
    if (results.some((r) => r.ok || !r.failover)) {
      failures.set(provider.name, 0);
      return;
    }
    const count = (failures.get(provider.name) ?? 0) + 1;
    failures.set(provider.name, count);
    if (count >= threshold) {
      openUntil.set(provider.name, now() + cooldownMs);
      failures.set(provider.name, 0);
    }
  };

  return {
    live: providers.some((p) => p.live),
    providers,

    async sendBatch(req, opts = {}) {
      const results = new Array<ChainResult>(req.to.length);
      let pending = req.to.map((_, i) => i);
      for (const provider of available()) {
        if (pending.length === 0) break;
        const numbers = pending.map((i) => req.to[i]!);
        let batch: SendResult[];
        if (provider.sendBatch && numbers.length > 1) {
          await opts.limit?.();
          batch = await provider.sendBatch({ ...req, to: numbers });
        } else {
          batch = await runPool(numbers, opts.concurrency ?? 5, async (to) => {
            await opts.limit?.();
            return provider.send({ to, text: req.text, from: req.from });
          });
        }
        record(provider, batch);
        const retry: number[] = [];
        batch.forEach((r, j) => {
          const i = pending[j]!;
          results[i] = { ...r, provider: provider.name };
          if (!r.ok && r.failover) retry.push(i); // awaria tej bramki – próbujemy następnej
        });
        pending = retry;
      }
      return results;
    },

    async senders() {
      const primary = available()[0]!;
      return primary.senders ? primary.senders() : null;
    },

    async send(req) {
      let last: ChainResult | null = null;
      for (const provider of available()) {
        const result = await provider.send(req);
        record(provider, [result]);
        last = { ...result, provider: provider.name };
        if (result.ok || !result.failover) return last; // sukces albo problem z odbiorcą – inna bramka nie pomoże
      }
      return last!;
    },

    async status() {
      return Promise.all(providers.map((p) => p.status()));
    },
  };
}
