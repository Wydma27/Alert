// Logika alertu: odbiorcy i podgląd, start, kolejne komunikaty, obecność, dane do centrum dowodzenia.
import { Prisma, type Alert, type AlertClass, type MessageKind, type School } from '@prisma/client';
import { z } from 'zod';
import type {
  AlertClassDto,
  AlertDetailDto,
  AlertMessageDto,
  AlertPreviewDto,
  AlertSummaryDto,
  AttendanceCounts,
  AttendanceValue,
  StatusCounts,
} from '@alert/shared';
import { plural } from '@alert/shared';
import { CTX, fieldCrypto, prisma } from '../db';
import { notifyAlertChanged } from '../lib/events';
import { HttpError } from '../lib/http';
import { compareClassNames } from '../lib/names';
import { getSender } from '../sms';
import { kickDeliveryWorker } from '../sms/queue';
import { loadTemplates, renderMessage, requireSchool, warsawTime, type TemplateConfig } from './templates';

type Tx = Prisma.TransactionClient;

export const alertInputSchema = z
  .object({
    mode: z.enum(['REAL', 'DRILL']),
    eventTypeId: z.number().int().positive().nullable().default(null),
    eventCustom: z
      .string()
      .trim()
      .max(60)
      .nullable()
      .default(null)
      .transform((v) => v || null),
    scope: z.enum(['SCHOOL', 'CLASSES', 'STUDENTS']),
    classIds: z.array(z.number().int().positive()).default([]),
    studentIds: z.array(z.number().int().positive()).default([]),
    points: z.record(z.string(), z.number().int().positive()).default({}),
    pickupInstruction: z.string().trim().min(3).max(150),
    sendConfirmations: z.boolean().default(true),
  })
  .refine((v) => v.eventTypeId !== null || v.eventCustom !== null, { message: 'wybierz typ zdarzenia albo wpisz własny opis' })
  .refine((v) => v.scope !== 'CLASSES' || v.classIds.length > 0, { message: 'wybierz co najmniej jedną klasę' })
  .refine((v) => v.scope !== 'STUDENTS' || v.studentIds.length > 0, { message: 'wybierz co najmniej jednego ucznia' });

export type AlertInput = z.infer<typeof alertInputSchema>;

/** Numery z danych demonstracyjnych (seed i plik przykładowy) – nie wolno do nich wysłać prawdziwych SMS-ów. */
const DEMO_PREFIX = '+4879000';

interface GuardianRecipient {
  guardianId: number;
  name: string | null;
  phone: string;
  canPickUp: boolean;
}

function reencrypt(phone: string) {
  return fieldCrypto.encrypt(phone, CTX.deliveryPhone);
}

/** Aktualni opiekunowie (z włączonymi SMS-ami) dla uczniów. */
async function recipientsFor(studentIds: number[], db: Tx | typeof prisma = prisma) {
  const links = await db.studentGuardian.findMany({
    where: { studentId: { in: studentIds } },
    include: { guardian: true },
    orderBy: { priority: 'asc' },
  });
  const map = new Map<number, { alerts: GuardianRecipient[]; all: GuardianRecipient[] }>();
  for (const link of links) {
    const entry = map.get(link.studentId) ?? { alerts: [], all: [] };
    const r: GuardianRecipient = {
      guardianId: link.guardianId,
      name: link.guardian.displayName,
      phone: fieldCrypto.decrypt(link.guardian.phoneEnc, CTX.guardianPhone),
      canPickUp: link.canPickUp,
    };
    entry.all.push(r);
    if (link.receivesAlerts) entry.alerts.push(r);
    map.set(link.studentId, entry);
  }
  return map;
}

// --- Plan alertu (podgląd i start) ---

interface PlannedClass {
  classId: number;
  className: string;
  point: { id: number; name: string; address: string } | null;
}

interface PlannedStudent {
  studentId: number;
  firstName: string;
  lastName: string;
  classId: number;
  guardians: GuardianRecipient[];
  body: string;
  parts: number;
  encoding: string;
}

export interface AlertPlan {
  school: School;
  templates: Record<MessageKind, TemplateConfig>;
  eventLabel: string;
  eventSmsLabel: string;
  classes: PlannedClass[];
  students: PlannedStudent[];
  blocking: string[];
  warnings: string[];
}

export async function buildPlan(input: AlertInput): Promise<AlertPlan> {
  const school = await requireSchool();
  const templates = await loadTemplates();

  let eventLabel: string;
  let eventSmsLabel: string;
  if (input.eventCustom) {
    eventLabel = input.eventCustom;
    eventSmsLabel = input.eventCustom;
  } else {
    const eventType = await prisma.eventType.findUnique({ where: { id: input.eventTypeId! } });
    if (!eventType) throw new HttpError(400, 'Nie ma takiego typu zdarzenia.');
    eventLabel = eventType.label;
    eventSmsLabel = eventType.smsLabel;
  }

  const where: Prisma.StudentWhereInput =
    input.scope === 'CLASSES' ? { classId: { in: input.classIds } } : input.scope === 'STUDENTS' ? { id: { in: input.studentIds } } : {};
  const students = await prisma.student.findMany({ where, include: { schoolClass: true } });
  if (students.length === 0) throw new HttpError(400, 'W wybranym zakresie nie ma żadnego ucznia.');

  const classRows = new Map(students.map((s) => [s.classId, s.schoolClass]));
  const pointIds = [...classRows.values()].map((c) => input.points[String(c.id)] ?? c.defaultAssemblyPointId).filter((v): v is number => !!v);
  const points = new Map(
    (await prisma.assemblyPoint.findMany({ where: { id: { in: pointIds }, active: true } })).map((p) => [p.id, p]),
  );

  const blocking: string[] = [];
  const warnings: string[] = [];
  const classes: PlannedClass[] = [...classRows.values()]
    .map((c) => {
      const pointId = input.points[String(c.id)] ?? c.defaultAssemblyPointId;
      const point = pointId ? points.get(pointId) : undefined;
      if (!point) blocking.push(`Klasa ${c.name} nie ma wybranego punktu zbiórki.`);
      return { classId: c.id, className: c.name, point: point ? { id: point.id, name: point.name, address: point.address } : null };
    })
    .sort((a, b) => compareClassNames(a.className, b.className));
  const classById = new Map(classes.map((c) => [c.classId, c]));

  const recipients = await recipientsFor(students.map((s) => s.id));
  const alertLike = { mode: input.mode, eventSmsLabel, pickupInstruction: input.pickupInstruction };
  const planned: PlannedStudent[] = students
    .map((s) => {
      const cls = classById.get(s.classId)!;
      const { body, info } = renderMessage(templates.START, {
        school,
        alert: alertLike,
        cls: { className: cls.className, pointName: cls.point?.name ?? '', pointAddress: cls.point?.address ?? '' },
        student: s,
      });
      return {
        studentId: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        classId: s.classId,
        guardians: recipients.get(s.id)?.alerts ?? [],
        body,
        parts: info.parts,
        encoding: info.encoding,
      };
    })
    .sort(
      (a, b) =>
        compareClassNames(classById.get(a.classId)!.className, classById.get(b.classId)!.className) ||
        a.lastName.localeCompare(b.lastName, 'pl'),
    );

  const withoutPhone = planned.filter((s) => s.guardians.length === 0).length;
  if (withoutPhone) {
    warnings.push(`${plural(withoutPhone, 'uczeń nie ma', 'uczniów nie ma', 'uczniów nie ma')} numeru opiekuna – ich rodzice nie dostaną SMS-a.`);
  }
  const maxParts = Math.max(...planned.map((s) => s.parts));
  if (maxParts > 2) warnings.push(`Najdłuższy SMS ma ${maxParts} części – rozważ krótszą instrukcję odbioru lub nazwę punktu.`);

  return { school, templates, eventLabel, eventSmsLabel, classes, students: planned, blocking, warnings };
}

export async function previewAlert(input: AlertInput): Promise<AlertPreviewDto> {
  const plan = await buildPlan(input);
  const sender = getSender();
  const testNumbers = input.mode === 'DRILL' ? await prisma.testNumber.count() : 0;
  const warnings = [...plan.blocking, ...plan.warnings];
  if (input.mode === 'REAL' && !sender.live) {
    warnings.push('Bramka SMS w trybie fake – nic nie zostanie wysłane do rodziców (ustawienie SMS_PROVIDER w .env).');
  }
  if (input.mode === 'DRILL') {
    warnings.push(
      testNumbers
        ? `Ćwiczenia: rodzice NIE dostaną SMS-ów (symulacja). Przykładowy SMS trafi na ${plural(testNumbers, 'numer testowy', 'numery testowe', 'numerów testowych')}.`
        : 'Ćwiczenia: rodzice NIE dostaną SMS-ów (symulacja). Brak numerów testowych – dodaj je w „Test SMS”.',
    );
  }
  const sample = plan.students.find((s) => s.guardians.length > 0) ?? plan.students[0]!;
  const sampleInfo = renderMessage(plan.templates.START, {
    school: plan.school,
    alert: { mode: input.mode, eventSmsLabel: plan.eventSmsLabel, pickupInstruction: input.pickupInstruction },
    cls: (() => {
      const c = plan.classes.find((x) => x.classId === sample.classId)!;
      return { className: c.className, pointName: c.point?.name ?? '', pointAddress: c.point?.address ?? '' };
    })(),
    student: sample,
  });
  const counts = new Map<number, number>();
  for (const s of plan.students) counts.set(s.classId, (counts.get(s.classId) ?? 0) + 1);
  return {
    students: plan.students.length,
    studentsWithoutPhone: plan.students.filter((s) => s.guardians.length === 0).length,
    recipients: plan.students.reduce((n, s) => n + s.guardians.length, 0),
    smsParts: plan.students.reduce((n, s) => n + s.parts * s.guardians.length, 0),
    maxParts: Math.max(...plan.students.map((s) => s.parts)),
    sample: sampleInfo.body,
    sampleInfo: sampleInfo.info,
    classes: plan.classes.map((c) => ({
      classId: c.classId,
      className: c.className,
      students: counts.get(c.classId) ?? 0,
      pointName: c.point?.name ?? '—',
    })),
    warnings,
    testNumbers,
    live: sender.live,
  };
}

async function testNumberDeliveries(alertId: number, messageId: number, body: string, info: { parts: number; encoding: string }) {
  const numbers = await prisma.testNumber.findMany();
  return numbers.map((n) => ({
    alertId,
    messageId,
    testNumberId: n.id,
    guardianName: `numer testowy: ${n.label}`,
    phoneEnc: reencrypt(fieldCrypto.decrypt(n.phoneEnc, CTX.testPhone)),
    body,
    parts: info.parts,
    encoding: info.encoding,
    simulated: false,
    priority: 1,
  }));
}

export async function startAlert(input: AlertInput, userId: number, idempotencyKey: string): Promise<{ alert: Alert; recipients: number; created: boolean }> {
  const existing = await prisma.alert.findUnique({ where: { idempotencyKey } });
  if (existing) return { alert: existing, recipients: 0, created: false };

  const plan = await buildPlan(input);
  if (plan.blocking.length) throw new HttpError(400, plan.blocking.join(' '));
  const sender = getSender();
  if (input.mode === 'REAL' && sender.live && plan.students.some((s) => s.guardians.some((g) => g.phone.startsWith(DEMO_PREFIX)))) {
    throw new HttpError(
      409,
      'W bazie są numery z danych demonstracyjnych (+48 790 00x xxx). Usuń dane demo przed prawdziwym alarmem – te numery mogą należeć do obcych osób.',
    );
  }
  if (await prisma.alert.findFirst({ where: { status: 'ACTIVE' } })) {
    throw new HttpError(409, 'Trwa już inny alert – zakończ go, zanim uruchomisz nowy.');
  }

  const drill = input.mode === 'DRILL';
  let recipients = 0;
  let alert: Alert;
  try {
    alert = await prisma.$transaction(
      async (tx) => {
        const created = await tx.alert.create({
          data: {
            mode: input.mode,
            eventTypeId: input.eventCustom ? null : input.eventTypeId,
            eventLabel: plan.eventLabel,
            eventSmsLabel: plan.eventSmsLabel,
            pickupInstruction: input.pickupInstruction,
            scope: input.scope,
            sendConfirmations: input.sendConfirmations,
            idempotencyKey,
            startedById: userId,
          },
        });
        const alertClassId = new Map<number, number>();
        for (const c of plan.classes) {
          const row = await tx.alertClass.create({
            data: {
              alertId: created.id,
              classId: c.classId,
              className: c.className,
              assemblyPointId: c.point!.id,
              pointName: c.point!.name,
              pointAddress: c.point!.address,
            },
          });
          alertClassId.set(c.classId, row.id);
        }
        await tx.alertStudent.createMany({
          data: plan.students.map((s) => ({
            alertId: created.id,
            alertClassId: alertClassId.get(s.classId)!,
            studentId: s.studentId,
            firstName: s.firstName,
            lastName: s.lastName,
          })),
        });
        const alertStudents = await tx.alertStudent.findMany({ where: { alertId: created.id }, select: { id: true, studentId: true } });
        const alertStudentId = new Map(alertStudents.map((a) => [a.studentId!, a.id]));

        const message = await tx.alertMessage.create({
          data: { alertId: created.id, kind: 'START', template: plan.templates.START.body, createdById: userId },
        });
        const deliveries: Prisma.SmsDeliveryCreateManyInput[] = plan.students.flatMap((s) =>
          s.guardians.map((g) => ({
            alertId: created.id,
            messageId: message.id,
            alertStudentId: alertStudentId.get(s.studentId)!,
            guardianId: g.guardianId,
            guardianName: g.name,
            phoneEnc: reencrypt(g.phone),
            body: s.body,
            parts: s.parts,
            encoding: s.encoding,
            simulated: drill,
            priority: 1,
          })),
        );
        recipients = deliveries.length;
        if (drill) {
          const sample = plan.students.find((s) => s.guardians.length) ?? plan.students[0]!;
          deliveries.push(...(await testNumberDeliveries(created.id, message.id, sample.body, sample)));
        }
        await tx.smsDelivery.createMany({ data: deliveries });
        return created;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const again = await prisma.alert.findUnique({ where: { idempotencyKey } });
      if (again) return { alert: again, recipients: 0, created: false };
      throw new HttpError(409, 'Trwa już inny alert – zakończ go, zanim uruchomisz nowy.');
    }
    throw err;
  }

  kickDeliveryWorker();
  notifyAlertChanged(alert.id);
  return { alert, recipients, created: true };
}

// --- Kolejne komunikaty ---

async function requireActive(alertId: number) {
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) throw new HttpError(404, 'Nie ma takiego alertu.');
  if (alert.status !== 'ACTIVE') throw new HttpError(409, 'Ten alert jest już zakończony.');
  return alert;
}

/** Fala komunikatów do opiekunów wskazanych uczniów (z pominięciem odebranych i nieobecnych). */
async function sendWave(opts: {
  alert: Alert;
  kind: MessageKind;
  classFilter?: number[];
  note: string | null;
  userId: number;
}): Promise<number> {
  const { alert, kind } = opts;
  const school = await requireSchool();
  const template = (await loadTemplates())[kind];
  const students = await prisma.alertStudent.findMany({
    where: {
      alertId: alert.id,
      attendance: { notIn: ['PICKED_UP', 'ABSENT_TODAY'] },
      ...(opts.classFilter ? { alertClassId: { in: opts.classFilter } } : {}),
    },
    include: { alertClass: true },
  });
  const recipients = await recipientsFor(students.map((s) => s.studentId).filter((v): v is number => v !== null));
  const drill = alert.mode === 'DRILL';

  const message = await prisma.alertMessage.create({
    data: { alertId: alert.id, kind, template: template.body, note: opts.note, createdById: opts.userId },
  });
  const deliveries: Prisma.SmsDeliveryCreateManyInput[] = [];
  let sample: { body: string; parts: number; encoding: string } | null = null;
  for (const s of students) {
    const { body, info } = renderMessage(template, { school, alert, cls: s.alertClass, student: s });
    sample ??= { body, parts: info.parts, encoding: info.encoding };
    for (const g of (s.studentId && recipients.get(s.studentId)?.alerts) || []) {
      deliveries.push({
        alertId: alert.id,
        messageId: message.id,
        alertStudentId: s.id,
        guardianId: g.guardianId,
        guardianName: g.name,
        phoneEnc: reencrypt(g.phone),
        body,
        parts: info.parts,
        encoding: info.encoding,
        simulated: drill,
        priority: kind === 'UPDATE' ? 2 : 3,
      });
    }
  }
  if (drill && sample) deliveries.push(...(await testNumberDeliveries(alert.id, message.id, sample.body, sample)));
  if (deliveries.length) await prisma.smsDelivery.createMany({ data: deliveries });
  kickDeliveryWorker();
  notifyAlertChanged(alert.id);
  return deliveries.filter((d) => !d.testNumberId).length;
}

export async function changeAssemblyPoint(alertId: number, alertClassIds: number[], assemblyPointId: number, userId: number) {
  const alert = await requireActive(alertId);
  const point = await prisma.assemblyPoint.findFirst({ where: { id: assemblyPointId, active: true } });
  if (!point) throw new HttpError(400, 'Nie ma takiego aktywnego punktu zbiórki.');
  const classes = await prisma.alertClass.findMany({ where: { alertId, id: { in: alertClassIds } } });
  if (classes.length === 0) throw new HttpError(400, 'Wybierz klasy.');
  await prisma.alertClass.updateMany({
    where: { id: { in: classes.map((c) => c.id) } },
    data: { assemblyPointId: point.id, pointName: point.name, pointAddress: point.address },
  });
  const note = `${classes.map((c) => c.className).join(', ')} → ${point.name}`;
  const recipients = await sendWave({ alert, kind: 'UPDATE', classFilter: classes.map((c) => c.id), note, userId });
  return { recipients, note };
}

/** Zakończenie alertu; opcjonalnie z SMS-em o odwołaniu alarmu. */
export async function closeAlert(alertId: number, sendCancelSms: boolean, userId: number) {
  const alert = await requireActive(alertId);
  const recipients = sendCancelSms ? await sendWave({ alert, kind: 'CANCEL', note: null, userId }) : 0;
  await prisma.alert.update({ where: { id: alertId }, data: { status: 'CLOSED', closedAt: new Date(), closedById: userId } });
  notifyAlertChanged(alertId);
  return { recipients };
}

// --- Obecność ---

/** Jeden komunikat zbiorczy na alert dla potwierdzeń / odbiorów (SMS-y dochodzą w miarę odhaczania). */
async function standingMessage(tx: Tx, alertId: number, kind: 'CONFIRM' | 'PICKUP', template: string) {
  const existing = await tx.alertMessage.findFirst({ where: { alertId, kind } });
  return existing ?? tx.alertMessage.create({ data: { alertId, kind, template } });
}

export const attendanceSchema = z
  .object({
    alertStudentId: z.number().int().positive(),
    attendance: z.enum(['UNKNOWN', 'PRESENT', 'ABSENT_TODAY', 'MISSING', 'PICKED_UP']),
    pickedUpByGuardianId: z.number().int().positive().nullable().default(null),
    pickedUpByName: z.string().trim().max(80).nullable().default(null),
    /** Czas zmiany na telefonie nauczyciela (ISO) – dla synchronizacji offline. */
    clientTime: z.string().datetime(),
  })
  .refine((v) => v.attendance !== 'PICKED_UP' || v.pickedUpByGuardianId !== null || !!v.pickedUpByName, {
    message: 'wskaż, kto odebrał dziecko',
  });

export async function markAttendance(input: z.infer<typeof attendanceSchema>, userId: number) {
  const student = await prisma.alertStudent.findUnique({
    where: { id: input.alertStudentId },
    include: { alert: true, alertClass: true },
  });
  if (!student) throw new HttpError(404, 'Nie ma takiego ucznia w alercie.');
  if (student.alert.status !== 'ACTIVE') throw new HttpError(409, 'Alert jest już zakończony.');

  const clientTime = new Date(input.clientTime);
  // Synchronizacja offline: starsza zmiana nie nadpisuje nowszej.
  if (student.clientUpdatedAt && clientTime < student.clientUpdatedAt) return { applied: false, smsQueued: 0 };

  const recipients = student.studentId ? (await recipientsFor([student.studentId])).get(student.studentId) : undefined;
  let pickedUpByName: string | null = null;
  if (input.attendance === 'PICKED_UP') {
    if (input.pickedUpByGuardianId) {
      const guardian = recipients?.all.find((g) => g.guardianId === input.pickedUpByGuardianId);
      if (!guardian) throw new HttpError(400, 'Ta osoba nie jest opiekunem tego ucznia.');
      if (!guardian.canPickUp) throw new HttpError(409, 'Ten opiekun NIE jest upoważniony do odbioru dziecka.');
      pickedUpByName = guardian.name ?? 'opiekun';
    } else {
      pickedUpByName = input.pickedUpByName;
    }
  }

  const changed = student.attendance !== input.attendance;
  const school = changed ? await requireSchool() : null;
  const templates = changed ? await loadTemplates() : null;
  let smsQueued = 0;

  await prisma.$transaction(async (tx) => {
    await tx.alertStudent.update({
      where: { id: student.id },
      data: {
        attendance: input.attendance,
        attendanceAt: new Date(),
        attendanceById: userId,
        clientUpdatedAt: clientTime,
        pickedUpByGuardianId: input.attendance === 'PICKED_UP' ? input.pickedUpByGuardianId : null,
        pickedUpByName: input.attendance === 'PICKED_UP' ? pickedUpByName : null,
      },
    });
    if (!changed || !school || !templates || !recipients) return;

    const drill = student.alert.mode === 'DRILL';
    let kind: 'CONFIRM' | 'PICKUP' | null = null;
    let targets: GuardianRecipient[] = [];
    if (input.attendance === 'PRESENT' && student.alert.sendConfirmations) {
      kind = 'CONFIRM';
      targets = recipients.alerts;
    } else if (input.attendance === 'PICKED_UP') {
      kind = 'PICKUP';
      targets = recipients.alerts.filter((g) => g.guardianId !== input.pickedUpByGuardianId);
    }
    if (!kind || targets.length === 0) return;

    const template = templates[kind];
    const message = await standingMessage(tx, student.alertId, kind, template.body);
    const { body, info } = renderMessage(template, {
      school,
      alert: student.alert,
      cls: student.alertClass,
      student,
      extra: { odbierajacy: pickedUpByName ?? '', godzina: warsawTime() },
    });
    const result = await tx.smsDelivery.createMany({
      data: targets.map((g) => ({
        alertId: student.alertId,
        messageId: message.id,
        alertStudentId: student.id,
        guardianId: g.guardianId,
        guardianName: g.name,
        phoneEnc: reencrypt(g.phone),
        body,
        parts: info.parts,
        encoding: info.encoding,
        simulated: drill,
        priority: 4,
      })),
      skipDuplicates: true, // potwierdzenie/odbiór najwyżej raz na opiekuna
    });
    smsQueued = result.count;
  });

  if (smsQueued) kickDeliveryWorker();
  notifyAlertChanged(student.alertId);
  return { applied: true, smsQueued };
}

// --- Dane do ekranów ---

function emptyAttendance(): AttendanceCounts {
  return { total: 0, UNKNOWN: 0, PRESENT: 0, ABSENT_TODAY: 0, MISSING: 0, PICKED_UP: 0 };
}
function emptyStatus(): StatusCounts & { total: number } {
  return { total: 0, QUEUED: 0, SENDING: 0, SENT: 0, DELIVERED: 0, UNDELIVERED: 0, FAILED: 0 };
}

async function userNames(ids: (number | null | undefined)[]) {
  const unique = [...new Set(ids.filter((v): v is number => typeof v === 'number'))];
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

export async function classAttendance(alertId: number): Promise<AlertClassDto[]> {
  const [classes, groups] = await Promise.all([
    prisma.alertClass.findMany({ where: { alertId } }),
    prisma.alertStudent.groupBy({ by: ['alertClassId', 'attendance'], where: { alertId }, _count: { _all: true } }),
  ]);
  return classes
    .map((c: AlertClass) => {
      const attendance = emptyAttendance();
      for (const g of groups.filter((x) => x.alertClassId === c.id)) {
        attendance[g.attendance as AttendanceValue] += g._count._all;
        attendance.total += g._count._all;
      }
      return {
        id: c.id,
        className: c.className,
        pointName: c.pointName,
        pointAddress: c.pointAddress,
        assemblyPointId: c.assemblyPointId,
        attendance,
      };
    })
    .sort((a, b) => compareClassNames(a.className, b.className));
}

export async function alertSummary(alert: Alert): Promise<AlertSummaryDto> {
  const [attendanceGroups, deliveryGroups, simulated, names] = await Promise.all([
    prisma.alertStudent.groupBy({ by: ['attendance'], where: { alertId: alert.id }, _count: { _all: true } }),
    prisma.smsDelivery.groupBy({ by: ['status'], where: { alertId: alert.id, testNumberId: null }, _count: { _all: true } }),
    prisma.smsDelivery.count({ where: { alertId: alert.id, simulated: true } }),
    userNames([alert.startedById, alert.closedById]),
  ]);
  const attendance = emptyAttendance();
  for (const g of attendanceGroups) {
    attendance[g.attendance as AttendanceValue] += g._count._all;
    attendance.total += g._count._all;
  }
  const deliveries = { ...emptyStatus(), simulated };
  for (const g of deliveryGroups) {
    deliveries[g.status] += g._count._all;
    deliveries.total += g._count._all;
  }
  return {
    id: alert.id,
    mode: alert.mode,
    status: alert.status,
    eventLabel: alert.eventLabel,
    pickupInstruction: alert.pickupInstruction,
    sendConfirmations: alert.sendConfirmations,
    startedAt: alert.startedAt.toISOString(),
    startedBy: names.get(alert.startedById) ?? null,
    closedAt: alert.closedAt?.toISOString() ?? null,
    closedBy: alert.closedById ? (names.get(alert.closedById) ?? null) : null,
    purged: alert.purgedAt !== null,
    attendance,
    deliveries,
  };
}

export async function alertDetail(alertId: number): Promise<AlertDetailDto> {
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) throw new HttpError(404, 'Nie ma takiego alertu.');
  const [summary, classes, messages, groups, missing] = await Promise.all([
    alertSummary(alert),
    classAttendance(alertId),
    prisma.alertMessage.findMany({ where: { alertId }, orderBy: { id: 'asc' } }),
    prisma.smsDelivery.groupBy({ by: ['messageId', 'status'], where: { alertId, testNumberId: null }, _count: { _all: true } }),
    prisma.alertStudent.findMany({ where: { alertId, attendance: 'MISSING' }, include: { alertClass: true } }),
  ]);
  const names = await userNames(messages.map((m) => m.createdById));
  const messageDtos: AlertMessageDto[] = messages.map((m) => {
    const counts = emptyStatus();
    for (const g of groups.filter((x) => x.messageId === m.id)) {
      counts[g.status] += g._count._all;
      counts.total += g._count._all;
    }
    return {
      id: m.id,
      kind: m.kind,
      note: m.note,
      createdAt: m.createdAt.toISOString(),
      createdBy: m.createdById ? (names.get(m.createdById) ?? null) : null,
      template: m.template,
      counts,
    };
  });
  return {
    alert: summary,
    classes,
    messages: messageDtos,
    missing: missing.map((s) => ({
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      className: s.alertClass.className,
      at: s.attendanceAt?.toISOString() ?? null,
    })),
    live: getSender().live,
  };
}
