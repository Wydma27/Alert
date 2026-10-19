import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_TEMPLATES,
  KIND_PLACEHOLDERS,
  MESSAGE_KINDS,
  TEMPLATE_MAX_LENGTH,
  TEMPLATE_PLACEHOLDERS,
  smsFirstName,
  type EventTypeDto,
  type MessageKind,
  type SmsTemplateDto,
  type TemplateValues,
} from '@alert/shared';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { HttpError, idParam, parseOr400 } from '../lib/http';
import { exampleContext, renderMessage } from '../alerts/templates';
import { requireLogin, requireRole } from '../auth/session';

const templateSchema = z.object({
  body: z.string().trim().min(10).max(TEMPLATE_MAX_LENGTH),
  stripDiacritics: z.boolean(),
});

function kindParam(params: unknown): MessageKind {
  const kind = (params as { kind: string }).kind;
  if (!(MESSAGE_KINDS as readonly string[]).includes(kind)) throw new HttpError(404, 'Nie ma takiego rodzaju komunikatu.');
  return kind as MessageKind;
}

function unknownPlaceholders(body: string): string[] {
  return [...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((k) => !(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(k));
}

const eventTypeSchema = z.object({
  label: z.string().trim().min(2).max(60),
  smsLabel: z.string().trim().min(2).max(40),
  sortOrder: z.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
});

export async function templateRoutes(app: FastifyInstance) {
  const viewers = { preHandler: requireRole('ADMIN', 'DYREKCJA') };
  const adminOnly = { preHandler: requireRole('ADMIN') };

  app.get('/templates', viewers, async () => {
    const ctx = await exampleContext();
    const rows = await prisma.smsTemplate.findMany();
    const templates: SmsTemplateDto[] = MESSAGE_KINDS.map((kind) => {
      const row = rows.find((r) => r.kind === kind);
      const config = { body: row?.body ?? DEFAULT_TEMPLATES[kind], stripDiacritics: row?.stripDiacritics ?? true };
      const { body, info } = renderMessage(config, ctx);
      return {
        kind,
        ...config,
        version: row?.version ?? 1,
        isDefault: config.body === DEFAULT_TEMPLATES[kind],
        updatedAt: row?.updatedAt.toISOString() ?? null,
        example: body,
        info,
      };
    });
    // Wartości przykładowe – interfejs liczy podgląd na żywo tym samym kodem co serwer.
    const exampleValues: TemplateValues = {
      szkola: ctx.school.smsName,
      zdarzenie: ctx.alert.eventSmsLabel,
      imie: smsFirstName(ctx.student.firstName),
      klasa: ctx.cls.className,
      punkt: ctx.cls.pointName,
      adres: ctx.cls.pointAddress,
      instrukcja: ctx.alert.pickupInstruction,
      telefon: ctx.school.contactPhone,
      ...ctx.extra,
    };
    return { templates, exampleValues, placeholders: KIND_PLACEHOLDERS };
  });

  app.put('/templates/:kind', adminOnly, async (req) => {
    const kind = kindParam(req.params);
    const data = parseOr400(templateSchema, req.body);
    const unknown = unknownPlaceholders(data.body);
    if (unknown.length) throw new HttpError(400, `Nieznane znaczniki: ${unknown.map((u) => `{${u}}`).join(', ')}.`);
    const before = await prisma.smsTemplate.findUnique({ where: { kind } });
    const saved = await prisma.smsTemplate.upsert({
      where: { kind },
      create: { kind, ...data, updatedById: req.auth!.user.id },
      update: { ...data, version: { increment: 1 }, updatedById: req.auth!.user.id },
    });
    // Szablon nie zawiera danych osobowych – w dzienniku zapisujemy pełną treść przed i po.
    await audit(req, {
      action: 'template.update',
      entity: 'sms_template',
      entityId: kind,
      details: { version: saved.version, before: before?.body ?? null, after: saved.body, stripDiacritics: saved.stripDiacritics },
    });
    return { ok: true, version: saved.version };
  });

  app.post('/templates/:kind/reset', adminOnly, async (req) => {
    const kind = kindParam(req.params);
    const saved = await prisma.smsTemplate.upsert({
      where: { kind },
      create: { kind, body: DEFAULT_TEMPLATES[kind], stripDiacritics: true, updatedById: req.auth!.user.id },
      update: { body: DEFAULT_TEMPLATES[kind], stripDiacritics: true, version: { increment: 1 }, updatedById: req.auth!.user.id },
    });
    await audit(req, { action: 'template.reset', entity: 'sms_template', entityId: kind, details: { version: saved.version } });
    return { ok: true };
  });

  // --- Typy zdarzeń ---

  app.get('/event-types', { preHandler: requireLogin }, async (): Promise<EventTypeDto[]> => {
    return prisma.eventType.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  });

  app.post('/event-types', adminOnly, async (req) => {
    const data = parseOr400(eventTypeSchema, req.body);
    const row = await prisma.eventType.create({ data });
    await audit(req, { action: 'event_type.create', entity: 'event_type', entityId: row.id, details: { label: row.label } });
    return row;
  });

  app.put('/event-types/:id', adminOnly, async (req) => {
    const id = idParam(req.params);
    const data = parseOr400(eventTypeSchema, req.body);
    const row = await prisma.eventType.update({ where: { id }, data });
    await audit(req, { action: 'event_type.update', entity: 'event_type', entityId: id, details: { label: row.label } });
    return row;
  });
}
