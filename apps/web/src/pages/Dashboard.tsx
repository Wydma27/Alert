import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { DashboardDto } from '@alert/shared';
import { Card, Loading, Notice, PageHeader } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { plural } from '../lib/format';
import { formatTime, useActiveAlert } from '../lib/hooks';
import { CHANGE_EVENT, getMeta, offlineSupported, type OfflineMeta } from '../lib/offline';

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

      <Link
        to="/wiadomosci/nowa"
        className="mb-6 block rounded-xl border-4 border-ink bg-surface px-6 py-5 text-center hover:bg-neutral-100"
      >
        <span className="block text-2xl font-black">WYŚLIJ SMS</span>
        <span className="block font-semibold text-muted">nauczyciele · uczniowie · rodzice – całe grupy, klasy albo wybrane osoby</span>
      </Link>

      {isLoading && <Loading />}
      {error && <Notice tone="error">{errorMessage(error)}</Notice>}
      {data && (
        <div className="flex flex-col gap-4">
          <Readiness data={data} hasPin={me!.user.hasLaunchPin} />
          <OfflineReminder />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="nauczycieli" value={data.counts.teachers} to="/nauczyciele" />
            <Stat label={`uczniów (z własnym numerem: ${data.counts.studentsWithOwnPhone})`} value={data.counts.students} to="/uczniowie" />
            <Stat label="rodziców (numerów)" value={data.counts.guardians} to="/uczniowie" />
            <Stat label="klas" value={data.counts.classes} to="/klasy" />
            <Stat label="punktów zbiórki" value={data.counts.assemblyPoints} to="/punkty-zbiorki" />
            <Stat label="wysłanych wiadomości" value={data.counts.notices} to="/wiadomosci" />
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

/** Kopia kontaktów w tym urządzeniu – do wysyłki, gdy serwer nie działa. */
function OfflineReminder() {
  const { me } = useAuth();
  const [meta, setMeta] = useState<OfflineMeta | null | undefined>(undefined);
  useEffect(() => {
    const load = () => void getMeta().then(setMeta);
    load();
    window.addEventListener(CHANGE_EVENT, load);
    return () => window.removeEventListener(CHANGE_EVENT, load);
  }, []);
  if (!offlineSupported() || meta === undefined) return null;
  if (meta && meta.userId === me?.user.id && meta.syncedAt) {
    return (
      <p className="text-muted">
        Kopia kontaktów w tym urządzeniu: {new Date(meta.syncedAt).toLocaleString('pl-PL')} ({meta.people}).{' '}
        <Link to="/awaryjny" className="underline">
          Tryb awaryjny
        </Link>
      </p>
    );
  }
  return (
    <Notice tone="info">
      Włącz <Link to="/konto" className="underline">kopię kontaktów w tym urządzeniu</Link> – SMS-y wyślesz wtedy nawet przy awarii serwera lub bazy
      danych.
    </Notice>
  );
}
