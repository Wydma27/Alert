import type { FastifyInstance } from 'fastify';
import type { AttendanceOverviewDto, AttendanceStudentDto } from '@alert/shared';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { HttpError, idParam, parseOr400 } from '../lib/http';
import { attendanceSchema, classAttendance, markAttendance } from '../alerts/service';
import { requireLogin } from '../auth/session';

/** Lista obecności w punkcie zbiórki – dla wszystkich ról (nauczyciel nie widzi numerów telefonów). */
export async function attendanceRoutes(app: FastifyInstance) {
  app.get('/attendance/active', { preHandler: requireLogin }, async (): Promise<AttendanceOverviewDto> => {
    const alert = await prisma.alert.findFirst({ where: { status: 'ACTIVE' } });
    if (!alert) return { alert: null, classes: [] };
    return {
      alert: { id: alert.id, mode: alert.mode, eventLabel: alert.eventLabel, startedAt: alert.startedAt.toISOString() },
      classes: await classAttendance(alert.id),
    };
  });

  app.get('/attendance/class/:alertClassId', { preHandler: requireLogin }, async (req): Promise<AttendanceStudentDto[]> => {
    const alertClassId = idParam(req.params, 'alertClassId');
    const cls = await prisma.alertClass.findUnique({ where: { id: alertClassId }, include: { alert: true } });
    if (!cls) throw new HttpError(404, 'Nie ma takiej klasy w alercie.');
    const students = await prisma.alertStudent.findMany({ where: { alertClassId }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
    const studentIds = students.map((s) => s.studentId).filter((v): v is number => v !== null);
    // Osoby do odbioru: tylko imiona i nazwiska + uprawnienie, bez numerów.
    const links = await prisma.studentGuardian.findMany({
      where: { studentId: { in: studentIds } },
      include: { guardian: { select: { displayName: true } } },
      orderBy: { priority: 'asc' },
    });
    return students
      .sort((a, b) => a.lastName.localeCompare(b.lastName, 'pl') || a.firstName.localeCompare(b.firstName, 'pl'))
      .map((s) => ({
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        attendance: s.attendance,
        attendanceAt: s.attendanceAt?.toISOString() ?? null,
        pickedUpByName: s.pickedUpByName,
        pickupPersons: links
          .filter((l) => l.studentId === s.studentId)
          .map((l) => ({ guardianId: l.guardianId, name: l.guardian.displayName ?? `Opiekun ${l.priority}`, canPickUp: l.canPickUp })),
      }));
  });

  app.post('/attendance/mark', { preHandler: requireLogin }, async (req) => {
    const input = parseOr400(attendanceSchema, req.body);
    const result = await markAttendance(input, req.auth!.user.id);
    if (result.applied) {
      await audit(req, {
        action: 'attendance.mark',
        entity: 'alert_student',
        entityId: input.alertStudentId,
        details: { attendance: input.attendance, smsQueued: result.smsQueued },
      });
    }
    return result;
  });
}
