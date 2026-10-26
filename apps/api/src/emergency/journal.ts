// Wysyłka awaryjna (bez bazy danych): SMS-y idą prosto do bramki z kopii kontaktów,
// przebieg zapisujemy w zaszyfrowanym pliku, a po powrocie bazy dopisujemy go do historii wiadomości
// (z możliwością ponowienia nieudanych) i do dziennika zdarzeń.
import type { FastifyBaseLogger } from 'fastify';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { plural, type EmergencyJobDto, type RecipientGroupValue, type RecipientSelection, type ResolvedRecipient, type SmsInfo } from '@alert/shared';
import { CTX, fieldCrypto, prisma } from '../db';
import { env } from '../env';
import { writeAudit } from '../lib/audit';
import { getSender } from '../sms';
import { createRateLimiter, runPool } from '../sms/retry';
import { emergencyDir, getSnapshot } from './snapshot';

const JOBS_DIR = join(emergencyDir, 'jobs');
const RETRY_DELAYS_MS = [2_000, 5_000];

interface JobItem {
  key: string;
  name: string;
  group: RecipientGroupValue;
  /** Numer zaszyfrowany jak w kolejce wysyłki. */
  phoneEnc: string;
  status: 'pending' | 'sent' | 'failed';
  provider: string | null;
  messageId: string | null;
  error: string | null;
  badNumber: boolean;
  at: string | null;
}

export interface EmergencyJob {
  id: string;
  userId: number;
  userName: string;
  startedAt: string;
  finishedAt: string | null;
  body: string;
  parts: number;
  encoding: string;
  sender: string | null;
  selection: RecipientSelection;
  summary: string;
  items: JobItem[];
}

const jobs = new Map<string, EmergencyJob>();
const running = new Set<string>();

async function persist(job: EmergencyJob) {
  await mkdir(JOBS_DIR, { recursive: true });
  const file = join(JOBS_DIR, `${job.id}.enc`);
  await writeFile(`${file}.tmp`, fieldCrypto.encrypt(JSON.stringify(job), CTX.journal), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}

export function getJob(id: string): EmergencyJob | undefined {
  return jobs.get(id);
}

export function jobDto(job: EmergencyJob): EmergencyJobDto {
  const sent = job.items.filter((i) => i.status === 'sent').length;
  const failed = job.items.filter((i) => i.status === 'failed');
  return {
    id: job.id,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    summary: job.summary,
    total: job.items.length,
    sent,
    failed: failed.length,
    badNumbers: failed.filter((i) => i.badNumber).length,
    errors: failed.slice(0, 200).map((i) => ({ name: i.name, error: i.error ?? 'błąd' })),
  };
}

export async function pendingJournalCount(): Promise<number> {
  if (!existsSync(JOBS_DIR)) return 0;
  return (await readdir(JOBS_DIR)).filter((f) => f.endsWith('.enc')).length;
}

export async function startEmergencyJob(
  opts: {
    id: string;
    user: { id: number; fullName: string };
    body: string;
    info: SmsInfo;
    sender: string | null;
    selection: RecipientSelection;
    summary: string;
    recipients: ResolvedRecipient[];
  },
  log: FastifyBaseLogger,
): Promise<EmergencyJob> {
  const existing = jobs.get(opts.id);
  if (existing) return existing; // podwójne kliknięcie
  const job: EmergencyJob = {
    id: opts.id,
    userId: opts.user.id,
    userName: opts.user.fullName,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    body: opts.body,
    parts: opts.info.parts,
    encoding: opts.info.encoding,
    sender: opts.sender,
    selection: opts.selection,
    summary: opts.summary,
    items: opts.recipients.map((r) => ({
      key: r.key,
      name: r.names.join(', '),
      group: r.group,
      phoneEnc: fieldCrypto.encrypt(r.phone, CTX.deliveryPhone),
      status: 'pending',
      provider: null,
      messageId: null,
      error: null,
      badNumber: false,
      at: null,
    })),
  };
  jobs.set(job.id, job);
  await persist(job);
  running.add(job.id);
  void run(job, opts.recipients, log).finally(() => running.delete(job.id));
  return job;
}

async function run(job: EmergencyJob, recipients: ResolvedRecipient[], log: FastifyBaseLogger) {
  const sender = getSender();
  const limit = createRateLimiter(env.SMS_RATE_PER_SECOND);
  const school = getSnapshot()?.school;
  const from = job.sender ?? (env.SMS_USE_DEFAULT_SENDER ? undefined : school?.senderName || undefined);
  let pending = recipients.map((_, i) => i);

  try {
    for (let round = 0; round <= RETRY_DELAYS_MS.length && pending.length; round++) {
      if (round > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[round - 1]));
      const lastRound = round === RETRY_DELAYS_MS.length;
      const chunks: number[][] = [];
      for (let c = 0; c < pending.length; c += env.SMS_BATCH_SIZE) chunks.push(pending.slice(c, c + env.SMS_BATCH_SIZE));
      const retry: number[] = [];
      await runPool(chunks, env.SMS_CONCURRENCY, async (chunk) => {
        const results = await sender.sendBatch(
          { to: chunk.map((i) => recipients[i]!.phone), text: job.body, from },
          { limit, concurrency: env.SMS_CONCURRENCY },
        );
        results.forEach((r, j) => {
          const i = chunk[j]!;
          const item = job.items[i]!;
          if (!r.ok && r.retryable && !lastRound) {
            retry.push(i);
            return;
          }
          item.at = new Date().toISOString();
          item.provider = r.provider;
          if (r.ok) {
            item.status = 'sent';
            item.messageId = r.messageId;
          } else {
            item.status = 'failed';
            item.error = r.error;
            item.badNumber = r.badRecipient === true;
          }
        });
        await persist(job);
      });
      pending = retry;
    }
  } catch (err) {
    log.error(err, `Wysyłka awaryjna ${job.id}`);
    for (const item of job.items) {
      if (item.status !== 'pending') continue;
      item.status = 'failed';
      item.error = 'Wysyłka awaryjna przerwana błędem – ponów po powrocie bazy.';
    }
  }
  job.finishedAt = new Date().toISOString();
  await persist(job);
  const dto = jobDto(job);
  log.warn(`Wysyłka awaryjna ${job.id}: wysłano ${dto.sent}/${dto.total}, błędy ${dto.failed}`);
}

/** Po powrocie bazy: wysyłki awaryjne trafiają do historii wiadomości i dziennika zdarzeń. */
export async function replayJournal(log: FastifyBaseLogger): Promise<number> {
  if (!existsSync(JOBS_DIR)) return 0;
  let replayed = 0;
  for (const file of (await readdir(JOBS_DIR)).filter((f) => f.endsWith('.enc'))) {
    const path = join(JOBS_DIR, file);
    let job: EmergencyJob;
    try {
      job = JSON.parse(fieldCrypto.decrypt(await readFile(path, 'utf8'), CTX.journal)) as EmergencyJob;
    } catch (err) {
      log.error(err, `Dziennik awaryjny: nie da się odczytać ${file}`);
      continue;
    }
    if (running.has(job.id)) continue; // jeszcze trwa – dopiszemy po zakończeniu

    const idempotencyKey = `emergency:${job.id}`;
    if (!(await prisma.notice.findUnique({ where: { idempotencyKey } }))) {
      const interrupted = !job.finishedAt;
      await prisma.$transaction(async (tx) => {
        const notice = await tx.notice.create({
          data: {
            body: job.body,
            sender: job.sender,
            selection: job.selection as object,
            summary: `${job.summary} · TRYB AWARYJNY${interrupted ? ' (przerwana)' : ''}`,
            recipients: job.items.length,
            parts: job.parts,
            encoding: job.encoding,
            emergency: true,
            idempotencyKey,
            createdById: job.userId,
            createdAt: new Date(job.startedAt),
          },
        });
        await tx.smsDelivery.createMany({
          data: job.items.map((i) => ({
            noticeId: notice.id,
            guardianName: i.name,
            contactKey: i.key,
            audience: i.group,
            phoneEnc: i.phoneEnc,
            body: job.body,
            parts: job.parts,
            encoding: job.encoding,
            sender: job.sender,
            priority: 3,
            status: i.status === 'sent' ? ('SENT' as const) : ('FAILED' as const),
            badNumber: i.badNumber,
            provider: i.provider,
            providerMessageId: i.messageId,
            attempts: i.status === 'pending' ? 0 : 1,
            sentAt: i.status === 'sent' && i.at ? new Date(i.at) : null,
            lastError: i.status === 'pending' ? 'Wysyłka awaryjna przerwana – ponów.' : i.error,
          })),
        });
        const dto = jobDto(job);
        await writeAudit(
          {
            action: 'emergency.send',
            entity: 'notice',
            entityId: notice.id,
            userId: job.userId,
            details: { summary: job.summary, recipients: dto.total, sent: dto.sent, failed: dto.failed, startedAt: job.startedAt, interrupted },
          },
          tx,
        );
      });
    }
    await unlink(path);
    jobs.delete(job.id);
    replayed++;
  }
  if (replayed) log.warn(`Dziennik awaryjny: ${plural(replayed, 'wysyłka dopisana', 'wysyłki dopisane', 'wysyłek dopisanych')} do historii`);
  return replayed;
}
