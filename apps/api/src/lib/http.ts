import type { z } from 'zod';

/** Błąd z komunikatem przeznaczonym dla użytkownika (po polsku). */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function parseOr400<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path.join('.');
    throw new HttpError(400, field ? `Pole "${field}": ${first?.message}` : (first?.message ?? 'Nieprawidłowe dane.'));
  }
  return result.data;
}

export function idParam(params: unknown, name = 'id'): number {
  const value = Number((params as Record<string, string>)[name]);
  if (!Number.isInteger(value) || value <= 0) throw new HttpError(400, 'Nieprawidłowy identyfikator.');
  return value;
}
