import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFieldCrypto, parseKeyring } from '../src/lib/crypto';
import { normalizeRecoveryCode, validatePin } from '../src/lib/password';
import { base32Decode, base32Encode, hotp, otpauthUri, totpStep, verifyTotp } from '../src/lib/totp';

describe('TOTP (RFC 6238)', () => {
  // Wektory testowe z RFC 6238, dodatek B (SHA-1, 8 cyfr).
  const secret = Buffer.from('12345678901234567890');
  const vectors: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  it.each(vectors)('czas %i -> %s', (seconds, expected) => {
    expect(hotp(secret, totpStep(seconds * 1000), 8)).toBe(expected);
  });

  it('base32 w obie strony', () => {
    const buf = randomBytes(20);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    expect(base32Encode(Buffer.from('12345678901234567890'))).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('akceptuje bieżący i sąsiedni krok, odrzuca użyty ponownie', () => {
    const b32 = base32Encode(secret);
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    const code = hotp(secret, step);
    expect(verifyTotp(b32, code, { nowMs: now })).toBe(step);
    expect(verifyTotp(b32, hotp(secret, step - 1), { nowMs: now })).toBe(step - 1);
    expect(verifyTotp(b32, hotp(secret, step - 3), { nowMs: now })).toBeNull();
    expect(verifyTotp(b32, code, { nowMs: now, lastUsedStep: step })).toBeNull();
    expect(verifyTotp(b32, '12345', { nowMs: now })).toBeNull();
  });

  it('URI dla aplikacji uwierzytelniającej', () => {
    expect(otpauthUri('ABC', 'a@b.pl', 'Alert Szkolny')).toBe(
      'otpauth://totp/Alert%20Szkolny%3Aa%40b.pl?secret=ABC&issuer=Alert+Szkolny&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('szyfrowanie pól', () => {
  const k1 = randomBytes(32).toString('base64');
  const k2 = randomBytes(32).toString('base64');
  const blind = randomBytes(32).toString('base64');

  it('szyfruje i odszyfrowuje, szyfrogram za każdym razem inny', () => {
    const c = createFieldCrypto(parseKeyring(`v1:${k1}`, 'v1', blind));
    const a = c.encrypt('+48790000001', 'guardian.phone');
    const b = c.encrypt('+48790000001', 'guardian.phone');
    expect(a).not.toBe(b);
    expect(a).not.toContain('790000001');
    expect(c.decrypt(a, 'guardian.phone')).toBe('+48790000001');
  });

  it('odrzuca szyfrogram z innego kontekstu (AAD) i zmodyfikowany', () => {
    const c = createFieldCrypto(parseKeyring(`v1:${k1}`, 'v1', blind));
    const enc = c.encrypt('sekret', 'user.totp');
    expect(() => c.decrypt(enc, 'guardian.phone')).toThrow();
    const parts = enc.split(':');
    parts[3] = Buffer.from('inne').toString('base64url');
    expect(() => c.decrypt(parts.join(':'), 'user.totp')).toThrow();
  });

  it('rotacja: stare dane czytelne po zmianie aktywnego klucza', () => {
    const old = createFieldCrypto(parseKeyring(`v1:${k1}`, 'v1', blind));
    const enc = old.encrypt('+48790000002', 'guardian.phone');
    const rotated = createFieldCrypto(parseKeyring(`v1:${k1},v2:${k2}`, 'v2', blind));
    expect(rotated.decrypt(enc, 'guardian.phone')).toBe('+48790000002');
    expect(rotated.needsReencrypt(enc)).toBe(true);
    expect(rotated.encrypt('x', 'c').startsWith('v2:')).toBe(true);
  });

  it('indeks HMAC jest deterministyczny i zależny od kontekstu', () => {
    const c = createFieldCrypto(parseKeyring(`v1:${k1}`, 'v1', blind));
    expect(c.blindIndex('+48790000001', 'a')).toBe(c.blindIndex('+48790000001', 'a'));
    expect(c.blindIndex('+48790000001', 'a')).not.toBe(c.blindIndex('+48790000001', 'b'));
  });

  it('odrzuca błędną konfigurację kluczy', () => {
    expect(() => parseKeyring('v1:krotki', 'v1', blind)).toThrow();
    expect(() => parseKeyring(`v1:${k1}`, 'v2', blind)).toThrow();
  });
});

describe('PIN i kody zapasowe', () => {
  it('waliduje PIN', () => {
    expect(validatePin('7391')).toBeNull();
    expect(validatePin('1111')).not.toBeNull();
    expect(validatePin('1234')).not.toBeNull();
    expect(validatePin('4321')).not.toBeNull();
    expect(validatePin('12a4')).not.toBeNull();
    expect(validatePin('123')).not.toBeNull();
  });

  it('normalizuje kod zapasowy', () => {
    expect(normalizeRecoveryCode(' abcd efgh ')).toBe('ABCD-EFGH');
    expect(normalizeRecoveryCode('ABCD-EFGH')).toBe('ABCD-EFGH');
  });
});
