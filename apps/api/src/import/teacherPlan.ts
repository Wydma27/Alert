// Import nauczycieli – porównanie z bazą i zapis. Dopasowanie: identyfikator, potem numer telefonu, potem imię i nazwisko.
import type { Teacher } from '@prisma/client';
import { CTX, fieldCrypto, prisma } from '../db';
import { foldKey } from '../lib/names';
import type { ImportedTeacher } from './teachers';

export interface TeacherPlan {
  toCreate: ImportedTeacher[];
  toUpdate: { existing: Teacher; incoming: ImportedTeacher }[];
  unchanged: number;
  toDelete: Teacher[];
}

const hmac = (e164: string) => fieldCrypto.blindIndex(e164, CTX.teacherPhone);
const nameKey = (last: string, first: string) => `${foldKey(last)}|${foldKey(first)}`;

export async function planTeachers(incoming: ImportedTeacher[], mode: 'upsert' | 'sync'): Promise<TeacherPlan> {
  const existing = await prisma.teacher.findMany();
  const byExternal = new Map(existing.filter((t) => t.externalId).map((t) => [t.externalId!, t]));
  const byPhone = new Map(existing.map((t) => [t.phoneHmac, t]));
  const byName = new Map(existing.map((t) => [nameKey(t.lastName, t.firstName), t]));
  const matched = new Set<number>();
  const plan: TeacherPlan = { toCreate: [], toUpdate: [], unchanged: 0, toDelete: [] };

  for (const t of incoming) {
    let match = (t.externalId && byExternal.get(t.externalId)) || byPhone.get(hmac(t.e164)) || byName.get(nameKey(t.lastName, t.firstName));
    if (match && matched.has(match.id)) match = undefined;
    if (!match) {
      plan.toCreate.push(t);
      continue;
    }
    matched.add(match.id);
    const changed =
      match.firstName !== t.firstName ||
      match.lastName !== t.lastName ||
      (match.position ?? null) !== t.position ||
      match.phoneHmac !== hmac(t.e164) ||
      (t.externalId !== null && match.externalId !== t.externalId);
    if (changed) plan.toUpdate.push({ existing: match, incoming: t });
    else plan.unchanged++;
  }
  if (mode === 'sync') plan.toDelete = existing.filter((t) => !matched.has(t.id));
  return plan;
}

export async function commitTeachers(plan: TeacherPlan) {
  return prisma.$transaction(
    async (tx) => {
      // Najpierw usunięcia – zwolnione numery mogą trafić do innych osób z pliku.
      if (plan.toDelete.length) await tx.teacher.deleteMany({ where: { id: { in: plan.toDelete.map((t) => t.id) } } });
      for (const { existing, incoming } of plan.toUpdate) {
        await tx.teacher.update({
          where: { id: existing.id },
          data: {
            firstName: incoming.firstName,
            lastName: incoming.lastName,
            position: incoming.position,
            externalId: incoming.externalId ?? existing.externalId,
            phoneHmac: hmac(incoming.e164),
            phoneEnc: fieldCrypto.encrypt(incoming.e164, CTX.teacherPhone),
          },
        });
      }
      for (const t of plan.toCreate) {
        await tx.teacher.create({
          data: {
            firstName: t.firstName,
            lastName: t.lastName,
            position: t.position,
            externalId: t.externalId,
            phoneHmac: hmac(t.e164),
            phoneEnc: fieldCrypto.encrypt(t.e164, CTX.teacherPhone),
          },
        });
      }
      return { created: plan.toCreate.length, updated: plan.toUpdate.length, deleted: plan.toDelete.length, classesCreated: 0, guardiansDeleted: 0 };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
