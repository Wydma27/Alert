import { PrismaClient } from '@prisma/client';
import { env } from './env';
import { createFieldCrypto, parseKeyring } from './lib/crypto';

/** Przy awarii bazy zapytania mają szybko zwracać błąd (tryb awaryjny), a nie czekać kilkanaście sekund. */
function withTimeouts(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('connect_timeout')) parsed.searchParams.set('connect_timeout', '5');
    if (!parsed.searchParams.has('pool_timeout')) parsed.searchParams.set('pool_timeout', '5');
    return parsed.toString();
  } catch {
    return url;
  }
}

export const prisma = new PrismaClient({ datasources: { db: { url: withTimeouts(env.DATABASE_URL) } } });

export const fieldCrypto = createFieldCrypto(
  parseKeyring(env.ENCRYPTION_KEYS, env.ENCRYPTION_ACTIVE_KEY_ID, env.BLIND_INDEX_KEY),
);

/** Konteksty AAD/HMAC – nie zmieniać po wdrożeniu (dane przestaną się odszyfrowywać). */
export const CTX = {
  guardianPhone: 'guardian.phone',
  testPhone: 'test.phone',
  /** Kopia numeru odbiorcy w kolejce wysyłki (przeżywa zmianę/usunięcie opiekuna w trakcie alertu). */
  deliveryPhone: 'delivery.phone',
  userPhone: 'user.phone',
  totpSecret: 'user.totp',
  teacherPhone: 'teacher.phone',
  studentPhone: 'student.phone',
  /** Kopia awaryjna kontaktów i kont na dysku serwera (do pracy bez bazy). */
  snapshot: 'emergency.snapshot',
  /** Dziennik wysyłek awaryjnych czekających na zapis w bazie. */
  journal: 'emergency.journal',
} as const;
