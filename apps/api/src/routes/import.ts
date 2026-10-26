import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  IMPORT_FIELDS,
  TEACHER_IMPORT_FIELDS,
  type ImportCommitResponse,
  type ImportType,
  type ImportUploadResponse,
  type ImportValidationResponse,
} from '@alert/shared';
import { prisma } from '../db';
import { refreshSnapshot } from '../emergency/snapshot';
import { audit } from '../lib/audit';
import { HttpError, parseOr400 } from '../lib/http';
import { buildStudents, validateMapping } from '../import/build';
import { forbiddenColumnIndexes, suggestMapping, suggestTeacherMapping } from '../import/mapping';
import { dropColumns, parseUpload, type Table } from '../import/parse';
import { buildPlan, commitPlan } from '../import/plan';
import { commitTeachers, planTeachers } from '../import/teacherPlan';
import { buildTeachers, validateTeacherMapping } from '../import/teachers';
import { requireRole } from '../auth/session';

// Odczytany plik trzymamy tylko w pamięci, przez krótki czas – nie trafia na dysk ani do bazy.
const TTL_MS = 30 * 60 * 1000;
const pending = new Map<string, { userId: number; type: ImportType; filename: string; table: Table; createdAt: number }>();

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

function optionsSchema(type: ImportType) {
  const fields: readonly string[] = type === 'teachers' ? TEACHER_IMPORT_FIELDS : IMPORT_FIELDS;
  return z.object({
    mapping: z
      .record(z.string(), z.number().int().min(0))
      .transform((m) => Object.fromEntries(Object.entries(m).filter(([k]) => fields.includes(k)))),
    fullNameOrder: z.enum(['LAST_FIRST', 'FIRST_LAST']).default('LAST_FIRST'),
    mode: z.enum(['upsert', 'sync']).default('upsert'),
  });
}

async function prepare(req: FastifyRequest) {
  const { id, entry } = getPending(req);
  const options = parseOr400(optionsSchema(entry.type), req.body);
  const mappingError = entry.type === 'teachers' ? validateTeacherMapping(options.mapping) : validateMapping(options.mapping);
  if (mappingError) throw new HttpError(400, mappingError);
  for (const col of Object.values(options.mapping)) {
    if (col! >= entry.table.headers.length) throw new HttpError(400, 'Mapowanie wskazuje nieistniejącą kolumnę.');
  }
  return { id, entry, options };
}

async function prepareStudents(req: FastifyRequest) {
  const p = await prepare(req);
  const built = buildStudents(p.entry.table, p.options.mapping, p.options.fullNameOrder);
  const plan = await buildPlan(built.students, p.options.mode);
  return { ...p, built, plan };
}

async function prepareTeachers(req: FastifyRequest) {
  const p = await prepare(req);
  const built = buildTeachers(p.entry.table, p.options.mapping, p.options.fullNameOrder);
  const plan = await planTeachers(built.teachers, p.options.mode);
  return { ...p, built, plan };
}

export async function importRoutes(app: FastifyInstance) {
  const adminOnly = { preHandler: requireRole('ADMIN') };

  app.post('/import/upload', adminOnly, async (req): Promise<ImportUploadResponse> => {
    const { type } = parseOr400(z.object({ type: z.enum(['students', 'teachers']).default('students') }), req.query);
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
    pending.set(importId, { userId: req.auth!.user.id, type, filename: file.filename, table, createdAt: Date.now() });
    return {
      importId,
      type,
      filename: file.filename,
      headers: table.headers,
      sampleRows: table.rows.slice(0, 5),
      totalRows: table.rows.length,
      suggestedMapping: type === 'teachers' ? suggestTeacherMapping(table.headers) : suggestMapping(table.headers),
      ignoredColumns,
    };
  });

  app.post('/import/:id/validate', adminOnly, async (req): Promise<ImportValidationResponse> => {
    const { entry } = getPending(req);
    if (entry.type === 'teachers') {
      const { built, plan } = await prepareTeachers(req);
      return {
        type: 'teachers',
        studentsInFile: built.teachers.length,
        toCreate: plan.toCreate.length,
        toUpdate: plan.toUpdate.length,
        unchanged: plan.unchanged,
        toDelete: plan.toDelete.length,
        newClasses: [],
        guardiansInFile: 0,
        studentsWithoutPhone: 0,
        studentPhonesInFile: 0,
        issues: built.issues.slice(0, 500),
      };
    }
    const { built, plan } = await prepareStudents(req);
    return {
      type: 'students',
      studentsInFile: built.students.length,
      toCreate: plan.toCreate.length,
      toUpdate: plan.toUpdate.length,
      unchanged: plan.unchanged,
      toDelete: plan.toDelete.length,
      newClasses: plan.newClasses,
      guardiansInFile: new Set(built.students.flatMap((s) => s.guardians.map((g) => g.e164))).size,
      studentsWithoutPhone: built.students.filter((s) => s.guardians.length === 0).length,
      studentPhonesInFile: built.students.filter((s) => s.phone).length,
      issues: built.issues.slice(0, 500),
    };
  });

  app.post('/import/:id/commit', adminOnly, async (req): Promise<ImportCommitResponse> => {
    const { entry } = getPending(req);
    let result: ImportCommitResponse;
    let issues: { level: string }[];
    let options: { mode: string };
    let id: string;
    if (entry.type === 'teachers') {
      const p = await prepareTeachers(req);
      result = await commitTeachers(p.plan);
      ({ id, options } = p);
      issues = p.built.issues;
    } else {
      const p = await prepareStudents(req);
      result = await commitPlan(p.plan);
      ({ id, options } = p);
      issues = p.built.issues;
    }
    pending.delete(id);

    const summary = {
      ...result,
      type: entry.type,
      mode: options.mode,
      rows: entry.table.rows.length,
      errors: issues.filter((i) => i.level === 'error').length,
      warnings: issues.filter((i) => i.level === 'warning').length,
    };
    const job = await prisma.importJob.create({
      data: { userId: req.auth!.user.id, filename: entry.filename, status: 'done', summary },
    });
    await audit(req, { action: 'import.commit', entity: 'import', entityId: job.id, details: summary });
    // Nowe numery od razu w kopii awaryjnej (wysyłka bez bazy).
    void refreshSnapshot(req.log).catch((err) => req.log.error(err, 'Kopia awaryjna po imporcie'));
    return result;
  });

  app.delete('/import/:id', adminOnly, async (req) => {
    const { id } = getPending(req);
    pending.delete(id);
    return { ok: true };
  });
}
