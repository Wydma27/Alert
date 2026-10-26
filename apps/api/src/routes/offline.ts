// Kopia kontaktów na urządzeniu (telefon / komputer dyrekcji): pobierana z bazy i szyfrowana w przeglądarce
// kluczem chronionym hasłem do konta. Bez połączenia z serwerem pozwala wysłać SMS z telefonu lub skopiować numery do panelu bramki.
// Działania wykonane bez sieci wracają tu po odzyskaniu połączenia (dziennik zdarzeń).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { loadDirectory } from '../lib/directory';
import { HttpError, parseOr400 } from '../lib/http';
import { verifySecret } from '../lib/password';
import { requireRole } from '../auth/session';

const journalEntry = z.object({
  id: z.string().uuid(),
  at: z.string().datetime(),
  action: z.enum(['sms_app', 'copy_numbers', 'csv', 'call']),
  summary: z.string().max(300),
  recipients: z.number().int().min(0).max(100_000),
  body: z.string().max(1000).nullable(),
});

export async function offlineRoutes(app: FastifyInstance) {
  const commanders = { preHandler: requireRole('ADMIN', 'DYREKCJA') };

  /**
   * Włączenie kopii na urządzeniu: hasło do konta potwierdza, że to samo hasło zabezpieczy kopię w telefonie
   * (hasło ma min. 12 znaków – krótki PIN dałoby się odgadnąć, gdyby ktoś skopiował dane przeglądarki).
   */
  app.post('/offline/enable', { ...commanders, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const { password } = parseOr400(z.object({ password: z.string().min(1).max(200) }), req.body);
    // Użytkownik z kopii awaryjnej nie ma skrótu hasła – kopię włącza się przy działającej bazie.
    if (!req.auth!.user.passwordHash) throw new HttpError(503, 'Kopię w urządzeniu włączysz, gdy baza danych działa.');
    if (!(await verifySecret(req.auth!.user.passwordHash, password))) {
      await audit(req, { action: 'offline.enable.failed' });
      throw new HttpError(401, 'Błędne hasło.');
    }
    await audit(req, { action: 'offline.enable', details: { userAgent: req.headers['user-agent']?.slice(0, 120) ?? null } });
    return { ok: true };
  });

  app.post('/offline/disable', commanders, async (req) => {
    await audit(req, { action: 'offline.disable' });
    return { ok: true };
  });

  /** Pełna książka kontaktów z numerami – tylko do zaszyfrowania na urządzeniu. Każde pobranie w dzienniku. */
  app.get('/offline/directory', { ...commanders, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
    const [directory, school] = await Promise.all([loadDirectory(true), prisma.school.findUnique({ where: { id: 1 } })]);
    await audit(req, { action: 'offline.sync', details: { people: directory.people.length } });
    reply.header('Cache-Control', 'no-store');
    return {
      directory,
      school: school ? { name: school.name, smsName: school.smsName, senderName: school.senderName } : null,
      userId: req.auth!.user.id,
    };
  });

  /** Co zrobiono na urządzeniu bez połączenia (wysyłka z aplikacji SMS, skopiowane numery…). */
  app.post('/offline/journal', commanders, async (req) => {
    const { entries } = parseOr400(z.object({ entries: z.array(journalEntry).max(500) }), req.body);
    for (const e of entries) {
      await audit(req, {
        action: `offline.${e.action}`,
        details: { clientId: e.id, at: e.at, summary: e.summary, recipients: e.recipients, body: e.body },
      });
    }
    return { saved: entries.length };
  });
}
