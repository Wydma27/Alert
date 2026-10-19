import type { Alert, School } from '@prisma/client';
import {
  DEFAULT_TEMPLATES,
  DRILL_PREFIX,
  MESSAGE_KINDS,
  analyzeSms,
  buildSms,
  smsFirstName,
  type MessageKind,
  type SmsInfo,
  type TemplateValues,
} from '@alert/shared';
import { prisma } from '../db';
import { HttpError } from '../lib/http';

export interface TemplateConfig {
  body: string;
  stripDiacritics: boolean;
}

const DEFAULT_EVENT_TYPES = [
  { label: 'Pożar', smsLabel: 'pożar', sortOrder: 1 },
  { label: 'Alarm bombowy', smsLabel: 'alarm bombowy', sortOrder: 2 },
  { label: 'Awaria (gaz, prąd, woda)', smsLabel: 'awaria', sortOrder: 3 },
  { label: 'Inne zagrożenie', smsLabel: 'zagrożenie', sortOrder: 4 },
];

/** Przy starcie serwera: brakujące szablony i typy zdarzeń uzupełniamy wartościami domyślnymi. */
export async function ensureDefaults() {
  for (const kind of MESSAGE_KINDS) {
    await prisma.smsTemplate.upsert({
      where: { kind },
      create: { kind, body: DEFAULT_TEMPLATES[kind], stripDiacritics: true },
      update: {},
    });
  }
  if ((await prisma.eventType.count()) === 0) {
    await prisma.eventType.createMany({ data: DEFAULT_EVENT_TYPES });
  }
}

export async function loadTemplates(): Promise<Record<MessageKind, TemplateConfig>> {
  const rows = await prisma.smsTemplate.findMany();
  const out = {} as Record<MessageKind, TemplateConfig>;
  for (const kind of MESSAGE_KINDS) {
    const row = rows.find((r) => r.kind === kind);
    out[kind] = row ? { body: row.body, stripDiacritics: row.stripDiacritics } : { body: DEFAULT_TEMPLATES[kind], stripDiacritics: true };
  }
  return out;
}

export async function requireSchool(): Promise<School> {
  const school = await prisma.school.findUnique({ where: { id: 1 } });
  if (!school) throw new HttpError(409, 'Najpierw uzupełnij dane szkoły (nazwa w SMS, telefon kontaktowy).');
  return school;
}

export function warsawTime(date = new Date()): string {
  return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' });
}

export interface RenderContext {
  school: Pick<School, 'smsName' | 'contactPhone'>;
  alert: Pick<Alert, 'mode' | 'eventSmsLabel' | 'pickupInstruction'>;
  cls: { className: string; pointName: string; pointAddress: string };
  student: { firstName: string };
  extra?: TemplateValues;
}

export function renderMessage(template: TemplateConfig, ctx: RenderContext): { body: string; info: SmsInfo } {
  const values: TemplateValues = {
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
  const body = buildSms(template.body, values, {
    stripDiacritics: template.stripDiacritics,
    prefix: ctx.alert.mode === 'DRILL' ? DRILL_PREFIX : '',
  });
  return { body, info: analyzeSms(body) };
}

/** Przykładowe dane do podglądu szablonów i SMS-a testowego. */
export async function exampleContext(): Promise<RenderContext & { school: School }> {
  const school = await requireSchool();
  const point = await prisma.assemblyPoint.findFirst({ where: { active: true }, orderBy: { id: 'asc' } });
  return {
    school,
    alert: { mode: 'REAL', eventSmsLabel: 'pożar', pickupInstruction: 'przy wejściu głównym, z dowodem osobistym' },
    cls: { className: '3B', pointName: point?.name ?? 'Hala sportowa', pointAddress: point?.address ?? 'ul. Sportowa 5' },
    student: { firstName: 'Zuzanna' },
    extra: { odbierajacy: 'Anna Kowalska', godzina: '10:42' },
  };
}
