import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DATA_VIEW_ROLES, type StudentDetailDto, type StudentListItemDto } from '@alert/shared';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import {
  decryptGuardianPhone,
  deleteOrphanGuardians,
  findOrCreateGuardian,
  maskedGuardianPhone,
  phoneHmac,
} from '../lib/guardians';
import { HttpError, idParam, parseOr400 } from '../lib/http';
import { compareClassNames, normalizePersonName } from '../lib/names';
import { formatPhone, maskPhone, normalizePhone } from '../lib/phone';
import { CTX, fieldCrypto } from '../db';
import { requireRole } from '../auth/session';

export function studentPhoneHmac(e164: string): string {
  return fieldCrypto.blindIndex(e164, CTX.studentPhone);
}

const studentSchema = z.object({
  classId: z.number().int().positive(),
  firstName: z.string().trim().min(1).max(60).transform(normalizePersonName),
  lastName: z.string().trim().min(1).max(80).transform(normalizePersonName),
  externalId: z.string().trim().max(60).transform((v) => v || null).nullable().optional(),
});

const phoneField = z.string().transform((raw, ctx) => {
  const result = normalizePhone(raw);
  if (!result.ok) {
    ctx.addIssue({ code: 'custom', message: result.error });
    return z.NEVER;
  }
  return result.e164;
});

const guardianLinkSchema = z.object({
  displayName: z.string().trim().max(100).transform((v) => v || null).nullable().optional(),
  phone: phoneField,
  priority: z.number().int().min(1).max(9).default(1),
  receivesAlerts: z.boolean().default(true),
  canPickUp: z.boolean().default(true),
});

const guardianLinkUpdateSchema = z.object({
  displayName: z.string().trim().max(100).transform((v) => v || null).nullable().optional(),
  phone: phoneField.optional(),
  priority: z.number().int().min(1).max(9).optional(),
  receivesAlerts: z.boolean().optional(),
  canPickUp: z.boolean().optional(),
});

const studentInclude = {
  schoolClass: { select: { name: true } },
  guardians: { include: { guardian: true }, orderBy: { priority: 'asc' } },
} satisfies Prisma.StudentInclude;

type StudentWithRelations = Prisma.StudentGetPayload<{ include: typeof studentInclude }>;

function toListItem(s: StudentWithRelations): StudentListItemDto {
  return {
    id: s.id,
    firstName: s.firstName,
    lastName: s.lastName,
    classId: s.classId,
    className: s.schoolClass.name,
    externalId: s.externalId,
    guardianCount: s.guardians.length,
    alertableGuardianCount: s.guardians.filter((g) => g.receivesAlerts).length,
    hasOwnPhone: Boolean(s.phoneEnc),
  };
}

function toDetail(s: StudentWithRelations): StudentDetailDto {
  return {
    ...toListItem(s),
    phoneMasked: s.phoneEnc ? maskPhone(fieldCrypto.decrypt(s.phoneEnc, CTX.studentPhone)) : null,
    guardians: s.guardians.map((link) => ({
      guardianId: link.guardianId,
      displayName: link.guardian.displayName,
      phoneMasked: maskedGuardianPhone(link.guardian.phoneEnc),
      priority: link.priority,
      receivesAlerts: link.receivesAlerts,
      canPickUp: link.canPickUp,
    })),
  };
}

async function loadStudent(id: number) {
  const student = await prisma.student.findUnique({ where: { id }, include: studentInclude });
  if (!student) throw new HttpError(404, 'Nie ma takiego ucznia.');
  return student;
}

export async function studentRoutes(app: FastifyInstance) {
  const canView = { preHandler: requireRole(...DATA_VIEW_ROLES) };
  const canEdit = { preHandler: requireRole('ADMIN') };

  app.get('/students', canView, async (req): Promise<StudentListItemDto[]> => {
    const query = parseOr400(
      z.object({
        classId: z.coerce.number().int().positive().optional(),
        q: z.string().trim().max(60).optional(),
        withoutPhone: z.enum(['1']).optional(),
      }),
      req.query,
    );
    const where: Prisma.StudentWhereInput = {};
    if (query.classId) where.classId = query.classId;
    if (query.q) {
      // Każde słowo musi pasować do imienia lub nazwiska ("jan kow" znajdzie Jana Kowalskiego).
      where.AND = query.q.split(/\s+/).map((part) => ({
        OR: [
          { firstName: { contains: part, mode: 'insensitive' as const } },
          { lastName: { contains: part, mode: 'insensitive' as const } },
        ],
      }));
    }
    if (query.withoutPhone) where.guardians = { none: { receivesAlerts: true } };
    const students = await prisma.student.findMany({ where, include: studentInclude, take: 2000 });
    return students
      .map(toListItem)
      .sort(
        (a, b) =>
          compareClassNames(a.className, b.className) ||
          a.lastName.localeCompare(b.lastName, 'pl') ||
          a.firstName.localeCompare(b.firstName, 'pl'),
      );
  });

  app.get('/students/:id', canView, async (req): Promise<StudentDetailDto> => {
    const student = await loadStudent(idParam(req.params));
    await audit(req, { action: 'student.view', entity: 'student', entityId: student.id });
    return toDetail(student);
  });

  app.post('/students', canEdit, async (req) => {
    const data = parseOr400(studentSchema, req.body);
    const created = await prisma.student.create({ data });
    await audit(req, { action: 'student.create', entity: 'student', entityId: created.id });
    return toDetail(await loadStudent(created.id));
  });

  app.put('/students/:id', canEdit, async (req) => {
    const id = idParam(req.params);
    const data = parseOr400(studentSchema, req.body);
    await prisma.student.update({ where: { id }, data });
    await audit(req, { action: 'student.update', entity: 'student', entityId: id });
    return toDetail(await loadStudent(id));
  });

  app.delete('/students/:id', canEdit, async (req) => {
    const id = idParam(req.params);
    const guardians = await prisma.$transaction(async (tx) => {
      await tx.student.delete({ where: { id } });
      const removed = await deleteOrphanGuardians(tx);
      await audit(req, { action: 'student.delete', entity: 'student', entityId: id, details: { guardiansRemoved: removed } }, tx);
      return removed;
    });
    return { ok: true, deletedGuardians: guardians };
  });

  // --- Własny telefon ucznia (grupa "Uczniowie") ---

  app.put('/students/:id/phone', canEdit, async (req) => {
    const id = idParam(req.params);
    const { phone } = parseOr400(z.object({ phone: phoneField.nullable() }), req.body);
    await prisma.student.update({
      where: { id },
      data: phone
        ? { phoneEnc: fieldCrypto.encrypt(phone, CTX.studentPhone), phoneHmac: studentPhoneHmac(phone) }
        : { phoneEnc: null, phoneHmac: null },
    });
    await audit(req, { action: phone ? 'student.phone.set' : 'student.phone.remove', entity: 'student', entityId: id });
    return toDetail(await loadStudent(id));
  });

  app.get('/students/:id/phone', canView, async (req) => {
    const id = idParam(req.params);
    const student = await prisma.student.findUnique({ where: { id } });
    if (!student?.phoneEnc) throw new HttpError(404, 'Uczeń nie ma własnego numeru.');
    await audit(req, { action: 'student.phone.reveal', entity: 'student', entityId: id });
    return { phone: formatPhone(fieldCrypto.decrypt(student.phoneEnc, CTX.studentPhone)) };
  });

  // --- Opiekunowie ucznia ---

  app.post('/students/:id/guardians', canEdit, async (req) => {
    const studentId = idParam(req.params);
    const data = parseOr400(guardianLinkSchema, req.body);
    await prisma.$transaction(async (tx) => {
      const guardian = await findOrCreateGuardian(tx, data.phone, data.displayName ?? null);
      const exists = await tx.studentGuardian.findUnique({
        where: { studentId_guardianId: { studentId, guardianId: guardian.id } },
      });
      if (exists) throw new HttpError(409, 'Ten numer jest już przypisany do tego ucznia.');
      await tx.studentGuardian.create({
        data: {
          studentId,
          guardianId: guardian.id,
          priority: data.priority,
          receivesAlerts: data.receivesAlerts,
          canPickUp: data.canPickUp,
        },
      });
      await audit(req, { action: 'guardian.link', entity: 'student', entityId: studentId, details: { guardianId: guardian.id } }, tx);
    });
    return toDetail(await loadStudent(studentId));
  });

  app.put('/students/:id/guardians/:guardianId', canEdit, async (req) => {
    const studentId = idParam(req.params);
    const guardianId = idParam(req.params, 'guardianId');
    const data = parseOr400(guardianLinkUpdateSchema, req.body);
    await prisma.$transaction(async (tx) => {
      const { displayName, phone, ...linkData } = data;
      if (Object.keys(linkData).length) {
        await tx.studentGuardian.update({ where: { studentId_guardianId: { studentId, guardianId } }, data: linkData });
      }
      const guardianData: Prisma.GuardianUpdateInput = {};
      if (displayName !== undefined) guardianData.displayName = displayName;
      if (phone) {
        const hmac = phoneHmac(phone);
        const clash = await tx.guardian.findUnique({ where: { phoneHmac: hmac } });
        if (clash && clash.id !== guardianId) {
          throw new HttpError(409, 'Ten numer należy już do innego opiekuna – usuń tego opiekuna i dodaj numer ponownie.');
        }
        guardianData.phoneHmac = hmac;
        guardianData.phoneEnc = fieldCrypto.encrypt(phone, CTX.guardianPhone);
      }
      if (Object.keys(guardianData).length) await tx.guardian.update({ where: { id: guardianId }, data: guardianData });
      await audit(
        req,
        {
          action: 'guardian.update',
          entity: 'guardian',
          entityId: guardianId,
          details: { studentId, fields: Object.keys(data) },
        },
        tx,
      );
    });
    return toDetail(await loadStudent(studentId));
  });

  app.delete('/students/:id/guardians/:guardianId', canEdit, async (req) => {
    const studentId = idParam(req.params);
    const guardianId = idParam(req.params, 'guardianId');
    await prisma.$transaction(async (tx) => {
      await tx.studentGuardian.delete({ where: { studentId_guardianId: { studentId, guardianId } } });
      const removed = await deleteOrphanGuardians(tx);
      await audit(
        req,
        { action: 'guardian.unlink', entity: 'student', entityId: studentId, details: { guardianId, guardianDeleted: removed > 0 } },
        tx,
      );
    });
    return toDetail(await loadStudent(studentId));
  });

  /** Pełny numer – tylko na żądanie i zawsze z wpisem w dzienniku. */
  app.get('/guardians/:id/phone', canView, async (req) => {
    const id = idParam(req.params);
    const guardian = await prisma.guardian.findUnique({ where: { id } });
    if (!guardian) throw new HttpError(404, 'Nie ma takiego opiekuna.');
    await audit(req, { action: 'guardian.phone.reveal', entity: 'guardian', entityId: id });
    return { phone: formatPhone(decryptGuardianPhone(guardian.phoneEnc)) };
  });
}
