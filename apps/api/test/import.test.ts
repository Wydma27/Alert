import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildStudents, validateMapping } from '../src/import/build';
import { forbiddenColumnIndexes, suggestMapping } from '../src/import/mapping';
import { decodeText, detectDelimiter, dropColumns, readCsv, toTable } from '../src/import/parse';
import { normalizeClassName, normalizePersonName } from '../src/lib/names';
import { maskPhone, normalizePhone } from '../src/lib/phone';

describe('numery telefonów', () => {
  it.each([
    ['790 001 001', '+48790001001'],
    ['+48 790-001-002', '+48790001002'],
    ['0048790001004', '+48790001004'],
    ['48790001005', '+48790001005'],
    ['(790) 001 006', '+48790001006'],
    ['+380 50 123 4567', '+380501234567'],
  ])('%s -> %s', (raw, e164) => {
    expect(normalizePhone(raw)).toEqual({ ok: true, e164 });
  });

  it('odrzuca stacjonarne i błędne', () => {
    const landline = normalizePhone('22 123 45 67');
    expect(landline.ok).toBe(false);
    expect(!landline.ok && landline.error).toMatch(/stacjonarny/);
    expect(normalizePhone('12345').ok).toBe(false);
    expect(normalizePhone('').ok).toBe(false);
  });

  it('maskuje numer', () => {
    expect(maskPhone('+48790001001')).toBe('+48 *** *** 001');
  });
});

describe('nazwy', () => {
  it('normalizuje wielkość liter tylko gdy całość jest wielka/mała', () => {
    expect(normalizePersonName('CHMIELEWSKA')).toBe('Chmielewska');
    expect(normalizePersonName('nowak-kowalska')).toBe('Nowak-Kowalska');
    expect(normalizePersonName('ŁUCJA')).toBe('Łucja');
    expect(normalizePersonName('McDonald')).toBe('McDonald');
    expect(normalizePersonName('  Jan   Maria ')).toBe('Jan Maria');
  });

  it('normalizuje klasę', () => {
    expect(normalizeClassName('kl. 2 a')).toBe('2A');
    expect(normalizeClassName('Klasa 3b')).toBe('3B');
    expect(normalizeClassName(' 8 A ')).toBe('8A');
  });
});

describe('odczyt CSV', () => {
  it('rozpoznaje Windows-1250 i średnik', () => {
    // "Uczeń;Klasa" w CP1250: ń = 0xF1
    const buf = Buffer.from([0x55, 0x63, 0x7a, 0x65, 0xf1, 0x3b, 0x4b, 0x6c, 0x61, 0x73, 0x61]);
    const text = decodeText(buf);
    expect(text).toBe('Uczeń;Klasa');
    expect(detectDelimiter(text)).toBe(';');
  });

  it('usuwa BOM UTF-8 i rozpoznaje przecinek', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Imię,Nazwisko,Klasa\nJan,Nowak,1A\n')]);
    const rows = readCsv(buf);
    expect(rows[0]).toEqual(['Imię', 'Nazwisko', 'Klasa']);
  });
});

describe('import przykładowego pliku', () => {
  const csv = readFileSync(fileURLToPath(new URL('../../../sample-data/import_przyklad.csv', import.meta.url)));
  const raw = toTable(readCsv(csv));
  const forbidden = forbiddenColumnIndexes(raw.headers);
  const table = dropColumns(raw, forbidden);
  const mapping = suggestMapping(table.headers);

  it('wycina PESEL i podpowiada mapowanie', () => {
    expect(forbidden).toEqual([2]);
    expect(table.headers).not.toContain('PESEL');
    expect(table.rows.every((r) => r.length === table.headers.length)).toBe(true);
    expect(mapping).toEqual({
      fullName: 0,
      className: 1,
      guardian1Name: 2,
      guardian1Phone: 3,
      guardian2Name: 4,
      guardian2Phone: 5,
    });
    expect(validateMapping(mapping)).toBeNull();
  });

  const { students, issues } = buildStudents(table, mapping, 'LAST_FIRST');
  const byName = (first: string) => students.find((s) => s.firstName === first)!;

  it('buduje uczniów z opiekunami', () => {
    expect(students).toHaveLength(9); // 10 wierszy, 1 bez nazwiska
    const natalia = byName('Natalia');
    expect(natalia).toMatchObject({ lastName: 'Chmielewska', className: '2A' });
    expect(natalia.guardians.map((g) => g.e164)).toEqual(['+48790001004', '+48790001005']);
  });

  it('rodzeństwo dzieli numery opiekunów', () => {
    const nina = byName('Nina');
    const oskar = byName('Oskar');
    expect(nina.guardians.map((g) => g.e164)).toEqual(['+48790001007', '+48790001009']);
    expect(oskar.guardians.map((g) => g.e164)).toEqual(['+48790001007', '+48790001009']);
  });

  it('raportuje problemy', () => {
    const text = issues.map((i) => `${i.row}:${i.level}:${i.message}`).join('\n');
    expect(text).toMatch(/5:warning:Opiekun 1: numer stacjonarny/); // Domański
    expect(text).toMatch(/6:warning:Opiekun 1: nieprawidłowy numer/); // Ewertowska
    expect(text).toMatch(/7:warning:Igor Fijałkowski \(3B\) nie ma żadnego poprawnego numeru/);
    expect(text).toMatch(/8:warning:Opiekun 1: kilka numerów/); // Gajewska
    expect(text).toMatch(/10:error:Brak imienia lub nazwiska/);
    // Ewertowska ma tylko błędny numer -> też bez numeru
    expect(text).toMatch(/Laura Ewertowska \(3B\) nie ma żadnego/);
  });

  it('łączy wiersze tego samego ucznia (układ: wiersz = opiekun)', () => {
    const rows = [
      ['Jan', 'Nowak', '1A', 'Anna Nowak', '790 002 001'],
      ['Jan', 'Nowak', '1A', 'Piotr Nowak', '790 002 002'],
      ['Jan', 'Nowak', '1A', 'Anna Nowak', '790 002 001'],
    ];
    const result = buildStudents(
      { headers: ['Imię', 'Nazwisko', 'Klasa', 'Opiekun', 'Telefon'], rows },
      { firstName: 0, lastName: 1, className: 2, guardian1Name: 3, guardian1Phone: 4 },
      'LAST_FIRST',
    );
    expect(result.students).toHaveLength(1);
    expect(result.students[0]!.guardians).toEqual([
      { name: 'Anna Nowak', e164: '+48790002001', priority: 1 },
      { name: 'Piotr Nowak', e164: '+48790002002', priority: 2 },
    ]);
  });
});
