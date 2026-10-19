// Kolejka wysyłki oparta na tabeli sms_deliveries (bez dodatkowych usług).
// - pobieranie partii: UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) – bezpieczne przy wielu procesach,
// - limit SMS/s, kilka wysyłek równolegle,
// - ponawianie błędów przejściowych z rosnącym odstępem, potem status FAILED,
// - tryb fake / ćwiczenia: symulowane raporty doręczeń.
import type { FastifyBaseLogger } from 'fastify';
import { CTX, fieldCrypto, prisma } from '../db';
import { env } from '../env';
import { notifyAlertChanged } from '../lib/events';
import { getSender, getSimulator } from '.';
import type { DlrStatus } from './provider';
import { createRateLimiter, nextRetryDelay } from './retry';

export { MAX_ATTEMPTS, RETRY_DELAYS_MS, createRateLimiter, nextRetryDelay } from './retry';

const BATCH = 25;
const CONCURRENCY = 5;
const IDLE_POLL_MS = 1_000;
const STATUS_POLL_MS = 15_000;
const STATUS_BATCH = 40;

interface Claimed {
  id: number;
  alert_id: number;
  phone_enc: string;
  body: string;
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
  notifyAlertChanged(delivery.alertId);
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

  constructor(private readonly log: FastifyBaseLogger) {}

  async start() {
    // Po restarcie: wiadomości przerwane w trakcie wysyłki wracają do kolejki.
    const recovered = await prisma.smsDelivery.updateMany({ where: { status: 'SENDING' }, data: { status: 'QUEUED' } });
    if (recovered.count) this.log.warn(`Kolejka SMS: przywrócono ${recovered.count} przerwanych wysyłek`);
    this.schedule(0);
    if (getSender().providers.some((p) => p.checkStatus)) {
      this.statusTimer = setInterval(() => void this.pollStatuses(), STATUS_POLL_MS);
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.statusTimer) clearInterval(this.statusTimer);
  }

  /** Statusy doręczeń odpytywane w bramce (dla wiadomości wysłanych w ciągu ostatniej doby). */
  private async pollStatuses() {
    if (this.polling) return;
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
    this.running = true;
    try {
      for (;;) {
        this.rerun = false;
        const batch = await this.claim();
        if (batch.length === 0 && !this.rerun) break;
        await this.processBatch(batch);
      }
    } catch (err) {
      this.log.error(err, 'Kolejka SMS: błąd');
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
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED)
      RETURNING id, alert_id, phone_enc, body, simulated, attempts`;
  }

  private async processBatch(batch: Claimed[]) {
    const queue = [...batch];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await this.processOne(item);
    });
    await Promise.all(workers);
  }

  private async processOne(d: Claimed) {
    const attempts = d.attempts + 1;
    try {
      const to = fieldCrypto.decrypt(d.phone_enc, CTX.deliveryPhone);
      let result;
      if (d.simulated) {
        result = { ...(await getSimulator().send({ to, text: d.body })), provider: 'symulacja' };
      } else {
        await this.limit();
        result = await getSender().send({ to, text: d.body, from: await senderName(), reference: String(d.id) });
      }

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
            events: { create: { status: 'SENT', detail: `${result.provider}${result.parts ? `, ${result.parts} cz.` : ''}` } },
          },
        });
        if (d.simulated || result.provider === 'fake') simulateReport(d.id);
      } else {
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
                  events: { create: { status: 'FAILED', detail: result.error } },
                },
        });
      }
    } catch (err) {
      this.log.error(err, `Kolejka SMS: wiadomość ${d.id}`);
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
    notifyAlertChanged(d.alert_id);
  }
}

let worker: DeliveryWorker | null = null;

export function startDeliveryWorker(log: FastifyBaseLogger) {
  worker = new DeliveryWorker(log);
  void worker.start();
  return worker;
}

export function kickDeliveryWorker() {
  worker?.kick();
}
