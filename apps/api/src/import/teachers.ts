// Import listy nauczycieli i pracowników (grupa "Nauczyciele"): imię, nazwisko, funkcja, telefon.
import type { FullNameOrder, ImportMapping, ImportRowIssue } from '@alert/shared';
import { normalizePersonName } from '../lib/names';
import { normalizePhone } from '../lib/phone';
import type { Table } from './parse';

export interface ImportedTeacher {
  externalId: string | null;
  firstName: string;
  lastName: string;
  position: string | null;
  e164: string;
  row: number;
}

export function validateTeacherMapping(mapping: ImportMapping): string | null {
  const hasNames = (mapping.firstName !== undefined && mapping.lastName !== undefined) || mapping.fullName !== undefined;
  if (!hasNames) return 'Wskaż kolumny z imieniem i nazwiskiem (osobno albo w jednej kolumnie).';
  if (mapping.phone === undefined) return 'Wskaż kolumnę z telefonem.';
  const used = Object.values(mapping).filter((v) => v !== undefined);
  if (new Set(used).size !== used.length) return 'Ta sama kolumna jest przypisana do dwóch pól.';
  return null;
}

export function buildTeachers(table: Table, mapping: ImportMapping, order: FullNameOrder) {
  const issues: ImportRowIssue[] = [];
  const byPhone = new Map<string, ImportedTeacher>();
  table.rows.forEach((row, index) => {
    const rowNo = index + 2;
    const get = (field: keyof ImportMapping) => {
      const col = mapping[field];
      return col === undefined ? '' : (row[col] ?? '').trim();
    };
    let firstName = get('firstName');
    let lastName = get('lastName');
    if ((!firstName || !lastName) && get('fullName')) {
      const parts = get('fullName').split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        if (order === 'LAST_FIRST') [lastName, firstName] = [parts[0]!, parts.slice(1).join(' ')];
        else [firstName, lastName] = [parts.slice(0, -1).join(' '), parts[parts.length - 1]!];
      }
    }
    firstName = normalizePersonName(firstName);
    lastName = normalizePersonName(lastName);
    if (!firstName || !lastName) {
      issues.push({ row: rowNo, level: 'error', message: 'Brak imienia lub nazwiska – wiersz pominięty.' });
      return;
    }
    const raw = get('phone');
    if (!raw) {
      issues.push({ row: rowNo, level: 'error', message: `${firstName} ${lastName}: brak numeru telefonu – wiersz pominięty.` });
      return;
    }
    const phone = normalizePhone(raw.split(/[,;/]/)[0] ?? raw);
    if (!phone.ok) {
      issues.push({ row: rowNo, level: 'error', message: `${firstName} ${lastName}: ${phone.error} – wiersz pominięty.` });
      return;
    }
    const duplicate = byPhone.get(phone.e164);
    if (duplicate) {
      issues.push({ row: rowNo, level: 'warning', message: `Ten sam numer co w wierszu ${duplicate.row} – wiersz pominięty.` });
      return;
    }
    byPhone.set(phone.e164, {
      externalId: get('externalId') || null,
      firstName,
      lastName,
      position: get('position') || null,
      e164: phone.e164,
      row: rowNo,
    });
  });
  return { teachers: [...byPhone.values()], issues };
}
