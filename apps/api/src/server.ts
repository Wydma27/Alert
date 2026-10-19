import { buildApp } from './app';
import { purgeOldAlerts } from './alerts/retention';
import { ensureDefaults } from './alerts/templates';
import { prisma } from './db';
import { env } from './env';
import { startDeliveryWorker } from './sms/queue';

const app = await buildApp();
await ensureDefaults();
const worker = startDeliveryWorker(app.log);
await purgeOldAlerts(app.log).catch((err) => app.log.error(err, 'Retencja'));

// Sprzątanie wygasłych sesji co godzinę, retencja danych alertów co 6 godzin.
const timers = [
  setInterval(() => {
    prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch((err) => app.log.error(err));
  }, 60 * 60 * 1000),
  setInterval(() => void purgeOldAlerts(app.log).catch((err) => app.log.error(err, 'Retencja')), 6 * 60 * 60 * 1000),
];

async function shutdown(signal: string) {
  app.log.info(`${signal} – zamykanie`);
  timers.forEach(clearInterval);
  worker.stop();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: env.API_PORT, host: env.API_HOST });
