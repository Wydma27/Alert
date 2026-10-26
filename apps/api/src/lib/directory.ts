// Książka kontaktów z bazy: nauczyciele, uczniowie (własny telefon), rodzice (opiekunowie z włączonymi SMS-ami).
import type { Directory, DirectoryPerson } from '@alert/shared';
import { CTX, fieldCrypto, prisma } from '../db';
import { compareClassNames } from './names';

/**
 * @param withPhones true = z odszyfrowanymi numerami (tylko do wysyłki i kopii awaryjnych – nigdy do listy w przeglądarce).
 */
export async function loadDirectory(withPhones: boolean): Promise<Directory> {
  const [classes, teachers, students, guardians] = await Promise.all([
    prisma.schoolClass.findMany({ select: { id: true, name: true } }),
    prisma.teacher.findMany({ orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] }),
    prisma.student.findMany({ include: { schoolClass: { select: { name: true } } } }),
    prisma.guardian.findMany({
      where: { students: { some: { receivesAlerts: true } } },
      include: {
        students: {
          where: { receivesAlerts: true },
          include: { student: { select: { id: true, firstName: true, lastName: true, classId: true, schoolClass: { select: { name: true } } } } },
        },
      },
    }),
  ]);
  classes.sort((a, b) => compareClassNames(a.name, b.name));
  const classOrder = new Map(classes.map((c, i) => [c.id, i]));
  const byClassAndName = (a: { classId: number; lastName: string; firstName: string }, b: typeof a) =>
    (classOrder.get(a.classId) ?? 0) - (classOrder.get(b.classId) ?? 0) ||
    a.lastName.localeCompare(b.lastName, 'pl') ||
    a.firstName.localeCompare(b.firstName, 'pl');

  const phone = (enc: string | null, ctx: string) => (withPhones && enc ? { phone: fieldCrypto.decrypt(enc, ctx) } : {});
  const people: DirectoryPerson[] = [];

  for (const t of teachers) {
    people.push({
      key: `t:${t.id}`,
      group: 'TEACHERS',
      name: `${t.firstName} ${t.lastName}`,
      classIds: [],
      detail: t.position ?? 'nauczyciel',
      hasPhone: true,
      ...phone(t.phoneEnc, CTX.teacherPhone),
    });
  }

  for (const s of [...students].sort(byClassAndName)) {
    people.push({
      key: `s:${s.id}`,
      group: 'STUDENTS',
      name: `${s.firstName} ${s.lastName}`,
      classIds: [s.classId],
      detail: `kl. ${s.schoolClass.name}`,
      hasPhone: Boolean(s.phoneEnc),
      ...phone(s.phoneEnc, CTX.studentPhone),
    });
  }

  const parents = guardians
    .map((g) => {
      const children = g.students.map((l) => l.student).sort(byClassAndName);
      return { g, children };
    })
    .filter((p) => p.children.length > 0)
    .sort((a, b) => byClassAndName(a.children[0]!, b.children[0]!));
  for (const { g, children } of parents) {
    const childList = children.map((c) => `${c.firstName} ${c.lastName} (${c.schoolClass.name})`).join(', ');
    people.push({
      key: `p:${g.id}`,
      group: 'PARENTS',
      name: g.displayName ?? `Opiekun: ${children[0]!.firstName} ${children[0]!.lastName}`,
      classIds: [...new Set(children.map((c) => c.classId))],
      detail: `dzieci: ${childList}`,
      hasPhone: true,
      ...phone(g.phoneEnc, CTX.guardianPhone),
    });
  }

  return { generatedAt: new Date().toISOString(), classes, people };
}

/** Lista dla przeglądarki – bez numerów. */
export function withoutPhones(directory: Directory): Directory {
  return { ...directory, people: directory.people.map(({ phone: _phone, ...p }) => p) };
}
