import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ATTENDANCE_LABELS,
  MESSAGE_KIND_LABELS,
  type AlertListItemDto,
  type DeliveryDto,
} from '@alert/shared';
import { CTX, fieldCrypto, prisma } from '../db';
import { audit } from '../lib/audit';
import { onAlertChanged } from '../lib/events';
import { HttpError, idParam, parseOr400 } from '../lib/http';
import { compareClassNames } from '../lib/names';
import { formatPhone, maskPhone } from '../lib/phone';
import { kickDeliveryWorker } from '../sms/queue';
import {
  alertDetail,
  alertInputSchema,
  alertSummary,
  changeAssemblyPoint,
  closeAlert,
  previewAlert,
  startAlert,
} from '../alerts/service';
import { verifyLaunchPin } from '../auth/pin';
import { requireLogin, requireRole } from '../auth/session';

const DEFAULT_PICKUP = 'osobiście w punkcie zbiórki, z dowodem tożsamości';

function deliveryPhone(phoneEnc: string): string | null {
  if (!phoneEnc) return null; // dane zanonimizowane
  return fieldCrypto.decrypt(phoneEnc, CTX.deliveryPhone);
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function alertRoutes(app: FastifyInstance) {
  const commanders = { preHandler: requireRole('ADMIN', 'DYREKCJA') };

  /** Czy trwa alert – dla wszystkich zalogowanych (baner, lista obecności). */
  app.get('/alerts/active', { preHandler: requireLogin }, async () => {
    const alert = await prisma.alert.findFirst({ where: { status: 'ACTIVE' } });
    return { alert: alert ? await alertSummary(alert) : null };
  });

  /** Dane do kreatora: domyślne wartości, klasy z punktami, punkty, typy zdarzeń. */
  app.get('/alerts/defaults', commanders, async (req) => {
    const [last, classes, points, eventTypes, testNumbers] = await Promise.all([
      prisma.alert.findFirst({ orderBy: { id: 'desc' }, select: { pickupInstruction: true } }),
      prisma.schoolClass.findMany({ select: { id: true, name: true, defaultAssemblyPointId: true, _count: { select: { students: true } } } }),
      prisma.assemblyPoint.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
      prisma.eventType.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      prisma.testNumber.count(),
    ]);
    return {
      pickupInstruction: last?.pickupInstruction ?? DEFAULT_PICKUP,
      classes: classes
        .map((c) => ({ id: c.id, name: c.name, defaultAssemblyPointId: c.defaultAssemblyPointId, students: c._count.students }))
        .sort((a, b) => compareClassNames(a.name, b.name)),
      points: points.map((p) => ({ id: p.id, name: p.name, address: p.address })),
      eventTypes: eventTypes.map((e) => ({ id: e.id, label: e.label, smsLabel: e.smsLabel })),
      testNumbers,
      hasPin: Boolean(req.auth!.user.launchPinHash),
    };
  });

  app.post('/alerts/preview', commanders, async (req) => previewAlert(parseOr400(alertInputSchema, req.body)));

  app.post('/alerts', { ...commanders, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = req.body as Record<string, unknown>;
    const { pin, idempotencyKey } = parseOr400(
      z.object({ pin: z.string().min(4).max(8), idempotencyKey: z.string().uuid() }),
      { pin: body?.pin, idempotencyKey: body?.idempotencyKey },
    );
    const input = parseOr400(alertInputSchema, body);
    await verifyLaunchPin(req.auth!.user, pin, req.ip);
    const { alert, recipients, created } = await startAlert(input, req.auth!.user.id, idempotencyKey);
    if (created) {
      await audit(req, {
        action: 'alert.start',
        entity: 'alert',
        entityId: alert.id,
        details: { mode: alert.mode, event: alert.eventLabel, scope: alert.scope, recipients, sendConfirmations: alert.sendConfirmations },
      });
    }
    return { id: alert.id, created };
  });

  app.get('/alerts', commanders, async (): Promise<AlertListItemDto[]> => {
    const alerts = await prisma.alert.findMany({
      orderBy: { id: 'desc' },
      take: 200,
      include: { _count: { select: { students: true, deliveries: true } } },
    });
    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(alerts.map((a) => a.startedById))] } },
      select: { id: true, fullName: true },
    });
    const names = new Map(users.map((u) => [u.id, u.fullName]));
    return alerts.map((a) => ({
      id: a.id,
      mode: a.mode,
      status: a.status,
      eventLabel: a.eventLabel,
      startedAt: a.startedAt.toISOString(),
      closedAt: a.closedAt?.toISOString() ?? null,
      startedBy: names.get(a.startedById) ?? null,
      students: a._count.students,
      deliveries: a._count.deliveries,
    }));
  });

  app.get('/alerts/:id', commanders, async (req) => alertDetail(idParam(req.params)));

  app.get('/alerts/:id/deliveries', commanders, async (req): Promise<DeliveryDto[]> => {
    const alertId = idParam(req.params);
    const q = parseOr400(
      z.object({
        filter: z.enum(['all', 'problems', 'pending']).default('all'),
        messageId: z.coerce.number().int().positive().optional(),
      }),
      req.query,
    );
    const where: Prisma.SmsDeliveryWhereInput = { alertId };
    if (q.messageId) where.messageId = q.messageId;
    if (q.filter === 'problems') where.status = { in: ['FAILED', 'UNDELIVERED'] };
    if (q.filter === 'pending') where.status = { in: ['QUEUED', 'SENDING', 'SENT'] };
    const rows = await prisma.smsDelivery.findMany({
      where,
      include: { message: { select: { kind: true } }, alertStudent: { include: { alertClass: { select: { className: true } } } } },
      orderBy: [{ status: 'asc' }, { id: 'asc' }],
      take: 3000,
    });
    const calls = await prisma.callAttempt.findMany({ where: { alertId }, orderBy: { at: 'asc' } });
    const callers = await prisma.user.findMany({
      where: { id: { in: [...new Set(calls.map((c) => c.userId))] } },
      select: { id: true, fullName: true },
    });
    const callerName = new Map(callers.map((u) => [u.id, u.fullName]));
    return rows.map((d) => {
      const phone = deliveryPhone(d.phoneEnc);
      return {
        id: d.id,
        messageKind: d.message?.kind ?? 'START',
        studentName: d.alertStudent ? `${d.alertStudent.firstName} ${d.alertStudent.lastName}` : null,
        className: d.alertStudent?.alertClass.className ?? null,
        guardianName: d.guardianName,
        testNumber: d.testNumberId !== null,
        phoneMasked: phone ? maskPhone(phone) : '—',
        status: d.status,
        simulated: d.simulated,
        attempts: d.attempts,
        lastError: d.lastError,
        provider: d.provider,
        updatedAt: d.updatedAt.toISOString(),
        calls: calls
          .filter((c) => c.guardianId !== null && c.guardianId === d.guardianId && c.alertStudentId === d.alertStudentId)
          .map((c) => ({ result: c.result, at: c.at.toISOString(), by: callerName.get(c.userId) ?? null, note: c.note })),
      };
    });
  });

  /** Ponowna wysyłka jednego SMS-a (np. po poprawieniu numeru albo awarii bramki). */
  app.post('/alerts/:id/deliveries/:deliveryId/resend', commanders, async (req) => {
    const alertId = idParam(req.params);
    const deliveryId = idParam(req.params, 'deliveryId');
    const delivery = await prisma.smsDelivery.findFirst({ where: { id: deliveryId, alertId } });
    if (!delivery) throw new HttpError(404, 'Nie ma takiej wiadomości.');
    if (!delivery.phoneEnc) throw new HttpError(409, 'Dane tej wiadomości zostały usunięte (retencja).');
    if (delivery.status === 'QUEUED' || delivery.status === 'SENDING') throw new HttpError(409, 'Ta wiadomość jest już w kolejce.');
    await prisma.smsDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'QUEUED',
        attempts: 0,
        nextAttemptAt: new Date(),
        priority: 1,
        lastError: null,
        events: { create: { status: 'QUEUED', detail: `ponowna wysyłka: ${req.auth!.user.fullName}` } },
      },
    });
    kickDeliveryWorker();
    await audit(req, { action: 'delivery.resend', entity: 'sms_delivery', entityId: deliveryId, details: { alertId } });
    return { ok: true };
  });

  app.post('/alerts/:id/resend-failed', commanders, async (req) => {
    const alertId = idParam(req.params);
    const result = await prisma.smsDelivery.updateMany({
      where: { alertId, status: { in: ['FAILED', 'UNDELIVERED'] }, phoneEnc: { not: '' } },
      data: { status: 'QUEUED', attempts: 0, nextAttemptAt: new Date(), priority: 1, lastError: null },
    });
    kickDeliveryWorker();
    await audit(req, { action: 'delivery.resend_all', entity: 'alert', entityId: alertId, details: { count: result.count } });
    return { count: result.count };
  });

  /** Pełny numer do telefonu – zawsze z wpisem w dzienniku. */
  app.get('/alerts/:id/deliveries/:deliveryId/phone', commanders, async (req) => {
    const alertId = idParam(req.params);
    const deliveryId = idParam(req.params, 'deliveryId');
    const delivery = await prisma.smsDelivery.findFirst({ where: { id: deliveryId, alertId } });
    const phone = delivery ? deliveryPhone(delivery.phoneEnc) : null;
    if (!phone) throw new HttpError(404, 'Brak numeru.');
    await audit(req, { action: 'delivery.phone.reveal', entity: 'sms_delivery', entityId: deliveryId, details: { alertId } });
    return { phone: formatPhone(phone) };
  });

  app.post('/alerts/:id/calls', commanders, async (req) => {
    const alertId = idParam(req.params);
    const data = parseOr400(
      z.object({
        deliveryId: z.number().int().positive(),
        result: z.enum(['REACHED', 'NO_ANSWER', 'WRONG_NUMBER']),
        note: z.string().trim().max(200).nullable().default(null),
      }),
      req.body,
    );
    const delivery = await prisma.smsDelivery.findFirst({ where: { id: data.deliveryId, alertId } });
    if (!delivery) throw new HttpError(404, 'Nie ma takiej wiadomości.');
    await prisma.callAttempt.create({
      data: {
        alertId,
        guardianId: delivery.guardianId,
        alertStudentId: delivery.alertStudentId,
        userId: req.auth!.user.id,
        result: data.result,
        note: data.note,
      },
    });
    await audit(req, { action: 'alert.call', entity: 'alert', entityId: alertId, details: { deliveryId: delivery.id, result: data.result } });
    return { ok: true };
  });

  app.post('/alerts/:id/change-point', commanders, async (req) => {
    const alertId = idParam(req.params);
    const data = parseOr400(
      z.object({
        alertClassIds: z.array(z.number().int().positive()).min(1),
        assemblyPointId: z.number().int().positive(),
        pin: z.string().min(4).max(8),
      }),
      req.body,
    );
    await verifyLaunchPin(req.auth!.user, data.pin, req.ip);
    const result = await changeAssemblyPoint(alertId, data.alertClassIds, data.assemblyPointId, req.auth!.user.id);
    await audit(req, { action: 'alert.change_point', entity: 'alert', entityId: alertId, details: result });
    return result;
  });

  app.post('/alerts/:id/close', commanders, async (req) => {
    const alertId = idParam(req.params);
    const data = parseOr400(z.object({ sendCancelSms: z.boolean(), pin: z.string().min(4).max(8) }), req.body);
    await verifyLaunchPin(req.auth!.user, data.pin, req.ip);
    const result = await closeAlert(alertId, data.sendCancelSms, req.auth!.user.id);
    await audit(req, { action: 'alert.close', entity: 'alert', entityId: alertId, details: { sendCancelSms: data.sendCancelSms, ...result } });
    return result;
  });

  /** Zdarzenia na żywo (Server-Sent Events): "coś się zmieniło – odśwież". */
  app.get('/alerts/:id/events', { preHandler: requireLogin }, async (req, reply) => {
    const alertId = idParam(req.params);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    let pending: NodeJS.Timeout | null = null;
    const unsubscribe = onAlertChanged((changedId) => {
      if (changedId !== alertId || pending) return;
      // Przy masowej wysyłce zdarzeń jest dużo – wysyłamy najwyżej kilka na sekundę.
      pending = setTimeout(() => {
        pending = null;
        res.write(`data: ${Date.now()}\n\n`);
      }, 400);
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.raw.on('close', () => {
      unsubscribe();
      clearInterval(heartbeat);
      if (pending) clearTimeout(pending);
    });
  });

  /** Raport z alertu / ćwiczeń (CSV dla Excela: średniki, BOM). */
  app.get('/alerts/:id/report.csv', commanders, async (req, reply) => {
    const alertId = idParam(req.params);
    const detail = await alertDetail(alertId);
    const students = await prisma.alertStudent.findMany({
      where: { alertId },
      include: { alertClass: true, deliveries: { select: { status: true } } },
    });
    students.sort(
      (a, b) => compareClassNames(a.alertClass.className, b.alertClass.className) || a.lastName.localeCompare(b.lastName, 'pl'),
    );
    const a = detail.alert;
    const lines: string[][] = [
      ['Raport z alertu', `#${a.id}`],
      ['Tryb', a.mode === 'DRILL' ? 'ĆWICZENIA' : 'PRAWDZIWY ALARM'],
      ['Zdarzenie', a.eventLabel],
      ['Start', new Date(a.startedAt).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }), a.startedBy ?? ''],
      ['Zakończenie', a.closedAt ? new Date(a.closedAt).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }) : 'trwa', a.closedBy ?? ''],
      ['Uczniowie', String(a.attendance.total), `obecni: ${a.attendance.PRESENT}`, `odebrani: ${a.attendance.PICKED_UP}`, `nieobecni w szkole: ${a.attendance.ABSENT_TODAY}`, `nieodnalezieni: ${a.attendance.MISSING}`],
      ['SMS do rodziców', String(a.deliveries.total), `doręczone: ${a.deliveries.DELIVERED}`, `niedoręczone/błąd: ${a.deliveries.UNDELIVERED + a.deliveries.FAILED}`],
      [],
      ['Komunikaty'],
      ['Godzina', 'Rodzaj', 'Uwagi', 'Kto', 'SMS', 'Doręczone'],
      ...detail.messages.map((m) => [
        new Date(m.createdAt).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw' }),
        MESSAGE_KIND_LABELS[m.kind],
        m.note ?? '',
        m.createdBy ?? 'system',
        String(m.counts.total),
        String(m.counts.DELIVERED),
      ]),
      [],
      ['Uczniowie'],
      ['Klasa', 'Nazwisko', 'Imię', 'Punkt zbiórki', 'Obecność', 'Godzina', 'Odebrany przez', 'SMS doręczone', 'SMS problem'],
      ...students.map((s) => [
        s.alertClass.className,
        s.lastName,
        s.firstName,
        s.alertClass.pointName,
        ATTENDANCE_LABELS[s.attendance],
        s.attendanceAt ? s.attendanceAt.toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw' }) : '',
        s.pickedUpByName ?? '',
        String(s.deliveries.filter((d) => d.status === 'DELIVERED').length),
        String(s.deliveries.filter((d) => d.status === 'FAILED' || d.status === 'UNDELIVERED').length),
      ]),
    ];
    await audit(req, { action: 'alert.report', entity: 'alert', entityId: alertId });
    const csv = '﻿' + lines.map((l) => l.map(csvCell).join(';')).join('\r\n');
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="alert-${alertId}.csv"`)
      .send(csv);
  });

}
