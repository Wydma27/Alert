// Zamiana wierszy pliku na listę uczniów z opiekunami + raport problemów.
// Obsługuje oba popularne układy: "jeden wiersz = uczeń z kolumnami opiekunów"
// oraz "jeden wiersz = opiekun" (ten sam uczeń w kilku wierszach – scalamy).
import type { FullNameOrder, ImportField, ImportMapping, ImportRowIssue } from '@alert/shared';
import { foldKey, normalizeClassName, normalizePersonName } from '../lib/names';
import { normalizePhone } from '../lib/phone';
import type { Table } from './parse';

export interface ImportedGuardian {
  name: string | null;
  e164: string;
  priority: number;
}

export interface ImportedStudent {
  key: string;
  nameKey: string;
  externalId: string | null;
  firstName: string;
  lastName: string;
  className: string;
  guardians: ImportedGuardian[];
  rows: number[];
}

export interface BuildResult {
  students: ImportedStudent[];
  issues: ImportRowIssue[];
}

export function studentNameKey(lastName: string, firstName: string, className: string) {
  return `name:${foldKey(lastName)}|${foldKey(firstName)}|${className}`;
}

function splitFullName(full: string, order: FullNameOrder): { firstName: string; lastName: string } | null {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return order === 'LAST_FIRST'
    ? { lastName: parts[0]!, firstName: parts.slice(1).join(' ') }
    : { lastName: parts[parts.length - 1]!, firstName: parts.slice(0, -1).join(' ') };
}

export function validateMapping(mapping: ImportMapping): string | null {
  const hasNames = (mapping.firstName !== undefined && mapping.lastName !== undefined) || mapping.fullName !== undefined;
  if (!hasNames) return 'Wskaż kolumny z imieniem i nazwiskiem ucznia (osobno albo w jednej kolumnie).';
  if (mapping.className === undefined) return 'Wskaż kolumnę z klasą.';
  const hasPhone = [1, 2, 3].some((n) => mapping[`guardian${n}Phone` as ImportField] !== undefined);
  if (!hasPhone) return 'Wskaż co najmniej jedną kolumnę z telefonem opiekuna.';
  const used = Object.values(mapping).filter((v) => v !== undefined);
  if (new Set(used).size !== used.length) return 'Ta sama kolumna jest przypisana do dwóch pól.';
  return null;
}

export function buildStudents(table: Table, mapping: ImportMapping, order: FullNameOrder): BuildResult {
  const issues: ImportRowIssue[] = [];
  const byKey = new Map<string, ImportedStudent>();

  table.rows.forEach((row, index) => {
    const rowNo = index + 2; // wiersz 1 = nagłówki
    const get = (field: ImportField) => {
      const col = mapping[field];
      return col === undefined ? '' : (row[col] ?? '').trim();
    };

    let firstName = get('firstName');
    let lastName = get('lastName');
    if ((!firstName || !lastName) && mapping.fullName !== undefined && get('fullName')) {
      const split = splitFullName(get('fullName'), order);
      if (split) ({ firstName, lastName } = split);
    }
    firstName = normalizePersonName(firstName);
    lastName = normalizePersonName(lastName);
    const className = normalizeClassName(get('className'));

    if (!firstName || !lastName) {
      issues.push({ row: rowNo, level: 'error', message: 'Brak imienia lub nazwiska ucznia – wiersz pominięty.' });
      return;
    }
    if (!className) {
      issues.push({ row: rowNo, level: 'error', message: 'Brak klasy – wiersz pominięty.' });
      return;
    }

    const guardians: ImportedGuardian[] = [];
    for (const n of [1, 2, 3] as const) {
      const rawPhone = get(`guardian${n}Phone`);
      const rawName = get(`guardian${n}Name`);
      if (!rawPhone) {
        if (rawName) issues.push({ row: rowNo, level: 'warning', message: `Opiekun ${n} nie ma numeru telefonu.` });
        continue;
      }
      // W jednej komórce bywa kilka numerów ("600100200, 601200300").
      const candidates = rawPhone.split(/[,;\/\n]|\s+i\s+|\s+lub\s+/).map((s) => s.trim()).filter(Boolean);
      const results = candidates.map(normalizePhone);
      const valid = results.find((r) => r.ok);
      if (!valid || !valid.ok) {
        const reason = results[0] && !results[0].ok ? results[0].error : 'nieprawidłowy numer';
        issues.push({ row: rowNo, level: 'warning', message: `Opiekun ${n}: ${reason} – pominięty.` });
        continue;
      }
      if (candidates.length > 1) {
        issues.push({ row: rowNo, level: 'warning', message: `Opiekun ${n}: kilka numerów w jednej komórce – użyto pierwszego poprawnego.` });
      }
      guardians.push({ name: rawName ? normalizePersonName(rawName) : null, e164: valid.e164, priority: n });
    }

    const externalId = get('externalId') || null;
    const nameKey = studentNameKey(lastName, firstName, className);
    const key = externalId ? `ext:${externalId}` : nameKey;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { key, nameKey, externalId, firstName, lastName, className, guardians, rows: [rowNo] });
      return;
    }

    // Kolejny wiersz tego samego ucznia: dokładamy opiekunów.
    existing.rows.push(rowNo);
    if (existing.className !== className) {
      issues.push({
        row: rowNo,
        level: 'warning',
        message: `Uczeń występuje też w wierszu ${existing.rows[0]} z inną klasą (${existing.className}) – użyto pierwszej.`,
      });
    }
    for (const g of guardians) {
      const same = existing.guardians.find((x) => x.e164 === g.e164);
      if (same) {
        same.name ??= g.name;
      } else {
        existing.guardians.push({ ...g, priority: existing.guardians.length + 1 });
      }
    }
  });

  const students = [...byKey.values()];
  for (const s of students) {
    if (s.guardians.length === 0) {
      issues.push({
        row: s.rows[0]!,
        level: 'warning',
        message: `${s.firstName} ${s.lastName} (${s.className}) nie ma żadnego poprawnego numeru opiekuna – nie dostanie SMS.`,
      });
    }
    // Priorytety ciągłe 1..n w kolejności z pliku.
    s.guardians.sort((a, b) => a.priority - b.priority).forEach((g, i) => (g.priority = i + 1));
  }

  issues.sort((a, b) => a.row - b.row);
  return { students, issues };
}
