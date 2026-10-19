import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { DashboardDto } from '@alert/shared';
import { Card, Loading, Notice, PageHeader } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { plural } from '../lib/format';
import { formatTime, useActiveAlert } from '../lib/hooks';

function Stat({ label, value, to }: { label: string; value: number; to?: string }) {
  const body = (
    <>
      <div className="text-3xl font-black">{value}</div>
      <div className="font-semibold text-muted">{label}</div>
    </>
  );
  return to ? (
    <Link to={to} className="rounded-xl border-2 border-line bg-surface p-4 hover:border-ink">
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border-2 border-line bg-surface p-4">{body}</div>
  );
}

export function DashboardPage() {
  const { me, hasRole } = useAuth();
  const isSender = hasRole('ADMIN', 'DYREKCJA');
  const active = useActiveAlert();
  const { data, error, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardDto>('/dashboard'),
    enabled: isSender,
  });

  if (!isSender) {
    return (
      <>
        <PageHeader title="Pulpit" />
        {active.data ? (
          <Link
            to="/obecnosc"
            className={`block rounded-xl border-4 p-6 text-center text-2xl font-black text-white ${active.data.mode === 'DRILL' ? 'border-warn bg-warn' : 'border-alarm-dark bg-alarm'}`}
          >
            {active.data.mode === 'DRILL' ? 'ĆWICZENIA' : 'ALARM'}: {active.data.eventLabel}
            <span className="mt-2 block text-lg">Otwórz listę obecności →</span>
          </Link>
        ) : (
          <Card>
            <p className="text-lg">
              Brak aktywnego alertu. Gdy dyrekcja uruchomi alarm lub ćwiczenia, tutaj pojawi się przycisk do <strong>listy obecności</strong>.
            </p>
            <p className="mt-2 text-muted">Wskazówka: dodaj tę stronę do ekranu głównego telefonu – lista działa także bez zasięgu.</p>
          </Card>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Pulpit">{data?.school.name}</PageHeader>

      {active.data ? (
        <Link
          to={`/alarm/${active.data.id}`}
          className={`mb-6 block rounded-xl border-4 p-6 text-center text-white ${active.data.mode === 'DRILL' ? 'border-warn bg-warn' : 'border-alarm-dark bg-alarm'}`}
        >
          <span className="block text-sm font-black uppercase tracking-widest">
            {active.data.mode === 'DRILL' ? 'Trwają ćwiczenia' : 'Trwa alarm'} · od {formatTime(active.data.startedAt)}
          </span>
          <span className="block text-3xl font-black">{active.data.eventLabel}</span>
          <span className="mt-2 block text-lg font-semibold">
            SMS doręczone {active.data.deliveries.DELIVERED}/{active.data.deliveries.total} · obecni {active.data.attendance.PRESENT}/
            {active.data.attendance.total} → Otwórz centrum alertu
          </span>
        </Link>
      ) : (
        <div className="mb-6 rounded-xl border-4 border-alarm bg-surface p-4 sm:p-6">
          <Link
            to="/alarm/nowy"
            className="block w-full rounded-xl bg-alarm px-6 py-8 text-center text-2xl font-black tracking-wide text-white hover:bg-alarm-dark sm:text-3xl"
          >
            ROZPOCZNIJ EWAKUACJĘ
          </Link>
          <Link
            to="/alarm/nowy?tryb=cwiczenia"
            className="mt-3 block w-full rounded-xl border-4 border-warn bg-warn-bg px-6 py-3 text-center text-lg font-black text-warn"
          >
            ĆWICZENIA (bez SMS do rodziców)
          </Link>
          <p className="mt-3 text-center text-muted">Start wymaga PIN-u alarmowego. Przed wysłaniem zobaczysz podgląd SMS-a i liczbę odbiorców.</p>
        </div>
      )}

      {isLoading && <Loading />}
      {error && <Notice tone="error">{errorMessage(error)}</Notice>}
      {data && (
        <div className="flex flex-col gap-4">
          <Readiness data={data} hasPin={me!.user.hasLaunchPin} />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="klas" value={data.counts.classes} to="/klasy" />
            <Stat label="uczniów" value={data.counts.students} to="/uczniowie" />
            <Stat label="numerów opiekunów" value={data.counts.guardians} />
            <Stat label="punktów zbiórki" value={data.counts.assemblyPoints} to="/punkty-zbiorki" />
          </div>
        </div>
      )}
    </>
  );
}

/** Lista braków, które trzeba usunąć przed prawdziwym alarmem. */
function Readiness({ data, hasPin }: { data: DashboardDto; hasPin: boolean }) {
  const problems: { text: string; to: string }[] = [];
  if (!data.school.configured) problems.push({ text: 'Uzupełnij dane szkoły (nazwa w SMS, telefon kontaktowy, nadawca).', to: '/szkola' });
  if (data.counts.assemblyPoints === 0) problems.push({ text: 'Dodaj co najmniej jeden punkt zbiórki.', to: '/punkty-zbiorki' });
  if (data.counts.classesWithoutAssemblyPoint > 0)
    problems.push({
      text: `${plural(data.counts.classesWithoutAssemblyPoint, 'klasa nie ma', 'klasy nie mają', 'klas nie ma')} domyślnego punktu zbiórki.`,
      to: '/klasy',
    });
  if (data.counts.studentsWithoutPhone > 0)
    problems.push({
      text: `${plural(data.counts.studentsWithoutPhone, 'uczeń nie ma', 'uczniów nie ma', 'uczniów nie ma')} numeru opiekuna – ich rodzice nie dostaną SMS.`,
      to: '/uczniowie?bezTelefonu=1',
    });
  if (!hasPin) problems.push({ text: 'Ustaw swój PIN alarmowy (potrzebny do uruchomienia alertu).', to: '/konto' });

  if (problems.length === 0) return <Notice tone="success">Dane są kompletne.</Notice>;
  return (
    <Notice tone="warning">
      <p className="mb-2 font-bold">Do uzupełnienia przed alarmem:</p>
      <ul className="flex flex-col gap-1">
        {problems.map((p) => (
          <li key={p.text}>
            <Link to={p.to} className="underline">
              {p.text}
            </Link>
          </li>
        ))}
      </ul>
    </Notice>
  );
}
