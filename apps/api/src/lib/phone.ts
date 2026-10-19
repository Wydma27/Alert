import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

export type PhoneResult = { ok: true; e164: string } | { ok: false; error: string };

// Typy numerów, na które da się wysłać SMS. Brak typu = numer poprawny, ale nieokreślony.
const SMS_CAPABLE = new Set(['MOBILE', 'FIXED_LINE_OR_MOBILE', 'PERSONAL_NUMBER']);

/** Normalizuje numer do E.164 (domyślnie Polska) i sprawdza, czy przyjmie SMS. */
export function normalizePhone(raw: string): PhoneResult {
  let s = raw.trim();
  if (!s) return { ok: false, error: 'brak numeru' };
  s = s.replace(/[\s\-().\/]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (/^48\d{9}$/.test(s)) s = `+${s}`;

  const parsed = parsePhoneNumberFromString(s, 'PL');
  if (!parsed || !parsed.isValid()) return { ok: false, error: 'nieprawidłowy numer telefonu' };

  const type = parsed.getType();
  if (type === 'FIXED_LINE') return { ok: false, error: 'numer stacjonarny – SMS nie dotrze' };
  if (type && !SMS_CAPABLE.has(type)) return { ok: false, error: 'ten typ numeru nie odbiera SMS' };
  return { ok: true, e164: parsed.number };
}

/** "+48 *** *** 789" – do list, bez odszyfrowywania w przeglądarce. */
export function maskPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  const prefix = parsed ? `+${parsed.countryCallingCode}` : e164.slice(0, 3);
  return `${prefix} *** *** ${e164.slice(-3)}`;
}

/** "+48 600 100 200" */
export function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}
