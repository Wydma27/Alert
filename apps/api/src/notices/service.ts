// Wiadomości do grup: nauczyciele, uczniowie, rodzice – całe grupy, klasy albo wybrane osoby.
// Wybrany nadawca i treść, podgląd z liczbą odbiorców i kosztem, wysyłka przez kolejkę (pule), raport doręczeń.
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  CLASS_GROUPS,
  DEMO_PHONE_PREFIX,
  NOTICE_MAX_LENGTH,
  RECIPIENT_GROUPS,
  SENDER_NAME_PATTERN,
  analyzeSms,
  describeSelection,
  plural,
  resolveRecipients,
  selectionIsEmpty,
  toGsmFriendly,
  type DeliveryCounts,
  type Directory,
  type NoticePreviewDto,
  type RecipientSelection,
  type Resolution,
  type SmsInfo,
} from '@alert/shared';
import { CTX, fieldCrypto, prisma } from '../db';
import { env } from '../env';
import { loadDirectory } from '../lib/directory';
import { HttpError } from '../lib/http';
import { getSender } from '../sms';
import { kickDeliveryWorker } from '../sms/queue';

export const selectionSchema = z.object({
  groups: z.array(z.enum(RECIPIENT_GROUPS)).default([]),
  classIds: z.array(z.number().int().positive()).max(500).default([]),
  classGroups: z.array(z.enum(CLASS_GROUPS)).default([]),
  personKeys: z
    .array(z.string().regex(/^[tsp]:\d+$/))
    .max(10_000)
    .default([]),
});

export const noticeSchema = z.object({
  selection: selectionSchema,
  body: z.string().trim().min(1, 'wpisz treść wiadomości').max(NOTICE_MAX_LENGTH),
  sender: z
    .string()
    .trim()
    .regex(SENDER_NAME_PATTERN, 'od 3 do 11 znaków: litery bez polskich znaków, cyfry, spacja, kropka, myślnik')
    .nullable()
    .default(null),
  /** Zamiana polskich znaków – SMS 160 zamiast 70 znaków na część. */
  stripDiacritics: z.boolean().default(false),
});

export type NoticeInput = z.infer<typeof noticeSchema>;

/** Treść, która faktycznie wyjdzie. */
export function finalBody(input: Pick<NoticeInput, 'body' | 'stripDiacritics'>): string {
  return input.stripDiacritics ? toGsmFriendly(input.body) : input.body;
}

export interface NoticePlan {
  directory: Directory;
  resolution: Resolution;
  body: string;
  info: SmsInfo;
  summary: string;
  senderLabel: string;
  blocking: string[];
  warnings: string[];
}

/** Wspólna kontrola wysyłki – dla bazy i trybu awaryjnego (kopia kontaktów). */
export async function checkNotice(
  input: NoticeInput,
  directory: Directory,
  schoolSender: string | null,
): Promise<Omit<NoticePlan, 'directory'>> {
  const sender = getSender();
  const resolution = resolveRecipients(directory, input.selection as RecipientSelection);
  const body = finalBody(input);
  const info = analyzeSms(body);
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (selectionIsEmpty(input.selection as RecipientSelection)) blocking.push('Wybierz odbiorców: grupę, klasy albo osoby.');
  else if (resolution.recipients.length === 0) blocking.push('Nikt z wybranych osób nie ma numeru telefonu.');

  if (input.sender) {
    const approved = await sender.senders().catch(() => null);
    if (approved && approved.length && !approved.includes(input.sender)) {
      blocking.push(`Nadawca „${input.sender}” nie jest zatwierdzony w bramce SMS. Zatwierdzone: ${approved.join(', ')}.`);
    }
  }
  if (sender.live && resolution.recipients.some((r) => r.phone.startsWith(DEMO_PHONE_PREFIX))) {
    blocking.push('Wśród odbiorców są numery z danych demonstracyjnych (+48 790 00x xxx) – mogą należeć do obcych osób. Usuń dane demo.');
  }

  if (resolution.withoutPhone.length) {
    warnings.push(`${plural(resolution.withoutPhone.length, 'osoba nie ma', 'osoby nie mają', 'osób nie ma')} numeru telefonu – nie dostanie SMS-a.`);
  }
  if (resolution.duplicates) {
    warnings.push(`${plural(resolution.duplicates, 'osoba ma', 'osoby mają', 'osób ma')} ten sam numer co ktoś inny z listy – na wspólny numer idzie jeden SMS.`);
  }
  if (info.parts > 2) warnings.push(`Wiadomość ma ${info.parts} części – każdy odbiorca to ${info.parts} SMS-y w rozliczeniu.`);
  if (info.encoding === 'UCS-2' && !input.stripDiacritics) {
    warnings.push('Polskie znaki skracają SMS do 70 znaków na część – zaznacz „bez polskich znaków”, żeby było taniej.');
  }
  if (!sender.live) warnings.push('Bramka SMS w trybie fake – nic nie zostanie wysłane (ustawienie SMS_PROVIDER w .env).');

  const senderLabel = input.sender ?? (env.SMS_USE_DEFAULT_SENDER || !schoolSender ? 'domyślny nadawca konta w bramce' : schoolSender);
  return {
    resolution,
    body,
    info,
    summary: describeSelection(input.selection as RecipientSelection, directory.classes),
    senderLabel,
    blocking,
    warnings,
  };
}

export async function buildNoticePlan(input: NoticeInput): Promise<NoticePlan> {
  const [directory, school] = await Promise.all([loadDirectory(true), prisma.school.findUnique({ where: { id: 1 } })]);
  return { directory, ...(await checkNotice(input, directory, school?.senderName ?? null)) };
}

export function previewDto(plan: Omit<NoticePlan, 'directory'>): NoticePreviewDto {
  const { resolution, info } = plan;
  return {
    recipients: resolution.recipients.length,
    byGroup: resolution.byGroup,
    withoutPhone: resolution.withoutPhone.map(({ key, name, group, detail }) => ({ key, name, group, detail })),
    duplicates: resolution.duplicates,
    body: plan.body,
    info,
    totalParts: info.parts * resolution.recipients.length,
    summary: plan.summary,
    sender: plan.senderLabel,
    blocking: plan.blocking,
    warnings: plan.warnings,
    live: getSender().live,
  };
}

export async function sendNotice(input: NoticeInput, userId: number, idempotencyKey: string) {
  const existing = await prisma.notice.findUnique({ where: { idempotencyKey } });
  if (existing) return { notice: existing, created: false };

  const plan = await buildNoticePlan(input);
  if (plan.blocking.length) throw new HttpError(400, plan.blocking.join(' '));

  const notice = await prisma.$transaction(
    async (tx) => {
      const created = await tx.notice.create({
        data: {
          body: plan.body,
          sender: input.sender,
          selection: input.selection as Prisma.InputJsonObject,
          summary: plan.summary,
          recipients: plan.resolution.recipients.length,
          parts: plan.info.parts,
          encoding: plan.info.encoding,
          idempotencyKey,
          createdById: userId,
        },
      });
      await tx.smsDelivery.createMany({
        data: plan.resolution.recipients.map((r) => ({
          noticeId: created.id,
          guardianName: r.names.join(', '),
          contactKey: r.key,
          audience: r.group,
          phoneEnc: fieldCrypto.encrypt(r.phone, CTX.deliveryPhone),
          body: plan.body,
          parts: plan.info.parts,
          encoding: plan.info.encoding,
          sender: input.sender,
          priority: 3,
        })),
      });
      return created;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  kickDeliveryWorker();
  return { notice, created: true };
}

export function emptyCounts(): DeliveryCounts {
  return { total: 0, badNumbers: 0, QUEUED: 0, SENDING: 0, SENT: 0, DELIVERED: 0, UNDELIVERED: 0, FAILED: 0 };
}

/** Statusy SMS-ów dla wielu wiadomości naraz. */
export async function noticeCounts(noticeIds: number[]): Promise<Map<number, DeliveryCounts>> {
  const [groups, bad] = await Promise.all([
    prisma.smsDelivery.groupBy({ by: ['noticeId', 'status'], where: { noticeId: { in: noticeIds } }, _count: { _all: true } }),
    prisma.smsDelivery.groupBy({ by: ['noticeId'], where: { noticeId: { in: noticeIds }, badNumber: true }, _count: { _all: true } }),
  ]);
  const map = new Map<number, DeliveryCounts>(noticeIds.map((id) => [id, emptyCounts()]));
  for (const g of groups) {
    const c = map.get(g.noticeId!)!;
    c[g.status] += g._count._all;
    c.total += g._count._all;
  }
  for (const b of bad) map.get(b.noticeId!)!.badNumbers = b._count._all;
  return map;
}
