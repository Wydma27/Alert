/** Polska odmiana: plural(2, 'uczeń', 'uczniów', 'uczniów') -> "2 uczniów"; formy: 1 / 2-4 / 5+ */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return `${n} ${one}`;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}
