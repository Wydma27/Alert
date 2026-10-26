import { describe, expect, it } from 'vitest';
import { buildStudents, validateMapping } from '../src/import/build';
import { suggestMapping, suggestTeacherMapping } from '../src/import/mapping';
import { toTable } from '../src/import/parse';
import { buildTeachers, validateTeacherMapping } from '../src/import/teachers';

describe('import nauczycieli', () => {
  const table = toTable([
    ['Nazwisko i imię', 'Funkcja', 'Telefon komórkowy', 'E-mail'],
    ['Nowak Anna', 'wychowawca 1A', '600 100 200', 'a@x.pl'],
    ['KOWALSKI JAN', '', '+48 600-100-201', ''],
    ['Lis Ewa', 'sekretariat', '22 123 45 67', ''],
    ['Duplikat Numeru', '', '600100200', ''],
    ['Bez', '', '', ''],
  ]);

  it('podpowiada kolumny', () => {
    expect(suggestTeacherMapping(table.headers)).toEqual({ fullName: 0, position: 1, phone: 2 });
  });

  it('buduje listę i raportuje błędne wiersze', () => {
    const mapping = suggestTeacherMapping(table.headers);
    expect(validateTeacherMapping(mapping)).toBeNull();
    const { teachers, issues } = buildTeachers(table, mapping, 'LAST_FIRST');
    expect(teachers.map((t) => [t.firstName, t.lastName, t.position, t.e164])).toEqual([
      ['Anna', 'Nowak', 'wychowawca 1A', '+48600100200'],
      ['Jan', 'Kowalski', null, '+48600100201'],
    ]);
    expect(issues.map((i) => [i.row, i.level])).toEqual([
      [4, 'error'], // stacjonarny
      [5, 'warning'], // ten sam numer
      [6, 'error'], // brak nazwiska / numeru
    ]);
  });

  it('wymaga telefonu', () => {
    expect(validateTeacherMapping({ fullName: 0 })).toMatch(/telefonem/);
  });
});

describe('import uczniów – własny telefon ucznia', () => {
  const table = toTable([
    ['Klasa', 'Nazwisko', 'Imię', 'Telefon ucznia', 'Telefon matki'],
    ['8A', 'Nowak', 'Ola', '510 100 200', '600 100 300'],
    ['8A', 'Lis', 'Jan', '', '600 100 301'],
    ['8A', 'Kot', 'Ada', '12', ''],
  ]);

  it('rozpoznaje kolumnę telefonu ucznia (nie myli z opiekunem)', () => {
    const mapping = suggestMapping(table.headers);
    expect(mapping.studentPhone).toBe(3);
    expect(mapping.guardian1Phone).toBe(4);
  });

  it('numer ucznia: poprawny / pusty / błędny', () => {
    const mapping = suggestMapping(table.headers);
    const { students, issues } = buildStudents(table, mapping, 'LAST_FIRST');
    expect(students.map((s) => s.phone)).toEqual(['+48510100200', null, null]);
    expect(issues.some((i) => i.row === 4 && /Telefon ucznia/.test(i.message))).toBe(true);
  });

  it('bez kolumny telefonu ucznia numer w bazie zostaje bez zmian (undefined)', () => {
    const { students } = buildStudents(table, { className: 0, lastName: 1, firstName: 2, guardian1Phone: 4 }, 'LAST_FIRST');
    expect(students[0]!.phone).toBeUndefined();
  });

  it('wystarczy sam telefon ucznia (bez opiekunów)', () => {
    expect(validateMapping({ className: 0, lastName: 1, firstName: 2, studentPhone: 3 })).toBeNull();
  });
});
