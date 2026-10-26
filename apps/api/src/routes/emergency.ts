// Tryb awaryjny: działa BEZ bazy danych – na zaszyfrowanej kopii kontaktów i sesji z dysku serwera.
// Trasy nie mogą sięgać do bazy (poza sprawdzeniem PIN-u, gdy baza akurat działa).
import type { User } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { EmergencyStatusDto } from '@alert/shared';
import { dbDownSince, dbHealthy } from '../lib/dbHealth';
import { withoutPhones } from '../lib/directory';
import { HttpError, parseOr400 } from '../lib/http';
import { verifySecret } from '../lib/password';
import { checkNotice, noticeSchema } from '../notices/service';
import { getSender } from '../sms';
import { getJob, jobDto, pendingJournalCount, startEmergencyJob } from '../emergency/journal';
import { getSnapshot } from '../emergency/snapshot';
import { verifyLaunchPin } from '../auth/pin';
import { requireRole } from '../auth/session';

const MAX_PIN_FAILURES = 5;
const PIN_LOCK_MS = 5 * 60_000;
const pinFailures = new Map<number, { count: number; until: number }>();

/** PIN bez bazy: skrót z kopii awaryjnej, blokada po błędach w pamięci serwera. */
async function verifyPin(user: User, pin: string, ip: string) {
  if (dbHealthy()) return verifyLaunchPin(user, pin, ip);
  if (!user.launchPinHash) throw new HttpError(409, 'Nie masz ustawionego PIN-u alarmowego.');
  const state = pinFailures.get(user.id) ?? { count: 0, until: 0 };
  if (state.until > Date.now()) throw new HttpError(423, 'PIN zablokowany po błędnych próbach. Poczekaj 5 minut albo poproś inną osobę.');
  if (await verifySecret(user.launchPinHash, pin)) {
    pinFailures.delete(user.id);
    return;
  }
  state.count++;
  if (state.count >= MAX_PIN_FAILURES) pinFailures.set(user.id, { count: 0, until: Date.now() + PIN_LOCK_MS });
  else pinFailures.set(user.id, state);
  throw new HttpError(401, `Błędny PIN. Pozostało prób: ${Math.max(0, MAX_PIN_FAILURES - state.count)}.`);
}

function requireSnapshot() {
  const snap = getSnapshot();
  if (!snap) throw new HttpError(503, 'Na serwerze nie ma kopii awaryjnej kontaktów – użyj kopii zapisanej w telefonie.');
  return snap;
}

export async function emergencyRoutes(app: FastifyInstance) {
  const commanders = { preHandler: requireRole('ADMIN', 'DYREKCJA') };

  /** Stan bazy i kopii – bez logowania (ekran trybu awaryjnego pokazuje go od razu). */
  app.get('/emergency/status', async (req): Promise<EmergencyStatusDto> => {
    const snap = getSnapshot();
    const user = req.auth?.session.mfaOk ? req.auth.user : null;
    return {
      db: dbHealthy(),
      dbDownSince: dbDownSince()?.toISOString() ?? null,
      snapshotAt: snap?.createdAt ?? null,
      live: getSender().live,
      user: user ? { id: user.id, fullName: user.fullName, role: user.role } : null,
      pendingJournal: user ? await pendingJournalCount() : 0,
    };
  });

  /** Kontakty z kopii awaryjnej (bez numerów) – do wyboru odbiorców. */
  app.get('/emergency/directory', commanders, async () => {
    const snap = requireSnapshot();
    return {
      directory: withoutPhones(snap.directory),
      snapshotAt: snap.createdAt,
      defaultSender: snap.school?.senderName ?? '',
      hasPin: true,
    };
  });

  app.post('/emergency/send', { ...commanders, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = req.body as Record<string, unknown>;
    const { pin, idempotencyKey } = parseOr400(z.object({ pin: z.string().min(4).max(8), idempotencyKey: z.string().uuid() }), {
      pin: body?.pin,
      idempotencyKey: body?.idempotencyKey,
    });
    const input = parseOr400(noticeSchema, body);
    const snap = requireSnapshot();
    await verifyPin(req.auth!.user, pin, req.ip);
    const plan = await checkNotice(input, snap.directory, snap.school?.senderName ?? null);
    if (plan.blocking.length) throw new HttpError(400, plan.blocking.join(' '));
    const job = await startEmergencyJob(
      {
        id: idempotencyKey,
        user: req.auth!.user,
        body: plan.body,
        info: plan.info,
        sender: input.sender,
        selection: input.selection,
        summary: plan.summary,
        recipients: plan.resolution.recipients,
      },
      req.log,
    );
    req.log.warn(`Wysyłka awaryjna ${job.id}: ${req.auth!.user.fullName}, ${job.items.length} odbiorców (${plan.summary})`);
    return { jobId: job.id };
  });

  app.get('/emergency/jobs/:id', commanders, async (req) => {
    const { id } = parseOr400(z.object({ id: z.string().uuid() }), req.params);
    const job = getJob(id);
    if (!job) throw new HttpError(404, 'Nie ma takiej wysyłki (albo jest już w historii wiadomości).');
    return jobDto(job);
  });
}
