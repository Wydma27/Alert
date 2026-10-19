import type { User } from '@prisma/client';
import { prisma } from '../db';
import { writeAudit } from '../lib/audit';
import { HttpError } from '../lib/http';
import { verifySecret } from '../lib/password';

const MAX_PIN_FAILURES = 5;
const PIN_LOCK_MINUTES = 5;

/** PIN alarmowy: potwierdza start, zmianę i zakończenie alertu. Po 5 błędach – blokada na 5 minut (inna osoba może działać). */
export async function verifyLaunchPin(user: User, pin: string, ip: string): Promise<void> {
  if (!user.launchPinHash) throw new HttpError(409, 'Nie masz ustawionego PIN-u alarmowego – ustaw go w „Moje konto”.');
  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
    throw new HttpError(423, 'PIN zablokowany po błędnych próbach. Poczekaj 5 minut albo poproś inną osobę z dyrekcji.');
  }
  if (await verifySecret(user.launchPinHash, pin)) {
    if (user.pinFailed) await prisma.user.update({ where: { id: user.id }, data: { pinFailed: 0, pinLockedUntil: null } });
    return;
  }
  const failed = user.pinFailed + 1;
  const lock = failed >= MAX_PIN_FAILURES;
  await prisma.user.update({
    where: { id: user.id },
    data: lock ? { pinFailed: 0, pinLockedUntil: new Date(Date.now() + PIN_LOCK_MINUTES * 60_000) } : { pinFailed: failed },
  });
  await writeAudit({ action: 'alert.pin.failed', userId: user.id, ip, details: { locked: lock } });
  throw new HttpError(401, lock ? 'Błędny PIN. PIN został zablokowany na 5 minut.' : `Błędny PIN. Pozostało prób: ${MAX_PIN_FAILURES - failed}.`);
}
