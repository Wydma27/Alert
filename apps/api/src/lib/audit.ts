import type { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { prisma } from '../db';

type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditEntry {
  action: string;
  entity?: string;
  entityId?: string | number | null;
  details?: Prisma.InputJsonObject;
  userId?: number | null;
  ip?: string | null;
}

/**
 * Zapis do dziennika zdarzeń. Hash i kolejność nadaje trigger w bazie.
 * Zasada: w details nie zapisujemy pełnych numerów telefonów ani treści danych osobowych
 * ponad to, co konieczne do ustalenia "kto, kiedy, co".
 */
export async function writeAudit(entry: AuditEntry, db: Db = prisma): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      entity: entry.entity ?? null,
      entityId: entry.entityId != null ? String(entry.entityId) : null,
      details: entry.details ?? {},
      userId: entry.userId ?? null,
      ip: entry.ip ?? null,
    },
  });
}

/** Skrót: wpis w imieniu zalogowanego użytkownika z bieżącego żądania. */
export function audit(req: FastifyRequest, entry: Omit<AuditEntry, 'userId' | 'ip'>, db: Db = prisma) {
  return writeAudit({ ...entry, userId: req.auth?.user.id ?? null, ip: req.ip }, db);
}

export async function verifyAuditChain(): Promise<{ checked: number; brokenIds: string[] }> {
  const rows = await prisma.$queryRaw<{ id: bigint; ok: boolean }[]>`
    SELECT id,
           (hash = audit_log_compute_hash(prev_hash, id, at, user_id, ip, action, entity, entity_id, details)
            AND prev_hash IS NOT DISTINCT FROM lag(hash) OVER (ORDER BY id)) AS ok
    FROM audit_log
    ORDER BY id`;
  return {
    checked: rows.length,
    brokenIds: rows.filter((r) => !r.ok).map((r) => r.id.toString()),
  };
}
