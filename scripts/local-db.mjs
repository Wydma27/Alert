// Lokalny PostgreSQL 16 bez Dockera i bez instalacji (pakiet embedded-postgres).
// Dane w .data/postgres, port 5433, tylko localhost. Zatrzymanie: Ctrl+C.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
if (!existsSync(envPath)) {
  console.error('Brak pliku .env – uruchom najpierw "npm run setup".');
  process.exit(1);
}
const envFile = readFileSync(envPath, 'utf8');
const password = /^POSTGRES_PASSWORD=(.*)$/m.exec(envFile)?.[1]?.trim() || 'alert_dev_haslo';
const databaseDir = join(root, '.data', 'postgres');
const firstRun = !existsSync(join(databaseDir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'alert',
  password,
  port: 5433,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
  onError: (err) => console.error(String(err)),
});

if (firstRun) {
  console.log('Pierwsze uruchomienie – tworzę klaster bazy w .data/postgres…');
  await pg.initialise();
}
await pg.start();
if (firstRun) await pg.createDatabase('alert');

console.log('PostgreSQL działa na 127.0.0.1:5433 (baza "alert"). Zatrzymanie: Ctrl+C.');

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  console.log('Zatrzymuję bazę…');
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
// Utrzymanie procesu przy życiu.
setInterval(() => {}, 1 << 30);
