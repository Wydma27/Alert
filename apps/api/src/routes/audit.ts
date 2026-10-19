import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuditEntryDto } from '@alert/shared';
import { prisma } from '../db';
import { audit, verifyAuditChain } from '../lib/audit';
import { parseOr400 } from '../lib/http';
import { requireRole } from '../auth/session';

const PAGE_SIZE = 50;

export async function auditRoutes(app: FastifyInstance) {
  app.get('/audit', { preHandler: requireRole('ADMIN', 'DYREKCJA') }, async (req) => {
    const q = parseOr400(
      z.object({
        action: z.string().trim().max(60).optional(),
        userId: z.coerce.number().int().positive().optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        before: z.string().regex(/^\d+$/).optional(),
      }),
      req.query,
    );
    const where: Prisma.AuditLogWhereInput = {};
    if (q.action) where.action = { startsWith: q.action };
    if (q.userId) where.userId = q.userId;
    if (q.from || q.to) {
      where.at = {};
      if (q.from) where.at.gte = new Date(`${q.from}T00:00:00`);
      if (q.to) where.at.lt = new Date(new Date(`${q.to}T00:00:00`).getTime() + 86_400_000);
    }
    if (q.before) where.id = { lt: BigInt(q.before) };

    const rows = await prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: PAGE_SIZE + 1 });
    const page = rows.slice(0, PAGE_SIZE);
    const userIds = [...new Set(page.map((r) => r.userId).filter((v): v is number => v != null))];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } });
    const names = new Map(users.map((u) => [u.id, u.fullName]));

    const entries: AuditEntryDto[] = page.map((r) => ({
      id: r.id.toString(),
      at: r.at.toISOString(),
      userId: r.userId,
      userName: r.userId != null ? (names.get(r.userId) ?? null) : null,
      ip: r.ip,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      details: r.details,
    }));
    return { entries, nextBefore: rows.length > PAGE_SIZE ? page[page.length - 1]!.id.toString() : null };
  });

  app.post('/audit/verify', { preHandler: requireRole('ADMIN') }, async (req) => {
    const result = await verifyAuditChain();
    await audit(req, { action: 'audit.verify', details: { checked: result.checked, broken: result.brokenIds.length } });
    return { ok: result.brokenIds.length === 0, checked: result.checked, brokenIds: result.brokenIds.slice(0, 100) };
  });
}
