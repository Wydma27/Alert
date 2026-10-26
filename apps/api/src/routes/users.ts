import type { User } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLES, type UserDto } from '@alert/shared';
import { prisma } from '../db';
import { forgetSessions } from '../emergency/snapshot';
import { audit } from '../lib/audit';
import { HttpError, idParam, parseOr400 } from '../lib/http';
import { hashSecret, validatePasswordStrength } from '../lib/password';
import { requireRole } from '../auth/session';

function toDto(u: User): UserDto {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    isActive: u.isActive,
    totpEnabled: Boolean(u.totpSecretEnc),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil.toISOString() : null,
  };
}

const passwordField = z.string().superRefine((v, ctx) => {
  const problem = validatePasswordStrength(v);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

/** Nie pozwalamy zostać bez aktywnego administratora. */
async function assertAnotherActiveAdmin(exceptId: number) {
  const admins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true, id: { not: exceptId } } });
  if (admins === 0) throw new HttpError(409, 'Musi pozostać co najmniej jeden aktywny administrator.');
}

export async function userRoutes(app: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('ADMIN') };

  app.get('/users', adminOnly, async () => {
    const users = await prisma.user.findMany({ orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }] });
    return users.map(toDto);
  });

  app.post('/users', adminOnly, async (req) => {
    const data = parseOr400(
      z.object({
        email: z.string().trim().toLowerCase().email('nieprawidłowy adres e-mail'),
        fullName: z.string().trim().min(3).max(100),
        role: z.enum(ROLES),
        password: passwordField,
      }),
      req.body,
    );
    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) throw new HttpError(409, 'Użytkownik z tym adresem już istnieje.');
    const user = await prisma.user.create({
      data: { email: data.email, fullName: data.fullName, role: data.role, passwordHash: await hashSecret(data.password) },
    });
    await audit(req, { action: 'user.create', entity: 'user', entityId: user.id, details: { role: user.role } });
    return toDto(user);
  });

  app.patch('/users/:id', adminOnly, async (req) => {
    const id = idParam(req.params);
    const data = parseOr400(
      z.object({
        fullName: z.string().trim().min(3).max(100).optional(),
        role: z.enum(ROLES).optional(),
        isActive: z.boolean().optional(),
      }),
      req.body,
    );
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new HttpError(404, 'Nie ma takiego użytkownika.');
    const losesAdmin = user.role === 'ADMIN' && user.isActive && ((data.role && data.role !== 'ADMIN') || data.isActive === false);
    if (losesAdmin) await assertAnotherActiveAdmin(id);

    const updated = await prisma.user.update({ where: { id }, data });
    if (data.isActive === false || (data.role && data.role !== user.role)) {
      // Zmiana roli lub dezaktywacja: wyloguj ze wszystkich urządzeń.
      await prisma.session.deleteMany({ where: { userId: id } });
      forgetSessions({ userId: id });
    }
    await audit(req, {
      action: 'user.update',
      entity: 'user',
      entityId: id,
      details: { ...data, previousRole: user.role },
    });
    return toDto(updated);
  });

  app.post('/users/:id/reset-password', adminOnly, async (req) => {
    const id = idParam(req.params);
    const { password } = parseOr400(z.object({ password: passwordField }), req.body);
    const updated = await prisma.user.update({
      where: { id },
      data: { passwordHash: await hashSecret(password), failedLogins: 0, lockedUntil: null },
    });
    await prisma.session.deleteMany({ where: { userId: id } });
    forgetSessions({ userId: id });
    await audit(req, { action: 'user.password.reset', entity: 'user', entityId: id });
    return toDto(updated);
  });

  /** Utrata telefonu z aplikacją: użytkownik skonfiguruje 2FA od nowa przy następnym logowaniu. */
  app.post('/users/:id/reset-2fa', adminOnly, async (req) => {
    const id = idParam(req.params);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.recoveryCode.deleteMany({ where: { userId: id } });
      await tx.session.deleteMany({ where: { userId: id } });
      return tx.user.update({
        where: { id },
        data: { totpSecretEnc: null, totpPendingEnc: null, totpLastStep: null },
      });
    });
    forgetSessions({ userId: id });
    await audit(req, { action: 'user.2fa.reset', entity: 'user', entityId: id });
    return toDto(updated);
  });

  app.post('/users/:id/unlock', adminOnly, async (req) => {
    const id = idParam(req.params);
    const updated = await prisma.user.update({ where: { id }, data: { failedLogins: 0, lockedUntil: null } });
    await audit(req, { action: 'user.unlock', entity: 'user', entityId: id });
    return toDto(updated);
  });
}
