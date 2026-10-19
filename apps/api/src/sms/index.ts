import { env } from '../env';
import { createFakeProvider } from './fake';
import { createSenderChain, type SenderChain } from './failover';
import type { SmsProvider } from './provider';
import { createSerwerSmsProvider } from './serwersms';
import { createSmsFlyProvider } from './smsfly';
import { createSmsApiProvider } from './smsapi';

function webhookUrl(provider: string, query: string): string | undefined {
  if (!env.SMS_CALLBACK_BASE_URL || !env.SMS_WEBHOOK_TOKEN) return undefined;
  const base = env.SMS_CALLBACK_BASE_URL.replace(/\/$/, '');
  return `${base}/api/webhooks/${provider}?token=${encodeURIComponent(env.SMS_WEBHOOK_TOKEN)}${query}`;
}

function build(name: 'fake' | 'smsfly' | 'smsapi' | 'serwersms'): SmsProvider {
  switch (name) {
    case 'smsfly':
      return createSmsFlyProvider({ apiKey: env.SMSFLY_API_KEY!, url: env.SMSFLY_API_URL, ttlMinutes: env.SMSFLY_TTL_MINUTES });
    case 'smsapi':
      return createSmsApiProvider({ token: env.SMSAPI_TOKEN!, baseUrl: env.SMSAPI_URL, notifyUrl: webhookUrl('smsapi', '') });
    case 'serwersms':
      return createSerwerSmsProvider({
        token: env.SERWERSMS_TOKEN!,
        baseUrl: env.SERWERSMS_URL,
        dlrUrl: webhookUrl('serwersms', '&id=#SMSID#&stan=#STAN#'),
      });
    default:
      return createFakeProvider();
  }
}

let chain: SenderChain | null = null;
let simulator: SmsProvider | null = null;

/** Bramki z .env: główna + opcjonalnie zapasowa. Klucze wyłącznie ze zmiennych środowiskowych. */
export function getSender(): SenderChain {
  if (!chain) {
    const providers = [build(env.SMS_PROVIDER)];
    if (env.SMS_PROVIDER !== 'fake' && env.SMS_BACKUP_PROVIDER !== 'none' && env.SMS_BACKUP_PROVIDER !== env.SMS_PROVIDER) {
      providers.push(build(env.SMS_BACKUP_PROVIDER));
    }
    chain = createSenderChain(providers);
  }
  return chain;
}

/** Bramka udawana – do SMS-ów symulowanych w trybie ćwiczeń. */
export function getSimulator(): SmsProvider {
  simulator ??= createFakeProvider();
  return simulator;
}
