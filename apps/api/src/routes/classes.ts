import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ClassDto } from '@alert/shared';
import { DATA_VIEW_ROLES } from '@alert/shared';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { deleteOrphanGuardians } from '../lib/guardians';
import { HttpError, idParam, parseOr400 } from '../lib/http';
import { compareClassNames, normalizeClassName } from '../lib/names';
import { requireRole } from '../auth/session';

const classSchema = z.object({
  name: z.string().trim().min(1).max(20).transform(normalizeClassName),
  defaultAssemblyPointId: z.number().int().positive().nullable().optional(),
});

export async function classRoutes(app: FastifyInstance) {
  app.get('/classes', { preHandler: requireRole(...DATA_VIEW_ROLES) }, async (): Promise<ClassDto[]> => {
    const rows = await prisma.$queryRaw<
      { id: number; name: string; default_assembly_point_id: number | null; student_count: number; without_phone: number }[]
    >`
      SELECT c.id, c.name, c.default_assembly_point_id,
             count(s.id)::int AS student_count,
             (count(s.id) FILTER (WHERE NOT EXISTS (
                SELECT 1 FROM student_guardians sg WHERE sg.student_id = s.id AND sg.receives_alerts)))::int AS without_phone
      FROM classes c
      LEFT JOIN students s ON s.class_id = c.id
      GROUP BY c.id`;
    return rows
      .map((r) => ({
        id: r.id,
        name: r.name,
        defaultAssemblyPointId: r.default_assembly_point_id,
        studentCount: r.student_count,
        studentsWithoutPhone: r.without_phone,
      }))
      .sort((a, b) => compareClassNames(a.name, b.name));
  });

  app.post('/classes', { preHandler: requireRole('ADMIN') }, async (req) => {
    const data = parseOr400(classSchema, req.body);
    const created = await prisma.schoolClass.create({ data });
    await audit(req, { action: 'class.create', entity: 'class', entityId: created.id, details: { name: created.name } });
    return created;
  });

  app.put('/classes/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const id = idParam(req.params);
    const data = parseOr400(classSchema, req.body);
    const updated = await prisma.schoolClass.update({ where: { id }, data });
    await audit(req, { action: 'class.update', entity: 'class', entityId: id, details: { name: updated.name } });
    return updated;
  });

  /** Usuwa klasę razem z uczniami (np. absolwenci) i osieroconymi opiekunami. */
  app.delete('/classes/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const id = idParam(req.params);
    const result = await prisma.$transaction(async (tx) => {
      const cls = await tx.schoolClass.findUnique({ where: { id } });
      if (!cls) throw new HttpError(404, 'Nie ma takiej klasy.');
      const students = await tx.student.deleteMany({ where: { classId: id } });
      await tx.schoolClass.delete({ where: { id } });
      const guardians = await deleteOrphanGuardians(tx);
      await audit(
        req,
        { action: 'class.delete', entity: 'class', entityId: id, details: { name: cls.name, students: students.count, guardians } },
        tx,
      );
      return { students: students.count, guardians };
    });
    return { ok: true, deletedStudents: result.students, deletedGuardians: result.guardians };
  });
}
