import { z } from 'zod';

const base64Key = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'klucz musi mieć 32 bajty zakodowane w base64');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().default(3000),
  /** 127.0.0.1 = tylko ten komputer; 0.0.0.0 = dostęp z innych urządzeń w sieci (np. test na telefonie). */
  API_HOST: z.string().default('127.0.0.1'),
  APP_URL: z.string().url().default('http://localhost:5180'),
  APP_NAME: z.string().default('Alert Szkolny'),
  ENCRYPTION_KEYS: z.string().min(1),
  ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1),
  BLIND_INDEX_KEY: base64Key,
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),
  LOGIN_MAX_FAILED: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  /** fake = nic nie wychodzi (lokalnie, testy); smsfly / smsapi / serwersms = prawdziwe SMS-y */
  SMS_PROVIDER: z.enum(['fake', 'smsfly', 'smsapi', 'serwersms']).default('fake'),
  /** Bramka zapasowa używana, gdy główna zawodzi. */
  SMS_BACKUP_PROVIDER: z.enum(['none', 'smsfly', 'smsapi', 'serwersms']).default('none'),
  /** SMS-fly: klucz API i adres z panelu (Integracja / Ustawienia API). */
  SMSFLY_API_KEY: z.string().trim().optional(),
  SMSFLY_API_URL: z.string().url().default('https://sms-fly.pl/api/v2/api.php'),
  /** Jak długo operator ma próbować doręczyć SMS (minuty, 1–1440). Po tym czasie alarm i tak jest nieaktualny. */
  SMSFLY_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(240),
  SMSAPI_TOKEN: z.string().trim().optional(),
  SMSAPI_URL: z.string().url().default('https://api.smsapi.pl'),
  SERWERSMS_TOKEN: z.string().trim().optional(),
  SERWERSMS_URL: z.string().url().default('https://api2.serwersms.pl'),
  /** true = wysyłaj bez nazwy nadawcy (domyślny nadawca konta), np. zanim bramka zatwierdzi nazwę szkoły. */
  SMS_USE_DEFAULT_SENDER: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Limit wysyłki (SMS/s) – dopasuj do limitu konta w bramce. */
  SMS_RATE_PER_SECOND: z.coerce.number().positive().default(10),
  /** Publiczny adres HTTPS aplikacji, pod który bramki odsyłają raporty doręczeń (po wdrożeniu na serwer). */
  SMS_CALLBACK_BASE_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  SMS_WEBHOOK_TOKEN: z.string().optional(),
  /** Tryb fake: odsetek SMS-ów oznaczanych jako niedoręczone (do ćwiczenia ścieżki "nie dotarło"). */
  FAKE_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.05),
  /** Po ilu dniach od zakończenia alertu anonimizować dane osobowe (treści SMS, numery, nazwiska). */
  ALERT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
}).superRefine((v, ctx) => {
  const used = new Set<string>([v.SMS_PROVIDER, v.SMS_BACKUP_PROVIDER]);
  if (used.has('smsfly') && !v.SMSFLY_API_KEY) {
    ctx.addIssue({ code: 'custom', path: ['SMSFLY_API_KEY'], message: 'wymagany, gdy używasz bramki smsfly (klucz z panelu SMS-fly → Ustawienia API)' });
  }
  if (used.has('smsapi') && !v.SMSAPI_TOKEN) {
    ctx.addIssue({ code: 'custom', path: ['SMSAPI_TOKEN'], message: 'wymagany, gdy używasz bramki smsapi (token z panelu SMSAPI)' });
  }
  if (used.has('serwersms') && !v.SERWERSMS_TOKEN) {
    ctx.addIssue({ code: 'custom', path: ['SERWERSMS_TOKEN'], message: 'wymagany, gdy używasz bramki serwersms (token z panelu SerwerSMS)' });
  }
  if (v.SMS_CALLBACK_BASE_URL && (!v.SMS_WEBHOOK_TOKEN || v.SMS_WEBHOOK_TOKEN.length < 16)) {
    ctx.addIssue({ code: 'custom', path: ['SMS_WEBHOOK_TOKEN'], message: 'ustaw losowy token (min. 16 znaków) do zabezpieczenia raportów doręczeń' });
  }
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Nieprawidłowa konfiguracja (.env):\n${problems}\nUruchom "npm run setup", aby wygenerować .env.`);
  }
  return parsed.data;
}

export const env = load();
export const isProduction = env.NODE_ENV === 'production';
