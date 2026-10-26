// Kopia awaryjna na dysku serwera (zaszyfrowana AES-256-GCM): kontakty z numerami, konta i aktywne sesje.
// Gdy baza nie odpowiada, z kopii rozpoznajemy zalogowanych użytkowników, sprawdzamy PIN i wysyłamy SMS-y.
import type { Session, User } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Directory } from '@alert/shared';
import { CTX, fieldCrypto, prisma } from '../db';
import { env } from '../env';
import { loadDirectory } from '../lib/directory';

export interface SnapshotUser {
  id: number;
  email: string;
  fullName: string;
  role: User['role'];
  isActive: boolean;
  totpEnabled: boolean;
  launchPinHash: string | null;
}

export interface SnapshotSession {
  /** SHA-256 tokenu (jak w bazie). */
  id: string;
  userId: number;
  mfaOk: boolean;
  expiresAt: string;
}

export interface Snapshot {
  createdAt: string;
  school: { name: string; smsName: string; senderName: string } | null;
  users: SnapshotUser[];
  sessions: SnapshotSession[];
  /** Z numerami telefonów. */
  directory: Directory;
}

export const emergencyDir = resolve(process.cwd(), env.EMERGENCY_DATA_DIR);
const FILE = join(emergencyDir, 'snapshot.enc');

let current: Snapshot | null = null;
let dirty = false;

export function getSnapshot(): Snapshot | null {
  return current;
}

function toSnapshotUser(u: User): SnapshotUser {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    isActive: u.isActive,
    totpEnabled: Boolean(u.totpSecretEnc),
    launchPinHash: u.launchPinHash,
  };
}

/** Użytkownik z kopii w kształcie wiersza bazy (pola niepotrzebne bez bazy – puste). */
export function snapshotUserToUser(u: SnapshotUser): User {
  const epoch = new Date(0);
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    passwordHash: '',
    totpSecretEnc: u.totpEnabled ? '(kopia awaryjna)' : null,
    totpPendingEnc: null,
    totpLastStep: null,
    launchPinHash: u.launchPinHash,
    pinFailed: 0,
    pinLockedUntil: null,
    phoneEnc: null,
    isActive: u.isActive,
    failedLogins: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: epoch,
    updatedAt: epoch,
  };
}

/** Sesja z kopii – gdy baza nie odpowiada. */
export function sessionFromSnapshot(sessionId: string): { session: Session; user: User } | null {
  const snap = current;
  if (!snap) return null;
  const s = snap.sessions.find((x) => x.id === sessionId);
  if (!s || new Date(s.expiresAt).getTime() < Date.now()) return null;
  const u = snap.users.find((x) => x.id === s.userId);
  if (!u || !u.isActive) return null;
  const now = new Date();
  return {
    session: { id: s.id, userId: s.userId, mfaOk: s.mfaOk, createdAt: now, expiresAt: new Date(s.expiresAt), lastSeenAt: now, ip: null, userAgent: null },
    user: snapshotUserToUser(u),
  };
}

/** Sesja sprawdzona w bazie – zapamiętujemy ją w kopii (nowe logowania działają też po awarii bazy). */
export function rememberSession(session: Session, user: User) {
  if (!current || !session.mfaOk) return;
  const entry: SnapshotSession = { id: session.id, userId: session.userId, mfaOk: session.mfaOk, expiresAt: session.expiresAt.toISOString() };
  const i = current.sessions.findIndex((s) => s.id === session.id);
  if (i < 0) {
    current.sessions.push(entry);
    dirty = true;
  } else if (current.sessions[i]!.expiresAt !== entry.expiresAt) {
    current.sessions[i] = entry;
    dirty = true;
  }
  // Dane konta mogły się zmienić (np. nowy PIN).
  const fresh = toSnapshotUser(user);
  const j = current.users.findIndex((u) => u.id === user.id);
  if (j < 0 || JSON.stringify(current.users[j]) !== JSON.stringify(fresh)) {
    if (j < 0) current.users.push(fresh);
    else current.users[j] = fresh;
    dirty = true;
  }
}

/** Wylogowanie, dezaktywacja, zmiana hasła lub roli: sesja przestaje działać także w trybie awaryjnym. */
export function forgetSessions(filter: { sessionId?: string; userId?: number; exceptSessionId?: string }) {
  if (!current) return;
  const before = current.sessions.length;
  current.sessions = current.sessions.filter((s) => {
    if (filter.sessionId) return s.id !== filter.sessionId;
    if (filter.userId !== undefined) return s.userId !== filter.userId || s.id === filter.exceptSessionId;
    return true;
  });
  if (current.sessions.length !== before) {
    dirty = true;
    void flushSnapshot().catch(() => undefined);
  }
}

async function save(snap: Snapshot) {
  await mkdir(emergencyDir, { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, fieldCrypto.encrypt(JSON.stringify(snap), CTX.snapshot), { mode: 0o600 });
  await rename(tmp, FILE);
  dirty = false;
}

/** Nowa kopia z bazy (co kilka minut i po imporcie danych). */
export async function refreshSnapshot(log?: FastifyBaseLogger): Promise<Snapshot> {
  const [school, users, sessions, directory] = await Promise.all([
    prisma.school.findUnique({ where: { id: 1 } }),
    prisma.user.findMany(),
    prisma.session.findMany({ where: { mfaOk: true, expiresAt: { gt: new Date() } } }),
    loadDirectory(true),
  ]);
  const snap: Snapshot = {
    createdAt: new Date().toISOString(),
    school: school ? { name: school.name, smsName: school.smsName, senderName: school.senderName } : null,
    users: users.map(toSnapshotUser),
    sessions: sessions.map((s) => ({ id: s.id, userId: s.userId, mfaOk: s.mfaOk, expiresAt: s.expiresAt.toISOString() })),
    directory,
  };
  current = snap;
  await save(snap);
  log?.debug(`Kopia awaryjna: ${directory.people.length} kontaktów, ${sessions.length} sesji`);
  return snap;
}

/** Zapis zmian z pamięci (nowe sesje) – bez sięgania do bazy. */
export async function flushSnapshot() {
  if (current && dirty) await save(current);
}

/** Przy starcie serwera: ostatnia kopia z dysku (jeśli baza nie odpowiada, tylko na niej pracujemy). */
export async function loadSnapshotFromDisk(log?: FastifyBaseLogger): Promise<boolean> {
  if (!existsSync(FILE)) return false;
  try {
    current = JSON.parse(fieldCrypto.decrypt(await readFile(FILE, 'utf8'), CTX.snapshot)) as Snapshot;
    log?.info(`Kopia awaryjna z ${current.createdAt} wczytana z dysku`);
    return true;
  } catch (err) {
    log?.error(err, 'Nie udało się odczytać kopii awaryjnej (inny klucz szyfrowania?)');
    return false;
  }
}
