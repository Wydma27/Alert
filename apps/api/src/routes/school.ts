import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DashboardDto, SchoolDto } from '@alert/shared';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { parseOr400 } from '../lib/http';
import { requireLogin, requireRole } from '../auth/session';

const EMPTY_SCHOOL: SchoolDto = { name: '', smsName: '', address: '', contactPhone: '', senderName: '' };

const schoolSchema = z.object({
  name: z.string().trim().min(3).max(200),
  smsName: z.string().trim().min(2).max(40),
  address: z.string().trim().min(3).max(200),
  contactPhone: z.string().trim().min(5).max(30),
  // Nadawca alfanumeryczny: max 11 znaków, co najmniej jedna litera (sam ciąg cyfr to numer telefonu).
  senderName: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9 .\-]{3,11}$/, 'od 3 do 11 znaków: litery bez polskich znaków, cyfry, spacja, kropka, myślnik')
    .refine((v) => /[A-Za-z]/.test(v), 'musi zawierać co najmniej jedną literę'),
});

export async function schoolRoutes(app: FastifyInstance) {
  app.get('/school', { preHandler: requireLogin }, async (): Promise<SchoolDto> => {
    const school = await prisma.school.findUnique({ where: { id: 1 } });
    if (!school) return EMPTY_SCHOOL;
    const { name, smsName, address, contactPhone, senderName } = school;
    return { name, smsName, address, contactPhone, senderName };
  });

  app.put('/school', { preHandler: requireRole('ADMIN') }, async (req) => {
    const data = parseOr400(schoolSchema, req.body);
    await prisma.school.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await audit(req, { action: 'school.update', entity: 'school', entityId: 1 });
    return data;
  });

  app.get('/dashboard', { preHandler: requireRole('ADMIN', 'DYREKCJA') }, async (): Promise<DashboardDto> => {
    const [school, classes, students, guardians, assemblyPoints, withoutPhone, classesWithoutPoint, teachers, ownPhones, notices] = await Promise.all([
      prisma.school.findUnique({ where: { id: 1 } }),
      prisma.schoolClass.count(),
      prisma.student.count(),
      prisma.guardian.count(),
      prisma.assemblyPoint.count({ where: { active: true } }),
      prisma.student.count({ where: { guardians: { none: { receivesAlerts: true } } } }),
      prisma.schoolClass.count({ where: { defaultAssemblyPointId: null } }),
      prisma.teacher.count(),
      prisma.student.count({ where: { phoneEnc: { not: null } } }),
      prisma.notice.count(),
    ]);
    return {
      school: { name: school?.name ?? '', configured: Boolean(school) },
      counts: {
        classes,
        students,
        guardians,
        assemblyPoints,
        studentsWithoutPhone: withoutPhone,
        classesWithoutAssemblyPoint: classesWithoutPoint,
        teachers,
        studentsWithOwnPhone: ownPhones,
        notices,
      },
    };
  });
}
