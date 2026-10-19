// Tworzy plik .env z .env.example i generuje losowe klucze.
// Nie nadpisuje istniejącego .env (bezpieczne do wielokrotnego uruchamiania).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');

if (existsSync(envPath)) {
  console.log('Plik .env już istnieje – nic nie zmieniam.');
  process.exit(0);
}

const key = () => randomBytes(32).toString('base64');
const password = () => randomBytes(12).toString('base64url');

const content = readFileSync(join(root, '.env.example'), 'utf8')
  .replace('ENCRYPTION_KEYS=v1:WYGENERUJ_PRZEZ_npm_run_setup', `ENCRYPTION_KEYS=v1:${key()}`)
  .replace('BLIND_INDEX_KEY=WYGENERUJ_PRZEZ_npm_run_setup', `BLIND_INDEX_KEY=${key()}`)
  .replace('SEED_PASSWORD=WYGENERUJ_PRZEZ_npm_run_setup', `SEED_PASSWORD=${password()}`)
  .replace('SMS_WEBHOOK_TOKEN=WYGENERUJ_PRZEZ_npm_run_setup', `SMS_WEBHOOK_TOKEN=${randomBytes(24).toString('hex')}`);

writeFileSync(envPath, content, { encoding: 'utf8', mode: 0o600 });
console.log('Utworzono .env z nowymi kluczami.');
console.log('Hasło kont demonstracyjnych znajdziesz w .env (SEED_PASSWORD).');
console.log('UWAGA: utrata ENCRYPTION_KEYS = utrata dostępu do zaszyfrowanych numerów. Zrób kopię klucza.');
