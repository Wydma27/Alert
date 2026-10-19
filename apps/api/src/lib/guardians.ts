import type { Prisma } from '@prisma/client';
import { CTX, fieldCrypto } from '../db';
import { maskPhone } from './phone';

type Tx = Prisma.TransactionClient;

export function phoneHmac(e164: string): string {
  return fieldCrypto.blindIndex(e164, CTX.guardianPhone);
}

export function decryptGuardianPhone(phoneEnc: string): string {
  return fieldCrypto.decrypt(phoneEnc, CTX.guardianPhone);
}

export function maskedGuardianPhone(phoneEnc: string): string {
  return maskPhone(decryptGuardianPhone(phoneEnc));
}

/** Ten sam numer = ten sam opiekun (np. rodzeństwo w różnych klasach). */
export async function findOrCreateGuardian(tx: Tx, e164: string, displayName: string | null) {
  const hmac = phoneHmac(e164);
  const existing = await tx.guardian.findUnique({ where: { phoneHmac: hmac } });
  if (existing) {
    if (!existing.displayName && displayName) {
      return tx.guardian.update({ where: { id: existing.id }, data: { displayName } });
    }
    return existing;
  }
  return tx.guardian.create({
    data: { displayName, phoneHmac: hmac, phoneEnc: fieldCrypto.encrypt(e164, CTX.guardianPhone) },
  });
}

/** Usuwa opiekunów niepowiązanych z żadnym uczniem (minimalizacja danych). */
export async function deleteOrphanGuardians(tx: Tx): Promise<number> {
  const result = await tx.guardian.deleteMany({ where: { students: { none: {} } } });
  return result.count;
}
