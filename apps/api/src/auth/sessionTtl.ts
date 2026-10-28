import type { Role } from '@alert/shared';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Długość sesji przesuwnej (liczonej od ostatniego użycia) dla roli.
 * Nauczyciel otwiera aplikację rzadko – na ćwiczeniach i w czasie alarmu – więc jego sesja trwa długo:
 * w dniu alarmu nie może zobaczyć ekranu logowania na boisku, przy słabym zasięgu. Konto nauczyciela widzi
 * tylko listę obecności; po zgubieniu telefonu administrator wyłącza konto albo zmienia hasło (wylogowuje wszędzie).
 * Dyrekcja i administrator (wysyłka SMS, dane kontaktowe) – krótsza sesja.
 */
export function sessionTtlMs(role: Role, days: { SESSION_TTL_DAYS: number; TEACHER_SESSION_TTL_DAYS: number }): number {
  return (role === 'NAUCZYCIEL' ? days.TEACHER_SESSION_TTL_DAYS : days.SESSION_TTL_DAYS) * DAY_MS;
}
