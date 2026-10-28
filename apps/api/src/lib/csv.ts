import type { FastifyReply } from 'fastify';

/**
 * Komórka CSV (separator ";", Excel). Tekst zaczynający się od = + - @ (albo tabulatora) Excel wykonałby jako formułę –
 * np. nazwisko z importu "=HYPERLINK(…)" albo numer "+48 *** *** 019". Taki tekst poprzedzamy apostrofem.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Cały plik: BOM (polskie znaki w Excelu), wiersze rozdzielone CRLF. */
export function csvBody(lines: unknown[][]): string {
  return '﻿' + lines.map((l) => l.map(csvCell).join(';')).join('\r\n');
}

export function sendCsv(reply: FastifyReply, filename: string, lines: unknown[][]) {
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .header('Cache-Control', 'no-store')
    .send(csvBody(lines));
}
