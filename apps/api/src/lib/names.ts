/** Usuwa nadmiarowe spacje; "KOWALSKI" / "kowalski" -> "Kowalski" (mieszaną wielkość liter zostawia). */
export function normalizePersonName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return s;
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  return s
    .toLocaleLowerCase('pl')
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('pl'));
}

/** "kl. 3 b" -> "3B" */
export function normalizeClassName(raw: string): string {
  return raw
    .trim()
    .replace(/^(klasa|kl\.?)\s*/i, '')
    .replace(/\s+/g, '')
    .toLocaleUpperCase('pl');
}

/** Klucz porównawczy: bez wielkości liter i polskich znaków. */
export function foldKey(s: string): string {
  return s
    .toLocaleLowerCase('pl')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Naturalne sortowanie nazw klas: 1A, 2B, 10A. */
export function compareClassNames(a: string, b: string): number {
  return a.localeCompare(b, 'pl', { numeric: true, sensitivity: 'base' });
}
