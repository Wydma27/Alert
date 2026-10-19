import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  MESSAGE_KINDS,
  type GatewayStatusDto,
  type MessageKind,
  type SmsExampleDto,
  type TestNumberDto,
  type TestSendResponse,
} from '@alert/shared';
import { CTX, fieldCrypto, prisma } from '../db';
import { env } from '../env';
import { audit } from '../lib/audit';
import { HttpError, idParam, parseOr400 } from '../lib/http';
import { maskPhone, normalizePhone } from '../lib/phone';
import { exampleContext, loadTemplates, renderMessage } from '../alerts/templates';
import { getSender } from '../sms';
import { requireRole } from '../auth/session';

/** Każdy SMS testowy zaczyna się od tego – odbiorca nie pomyli go z prawdziwym alarmem. */
const TEST_PREFIX = 'TEST, NIE ALARM: ';

const phoneField = z.string().transform((raw, ctx) => {
  const result = normalizePhone(raw);
  if (!result.ok) {
    ctx.addIssue({ code: 'custom', message: result.error });
    return z.NEVER;
  }
  return result.e164;
});

async function buildExample(kind: MessageKind): Promise<SmsExampleDto> {
  const ctx = await exampleContext();
  const template = (await loadTemplates())[kind];
  const { body, info } = renderMessage({ ...template, body: `${TEST_PREFIX}${template.body}` }, ctx);
  return { text: body, info, senderName: env.SMS_USE_DEFAULT_SENDER ? '' : ctx.school.senderName };
}

export async function smsRoutes(app: FastifyInstance) {
  const viewers = { preHandler: requireRole('ADMIN', 'DYREKCJA') };
  const adminOnly = { preHandler: requireRole('ADMIN') };

  app.get('/test-numbers', viewers, async (): Promise<TestNumberDto[]> => {
    const rows = await prisma.testNumber.findMany({ orderBy: { id: 'asc' } });
    return rows.map((r) => ({ id: r.id, label: r.label, phoneMasked: maskPhone(fieldCrypto.decrypt(r.phoneEnc, CTX.testPhone)) }));
  });

  app.post('/test-numbers', adminOnly, async (req) => {
    const data = parseOr400(z.object({ label: z.string().trim().min(1).max(60), phone: phoneField }), req.body);
    const hmac = fieldCrypto.blindIndex(data.phone, CTX.testPhone);
    if (await prisma.testNumber.findUnique({ where: { phoneHmac: hmac } })) {
      throw new HttpError(409, 'Ten numer jest już na liście testowej.');
    }
    const row = await prisma.testNumber.create({
      data: { label: data.label, phoneHmac: hmac, phoneEnc: fieldCrypto.encrypt(data.phone, CTX.testPhone) },
    });
    await audit(req, { action: 'test_number.create', entity: 'test_number', entityId: row.id, details: { label: row.label } });
    return { id: row.id, label: row.label, phoneMasked: maskPhone(data.phone) } satisfies TestNumberDto;
  });

  app.delete('/test-numbers/:id', adminOnly, async (req) => {
    const id = idParam(req.params);
    const row = await prisma.testNumber.delete({ where: { id } });
    await audit(req, { action: 'test_number.delete', entity: 'test_number', entityId: id, details: { label: row.label } });
    return { ok: true };
  });

  /** Stan bramek: główna i (jeśli jest) zapasowa. */
  app.get('/sms/gateway', viewers, async (): Promise<GatewayStatusDto[]> => getSender().status());

  app.get('/sms/example', viewers, async (req) => {
    const { kind } = parseOr400(z.object({ kind: z.enum(MESSAGE_KINDS).default('START') }), req.query);
    return buildExample(kind);
  });

  /** Przykładowy SMS – wyłącznie na numery z listy testowej, z prefiksem TEST. */
  app.post(
    '/sms/test-send',
    { ...viewers, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req): Promise<TestSendResponse> => {
      const body = parseOr400(
        z.object({
          testNumberId: z.number().int().positive(),
          useDefaultSender: z.boolean().default(false),
          kind: z.enum(MESSAGE_KINDS).default('START'),
        }),
        req.body,
      );
      const testNumber = await prisma.testNumber.findUnique({ where: { id: body.testNumberId } });
      if (!testNumber) throw new HttpError(404, 'Nie ma takiego numeru testowego.');

      const example = await buildExample(body.kind);
      const sender = getSender();
      const from = body.useDefaultSender || !example.senderName ? undefined : example.senderName;
      const to = fieldCrypto.decrypt(testNumber.phoneEnc, CTX.testPhone);
      const result = await sender.send({ to, text: example.text, from });

      if (!sender.live) req.log.info({ to: maskPhone(to), text: example.text }, 'SMS testowy (fake – nie wysłano)');
      await audit(req, {
        action: 'sms.test_send',
        entity: 'test_number',
        entityId: testNumber.id,
        details: {
          kind: body.kind,
          provider: result.provider,
          live: sender.live,
          ok: result.ok,
          sender: from ?? '(domyślny nadawca konta)',
          parts: example.info.parts,
          messageId: result.ok ? result.messageId : null,
          error: result.ok ? null : result.error,
        },
      });

      return {
        ok: result.ok,
        live: sender.live,
        text: example.text,
        parts: example.info.parts,
        messageId: result.ok ? result.messageId : null,
        error: result.ok ? null : result.error,
      };
    },
  );
}
