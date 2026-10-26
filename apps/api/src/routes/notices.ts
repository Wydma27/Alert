import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  DELIVERY_STATUS_LABELS,
  GROUP_LABELS,
  contactLink,
  type NoticeDeliveryDto,
  type NoticeDetailDto,
  type NoticeListItemDto,
  type NoticeOptionsDto,
  type ProblemNumberDto,
  type RecipientGroupValue,
} from '@alert/shared';
import { CTX, fieldCrypto, prisma } from '../db';
import { env } from '../env';
import { audit } from '../lib/audit';
import { loadDirectory, withoutPhones } from '../lib/directory';
import { HttpError, idParam, parseOr400 } from '../lib/http';
import { maskPhone } from '../lib/phone';
import { buildNoticePlan, noticeCounts, noticeSchema, previewDto, sendNotice } from '../notices/service';
import { getSender } from '../sms';
import { kickDeliveryWorker } from '../sms/queue';
import { verifyLaunchPin } from '../auth/pin';
import { requireRole } from '../auth/session';

const PROBLEM_WINDOW_DAYS = 90;

function maskedDeliveryPhone(phoneEnc: string): string {
  return phoneEnc ? maskPhone(fieldCrypto.decrypt(phoneEnc, CTX.deliveryPhone)) : '—';
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sendCsv(reply: FastifyReply, filename: string, lines: unknown[][]) {
  const csv = '﻿' + lines.map((l) => l.map(csvCell).join(';')).join('\r\n');
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(csv);
}

const warsaw = (d: Date) => d.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });

async function userNames(ids: number[]) {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

/** Numery, na które ostatnio nie udało się wysłać (alerty i wiadomości) – z aktualnymi danymi kontaktu. */
async function problemNumbers(): Promise<ProblemNumberDto[]> {
  const since = new Date(Date.now() - PROBLEM_WINDOW_DAYS * 86_400_000);
  const failed = await prisma.smsDelivery.findMany({
    where: { createdAt: { gte: since }, simulated: false, testNumberId: null, contactKey: { not: null }, status: { in: ['FAILED', 'UNDELIVERED'] } },
    select: { contactKey: true },
    distinct: ['contactKey'],
  });
  const keys = failed.map((f) => f.contactKey!);
  if (keys.length === 0) return [];
  const rows = await prisma.smsDelivery.findMany({
    where: { contactKey: { in: keys }, createdAt: { gte: since }, simulated: false },
    select: { contactKey: true, status: true, badNumber: true, lastError: true, updatedAt: true, audience: true, guardianName: true, phoneEnc: true },
    orderBy: { createdAt: 'desc' },
  });
  const byKey = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byKey.get(r.contactKey!) ?? [];
    list.push(r);
    byKey.set(r.contactKey!, list);
  }

  const idsOf = (prefix: string) => keys.filter((k) => k.startsWith(prefix)).map((k) => Number(k.slice(2)));
  const [teachers, students, guardians] = await Promise.all([
    prisma.teacher.findMany({ where: { id: { in: idsOf('t:') } } }),
    prisma.student.findMany({ where: { id: { in: idsOf('s:') } }, include: { schoolClass: true } }),
    prisma.guardian.findMany({
      where: { id: { in: idsOf('p:') } },
      include: { students: { include: { student: { include: { schoolClass: true } } }, orderBy: { priority: 'asc' } } },
    }),
  ]);

  const result: ProblemNumberDto[] = [];
  for (const [key, list] of byKey) {
    const latest = list[0]!;
    // Po nieudanej wysyłce przyszła udana – numer działa.
    if (latest.status !== 'FAILED' && latest.status !== 'UNDELIVERED') continue;
    const failures = list.filter((r) => r.status === 'FAILED' || r.status === 'UNDELIVERED');
    const id = Number(key.slice(2));
    let name = latest.guardianName ?? '—';
    let detail = '';
    let phoneMasked: string | null = latest.phoneEnc ? maskedDeliveryPhone(latest.phoneEnc) : null;
    let exists = false;
    let link: string | null = null;
    if (key.startsWith('t:')) {
      const t = teachers.find((x) => x.id === id);
      if (t) {
        exists = true;
        name = `${t.firstName} ${t.lastName}`;
        detail = t.position ?? 'nauczyciel';
        phoneMasked = maskPhone(fieldCrypto.decrypt(t.phoneEnc, CTX.teacherPhone));
        link = contactLink(key);
      }
    } else if (key.startsWith('s:')) {
      const s = students.find((x) => x.id === id);
      if (s) {
        exists = true;
        name = `${s.firstName} ${s.lastName}`;
        detail = `uczeń, kl. ${s.schoolClass.name}`;
        phoneMasked = s.phoneEnc ? maskPhone(fieldCrypto.decrypt(s.phoneEnc, CTX.studentPhone)) : null;
        link = contactLink(key);
      }
    } else {
      const g = guardians.find((x) => x.id === id);
      if (g) {
        exists = true;
        const child = g.students[0]?.student;
        name = g.displayName ?? name;
        detail = `rodzic: ${g.students.map((l) => `${l.student.firstName} ${l.student.lastName} (${l.student.schoolClass.name})`).join(', ')}`;
        phoneMasked = maskPhone(fieldCrypto.decrypt(g.phoneEnc, CTX.guardianPhone));
        link = contactLink(key, child?.id);
      }
    }
    result.push({
      contactKey: key,
      group: (latest.audience as RecipientGroupValue | null) ?? null,
      name,
      detail,
      phoneMasked,
      failures: failures.length,
      badNumber: failures.some((r) => r.badNumber),
      lastError: latest.lastError,
      lastAt: latest.updatedAt.toISOString(),
      exists,
      link,
    });
  }
  return result.sort((a, b) => Number(b.badNumber) - Number(a.badNumber) || b.failures - a.failures || a.name.localeCompare(b.name, 'pl'));
}

export async function noticeRoutes(app: FastifyInstance) {
  const commanders = { preHandler: requireRole('ADMIN', 'DYREKCJA') };

  /** Kontakty (bez numerów) i nadawcy do formularza. */
  app.get('/notices/options', commanders, async (req): Promise<NoticeOptionsDto> => {
    const [directory, school, senders] = await Promise.all([
      loadDirectory(false),
      prisma.school.findUnique({ where: { id: 1 } }),
      getSender()
        .senders()
        .catch(() => null),
    ]);
    return {
      directory: withoutPhones(directory),
      senders,
      defaultSender: env.SMS_USE_DEFAULT_SENDER ? '' : (school?.senderName ?? ''),
      live: getSender().live,
      hasPin: Boolean(req.auth!.user.launchPinHash),
    };
  });

  app.post('/notices/preview', commanders, async (req) => {
    const input = parseOr400(noticeSchema, req.body);
    const { directory: _directory, ...plan } = await buildNoticePlan(input);
    return previewDto(plan);
  });

  app.post('/notices', { ...commanders, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = req.body as Record<string, unknown>;
    const { pin, idempotencyKey } = parseOr400(z.object({ pin: z.string().min(4).max(8), idempotencyKey: z.string().uuid() }), {
      pin: body?.pin,
      idempotencyKey: body?.idempotencyKey,
    });
    const input = parseOr400(noticeSchema, body);
    await verifyLaunchPin(req.auth!.user, pin, req.ip);
    const { notice, created } = await sendNotice(input, req.auth!.user.id, idempotencyKey);
    if (created) {
      await audit(req, {
        action: 'notice.send',
        entity: 'notice',
        entityId: notice.id,
        details: { summary: notice.summary, recipients: notice.recipients, sender: notice.sender ?? '(domyślny)', parts: notice.parts },
      });
    }
    return { id: notice.id, created };
  });

  app.get('/notices', commanders, async (): Promise<NoticeListItemDto[]> => {
    const notices = await prisma.notice.findMany({ orderBy: { id: 'desc' }, take: 200 });
    const [counts, names] = await Promise.all([noticeCounts(notices.map((n) => n.id)), userNames(notices.map((n) => n.createdById))]);
    return notices.map((n) => ({
      id: n.id,
      createdAt: n.createdAt.toISOString(),
      createdBy: names.get(n.createdById) ?? null,
      summary: n.summary,
      sender: n.sender,
      recipients: n.recipients,
      emergency: n.emergency,
      counts: counts.get(n.id)!,
    }));
  });

  app.get('/notices/:id', commanders, async (req): Promise<NoticeDetailDto> => {
    const id = idParam(req.params);
    const n = await prisma.notice.findUnique({ where: { id } });
    if (!n) throw new HttpError(404, 'Nie ma takiej wiadomości.');
    const [counts, names] = await Promise.all([noticeCounts([id]), userNames([n.createdById])]);
    return {
      id: n.id,
      createdAt: n.createdAt.toISOString(),
      createdBy: names.get(n.createdById) ?? null,
      summary: n.summary,
      sender: n.sender,
      recipients: n.recipients,
      emergency: n.emergency,
      counts: counts.get(id)!,
      body: n.body,
      parts: n.parts,
      encoding: n.encoding,
      purged: n.purgedAt !== null,
      live: getSender().live,
    };
  });

  app.get('/notices/:id/deliveries', commanders, async (req): Promise<NoticeDeliveryDto[]> => {
    const noticeId = idParam(req.params);
    const q = parseOr400(z.object({ filter: z.enum(['all', 'problems', 'pending']).default('all') }), req.query);
    const where: Prisma.SmsDeliveryWhereInput = { noticeId };
    if (q.filter === 'problems') where.status = { in: ['FAILED', 'UNDELIVERED'] };
    if (q.filter === 'pending') where.status = { in: ['QUEUED', 'SENDING', 'SENT'] };
    const rows = await prisma.smsDelivery.findMany({ where, orderBy: [{ status: 'asc' }, { id: 'asc' }], take: 5000 });
    return rows.map((d) => ({
      id: d.id,
      recipientName: d.guardianName,
      audience: d.audience,
      contactKey: d.contactKey,
      phoneMasked: maskedDeliveryPhone(d.phoneEnc),
      status: d.status,
      badNumber: d.badNumber,
      attempts: d.attempts,
      lastError: d.lastError,
      provider: d.provider,
      updatedAt: d.updatedAt.toISOString(),
    }));
  });

  app.post('/notices/:id/resend-failed', commanders, async (req) => {
    const noticeId = idParam(req.params);
    // Błędnych numerów nie ponawiamy – trzeba je najpierw poprawić w danych.
    const result = await prisma.smsDelivery.updateMany({
      where: { noticeId, status: { in: ['FAILED', 'UNDELIVERED'] }, badNumber: false, phoneEnc: { not: '' } },
      data: { status: 'QUEUED', attempts: 0, nextAttemptAt: new Date(), priority: 2, lastError: null },
    });
    kickDeliveryWorker();
    await audit(req, { action: 'notice.resend_failed', entity: 'notice', entityId: noticeId, details: { count: result.count } });
    return { count: result.count };
  });

  app.get('/notices/:id/report.csv', commanders, async (req, reply) => {
    const noticeId = idParam(req.params);
    const n = await prisma.notice.findUnique({ where: { id: noticeId } });
    if (!n) throw new HttpError(404, 'Nie ma takiej wiadomości.');
    const [counts, names, rows] = await Promise.all([
      noticeCounts([noticeId]),
      userNames([n.createdById]),
      prisma.smsDelivery.findMany({ where: { noticeId }, orderBy: [{ status: 'asc' }, { id: 'asc' }] }),
    ]);
    const c = counts.get(noticeId)!;
    await audit(req, { action: 'notice.report', entity: 'notice', entityId: noticeId });
    return sendCsv(reply, `wiadomosc-${noticeId}.csv`, [
      ['Raport wysyłki', `#${n.id}`, n.emergency ? 'TRYB AWARYJNY' : ''],
      ['Data', warsaw(n.createdAt), names.get(n.createdById) ?? ''],
      ['Odbiorcy', n.summary],
      ['Nadawca', n.sender ?? '(domyślny)'],
      ['Treść', n.body],
      ['SMS', c.total, `doręczone: ${c.DELIVERED}`, `wysłane (bez raportu): ${c.SENT}`, `niedoręczone/błąd: ${c.UNDELIVERED + c.FAILED}`, `błędne numery: ${c.badNumbers}`],
      [],
      ['Odbiorca', 'Grupa', 'Numer', 'Status', 'Błędny numer', 'Przyczyna', 'Próby', 'Bramka', 'Ostatnia zmiana'],
      ...rows.map((d) => [
        d.guardianName ?? '',
        d.audience ? GROUP_LABELS[d.audience] : '',
        maskedDeliveryPhone(d.phoneEnc),
        DELIVERY_STATUS_LABELS[d.status],
        d.badNumber ? 'TAK' : '',
        d.lastError ?? '',
        d.attempts,
        d.provider ?? '',
        warsaw(d.updatedAt),
      ]),
    ]);
  });

  /** Raport: numery do poprawy (nieudane wysyłki z ostatnich 90 dni, bez późniejszego sukcesu). */
  app.get('/reports/problem-numbers', commanders, async () => problemNumbers());

  app.get('/reports/problem-numbers.csv', commanders, async (req, reply) => {
    const rows = await problemNumbers();
    await audit(req, { action: 'report.problem_numbers', details: { count: rows.length } });
    return sendCsv(reply, 'numery-do-poprawy.csv', [
      ['Numery do poprawy', `ostatnie ${PROBLEM_WINDOW_DAYS} dni`, warsaw(new Date())],
      [],
      ['Osoba', 'Grupa', 'Opis', 'Numer', 'Błędny numer', 'Nieudane wysyłki', 'Ostatni błąd', 'Kiedy', 'W bazie'],
      ...rows.map((r) => [
        r.name,
        r.group ? GROUP_LABELS[r.group] : '',
        r.detail,
        r.phoneMasked ?? '',
        r.badNumber ? 'TAK' : '',
        r.failures,
        r.lastError ?? '',
        warsaw(new Date(r.lastAt)),
        r.exists ? 'tak' : 'usunięty',
      ]),
    ]);
  });
}
