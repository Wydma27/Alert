// Dane demonstracyjne: fikcyjna szkoła, klasy, uczniowie, opiekunowie, punkty zbiórki i konta.
// Wszystkie nazwiska i numery są zmyślone. Uruchom: npm run db:seed
// Skrypt czyści dane szkoły (nie dziennik zdarzeń) – NIE uruchamiaj go na danych produkcyjnych.
import { CTX, fieldCrypto, prisma } from '../src/db';
import { writeAudit } from '../src/lib/audit';
import { findOrCreateGuardian } from '../src/lib/guardians';
import { hashSecret } from '../src/lib/password';

const seedPassword = process.env.SEED_PASSWORD;
if (!seedPassword || seedPassword.length < 12) {
  console.error('Ustaw SEED_PASSWORD (min. 12 znaków) w .env – np. przez "npm run setup".');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('Seed jest zablokowany przy NODE_ENV=production.');
  process.exit(1);
}

const FIRST_NAMES_F = ['Zuzanna', 'Julia', 'Maja', 'Zofia', 'Hanna', 'Lena', 'Alicja', 'Maria', 'Oliwia', 'Amelia', 'Wiktoria', 'Pola'];
const FIRST_NAMES_M = ['Jan', 'Antoni', 'Franciszek', 'Aleksander', 'Szymon', 'Jakub', 'Leon', 'Filip', 'Mikołaj', 'Stanisław', 'Ignacy', 'Tymon'];
const LAST_NAMES = [
  ['Nowak', 'Nowak'],
  ['Wiśniewski', 'Wiśniewska'],
  ['Wójcik', 'Wójcik'],
  ['Kamiński', 'Kamińska'],
  ['Lewandowski', 'Lewandowska'],
  ['Zieliński', 'Zielińska'],
  ['Szymański', 'Szymańska'],
  ['Dąbrowski', 'Dąbrowska'],
  ['Kozłowski', 'Kozłowska'],
  ['Jankowski', 'Jankowska'],
  ['Mazur', 'Mazur'],
  ['Krawczyk', 'Krawczyk'],
  ['Piotrowski', 'Piotrowska'],
  ['Grabowski', 'Grabowska'],
  ['Pawłowski', 'Pawłowska'],
] as const;
const PARENT_F = ['Anna', 'Katarzyna', 'Magdalena', 'Agnieszka', 'Monika', 'Joanna', 'Ewa'];
const PARENT_M = ['Piotr', 'Tomasz', 'Paweł', 'Marcin', 'Michał', 'Krzysztof', 'Łukasz'];

const CLASSES = ['1A', '1B', '2A', '3A', '3B', '4A', '5A', '6A', '7A', '8A'];

/** Prosty deterministyczny generator – te same dane przy każdym uruchomieniu. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
const rand = rng(12);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

// Fikcyjne numery komórkowe z jednego bloku 7xx (zaczynają się od 790 000 …).
let phoneCounter = 0;
const nextPhone = () => `+48790000${String(++phoneCounter).padStart(3, '0')}`;

async function main() {
  console.log('Czyszczenie danych szkoły…');
  await prisma.notice.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.studentGuardian.deleteMany();
  await prisma.student.deleteMany();
  await prisma.guardian.deleteMany();
  await prisma.schoolClass.deleteMany();
  await prisma.assemblyPoint.deleteMany();
  await prisma.session.deleteMany();
  await prisma.recoveryCode.deleteMany();
  await prisma.user.deleteMany();

  await prisma.school.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      name: 'Szkoła Podstawowa nr 12 im. Marii Konopnickiej w Zielonowie',
      smsName: 'SP12 Zielonowo',
      address: 'ul. Szkolna 12, 00-000 Zielonowo',
      contactPhone: '22 000 00 12',
      senderName: 'SP12-ALERT',
    },
    update: {},
  });

  const [hala, boisko, domKultury] = await Promise.all([
    prisma.assemblyPoint.create({
      data: { name: 'Hala sportowa MOSiR', address: 'ul. Sportowa 5, Zielonowo', notes: 'Wejście od parkingu' },
    }),
    prisma.assemblyPoint.create({ data: { name: 'Boisko Orlik', address: 'ul. Szkolna 14, Zielonowo' } }),
    prisma.assemblyPoint.create({ data: { name: 'Dom Kultury', address: 'pl. Główny 1, Zielonowo' } }),
  ]);

  const classIds = new Map<string, number>();
  for (const name of CLASSES) {
    const point = name.startsWith('1') || name.startsWith('2') || name.startsWith('3') ? hala : name < '6' ? boisko : domKultury;
    const cls = await prisma.schoolClass.create({ data: { name, defaultAssemblyPointId: point!.id } });
    classIds.set(name, cls.id);
  }

  console.log('Uczniowie i opiekunowie…');
  let students = 0;
  let studentNo = 0;
  for (const className of CLASSES) {
    for (let i = 0; i < 12; i++) {
      const girl = rand() < 0.5;
      const [lastM, lastF] = pick(LAST_NAMES);
      const firstName = girl ? pick(FIRST_NAMES_F) : pick(FIRST_NAMES_M);
      const lastName = girl ? lastF : lastM;
      studentNo++;

      await prisma.$transaction(async (tx) => {
        const student = await tx.student.create({
          data: { firstName, lastName, externalId: `DEMO-${String(studentNo).padStart(4, '0')}`, classId: classIds.get(className)! },
        });
        // Starsze klasy: większość uczniów ma własny telefon (grupa "Uczniowie").
        if ((className === '7A' || className === '8A') && studentNo % 4 !== 0) {
          const own = nextPhone();
          await tx.student.update({
            where: { id: student.id },
            data: { phoneEnc: fieldCrypto.encrypt(own, CTX.studentPhone), phoneHmac: fieldCrypto.blindIndex(own, CTX.studentPhone) },
          });
        }
        // Co ~15. uczeń bez numeru opiekuna (żeby ostrzeżenia było widać), część z jednym opiekunem.
        if (studentNo % 15 === 0) return;
        const mother = await findOrCreateGuardian(tx, nextPhone(), `${pick(PARENT_F)} ${lastF}`);
        await tx.studentGuardian.create({ data: { studentId: student.id, guardianId: mother.id, priority: 1 } });
        if (studentNo % 3 !== 0) {
          const father = await findOrCreateGuardian(tx, nextPhone(), `${pick(PARENT_M)} ${lastM}`);
          await tx.studentGuardian.create({ data: { studentId: student.id, guardianId: father.id, priority: 2 } });
        }
      });
      students++;
    }
  }

  // Rodzeństwo: drugi uczeń z tym samym opiekunem (jeden numer = jeden opiekun).
  const someGuardian = await prisma.guardian.findFirst({ orderBy: { id: 'asc' } });
  if (someGuardian) {
    const sibling = await prisma.student.create({
      data: { firstName: 'Tymon', lastName: 'Nowak', externalId: 'DEMO-9999', classId: classIds.get('7A')! },
    });
    await prisma.studentGuardian.create({ data: { studentId: sibling.id, guardianId: someGuardian.id, priority: 1 } });
    students++;
  }

  console.log('Nauczyciele…');
  const TEACHERS: [string, string, string][] = [
    ['Barbara', 'Kowalczyk', 'dyrektor'],
    ['Grażyna', 'Wójcik', 'wicedyrektor'],
    ['Teresa', 'Mazur', 'sekretariat'],
    ...CLASSES.map((c, i): [string, string, string] => [pick(PARENT_F), LAST_NAMES[(i + 3) % LAST_NAMES.length]![1], `wychowawca ${c}`]),
  ];
  for (const [firstName, lastName, position] of TEACHERS) {
    const phone = nextPhone();
    await prisma.teacher.create({
      data: {
        firstName,
        lastName,
        position,
        phoneEnc: fieldCrypto.encrypt(phone, CTX.teacherPhone),
        phoneHmac: fieldCrypto.blindIndex(phone, CTX.teacherPhone),
      },
    });
  }

  console.log('Konta…');
  const passwordHash = await hashSecret(seedPassword!);
  await prisma.user.createMany({
    data: [
      { email: 'admin@szkola.test', fullName: 'Adam Administrator', role: 'ADMIN', passwordHash },
      { email: 'dyrektor@szkola.test', fullName: 'Dorota Dyrektor', role: 'DYREKCJA', passwordHash },
      { email: 'nauczyciel@szkola.test', fullName: 'Norbert Nauczyciel', role: 'NAUCZYCIEL', passwordHash },
    ],
  });

  await writeAudit({ action: 'seed.demo_data', details: { students, classes: CLASSES.length, teachers: TEACHERS.length } });
  console.log(`Gotowe: ${CLASSES.length} klas, ${students} uczniów, ${TEACHERS.length} nauczycieli, ${phoneCounter} numerów, 3 punkty zbiórki.`);
  console.log('Konta: admin@szkola.test, dyrektor@szkola.test, nauczyciel@szkola.test – hasło: SEED_PASSWORD z .env');
}

await main();
await prisma.$disconnect();
