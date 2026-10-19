// Pierwsze konto administratora na nowej instalacji (także produkcyjnej):
//   npm run admin:create -- jan.kowalski@szkola.pl "Jan Kowalski"
// Hasło tymczasowe jest wypisywane jeden raz – zmień je po pierwszym logowaniu („Moje konto”).
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db';
import { writeAudit } from '../lib/audit';
import { hashSecret } from '../lib/password';

const [emailArg, ...nameParts] = process.argv.slice(2);
const parsed = z
  .object({ email: z.string().trim().toLowerCase().email(), fullName: z.string().trim().min(3).max(100) })
  .safeParse({ email: emailArg, fullName: nameParts.join(' ') });

if (!parsed.success) {
  console.error('Użycie: npm run admin:create -- adres@email.pl "Imię Nazwisko"');
  process.exit(1);
}

const { email, fullName } = parsed.data;
if (await prisma.user.findUnique({ where: { email } })) {
  console.error(`Konto ${email} już istnieje.`);
  process.exit(1);
}

const password = randomBytes(12).toString('base64url');
const user = await prisma.user.create({
  data: { email, fullName, role: 'ADMIN', passwordHash: await hashSecret(password) },
});
await writeAudit({ action: 'user.create', entity: 'user', entityId: user.id, details: { role: 'ADMIN', via: 'admin:create' } });

console.log(`Utworzono administratora: ${email}`);
console.log(`Hasło tymczasowe: ${password}`);
console.log('Przy pierwszym logowaniu skonfigurujesz weryfikację dwuetapową. Potem zmień hasło i ustaw PIN w „Moje konto”.');
await prisma.$disconnect();
