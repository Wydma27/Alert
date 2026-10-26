// Książka kontaktów (grupy: nauczyciele, uczniowie, rodzice) i wybór odbiorców wiadomości.
// Ten sam kod liczy odbiorców na serwerze (z bazy), w trybie awaryjnym (z kopii bez bazy)
// i w telefonie bez zasięgu (z zaszyfrowanej kopii na urządzeniu).
import { plural } from './plural';

export const RECIPIENT_GROUPS = ['TEACHERS', 'STUDENTS', 'PARENTS'] as const;
export type RecipientGroupValue = (typeof RECIPIENT_GROUPS)[number];

export const GROUP_LABELS: Record<RecipientGroupValue, string> = {
  TEACHERS: 'Nauczyciele',
  STUDENTS: 'Uczniowie',
  PARENTS: 'Rodzice',
};

/** Grupy, które da się zawęzić do klas. */
export const CLASS_GROUPS = ['STUDENTS', 'PARENTS'] as const;
export type ClassGroupValue = (typeof CLASS_GROUPS)[number];

export interface DirectoryPerson {
  /** "t:<id>" nauczyciel, "s:<id>" uczeń (własny telefon), "p:<id>" rodzic/opiekun. */
  key: string;
  group: RecipientGroupValue;
  name: string;
  /** Klasy: ucznia, dzieci rodzica; nauczyciel – brak. */
  classIds: number[];
  /** Dodatkowy opis: funkcja nauczyciela, klasa ucznia, dzieci rodzica. */
  detail: string;
  hasPhone: boolean;
  /** Pełny numer E.164 – tylko w kopiach do wysyłki (serwer, kopia awaryjna, telefon); nigdy w liście dla przeglądarki. */
  phone?: string;
}

export interface DirectoryClass {
  id: number;
  name: string;
}

export interface Directory {
  generatedAt: string;
  classes: DirectoryClass[];
  people: DirectoryPerson[];
}

export interface RecipientSelection {
  /** Całe grupy. */
  groups: RecipientGroupValue[];
  /** Wybrane klasy… */
  classIds: number[];
  /** …i które grupy z tych klas (uczniowie, rodzice). */
  classGroups: ClassGroupValue[];
  /** Pojedyncze osoby. */
  personKeys: string[];
}

export const EMPTY_SELECTION: RecipientSelection = { groups: [], classIds: [], classGroups: [], personKeys: [] };

export interface ResolvedRecipient {
  phone: string;
  /** Pierwsza osoba z tym numerem (do raportu). */
  key: string;
  group: RecipientGroupValue;
  /** Wszystkie osoby pod tym numerem, np. nauczyciel będący też rodzicem. */
  names: string[];
}

export interface Resolution {
  /** Osoby objęte wyborem (przed usunięciem duplikatów). */
  selected: DirectoryPerson[];
  /** Unikalne numery – tyle SMS-ów wyjdzie. */
  recipients: ResolvedRecipient[];
  withoutPhone: DirectoryPerson[];
  /** Ile osób dostanie SMS na wspólny numer (rodzeństwo, nauczyciel-rodzic). */
  duplicates: number;
  byGroup: Record<RecipientGroupValue, number>;
}

export function selectionIsEmpty(s: RecipientSelection): boolean {
  return s.groups.length === 0 && s.personKeys.length === 0 && (s.classIds.length === 0 || s.classGroups.length === 0);
}

/** Kto jest objęty wyborem. Numery wspólne dla kilku osób dostają jeden SMS. */
export function resolveRecipients(directory: Directory, selection: RecipientSelection): Resolution {
  const groups = new Set(selection.groups);
  const classIds = new Set(selection.classIds);
  const classGroups = new Set<RecipientGroupValue>(selection.classGroups);
  const keys = new Set(selection.personKeys);

  const selected = directory.people.filter(
    (p) => groups.has(p.group) || keys.has(p.key) || (classGroups.has(p.group) && p.classIds.some((id) => classIds.has(id))),
  );

  const byPhone = new Map<string, ResolvedRecipient>();
  const withoutPhone: DirectoryPerson[] = [];
  const byGroup: Record<RecipientGroupValue, number> = { TEACHERS: 0, STUDENTS: 0, PARENTS: 0 };
  let duplicates = 0;
  for (const p of selected) {
    if (!p.hasPhone) {
      withoutPhone.push(p);
      continue;
    }
    // Lista dla przeglądarki nie ma numerów – liczymy po kluczu osoby.
    const id = p.phone ?? p.key;
    const existing = byPhone.get(id);
    if (existing) {
      existing.names.push(p.name);
      duplicates++;
      continue;
    }
    byPhone.set(id, { phone: p.phone ?? '', key: p.key, group: p.group, names: [p.name] });
    byGroup[p.group]++;
  }
  return { selected, recipients: [...byPhone.values()], withoutPhone, duplicates, byGroup };
}

/** Krótki opis wyboru do historii i raportów, np. "Rodzice: 3A, 3B · Nauczyciele · 2 osoby". */
export function describeSelection(selection: RecipientSelection, classes: DirectoryClass[]): string {
  const parts: string[] = [];
  for (const g of RECIPIENT_GROUPS) if (selection.groups.includes(g)) parts.push(`${GROUP_LABELS[g]} (wszyscy)`);
  if (selection.classIds.length && selection.classGroups.length) {
    const names = selection.classIds
      .map((id) => classes.find((c) => c.id === id)?.name)
      .filter((n): n is string => Boolean(n))
      .join(', ');
    for (const g of CLASS_GROUPS) {
      if (selection.classGroups.includes(g) && !selection.groups.includes(g)) parts.push(`${GROUP_LABELS[g]}: ${names}`);
    }
  }
  if (selection.personKeys.length) parts.push(plural(selection.personKeys.length, 'osoba', 'osoby', 'osób'));
  return parts.join(' · ') || '—';
}

/** Numery z danych demonstracyjnych (seed, plik przykładowy) – prawdziwy SMS do nich jest blokowany. */
export const DEMO_PHONE_PREFIX = '+4879000';

/** Do wyszukiwarki: bez wielkości liter i polskich znaków. */
export function searchKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l');
}
