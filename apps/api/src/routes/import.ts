import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  IMPORT_FIELDS,
  type ImportCommitResponse,
  type ImportUploadResponse,
  type ImportValidationResponse,
} from '@alert/shared';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { HttpError, parseOr400 } from '../lib/http';
import { buildStudents, validateMapping } from '../import/build';
import { forbiddenColumnIndexes, suggestMapping } from '../import/mapping';
import { dropColumns, parseUpload, type Table } from '../import/parse';
import { buildPlan, commitPlan } from '../import/plan';
import { requireRole } from '../auth/session';

// Odczytany plik trzymamy tylko w pamięci, przez krótki czas – nie trafia na dysk ani do bazy.
const TTL_MS = 30 * 60 * 1000;
const pending = new Map<string, { userId: number; filename: string; table: Table; createdAt: number }>();

function cleanup() {
  const now = Date.now();
  for (const [id, entry] of pending) if (now - entry.createdAt > TTL_MS) pending.delete(id);
}

function getPending(req: FastifyRequest) {
  cleanup();
  const { id } = req.params as { id: string };
  const entry = pending.get(id);
  if (!entry || entry.userId !== req.auth!.user.id) {
    throw new HttpError(404, 'Sesja importu wygasła – wgraj plik ponownie.');
  }
  return { id, entry };
}

const optionsSchema = z.object({
  mapping: z
    .record(z.string(), z.number().int().min(0))
    .transform((m) => Object.fromEntries(Object.entries(m).filter(([k]) => (IMPORT_FIELDS as readonly string[]).includes(k)))),
  fullNameOrder: z.enum(['LAST_FIRST', 'FIRST_LAST']).default('LAST_FIRST'),
  mode: z.enum(['upsert', 'sync']).default('upsert'),
});

async function prepare(req: FastifyRequest) {
  const { id, entry } = getPending(req);
  const options = parseOr400(optionsSchema, req.body);
  const mappingError = validateMapping(options.mapping);
  if (mappingError) throw new HttpError(400, mappingError);
  for (const col of Object.values(options.mapping)) {
    if (col! >= entry.table.headers.length) throw new HttpError(400, 'Mapowanie wskazuje nieistniejącą kolumnę.');
  }
  const built = buildStudents(entry.table, options.mapping, options.fullNameOrder);
  const plan = await buildPlan(built.students, options.mode);
  return { id, entry, options, built, plan };
}

export async function importRoutes(app: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('ADMIN') };

  app.post('/import/upload', adminOnly, async (req): Promise<ImportUploadResponse> => {
    const file = await req.file();
    if (!file) throw new HttpError(400, 'Nie przesłano pliku.');
    const buffer = await file.toBuffer();
    if (file.file.truncated) throw new HttpError(413, 'Plik jest za duży (limit 5 MB).');
    const raw = await parseUpload(buffer, file.filename);
    // PESEL, adresy, e-maile itp. wycinamy od razu – minimalizacja danych.
    const forbidden = forbiddenColumnIndexes(raw.headers);
    const table = dropColumns(raw, forbidden);
    const ignoredColumns = forbidden.map((i) => raw.headers[i]!);

    cleanup();
    const importId = randomUUID();
    pending.set(importId, { userId: req.auth!.user.id, filename: file.filename, table, createdAt: Date.now() });
    const mapping = suggestMapping(table.headers);
    return {
      importId,
      filename: file.filename,
      headers: table.headers,
      sampleRows: table.rows.slice(0, 5),
      totalRows: table.rows.length,
      suggestedMapping: mapping,
      ignoredColumns,
    };
  });

  app.post('/import/:id/validate', adminOnly, async (req): Promise<ImportValidationResponse> => {
    const { built, plan } = await prepare(req);
    return {
      studentsInFile: built.students.length,
      toCreate: plan.toCreate.length,
      toUpdate: plan.toUpdate.length,
      unchanged: plan.unchanged,
      toDelete: plan.toDelete.length,
      newClasses: plan.newClasses,
      guardiansInFile: new Set(built.students.flatMap((s) => s.guardians.map((g) => g.e164))).size,
      studentsWithoutPhone: built.students.filter((s) => s.guardians.length === 0).length,
      issues: built.issues.slice(0, 500),
    };
  });

  app.post('/import/:id/commit', adminOnly, async (req): Promise<ImportCommitResponse> => {
    const { id, entry, options, built, plan } = await prepare(req);
    const result = await commitPlan(plan);
    pending.delete(id);

    const summary = {
      ...result,
      mode: options.mode,
      rows: entry.table.rows.length,
      errors: built.issues.filter((i) => i.level === 'error').length,
      warnings: built.issues.filter((i) => i.level === 'warning').length,
    };
    const job = await prisma.importJob.create({
      data: { userId: req.auth!.user.id, filename: entry.filename, status: 'done', summary },
    });
    await audit(req, { action: 'import.commit', entity: 'import', entityId: job.id, details: summary });
    return result;
  });

  app.delete('/import/:id', adminOnly, async (req) => {
    const { id } = getPending(req);
    pending.delete(id);
    return { ok: true };
  });
}
