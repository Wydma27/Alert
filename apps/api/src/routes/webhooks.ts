// Raporty doręczeń od bramek SMS. Działają dopiero, gdy aplikacja ma publiczny adres HTTPS
// (SMS_CALLBACK_BASE_URL) – lokalnie statusy kończą się na "wysłano".
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../env';
import { HttpError } from '../lib/http';
import { mapSerwerSmsStatus } from '../sms/serwersms';
import { mapSmsApiStatus } from '../sms/smsapi';
import { applyDeliveryReport } from '../sms/queue';

function checkToken(req: FastifyRequest) {
  const expected = env.SMS_WEBHOOK_TOKEN;
  const given = (req.query as Record<string, string | undefined>).token ?? '';
  if (!expected || !env.SMS_CALLBACK_BASE_URL) throw new HttpError(404, 'Nie znaleziono.');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(403, 'Brak dostępu.');
}

/** Parametry z zapytania lub treści (bramki różnie je wysyłają). */
function params(req: FastifyRequest): Record<string, string> {
  return { ...((req.body as Record<string, string>) ?? {}), ...(req.query as Record<string, string>) };
}

export async function webhookRoutes(app: FastifyInstance) {
  // Bramki mogą wysyłać raport jako formularz – parser tylko w obrębie tych tras.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  // SMSAPI: MsgId, status (kod 401–412), status_name. Przy wielu raportach wartości bywają rozdzielone przecinkami.
  app.route({
    method: ['GET', 'POST'],
    url: '/webhooks/smsapi',
    handler: async (req, reply) => {
      checkToken(req);
      const p = params(req);
      const ids = (p.MsgId ?? '').split(',').filter(Boolean);
      const codes = (p.status ?? '').split(',');
      const names = (p.status_name ?? '').split(',');
      for (const [i, id] of ids.entries()) {
        const status = mapSmsApiStatus(codes[i] ?? codes[0], names[i] ?? names[0]);
        if (status) await applyDeliveryReport({ provider: 'smsapi', providerMessageId: id }, status, `SMSAPI ${names[i] ?? codes[i] ?? ''}`);
      }
      return reply.type('text/plain').send('OK'); // SMSAPI ponawia, dopóki nie dostanie "OK"
    },
  });

  // SerwerSMS: dlr_url z #SMSID# i #STAN# podstawionymi w parametrach id / stan.
  app.route({
    method: ['GET', 'POST'],
    url: '/webhooks/serwersms',
    handler: async (req, reply) => {
      checkToken(req);
      const p = params(req);
      const status = mapSerwerSmsStatus(p.stan);
      if (p.id && status) await applyDeliveryReport({ provider: 'serwersms', providerMessageId: p.id }, status, `SerwerSMS ${p.stan}`);
      return reply.type('text/plain').send('OK');
    },
  });
}
