import type { Session, User } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { randomBytes } from 'node:crypto';
import type { Role } from '@alert/shared';
import { prisma } from '../db';
import { forgetSessions, rememberSession, sessionFromSnapshot } from '../emergency/snapshot';
import { env } from '../env';
import { dbHealthy, isDbConnectionError, markDbDown } from '../lib/dbHealth';
import { HttpError } from '../lib/http';
import { sha256Hex } from '../lib/password';
import { sessionTtlMs } from './sessionTtl';

export const SESSION_COOKIE = 'sid';
const MFA_PENDING_TTL_MS = 10 * 60 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const secureCookie = env.APP_URL.startsWith('https://');

declare module 'fastify' {
  interface FastifyRequest {
    auth: { session: Session; user: User } | null;
  }
}

function fullSessionTtlMs(role: Role) {
  return sessionTtlMs(role, env);
}

function setSessionCookie(reply: FastifyReply, token: string, expires: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: secureCookie,
    path: '/',
    expires,
  });
}

/** Tworzy sesję i ustawia ciasteczko. Token trafia tylko do przeglądarki, w bazie jest jego hash. */
export async function startSession(req: FastifyRequest, reply: FastifyReply, user: Pick<User, 'id' | 'role'>, mfaOk: boolean) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (mfaOk ? fullSessionTtlMs(user.role) : MFA_PENDING_TTL_MS));
  await prisma.session.create({
    data: {
      id: sha256Hex(token),
      userId: user.id,
      mfaOk,
      expiresAt,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
    },
  });
  setSessionCookie(reply, token, expiresAt);
}

export async function endSession(req: FastifyRequest, reply: FastifyReply) {
  if (req.auth) {
    forgetSessions({ sessionId: req.auth.session.id });
    await prisma.session.deleteMany({ where: { id: req.auth.session.id } });
  }
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export const sessionPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req, reply) => {
    // CSRF: zmiany stanu tylko z nagłówkiem, którego obca strona nie może ustawić bez CORS.
    // Uzupełnia SameSite=Strict na ciasteczku sesji.
    // Wyjątek: raporty doręczeń od bramek SMS (chronione osobnym tokenem w adresie).
    if (req.url.startsWith('/api/') && !req.url.startsWith('/api/webhooks/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers['x-csrf-protection'] !== '1') throw new HttpError(403, 'Brak nagłówka ochrony CSRF.');
    }

    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const sessionId = sha256Hex(token);
    // Baza nie odpowiada: zalogowani rozpoznawani z kopii awaryjnej (wysyłka SMS działa dalej).
    if (!dbHealthy()) {
      req.auth = sessionFromSnapshot(sessionId);
      return;
    }
    let session;
    try {
      session = await prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } });
    } catch (err) {
      if (!isDbConnectionError(err)) throw err;
      markDbDown();
      req.auth = sessionFromSnapshot(sessionId);
      return;
    }
    if (!session) return;
    const now = Date.now();
    if (session.expiresAt.getTime() < now || !session.user.isActive) {
      await prisma.session.deleteMany({ where: { id: session.id } });
      return;
    }
    const { user, ...sessionOnly } = session;
    req.auth = { session: sessionOnly, user };

    // Sesja przesuwna: odświeżamy co kilka minut, nie przy każdym żądaniu – w bazie i w ciasteczku
    // (inaczej przeglądarka i tak usunęłaby ciasteczko po czasie liczonym od zalogowania).
    if (session.mfaOk && now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      const updated = await prisma.session
        .update({
          where: { id: session.id },
          data: { lastSeenAt: new Date(now), expiresAt: new Date(now + fullSessionTtlMs(user.role)) },
        })
        .catch(() => null); // brak zapisu (np. pełny dysk bazy) nie może zablokować pracy
      if (updated) {
        sessionOnly.expiresAt = updated.expiresAt;
        setSessionCookie(reply, token, updated.expiresAt);
      }
    }
    rememberSession(sessionOnly, user);
  });
});

/** Strażnik trasy: wymaga pełnej sesji (po 2FA) i jednej z ról. */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest) => {
    if (!req.auth || !req.auth.session.mfaOk) throw new HttpError(401, 'Zaloguj się.');
    if (roles.length && !roles.includes(req.auth.user.role)) throw new HttpError(403, 'Brak uprawnień.');
  };
}

export const requireLogin = requireRole();

/** Wymaga sesji – także w trakcie logowania (przed 2FA). */
export async function requireAnySession(req: FastifyRequest) {
  if (!req.auth) throw new HttpError(401, 'Zaloguj się.');
}

export function currentUser(req: FastifyRequest): User {
  if (!req.auth) throw new HttpError(401, 'Zaloguj się.');
  return req.auth.user;
}
