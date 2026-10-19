import type { Session, User } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { randomBytes } from 'node:crypto';
import type { Role } from '@alert/shared';
import { prisma } from '../db';
import { env } from '../env';
import { HttpError } from '../lib/http';
import { sha256Hex } from '../lib/password';

export const SESSION_COOKIE = 'sid';
const MFA_PENDING_TTL_MS = 10 * 60 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const secureCookie = env.APP_URL.startsWith('https://');

declare module 'fastify' {
  interface FastifyRequest {
    auth: { session: Session; user: User } | null;
  }
}

function fullSessionTtlMs() {
  return env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/** Tworzy sesję i ustawia ciasteczko. Token trafia tylko do przeglądarki, w bazie jest jego hash. */
export async function startSession(req: FastifyRequest, reply: FastifyReply, userId: number, mfaOk: boolean) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (mfaOk ? fullSessionTtlMs() : MFA_PENDING_TTL_MS));
  await prisma.session.create({
    data: {
      id: sha256Hex(token),
      userId,
      mfaOk,
      expiresAt,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
    },
  });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: secureCookie,
    path: '/',
    expires: expiresAt,
  });
}

export async function endSession(req: FastifyRequest, reply: FastifyReply) {
  if (req.auth) await prisma.session.deleteMany({ where: { id: req.auth.session.id } });
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export const sessionPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req) => {
    // CSRF: zmiany stanu tylko z nagłówkiem, którego obca strona nie może ustawić bez CORS.
    // Uzupełnia SameSite=Strict na ciasteczku sesji.
    // Wyjątek: raporty doręczeń od bramek SMS (chronione osobnym tokenem w adresie).
    if (req.url.startsWith('/api/') && !req.url.startsWith('/api/webhooks/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers['x-csrf-protection'] !== '1') throw new HttpError(403, 'Brak nagłówka ochrony CSRF.');
    }

    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const session = await prisma.session.findUnique({ where: { id: sha256Hex(token) }, include: { user: true } });
    if (!session) return;
    const now = Date.now();
    if (session.expiresAt.getTime() < now || !session.user.isActive) {
      await prisma.session.deleteMany({ where: { id: session.id } });
      return;
    }
    const { user, ...sessionOnly } = session;
    req.auth = { session: sessionOnly, user };

    // Sesja przesuwna: odświeżamy co kilka minut, nie przy każdym żądaniu.
    if (session.mfaOk && now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now), expiresAt: new Date(now + fullSessionTtlMs()) },
      });
    }
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
