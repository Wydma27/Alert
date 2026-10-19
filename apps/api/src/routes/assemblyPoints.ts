import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AssemblyPointDto } from '@alert/shared';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { idParam, parseOr400 } from '../lib/http';
import { requireLogin, requireRole } from '../auth/session';

const pointSchema = z.object({
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().min(3).max(150),
  mapUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https:\/\//.test(v), 'link musi zaczynać się od https://')
    .transform((v) => v || null)
    .nullable()
    .optional(),
  notes: z.string().trim().max(500).transform((v) => v || null).nullable().optional(),
  active: z.boolean().optional(),
});

export async function assemblyPointRoutes(app: FastifyInstance) {
  app.get('/assembly-points', { preHandler: requireLogin }, async (): Promise<AssemblyPointDto[]> => {
    return prisma.assemblyPoint.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, address: true, mapUrl: true, notes: true, active: true },
    });
  });

  app.post('/assembly-points', { preHandler: requireRole('ADMIN') }, async (req) => {
    const data = parseOr400(pointSchema, req.body);
    const point = await prisma.assemblyPoint.create({ data });
    await audit(req, { action: 'assembly_point.create', entity: 'assembly_point', entityId: point.id, details: { name: point.name } });
    return point;
  });

  app.put('/assembly-points/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const id = idParam(req.params);
    const data = parseOr400(pointSchema, req.body);
    const point = await prisma.assemblyPoint.update({ where: { id }, data });
    await audit(req, { action: 'assembly_point.update', entity: 'assembly_point', entityId: id });
    return point;
  });

  app.delete('/assembly-points/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const id = idParam(req.params);
    const point = await prisma.assemblyPoint.delete({ where: { id } });
    await audit(req, { action: 'assembly_point.delete', entity: 'assembly_point', entityId: id, details: { name: point.name } });
    return { ok: true };
  });
}
