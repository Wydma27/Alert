// Łańcuch bramek: główna, a przy jej awarii zapasowa ("bezpiecznik" wyłącza na chwilę bramkę,
// która kilka razy z rzędu zawiodła). Przy przekroczeniu czasu odpowiedzi możliwy jest duplikat SMS-a
// – świadomie: w alarmie lepiej dwa SMS-y niż żaden.
import type { GatewayStatus, SendRequest, SendResult, SmsProvider } from './provider';

export type ChainResult = SendResult & { provider: string };

export interface SenderChain {
  readonly live: boolean;
  readonly providers: readonly SmsProvider[];
  send(req: SendRequest): Promise<ChainResult>;
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

  return {
    live: providers.some((p) => p.live),
    providers,

    async send(req) {
      let last: ChainResult | null = null;
      for (const provider of available()) {
        const result = await provider.send(req);
        if (result.ok) {
          failures.set(provider.name, 0);
          return { ...result, provider: provider.name };
        }
        last = { ...result, provider: provider.name };
        if (!result.failover) return last; // problem z odbiorcą – inna bramka nie pomoże
        const count = (failures.get(provider.name) ?? 0) + 1;
        failures.set(provider.name, count);
        if (count >= threshold) {
          openUntil.set(provider.name, now() + cooldownMs);
          failures.set(provider.name, 0);
        }
      }
      return last!;
    },

    async status() {
      return Promise.all(providers.map((p) => p.status()));
    },
  };
}
