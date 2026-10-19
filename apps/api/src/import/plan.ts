// Porównanie pliku z bazą (podgląd zmian) i zapis w jednej transakcji.
import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { deleteOrphanGuardians, findOrCreateGuardian, phoneHmac } from '../lib/guardians';
import { compareClassNames } from '../lib/names';
import { studentNameKey, type ImportedStudent } from './build';

export type ImportMode = 'upsert' | 'sync';

type ExistingStudent = Prisma.StudentGetPayload<{
  include: { schoolClass: true; guardians: { include: { guardian: { select: { phoneHmac: true } } } } };
}>;

export interface ImportPlan {
  toCreate: ImportedStudent[];
  toUpdate: { existing: ExistingStudent; incoming: ImportedStudent }[];
  unchanged: number;
  toDelete: ExistingStudent[];
  newClasses: string[];
}

function guardianSignature(pairs: { hmac: string; priority: number }[]) {
  return pairs
    .map((p) => `${p.priority}:${p.hmac}`)
    .sort()
    .join(',');
}

function isChanged(existing: ExistingStudent, incoming: ImportedStudent): boolean {
  if (existing.firstName !== incoming.firstName) return true;
  if (existing.lastName !== incoming.lastName) return true;
  if (existing.schoolClass.name !== incoming.className) return true;
  if (incoming.externalId && existing.externalId !== incoming.externalId) return true;
  const before = guardianSignature(existing.guardians.map((g) => ({ hmac: g.guardian.phoneHmac, priority: g.priority })));
  const after = guardianSignature(incoming.guardians.map((g) => ({ hmac: phoneHmac(g.e164), priority: g.priority })));
  return before !== after;
}

export async function buildPlan(students: ImportedStudent[], mode: ImportMode): Promise<ImportPlan> {
  const existing = await prisma.student.findMany({
    include: { schoolClass: true, guardians: { include: { guardian: { select: { phoneHmac: true } } } } },
  });
  const byExternal = new Map<string, ExistingStudent>();
  const byName = new Map<string, ExistingStudent>();
  for (const s of existing) {
    if (s.externalId) byExternal.set(s.externalId, s);
    byName.set(studentNameKey(s.lastName, s.firstName, s.schoolClass.name), s);
  }

  const matched = new Set<number>();
  const plan: ImportPlan = { toCreate: [], toUpdate: [], unchanged: 0, toDelete: [], newClasses: [] };

  for (const incoming of students) {
    // Najpierw po identyfikatorze z dziennika, potem po imieniu, nazwisku i klasie.
    let match = incoming.externalId ? byExternal.get(incoming.externalId) : undefined;
    if (!match) {
      const byNameMatch = byName.get(incoming.nameKey);
      // Nie łączymy z uczniem, który ma inny identyfikator z dziennika (to inna osoba).
      if (byNameMatch && (!byNameMatch.externalId || !incoming.externalId)) match = byNameMatch;
    }
    if (match && matched.has(match.id)) match = undefined;

    if (!match) {
      plan.toCreate.push(incoming);
      continue;
    }
    matched.add(match.id);
    if (isChanged(match, incoming)) plan.toUpdate.push({ existing: match, incoming });
    else plan.unchanged++;
  }

  if (mode === 'sync') plan.toDelete = existing.filter((s) => !matched.has(s.id));

  const existingClasses = new Set((await prisma.schoolClass.findMany({ select: { name: true } })).map((c) => c.name));
  plan.newClasses = [...new Set(students.map((s) => s.className))]
    .filter((name) => !existingClasses.has(name))
    .sort(compareClassNames);
  return plan;
}

export async function commitPlan(plan: ImportPlan) {
  return prisma.$transaction(
    async (tx) => {
      // Klasy
      for (const name of plan.newClasses) await tx.schoolClass.create({ data: { name } });
      const classes = await tx.schoolClass.findMany({ select: { id: true, name: true } });
      const classId = new Map(classes.map((c) => [c.name, c.id]));

      // Opiekunowie (ten sam numer = ten sam opiekun)
      const guardianIdByPhone = new Map<string, number>();
      const allIncoming = [...plan.toCreate, ...plan.toUpdate.map((u) => u.incoming)];
      for (const s of allIncoming) {
        for (const g of s.guardians) {
          if (guardianIdByPhone.has(g.e164)) continue;
          const guardian = await findOrCreateGuardian(tx, g.e164, g.name);
          guardianIdByPhone.set(g.e164, guardian.id);
        }
      }

      // Nowi uczniowie
      for (const s of plan.toCreate) {
        await tx.student.create({
          data: {
            firstName: s.firstName,
            lastName: s.lastName,
            externalId: s.externalId,
            classId: classId.get(s.className)!,
            guardians: {
              create: s.guardians.map((g) => ({ guardianId: guardianIdByPhone.get(g.e164)!, priority: g.priority })),
            },
          },
        });
      }

      // Zmienieni uczniowie: dane + opiekunowie z pliku (zachowujemy ręcznie ustawione flagi istniejących powiązań)
      for (const { existing, incoming } of plan.toUpdate) {
        await tx.student.update({
          where: { id: existing.id },
          data: {
            firstName: incoming.firstName,
            lastName: incoming.lastName,
            externalId: incoming.externalId ?? existing.externalId,
            classId: classId.get(incoming.className)!,
          },
        });
        const wanted = new Map(incoming.guardians.map((g) => [guardianIdByPhone.get(g.e164)!, g.priority]));
        await tx.studentGuardian.deleteMany({
          where: { studentId: existing.id, guardianId: { notIn: [...wanted.keys()] } },
        });
        for (const [guardianId, priority] of wanted) {
          await tx.studentGuardian.upsert({
            where: { studentId_guardianId: { studentId: existing.id, guardianId } },
            create: { studentId: existing.id, guardianId, priority },
            update: { priority },
          });
        }
      }

      // Tryb synchronizacji: uczniowie spoza pliku są usuwani
      let deleted = 0;
      if (plan.toDelete.length) {
        const result = await tx.student.deleteMany({ where: { id: { in: plan.toDelete.map((s) => s.id) } } });
        deleted = result.count;
      }

      const guardiansDeleted = await deleteOrphanGuardians(tx);
      return {
        created: plan.toCreate.length,
        updated: plan.toUpdate.length,
        deleted,
        classesCreated: plan.newClasses.length,
        guardiansDeleted,
      };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
