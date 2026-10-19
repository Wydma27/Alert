import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { Prisma } from '@prisma/client';
import Fastify, { type FastifyError } from 'fastify';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, isProduction } from './env';
import { HttpError } from './lib/http';
import { sessionPlugin } from './auth/session';
import { alertRoutes } from './routes/alerts';
import { assemblyPointRoutes } from './routes/assemblyPoints';
import { attendanceRoutes } from './routes/attendance';
import { auditRoutes } from './routes/audit';
import { authRoutes } from './routes/auth';
import { classRoutes } from './routes/classes';
import { importRoutes } from './routes/import';
import { schoolRoutes } from './routes/school';
import { smsRoutes } from './routes/sms';
import { studentRoutes } from './routes/students';
import { templateRoutes } from './routes/templates';
import { userRoutes } from './routes/users';
import { webhookRoutes } from './routes/webhooks';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: isProduction ? 'info' : 'debug',
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    bodyLimit: 1024 * 1024,
  });

  // Bez HTTPS (test lokalny, telefon w sieci Wi-Fi) wymuszanie https zepsułoby ładowanie skryptów.
  const https = env.APP_URL.startsWith('https://');
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:'],
        'upgrade-insecure-requests': https ? [] : null,
      },
    },
    strictTransportSecurity: https,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({ statusCode: 429, error: 'Zbyt wiele prób – odczekaj chwilę i spróbuj ponownie.' }),
  });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  await app.register(sessionPlugin);

  app.setErrorHandler((error: FastifyError | HttpError | Error, req, reply) => {
    if (error instanceof HttpError) return reply.status(error.statusCode).send({ error: error.message });
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') return reply.status(409).send({ error: 'Taki wpis już istnieje.' });
      if (error.code === 'P2025') return reply.status(404).send({ error: 'Nie znaleziono.' });
      if (error.code === 'P2003') return reply.status(409).send({ error: 'Nie można usunąć – element jest używany.' });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ error: 'Zbyt wiele prób – odczekaj chwilę i spróbuj ponownie.' });
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: 'Nieprawidłowe żądanie.' });
    }
    req.log.error(error);
    return reply.status(500).send({ error: 'Błąd serwera. Spróbuj ponownie.' });
  });

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true }));
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(schoolRoutes);
      await api.register(assemblyPointRoutes);
      await api.register(classRoutes);
      await api.register(studentRoutes);
      await api.register(userRoutes);
      await api.register(auditRoutes);
      await api.register(importRoutes);
      await api.register(smsRoutes);
      await api.register(templateRoutes);
      await api.register(alertRoutes);
      await api.register(attendanceRoutes);
      await api.register(webhookRoutes);
    },
    { prefix: '/api' },
  );

  // Zbudowany frontend (npm run build) serwowany z tego samego adresu co API.
  const webDist = join(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') return reply.status(404).send({ error: 'Nie znaleziono.' });
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'Nie znaleziono.' }));
  }

  return app;
}
