// Szyfrowanie pól z danymi osobowymi (AES-256-GCM) i indeks HMAC do wyszukiwania.
// Format szyfrogramu: <idKlucza>:<iv b64url>:<tag b64url>:<dane b64url>
// "context" (np. "guardian.phone") trafia do AAD – szyfrogramu nie da się
// przenieść do innej kolumny bez wykrycia.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

export interface Keyring {
  activeId: string;
  keys: Map<string, Buffer>;
  blindIndexKey: Buffer;
}

export function parseKeyring(encryptionKeys: string, activeId: string, blindIndexKey: string): Keyring {
  const keys = new Map<string, Buffer>();
  for (const entry of encryptionKeys.split(',').map((s) => s.trim()).filter(Boolean)) {
    const sep = entry.indexOf(':');
    if (sep <= 0) throw new Error('ENCRYPTION_KEYS: oczekiwano formatu id:kluczBase64');
    const id = entry.slice(0, sep);
    const key = Buffer.from(entry.slice(sep + 1), 'base64');
    if (key.length !== 32) throw new Error(`ENCRYPTION_KEYS: klucz "${id}" musi mieć 32 bajty`);
    keys.set(id, key);
  }
  if (!keys.has(activeId)) throw new Error(`ENCRYPTION_ACTIVE_KEY_ID="${activeId}" nie występuje w ENCRYPTION_KEYS`);
  return { activeId, keys, blindIndexKey: Buffer.from(blindIndexKey, 'base64') };
}

export function createFieldCrypto(keyring: Keyring) {
  return {
    encrypt(plain: string, context: string): string {
      const key = keyring.keys.get(keyring.activeId)!;
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [keyring.activeId, iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join(':');
    },

    decrypt(payload: string, context: string): string {
      const [keyId, iv, tag, data] = payload.split(':');
      if (!keyId || !iv || !tag || data === undefined) throw new Error('Uszkodzony szyfrogram');
      const key = keyring.keys.get(keyId);
      if (!key) throw new Error(`Brak klucza "${keyId}" w ENCRYPTION_KEYS`);
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    },

    /** Deterministyczny HMAC – ten sam numer daje ten sam indeks. */
    blindIndex(value: string, context: string): string {
      return createHmac('sha256', keyring.blindIndexKey).update(`${context}|${value}`).digest('hex');
    },

    /** Czy szyfrogram używa nieaktywnego klucza (do rotacji). */
    needsReencrypt(payload: string): boolean {
      return !payload.startsWith(`${keyring.activeId}:`);
    },
  };
}

export type FieldCrypto = ReturnType<typeof createFieldCrypto>;
