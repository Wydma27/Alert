import { buildApp } from './app';
import { purgeOldAlerts, purgeOldNotices } from './alerts/retention';
import { ensureDefaults } from './alerts/templates';
import { prisma } from './db';
import { replayJournal, pendingJournalCount } from './emergency/journal';
import { flushSnapshot, loadSnapshotFromDisk, refreshSnapshot } from './emergency/snapshot';
import { env } from './env';
import { checkDb, dbHealthy, onDbStateChange, startDbMonitor } from './lib/dbHealth';
import { startDeliveryWorker } from './sms/queue';

const app = await buildApp();
const log = app.log;

// Kopia awaryjna z dysku – serwer działa (logowanie, wysyłka SMS), nawet gdy baza nie odpowiada od startu.
await loadSnapshotFromDisk(log);
const worker = startDeliveryWorker(log);

/** Wszystko, co wymaga bazy: przy starcie i po każdym jej powrocie. */
let initializing: Promise<void> | null = null;
function initWithDb() {
  initializing ??= (async () => {
    try {
      await ensureDefaults();
      await worker.recover();
      await replayJournal(log);
      await refreshSnapshot(log);
      await purgeOldAlerts(log);
      await purgeOldNotices(log);
    } catch (err) {
      log.error(err, 'Start z bazą danych');
    } finally {
      initializing = null;
    }
  })();
  return initializing;
}

if (await checkDb()) await initWithDb();
else log.error('Baza danych nie odpowiada – start w trybie awaryjnym (kopia kontaktów z dysku).');
onDbStateChange((ok) => {
  if (ok) void initWithDb();
});
const stopMonitor = startDbMonitor(log);

const guarded = (fn: () => Promise<unknown>, label: string) => () => {
  if (dbHealthy()) void fn().catch((err) => log.error(err, label));
};

// Sprzątanie sesji co godzinę, retencja co 6 godzin, kopia awaryjna co kilka minut,
// zaległe wysyłki awaryjne co minutę (np. gdy wysłano je przy działającej, ale pełnej bazie).
const timers = [
  setInterval(guarded(() => prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }), 'Sesje'), 60 * 60 * 1000),
  setInterval(guarded(async () => (await purgeOldAlerts(log)) + (await purgeOldNotices(log)), 'Retencja'), 6 * 60 * 60 * 1000),
  setInterval(guarded(() => refreshSnapshot(log), 'Kopia awaryjna'), env.SNAPSHOT_INTERVAL_MINUTES * 60 * 1000),
  setInterval(
    guarded(async () => ((await pendingJournalCount()) ? replayJournal(log) : 0), 'Dziennik awaryjny'),
    60 * 1000,
  ),
  setInterval(() => void flushSnapshot().catch((err) => log.error(err, 'Kopia awaryjna')), 60 * 1000),
];

async function shutdown(signal: string) {
  log.info(`${signal} – zamykanie`);
  timers.forEach(clearInterval);
  stopMonitor();
  worker.stop();
  await flushSnapshot().catch(() => undefined);
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: env.API_PORT, host: env.API_HOST });
