import type { User } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { SENDER_ROLES, requiresTwoFactor, type MeResponse, type MfaState } from '@alert/shared';
import { CTX, fieldCrypto, prisma } from '../db';
import { env } from '../env';
import { audit, writeAudit } from '../lib/audit';
import { HttpError, parseOr400 } from '../lib/http';
import {
  generateRecoveryCodes,
  getDummyHash,
  hashSecret,
  normalizeRecoveryCode,
  sha256Hex,
  validatePasswordStrength,
  validatePin,
  verifySecret,
} from '../lib/password';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../lib/totp';
import { currentUser, endSession, requireAnySession, requireLogin, startSession } from '../auth/session';
import { forgetSessions } from '../emergency/snapshot';

// Limit na adres IP. Logowanie luźniej: w szkolnej sieci Wi-Fi wszyscy nauczyciele mają ten sam adres publiczny,
// a przed zgadywaniem haseł chroni blokada konta po LOGIN_MAX_FAILED błędach.
const loginRateLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };
const sensitiveRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

function mfaStateFor(user: User, mfaOk: boolean): MfaState {
  if (mfaOk) return 'ok';
  if (user.totpSecretEnc) return 'verify';
  return 'setup';
}

export function toMe(user: User, mfaOk: boolean): MeResponse {
  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      totpEnabled: Boolean(user.totpSecretEnc),
      hasLaunchPin: Boolean(user.launchPinHash),
    },
    mfa: mfaStateFor(user, mfaOk),
  };
}

/** Nieudana próba (hasło lub 2FA): licznik i ewentualna blokada konta. */
async function registerFailure(user: User): Promise<boolean> {
  const failed = user.failedLogins + 1;
  const lock = failed >= env.LOGIN_MAX_FAILED;
  await prisma.user.update({
    where: { id: user.id },
    data: lock
      ? { failedLogins: 0, lockedUntil: new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000) }
      : { failedLogins: failed },
  });
  return lock;
}

function lockedMessage(until: Date) {
  const time = until.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' });
  return `Konto zablokowane po zbyt wielu nieudanych próbach. Spróbuj ponownie po ${time}.`;
}

/** Po pełnym zalogowaniu wymieniamy token sesji (ochrona przed przejęciem sesji sprzed 2FA). */
async function upgradeSession(req: FastifyRequest, reply: FastifyReply, user: User) {
  await prisma.session.deleteMany({ where: { id: req.auth!.session.id } });
  await startSession(req, reply, user, true);
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', { config: loginRateLimit }, async (req, reply) => {
    const body = parseOr400(z.object({ email: z.string().trim().min(1), password: z.string().min(1) }), req.body);
    const email = body.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.isActive) {
      await verifySecret(await getDummyHash(), body.password); // wyrównanie czasu odpowiedzi
      await writeAudit({ action: 'auth.login.failed', ip: req.ip, details: { email, reason: user ? 'inactive' : 'unknown' } });
      throw new HttpError(401, 'Nieprawidłowy e-mail lub hasło.');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await writeAudit({ action: 'auth.login.blocked', userId: user.id, ip: req.ip });
      throw new HttpError(423, lockedMessage(user.lockedUntil));
    }
    if (!(await verifySecret(user.passwordHash, body.password))) {
      const locked = await registerFailure(user);
      await writeAudit({ action: 'auth.login.failed', userId: user.id, ip: req.ip, details: { reason: 'password', locked } });
      throw new HttpError(401, 'Nieprawidłowy e-mail lub hasło.');
    }

    const fresh = await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null },
    });
    const needsSecondFactor = Boolean(fresh.totpSecretEnc) || requiresTwoFactor(fresh.role);
    await startSession(req, reply, fresh, !needsSecondFactor);
    if (!needsSecondFactor) {
      await prisma.user.update({ where: { id: fresh.id }, data: { lastLoginAt: new Date() } });
      await writeAudit({ action: 'auth.login', userId: fresh.id, ip: req.ip, details: { method: 'password' } });
    } else {
      await writeAudit({ action: 'auth.login.password_ok', userId: fresh.id, ip: req.ip });
    }
    return toMe(fresh, !needsSecondFactor);
  });

  app.get('/me', { preHandler: requireAnySession }, async (req) => {
    return toMe(req.auth!.user, req.auth!.session.mfaOk);
  });

  app.post('/logout', async (req, reply) => {
    if (req.auth) await audit(req, { action: 'auth.logout' });
    await endSession(req, reply);
    return { ok: true };
  });

  // --- Drugi składnik przy logowaniu ---
  app.post('/2fa/verify', { config: sensitiveRateLimit, preHandler: requireAnySession }, async (req, reply) => {
    const { code } = parseOr400(z.object({ code: z.string().trim().min(6).max(20) }), req.body);
    const user = currentUser(req);
    if (req.auth!.session.mfaOk) return toMe(user, true);
    if (!user.totpSecretEnc) throw new HttpError(400, 'Najpierw skonfiguruj weryfikację dwuetapową.');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await endSession(req, reply);
      throw new HttpError(423, lockedMessage(user.lockedUntil));
    }

    let method: 'totp' | 'recovery' | null = null;
    const secret = fieldCrypto.decrypt(user.totpSecretEnc, CTX.totpSecret);
    const step = verifyTotp(secret, code, { lastUsedStep: user.totpLastStep });
    if (step !== null) {
      method = 'totp';
      await prisma.user.update({ where: { id: user.id }, data: { totpLastStep: step } });
    } else if (/[A-Za-z]/.test(code)) {
      const used = await prisma.recoveryCode.updateMany({
        where: { userId: user.id, codeHash: sha256Hex(normalizeRecoveryCode(code)), usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count === 1) method = 'recovery';
    }

    if (!method) {
      const locked = await registerFailure(user);
      await audit(req, { action: 'auth.2fa.failed', details: { locked } });
      if (locked) {
        await endSession(req, reply);
        throw new HttpError(423, 'Zbyt wiele błędnych kodów – konto zostało czasowo zablokowane.');
      }
      throw new HttpError(401, 'Nieprawidłowy kod.');
    }

    const fresh = await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lastLoginAt: new Date() },
    });
    await upgradeSession(req, reply, fresh);
    await audit(req, { action: 'auth.login', details: { method } });
    if (method === 'recovery') {
      const left = await prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } });
      return { ...toMe(fresh, true), recoveryCodesLeft: left };
    }
    return toMe(fresh, true);
  });

  // --- Konfiguracja 2FA (pierwsze logowanie lub ponowna konfiguracja z konta) ---
  app.post('/2fa/setup/start', { preHandler: requireAnySession }, async (req) => {
    const user = currentUser(req);
    const mfaOk = req.auth!.session.mfaOk;
    if (user.totpSecretEnc) {
      // Zmiana telefonu z aplikacją: tylko z pełnej sesji i z hasłem.
      const body = parseOr400(z.object({ password: z.string().min(1) }), req.body ?? {});
      if (!mfaOk) throw new HttpError(403, 'Najpierw potwierdź logowanie kodem.');
      if (!(await verifySecret(user.passwordHash, body.password))) throw new HttpError(401, 'Nieprawidłowe hasło.');
    }
    const secret = generateTotpSecret();
    await prisma.user.update({
      where: { id: user.id },
      data: { totpPendingEnc: fieldCrypto.encrypt(secret, CTX.totpSecret) },
    });
    const uri = otpauthUri(secret, user.email, env.APP_NAME);
    return { secret, otpauthUri: uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) };
  });

  app.post('/2fa/setup/confirm', { config: sensitiveRateLimit, preHandler: requireAnySession }, async (req, reply) => {
    const { code } = parseOr400(z.object({ code: z.string().trim().min(6).max(10) }), req.body);
    const user = currentUser(req);
    if (!user.totpPendingEnc) throw new HttpError(400, 'Rozpocznij konfigurację od nowa.');
    if (user.totpSecretEnc && !req.auth!.session.mfaOk) throw new HttpError(403, 'Najpierw potwierdź logowanie kodem.');

    const pending = fieldCrypto.decrypt(user.totpPendingEnc, CTX.totpSecret);
    const step = verifyTotp(pending, code);
    if (step === null) throw new HttpError(401, 'Kod się nie zgadza. Sprawdź, czy zegar w telefonie jest ustawiony automatycznie.');

    const recoveryCodes = generateRecoveryCodes();
    const fresh = await prisma.$transaction(async (tx) => {
      await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.recoveryCode.createMany({
        data: recoveryCodes.map((c) => ({ userId: user.id, codeHash: sha256Hex(c) })),
      });
      return tx.user.update({
        where: { id: user.id },
        data: {
          totpSecretEnc: user.totpPendingEnc,
          totpPendingEnc: null,
          totpLastStep: step,
          failedLogins: 0,
          lastLoginAt: new Date(),
        },
      });
    });
    const wasLoginFlow = !req.auth!.session.mfaOk;
    await upgradeSession(req, reply, fresh);
    await audit(req, { action: 'auth.2fa.enabled' });
    if (wasLoginFlow) await audit(req, { action: 'auth.login', details: { method: 'totp' } });
    return { ...toMe(fresh, true), recoveryCodes };
  });

  // --- Moje konto ---
  app.post('/password', { config: sensitiveRateLimit, preHandler: requireLogin }, async (req) => {
    const body = parseOr400(z.object({ currentPassword: z.string().min(1), newPassword: z.string() }), req.body);
    const user = currentUser(req);
    if (!(await verifySecret(user.passwordHash, body.currentPassword))) throw new HttpError(401, 'Obecne hasło jest nieprawidłowe.');
    const problem = validatePasswordStrength(body.newPassword);
    if (problem) throw new HttpError(400, problem);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashSecret(body.newPassword) } });
    // Wyloguj pozostałe urządzenia.
    await prisma.session.deleteMany({ where: { userId: user.id, id: { not: req.auth!.session.id } } });
    forgetSessions({ userId: user.id, exceptSessionId: req.auth!.session.id });
    await audit(req, { action: 'auth.password.changed' });
    return { ok: true };
  });

  app.post('/pin', { config: sensitiveRateLimit, preHandler: requireLogin }, async (req) => {
    const body = parseOr400(z.object({ currentPassword: z.string().min(1), pin: z.string() }), req.body);
    const user = currentUser(req);
    if (!SENDER_ROLES.includes(user.role)) throw new HttpError(403, 'PIN alarmowy dotyczy tylko osób uruchamiających alerty.');
    if (!(await verifySecret(user.passwordHash, body.currentPassword))) throw new HttpError(401, 'Hasło jest nieprawidłowe.');
    const problem = validatePin(body.pin);
    if (problem) throw new HttpError(400, problem);
    await prisma.user.update({ where: { id: user.id }, data: { launchPinHash: await hashSecret(body.pin) } });
    await audit(req, { action: 'auth.pin.set' });
    return { ok: true };
  });
}
