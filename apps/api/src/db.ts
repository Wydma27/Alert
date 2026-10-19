import { PrismaClient } from '@prisma/client';
import { env } from './env';
import { createFieldCrypto, parseKeyring } from './lib/crypto';

export const prisma = new PrismaClient();

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
} as const;
