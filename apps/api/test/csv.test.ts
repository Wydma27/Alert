import { describe, expect, it } from 'vitest';
import { csvBody, csvCell } from '../src/lib/csv';

describe('csvCell', () => {
  it('zostawia zwykły tekst bez zmian', () => {
    expect(csvCell('Nowak')).toBe('Nowak');
    expect(csvCell(12)).toBe('12');
    expect(csvCell(null)).toBe('');
  });

  it('cytuje separator, cudzysłów i nowe linie', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('powiedział "tak"')).toBe('"powiedział ""tak"""');
    expect(csvCell('dwie\nlinie')).toBe('"dwie\nlinie"');
  });

  it('nie pozwala Excelowi wykonać formuły', () => {
    expect(csvCell('=HYPERLINK("http://zly.example","klik")')).toBe(`"'=HYPERLINK(""http://zly.example"",""klik"")"`);
    expect(csvCell('+48 *** *** 019')).toBe("'+48 *** *** 019");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tukryte')).toBe("'\tukryte");
  });

  it('plik ma BOM i wiersze rozdzielone CRLF', () => {
    expect(csvBody([['a', 'b'], ['c']])).toBe('﻿a;b\r\nc');
  });
});
