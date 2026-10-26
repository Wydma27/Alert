// RODO – retencja: po ALERT_RETENTION_DAYS od zakończenia alertu usuwamy dane osobowe z jego historii
// (imiona i nazwiska, numery, treści SMS). Zostają liczby i przebieg (kto uruchomił, kiedy, ile SMS-ów).
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db';
import { env } from '../env';
import { writeAudit } from '../lib/audit';

export async function purgeOldAlerts(log?: FastifyBaseLogger): Promise<number> {
  const cutoff = new Date(Date.now() - env.ALERT_RETENTION_DAYS * 86_400_000);
  const alerts = await prisma.alert.findMany({
    where: { status: 'CLOSED', purgedAt: null, closedAt: { lt: cutoff } },
    select: { id: true },
  });
  for (const { id } of alerts) {
    await prisma.$transaction([
      prisma.alertStudent.updateMany({ where: { alertId: id }, data: { firstName: '—', lastName: '—', pickedUpByName: null } }),
      prisma.smsDelivery.updateMany({ where: { alertId: id }, data: { body: '', phoneEnc: '', guardianName: null } }),
      prisma.callAttempt.updateMany({ where: { alertId: id }, data: { note: null } }),
      prisma.alert.update({ where: { id }, data: { purgedAt: new Date() } }),
    ]);
    await writeAudit({ action: 'alert.purged', entity: 'alert', entityId: id, details: { retentionDays: env.ALERT_RETENTION_DAYS } });
  }
  if (alerts.length) log?.info(`Retencja: zanonimizowano ${alerts.length} alertów`);
  return alerts.length;
}

/** To samo dla wiadomości do grup: po ALERT_RETENTION_DAYS od wysłania zostają tylko liczby i statusy. */
export async function purgeOldNotices(log?: FastifyBaseLogger): Promise<number> {
  const cutoff = new Date(Date.now() - env.ALERT_RETENTION_DAYS * 86_400_000);
  const notices = await prisma.notice.findMany({ where: { purgedAt: null, createdAt: { lt: cutoff } }, select: { id: true } });
  for (const { id } of notices) {
    await prisma.$transaction([
      prisma.smsDelivery.updateMany({ where: { noticeId: id }, data: { body: '', phoneEnc: '', guardianName: null } }),
      prisma.notice.update({ where: { id }, data: { body: '', purgedAt: new Date() } }),
    ]);
    await writeAudit({ action: 'notice.purged', entity: 'notice', entityId: id, details: { retentionDays: env.ALERT_RETENTION_DAYS } });
  }
  if (notices.length) log?.info(`Retencja: zanonimizowano ${notices.length} wiadomości`);
  return notices.length;
}
