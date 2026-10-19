// Odczyt CSV/XLSX do prostej tabeli tekstowej (nagłówki + wiersze).
import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import { HttpError } from '../lib/http';

export interface Table {
  headers: string[];
  rows: string[][];
}

export const MAX_IMPORT_ROWS = 5000;

export async function parseUpload(buffer: Buffer, filename: string): Promise<Table> {
  const lower = filename.toLowerCase();
  let raw: string[][];
  if (lower.endsWith('.xlsx')) raw = await readXlsx(buffer);
  else if (lower.endsWith('.csv') || lower.endsWith('.txt')) raw = readCsv(buffer);
  else if (lower.endsWith('.xls')) throw new HttpError(400, 'Stary format .xls nie jest obsługiwany – zapisz plik jako .xlsx lub .csv.');
  else throw new HttpError(400, 'Obsługiwane formaty plików: .csv i .xlsx.');
  return toTable(raw);
}

/** Pierwszy niepusty wiersz to nagłówki; puste wiersze pomijamy; wiersze dopełniamy do szerokości nagłówka. */
export function toTable(raw: string[][]): Table {
  const nonEmpty = raw.map((r) => r.map((c) => (c ?? '').toString().trim())).filter((r) => r.some((c) => c !== ''));
  if (nonEmpty.length < 2) throw new HttpError(400, 'Plik nie zawiera danych (potrzebny wiersz nagłówków i co najmniej jeden wiersz).');
  const headers = nonEmpty[0]!.map((h, i) => h || `Kolumna ${i + 1}`);
  const width = Math.max(headers.length, ...nonEmpty.map((r) => r.length));
  while (headers.length < width) headers.push(`Kolumna ${headers.length + 1}`);
  const rows = nonEmpty.slice(1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
  if (rows.length > MAX_IMPORT_ROWS) throw new HttpError(400, `Plik ma za dużo wierszy (limit ${MAX_IMPORT_ROWS}).`);
  return { headers, rows };
}

export function dropColumns(table: Table, indexes: number[]): Table {
  if (indexes.length === 0) return table;
  const drop = new Set(indexes);
  const keep = (_: string, i: number) => !drop.has(i);
  return { headers: table.headers.filter(keep), rows: table.rows.map((r) => r.filter(keep)) };
}

/** Eksporty z dzienników bywają w UTF-8 (z BOM lub bez), UTF-16 albo Windows-1250. */
export function decodeText(buffer: Buffer): string {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString('utf8');
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1250').decode(buffer);
  }
}

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  let best = ';';
  let bestCount = -1;
  for (const candidate of [';', ',', '\t']) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export function readCsv(buffer: Buffer): string[][] {
  const text = decodeText(buffer);
  try {
    return parseCsv(text, {
      delimiter: detectDelimiter(text),
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: true,
    }) as string[][];
  } catch {
    throw new HttpError(400, 'Nie udało się odczytać pliku CSV. Sprawdź, czy to plik tekstowy z kolumnami oddzielonymi średnikiem lub przecinkiem.');
  }
}

async function readXlsx(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs ma typ Buffer ze starszego @types/node
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new HttpError(400, 'Nie udało się odczytać pliku XLSX.');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new HttpError(400, 'Plik XLSX nie zawiera arkusza.');
  const out: string[][] = [];
  const columns = sheet.columnCount;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    for (let c = 1; c <= columns; c++) values.push(row.getCell(c).text ?? '');
    out.push(values);
  });
  return out;
}
