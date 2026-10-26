import type { Teacher } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DATA_VIEW_ROLES, type TeacherDto } from '@alert/shared';
import { CTX, fieldCrypto, prisma } from '../db';
import { audit } from '../lib/audit';
import { HttpError, idParam, parseOr400 } from '../lib/http';
import { normalizePersonName } from '../lib/names';
import { formatPhone, maskPhone, normalizePhone } from '../lib/phone';
import { requireRole } from '../auth/session';

export function teacherPhoneHmac(e164: string): string {
  return fieldCrypto.blindIndex(e164, CTX.teacherPhone);
}

function toDto(t: Teacher): TeacherDto {
  return {
    id: t.id,
    firstName: t.firstName,
    lastName: t.lastName,
    position: t.position,
    externalId: t.externalId,
    phoneMasked: maskPhone(fieldCrypto.decrypt(t.phoneEnc, CTX.teacherPhone)),
  };
}

const phoneField = z.string().transform((raw, ctx) => {
  const result = normalizePhone(raw);
  if (!result.ok) {
    ctx.addIssue({ code: 'custom', message: result.error });
    return z.NEVER;
  }
  return result.e164;
});

const teacherSchema = z.object({
  firstName: z.string().trim().min(1).max(60).transform(normalizePersonName),
  lastName: z.string().trim().min(1).max(80).transform(normalizePersonName),
  position: z.string().trim().max(80).transform((v) => v || null).nullable().optional(),
  externalId: z.string().trim().max(60).transform((v) => v || null).nullable().optional(),
});

export async function teacherRoutes(app: FastifyInstance) {
  const canView = { preHandler: requireRole(...DATA_VIEW_ROLES) };
  const canEdit = { preHandler: requireRole('ADMIN') };

  app.get('/teachers', canView, async (): Promise<TeacherDto[]> => {
    const rows = await prisma.teacher.findMany({ orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
    return rows.sort((a, b) => a.lastName.localeCompare(b.lastName, 'pl') || a.firstName.localeCompare(b.firstName, 'pl')).map(toDto);
  });

  app.post('/teachers', canEdit, async (req) => {
    const data = parseOr400(teacherSchema.extend({ phone: phoneField }), req.body);
    const hmac = teacherPhoneHmac(data.phone);
    if (await prisma.teacher.findUnique({ where: { phoneHmac: hmac } })) {
      throw new HttpError(409, 'Nauczyciel z tym numerem już jest na liście.');
    }
    const { phone, ...rest } = data;
    const row = await prisma.teacher.create({
      data: { ...rest, phoneHmac: hmac, phoneEnc: fieldCrypto.encrypt(phone, CTX.teacherPhone) },
    });
    await audit(req, { action: 'teacher.create', entity: 'teacher', entityId: row.id });
    return toDto(row);
  });

  app.put('/teachers/:id', canEdit, async (req) => {
    const id = idParam(req.params);
    const data = parseOr400(teacherSchema.extend({ phone: phoneField.optional() }), req.body);
    const { phone, ...rest } = data;
    const update: Parameters<typeof prisma.teacher.update>[0]['data'] = { ...rest };
    if (phone) {
      const hmac = teacherPhoneHmac(phone);
      const clash = await prisma.teacher.findUnique({ where: { phoneHmac: hmac } });
      if (clash && clash.id !== id) throw new HttpError(409, 'Ten numer ma już inny nauczyciel.');
      update.phoneHmac = hmac;
      update.phoneEnc = fieldCrypto.encrypt(phone, CTX.teacherPhone);
    }
    const row = await prisma.teacher.update({ where: { id }, data: update });
    await audit(req, { action: 'teacher.update', entity: 'teacher', entityId: id, details: { fields: Object.keys(data) } });
    return toDto(row);
  });

  app.delete('/teachers/:id', canEdit, async (req) => {
    const id = idParam(req.params);
    await prisma.teacher.delete({ where: { id } });
    await audit(req, { action: 'teacher.delete', entity: 'teacher', entityId: id });
    return { ok: true };
  });

  /** Pełny numer – tylko na żądanie i zawsze z wpisem w dzienniku. */
  app.get('/teachers/:id/phone', canView, async (req) => {
    const id = idParam(req.params);
    const row = await prisma.teacher.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, 'Nie ma takiego nauczyciela.');
    await audit(req, { action: 'teacher.phone.reveal', entity: 'teacher', entityId: id });
    return { phone: formatPhone(fieldCrypto.decrypt(row.phoneEnc, CTX.teacherPhone)) };
  });
}
