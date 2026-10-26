// Kolejka wysyłki oparta na tabeli sms_deliveries (bez dodatkowych usług).
// - pobieranie partii: UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) – bezpieczne przy wielu procesach,
// - pule: SMS-y z tą samą treścią i nadawcą idą jednym zapytaniem do bramki (SMSAPI, SerwerSMS),
//   pozostałe – równolegle (SMS_CONCURRENCY zapytań naraz, limit SMS_RATE_PER_SECOND zapytań/s),
// - ponawianie błędów przejściowych z rosnącym odstępem, potem status FAILED,
// - tryb fake / ćwiczenia: symulowane raporty doręczeń.
import type { FastifyBaseLogger } from 'fastify';
import { CTX, fieldCrypto, prisma } from '../db';
import { env } from '../env';
import { dbHealthy, isDbConnectionError, markDbDown } from '../lib/dbHealth';
import { notifyAlertChanged } from '../lib/events';
import { getSender, getSimulator } from '.';
import type { ChainResult } from './failover';
import type { DlrStatus } from './provider';
import { createRateLimiter, nextRetryDelay, runPool } from './retry';

export { MAX_ATTEMPTS, RETRY_DELAYS_MS, createRateLimiter, nextRetryDelay } from './retry';

/** Ile wiadomości pobierać z kolejki naraz (priorytety: alarm przed resztą). */
const CLAIM = 200;
const IDLE_POLL_MS = 1_000;
const STATUS_POLL_MS = 15_000;
const STATUS_BATCH = 40;

interface Claimed {
  id: number;
  alert_id: number | null;
  phone_enc: string;
  body: string;
  sender: string | null;
  simulated: boolean;
  attempts: number;
}

let senderNameCache: { value: string | undefined; at: number } | null = null;
async function senderName(): Promise<string | undefined> {
  if (env.SMS_USE_DEFAULT_SENDER) return undefined;
  if (!senderNameCache || Date.now() - senderNameCache.at > 30_000) {
    const school = await prisma.school.findUnique({ where: { id: 1 }, select: { senderName: true } });
    senderNameCache = { value: school?.senderName || undefined, at: Date.now() };
  }
  return senderNameCache.value;
}

/** Raport doręczenia (z bramki albo symulowany). Nie cofa statusów końcowych. */
export async function applyDeliveryReport(
  where: { id: number } | { provider: string; providerMessageId: string },
  status: DlrStatus,
  detail: string,
): Promise<boolean> {
  const delivery =
    'id' in where
      ? await prisma.smsDelivery.findUnique({ where: { id: where.id } })
      : await prisma.smsDelivery.findFirst({ where: { provider: where.provider, providerMessageId: where.providerMessageId } });
  if (!delivery) return false;
  if (delivery.status === 'DELIVERED') return true;
  if (status === 'SENT' && delivery.status !== 'SENDING' && delivery.status !== 'QUEUED') return true;

  await prisma.smsDelivery.update({
    where: { id: delivery.id },
    data: {
      status,
      deliveredAt: status === 'DELIVERED' ? new Date() : delivery.deliveredAt,
      lastError: status === 'DELIVERED' ? null : status === 'SENT' ? delivery.lastError : `Raport: ${detail}`,
      events: { create: { status, detail } },
    },
  });
  if (delivery.alertId) notifyAlertChanged(delivery.alertId);
  return true;
}

function simulateReport(deliveryId: number) {
  const delay = 800 + Math.random() * 3_000;
  const failed = Math.random() < env.FAKE_FAILURE_RATE;
  setTimeout(() => {
    void applyDeliveryReport({ id: deliveryId }, failed ? 'UNDELIVERED' : 'DELIVERED', failed ? 'symulacja: telefon niedostępny' : 'symulacja');
  }, delay).unref();
}

export class DeliveryWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private rerun = false;
  private stopped = false;
  private readonly limit = createRateLimiter(env.SMS_RATE_PER_SECOND);
  private statusTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private recovered = false;

  constructor(private readonly log: FastifyBaseLogger) {}

  /** Uruchomienie pętli (bez bazy – pętla czeka, aż baza wróci). */
  start() {
    this.schedule(0);
    if (getSender().providers.some((p) => p.checkStatus)) {
      this.statusTimer = setInterval(() => void this.pollStatuses(), STATUS_POLL_MS);
    }
  }

  /** Raz po starcie procesu (gdy baza odpowiada): wiadomości przerwane w trakcie wysyłki wracają do kolejki. */
  async recover() {
    if (this.recovered) return;
    const recovered = await prisma.smsDelivery.updateMany({ where: { status: 'SENDING' }, data: { status: 'QUEUED' } });
    this.recovered = true;
    if (recovered.count) this.log.warn(`Kolejka SMS: przywrócono ${recovered.count} przerwanych wysyłek`);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.statusTimer) clearInterval(this.statusTimer);
  }

  /** Statusy doręczeń odpytywane w bramce (dla wiadomości wysłanych w ciągu ostatniej doby). */
  private async pollStatuses() {
    if (this.polling || !dbHealthy() || !this.recovered) return;
    this.polling = true;
    try {
      for (const provider of getSender().providers) {
        if (!provider.checkStatus) continue;
        const pendingRows = await prisma.smsDelivery.findMany({
          where: {
            provider: provider.name,
            status: 'SENT',
            providerMessageId: { not: null },
            sentAt: { gt: new Date(Date.now() - 86_400_000), lt: new Date(Date.now() - 5_000) },
          },
          orderBy: { updatedAt: 'asc' },
          take: STATUS_BATCH,
          select: { id: true, providerMessageId: true },
        });
        for (const row of pendingRows) {
          const status = await provider.checkStatus(row.providerMessageId!).catch(() => null);
          if (status && status !== 'SENT') {
            await applyDeliveryReport({ id: row.id }, status, `${provider.name}: status ${status}`);
          } else {
            // Przesuń na koniec kolejki odpytywania.
            await prisma.smsDelivery.update({ where: { id: row.id }, data: { updatedAt: new Date() } });
          }
        }
      }
    } catch (err) {
      this.log.error(err, 'Kolejka SMS: odpytywanie statusów');
    } finally {
      this.polling = false;
    }
  }

  /** Natychmiastowe przetworzenie (po dodaniu nowych SMS-ów). */
  kick() {
    this.schedule(0);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick() {
    if (this.running) {
      this.rerun = true;
      return;
    }
    // Bez bazy nie ma kolejki – czekamy (wysyłka awaryjna idzie osobną drogą).
    if (!dbHealthy() || !this.recovered) {
      this.schedule(IDLE_POLL_MS);
      return;
    }
    this.running = true;
    try {
      for (;;) {
        this.rerun = false;
        const batch = await this.claim();
        if (batch.length === 0 && !this.rerun) break;
        await this.processBatch(batch);
      }
    } catch (err) {
      if (isDbConnectionError(err)) markDbDown();
      else this.log.error(err, 'Kolejka SMS: błąd');
    } finally {
      this.running = false;
      this.schedule(IDLE_POLL_MS);
    }
  }

  private claim() {
    return prisma.$queryRaw<Claimed[]>`
      UPDATE sms_deliveries SET status = 'SENDING', updated_at = now()
      WHERE id IN (
        SELECT id FROM sms_deliveries
        WHERE status = 'QUEUED' AND next_attempt_at <= now()
        ORDER BY priority, id
        LIMIT ${CLAIM}
        FOR UPDATE SKIP LOCKED)
      RETURNING id, alert_id, phone_enc, body, sender, simulated, attempts`;
  }

  private async processBatch(batch: Claimed[]) {
    // Symulowane (ćwiczenia) – bez bramki. Prawdziwe – grupy z tą samą treścią i nadawcą, pocięte na paczki.
    const tasks: (() => Promise<void>)[] = [];
    const groups = new Map<string, Claimed[]>();
    for (const d of batch) {
      if (d.simulated) {
        tasks.push(() => this.processSimulated(d));
        continue;
      }
      const key = `${d.sender ?? ''}|${d.body}`;
      const group = groups.get(key);
      if (group) group.push(d);
      else groups.set(key, [d]);
    }
    for (const items of groups.values()) {
      for (let i = 0; i < items.length; i += env.SMS_BATCH_SIZE) {
        const chunk = items.slice(i, i + env.SMS_BATCH_SIZE);
        tasks.push(() => this.processLive(chunk));
      }
    }
    await runPool(tasks, env.SMS_CONCURRENCY, (task) => task());
  }

  private async processSimulated(d: Claimed) {
    try {
      const to = fieldCrypto.decrypt(d.phone_enc, CTX.deliveryPhone);
      const result = { ...(await getSimulator().send({ to, text: d.body })), provider: 'symulacja' };
      await this.save(d, result);
      if (result.ok) simulateReport(d.id);
    } catch (err) {
      await this.internalError(d, err);
    }
    this.notify([d]);
  }

  private async processLive(items: Claimed[]) {
    const ready: { d: Claimed; to: string }[] = [];
    for (const d of items) {
      try {
        ready.push({ d, to: fieldCrypto.decrypt(d.phone_enc, CTX.deliveryPhone) });
      } catch (err) {
        await this.internalError(d, err);
      }
    }
    if (ready.length) {
      try {
        const first = ready[0]!.d;
        const results = await getSender().sendBatch(
          { to: ready.map((r) => r.to), text: first.body, from: first.sender ?? (await senderName()) },
          { limit: this.limit, concurrency: env.SMS_CONCURRENCY },
        );
        for (const [i, { d }] of ready.entries()) {
          const result = results[i]!;
          await this.save(d, result);
          if (result.ok && result.provider === 'fake') simulateReport(d.id);
        }
      } catch (err) {
        for (const { d } of ready) await this.internalError(d, err);
      }
    }
    this.notify(items);
  }

  private async save(d: Claimed, result: ChainResult) {
    const attempts = d.attempts + 1;
    if (result.ok) {
      await prisma.smsDelivery.update({
        where: { id: d.id },
        data: {
          status: 'SENT',
          attempts,
          provider: result.provider,
          providerMessageId: result.messageId,
          sentAt: new Date(),
          lastError: null,
          badNumber: false,
          events: { create: { status: 'SENT', detail: `${result.provider}${result.parts ? `, ${result.parts} cz.` : ''}` } },
        },
      });
      return;
    }
    const delay = nextRetryDelay(attempts, result.retryable);
    await prisma.smsDelivery.update({
      where: { id: d.id },
      data:
        delay !== null
          ? {
              status: 'QUEUED',
              attempts,
              provider: result.provider,
              lastError: result.error,
              nextAttemptAt: new Date(Date.now() + delay),
              events: { create: { status: 'QUEUED', detail: `ponowienie za ${delay / 1000} s: ${result.error}` } },
            }
          : {
              status: 'FAILED',
              attempts,
              provider: result.provider,
              lastError: result.error,
              badNumber: result.badRecipient === true,
              events: { create: { status: 'FAILED', detail: result.error } },
            },
    });
  }

  private async internalError(d: Claimed, err: unknown) {
    this.log.error(err, `Kolejka SMS: wiadomość ${d.id}`);
    const attempts = d.attempts + 1;
    const delay = nextRetryDelay(attempts, true);
    await prisma.smsDelivery
      .update({
        where: { id: d.id },
        data: {
          status: delay !== null ? 'QUEUED' : 'FAILED',
          attempts,
          lastError: 'Błąd wewnętrzny przy wysyłce',
          nextAttemptAt: new Date(Date.now() + (delay ?? 0)),
        },
      })
      .catch(() => undefined);
  }

  private notify(items: Claimed[]) {
    for (const alertId of new Set(items.map((d) => d.alert_id))) if (alertId) notifyAlertChanged(alertId);
  }
}

let worker: DeliveryWorker | null = null;

export function startDeliveryWorker(log: FastifyBaseLogger) {
  worker = new DeliveryWorker(log);
  worker.start();
  return worker;
}

export function kickDeliveryWorker() {
  worker?.kick();
}
