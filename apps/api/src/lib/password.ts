import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';

// argon2id z parametrami zbliżonymi do rekomendacji OWASP.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const PASSWORD_MIN_LENGTH = 12;

export function hashSecret(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifySecret(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

/** Hash używany przy nieistniejącym koncie, żeby czas odpowiedzi nie zdradzał, czy e-mail istnieje. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashSecret(randomBytes(16).toString('hex'));
  return dummyHash;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Kody zapasowe 2FA: wysoka entropia, więc wystarczy SHA-256. Format XXXX-XXXX. */
export function generateRecoveryCodes(count = 10): string[] {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(8);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Hasło musi mieć co najmniej ${PASSWORD_MIN_LENGTH} znaków.`;
  if (password.length > 200) return 'Hasło jest za długie.';
  if (new Set(password).size < 5) return 'Hasło jest zbyt proste.';
  return null;
}

export function validatePin(pin: string): string | null {
  if (!/^\d{4,8}$/.test(pin)) return 'PIN musi mieć od 4 do 8 cyfr.';
  if (/^(\d)\1+$/.test(pin)) return 'PIN nie może składać się z jednej powtórzonej cyfry.';
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) return 'PIN nie może być ciągiem kolejnych cyfr.';
  return null;
}
