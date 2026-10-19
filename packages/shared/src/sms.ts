// Treść SMS: szablony, usuwanie polskich znaków, kodowanie i liczba części.
// Ten sam kod liczy podgląd w przeglądarce i treść wysyłaną przez serwer.

// Alfabet GSM 03.38 (bez znaku ESC). Każdy znak = 1 jednostka.
const GSM7_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
// Rozszerzenie GSM – każdy znak zajmuje 2 jednostki.
const GSM7_EXTENDED = new Set('^{}\\[~]|€\f');

const POLISH: Record<string, string> = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
  Ą: 'A', Ć: 'C', Ę: 'E', Ł: 'L', Ń: 'N', Ó: 'O', Ś: 'S', Ź: 'Z', Ż: 'Z',
};
// Znaki "z Worda", które po cichu przełączają SMS na drogie kodowanie UCS-2.
const TYPOGRAPHIC: Record<string, string> = {
  '–': '-', '—': '-', '‑': '-', '„': '"', '”': '"', '“': '"', '«': '"', '»': '"',
  '‘': "'", '’': "'", '‚': "'", '…': '...', ' ': ' ', '\t': ' ',
};

export type SmsEncoding = 'GSM-7' | 'UCS-2';

export interface SmsInfo {
  /** Długość w jednostkach kodowania (znaki rozszerzone GSM liczą się podwójnie). */
  length: number;
  encoding: SmsEncoding;
  parts: number;
  /** Limit znaków na część przy obecnej długości. */
  perPart: number;
  /** Znaki spoza GSM-7 – to one wymuszają UCS-2. */
  nonGsmChars: string[];
}

export function isGsm7Char(ch: string): boolean {
  return GSM7_BASIC.has(ch) || GSM7_EXTENDED.has(ch);
}

/** Zamienia polskie i typograficzne znaki na odpowiedniki z alfabetu GSM. */
export function toGsmFriendly(text: string): string {
  let out = '';
  for (const ch of text) {
    const mapped = POLISH[ch] ?? TYPOGRAPHIC[ch];
    if (mapped !== undefined) {
      out += mapped;
    } else if (isGsm7Char(ch)) {
      out += ch;
    } else {
      // Inne litery z akcentami (č, ř, ü…) – bez znaków diakrytycznych, jeśli to pomaga.
      const stripped = ch.normalize('NFD').replace(/\p{M}/gu, '');
      out += [...stripped].every(isGsm7Char) ? stripped : ch;
    }
  }
  return out;
}

export function analyzeSms(text: string): SmsInfo {
  let gsmLength = 0;
  const nonGsm = new Set<string>();
  for (const ch of text) {
    if (GSM7_BASIC.has(ch)) gsmLength += 1;
    else if (GSM7_EXTENDED.has(ch)) gsmLength += 2;
    else nonGsm.add(ch);
  }
  if (nonGsm.size === 0) {
    const single = gsmLength <= 160;
    return {
      length: gsmLength,
      encoding: 'GSM-7',
      parts: gsmLength === 0 ? 0 : single ? 1 : Math.ceil(gsmLength / 153),
      perPart: single ? 160 : 153,
      nonGsmChars: [],
    };
  }
  const length = text.length; // jednostki UTF-16
  const single = length <= 70;
  return {
    length,
    encoding: 'UCS-2',
    parts: single ? 1 : Math.ceil(length / 67),
    perPart: single ? 70 : 67,
    nonGsmChars: [...nonGsm],
  };
}

// --- Szablony ---

export const TEMPLATE_PLACEHOLDERS = [
  'szkola',
  'zdarzenie',
  'imie',
  'klasa',
  'punkt',
  'adres',
  'instrukcja',
  'telefon',
  'odbierajacy',
  'godzina',
] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];
export type TemplateValues = Partial<Record<TemplatePlaceholder, string>>;

export const PLACEHOLDER_LABELS: Record<TemplatePlaceholder, string> = {
  szkola: 'krótka nazwa szkoły',
  zdarzenie: 'typ zdarzenia',
  imie: 'imię dziecka',
  klasa: 'klasa',
  punkt: 'nazwa punktu zbiórki',
  adres: 'adres punktu zbiórki',
  instrukcja: 'instrukcja odbioru',
  telefon: 'telefon kontaktowy szkoły',
  odbierajacy: 'kto odebrał dziecko',
  godzina: 'godzina (GG:MM)',
};

/**
 * Domyślny szablon pierwszego SMS-a. Celowo "jest ewakuowane do", a nie "jest bezpieczne" –
 * SMS wychodzi zanim ktokolwiek sprawdzi obecność (potwierdzenie przychodzi osobnym SMS-em).
 */
export const DEFAULT_START_TEMPLATE =
  'ALERT SZKOLNY: {szkola}. Trwa ewakuacja ({zdarzenie}). Twoje dziecko {imie} (kl. {klasa}) jest ewakuowane do punktu zbiorki: {punkt}, {adres}. Odbior dziecka: {instrukcja}. Kontakt: {telefon}. Nie dzwon do szkoly bez potrzeby.';

export function renderTemplate(template: string, values: TemplateValues): string {
  return template
    .replace(/\{(\w+)\}/g, (match, key: string) =>
      (TEMPLATE_PLACEHOLDERS as readonly string[]).includes(key) ? (values[key as TemplatePlaceholder] ?? '').trim() : match,
    )
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Tylko pierwsze imię – krócej i bez zbędnych danych. */
export function smsFirstName(firstName: string): string {
  return firstName.trim().split(/\s+/)[0] ?? '';
}

/** Gotowa treść: szablon + wartości, opcjonalnie bez polskich znaków (taniej: 160 zamiast 70 znaków na część). */
export function buildSms(template: string, values: TemplateValues, opts: { stripDiacritics: boolean; prefix?: string }): string {
  const body = `${opts.prefix ?? ''}${renderTemplate(template, values)}`;
  return opts.stripDiacritics ? toGsmFriendly(body) : body;
}
