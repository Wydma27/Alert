// Podpowiedź mapowania kolumn na podstawie nagłówków typowych eksportów z dzienników.
import type { ImportField, ImportMapping } from '@alert/shared';
import { foldKey } from '../lib/names';

/** Kolumny, których świadomie nie importujemy (minimalizacja danych – RODO). */
const FORBIDDEN = /\b(pesel|data urodzenia|miejsce urodzenia|adres|ulica|e ?mail|mail)\b/;

const PHONE = /\b(tel|telefon|telefonu|komorka|komorkowy|gsm|nr kontaktowy|numer kontaktowy)\b/;
const GUARDIAN = /\b(matk[aiy]|mama|mamy|ojc(iec|a)|tata|taty|opiekun(a|ow)?|rodzic(a|e|ow)?)\b/;

function guardianIndex(h: string): 1 | 2 | 3 | null {
  if (/\b(matk[aiy]|mama|mamy)\b/.test(h) || /\b1\b/.test(h)) return 1;
  if (/\b(ojc(iec|a)|tata|taty)\b/.test(h) || /\b2\b/.test(h)) return 2;
  if (/\b3\b/.test(h)) return 3;
  return null;
}

/** Indeksy kolumn, które usuwamy z danych zaraz po odczycie pliku (nie trafiają do pamięci ani przeglądarki). */
export function forbiddenColumnIndexes(headers: string[]): number[] {
  return headers.flatMap((h, i) => (FORBIDDEN.test(foldKey(h)) ? [i] : []));
}

export function suggestMapping(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const taken = new Set<number>();

  const assign = (field: ImportField, col: number) => {
    if (mapping[field] === undefined && !taken.has(col)) {
      mapping[field] = col;
      taken.add(col);
      return true;
    }
    return false;
  };
  const assignNextGuardian = (kind: 'Name' | 'Phone', col: number, preferred: 1 | 2 | 3 | null) => {
    const order = preferred ? [preferred, 1, 2, 3] : [1, 2, 3];
    for (const n of order) if (assign(`guardian${n}${kind}` as ImportField, col)) return;
  };

  headers.forEach((raw, col) => {
    const h = foldKey(raw);
    if (FORBIDDEN.test(h)) return;
    if (PHONE.test(h)) return assignNextGuardian('Phone', col, guardianIndex(h));
    if (GUARDIAN.test(h)) return assignNextGuardian('Name', col, guardianIndex(h));
    if (/^(id|identyfikator|id ucznia|identyfikator ucznia|nr ewidencyjny|numer ewidencyjny)$/.test(h)) return assign('externalId', col);
    if (/^(klasa|oddzial|klasa oddzial|oddzial klasa)$/.test(h)) return assign('className', col);
    if (/^(imie|imiona|imie ucznia|imiona ucznia)$/.test(h)) return assign('firstName', col);
    if (/^(nazwisko|nazwisko ucznia)$/.test(h)) return assign('lastName', col);
    if (/^(uczen|imie i nazwisko|nazwisko i imie|imie i nazwisko ucznia|nazwisko i imie ucznia)$/.test(h)) return assign('fullName', col);
  });

  return mapping;
}
