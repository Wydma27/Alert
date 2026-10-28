import { describe, expect, it } from 'vitest';
import { sessionTtlMs } from '../src/auth/sessionTtl';

const DAY = 24 * 60 * 60 * 1000;
const days = { SESSION_TTL_DAYS: 14, TEACHER_SESSION_TTL_DAYS: 365 };

describe('sessionTtlMs', () => {
  it('nauczyciel – długa sesja (logowanie raz, lista obecności w dniu alarmu bez logowania)', () => {
    expect(sessionTtlMs('NAUCZYCIEL', days)).toBe(365 * DAY);
  });

  it('dyrekcja i administrator – krótsza sesja', () => {
    expect(sessionTtlMs('DYREKCJA', days)).toBe(14 * DAY);
    expect(sessionTtlMs('ADMIN', days)).toBe(14 * DAY);
  });
});
