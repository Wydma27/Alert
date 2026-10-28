import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { DashboardDto } from '@alert/shared';
import { Icon, type IconName } from '../components/icons';
import { Card, Loading, Notice, PageHeader } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { plural } from '../lib/format';
import { formatTime, useActiveAlert } from '../lib/hooks';
import { CHANGE_EVENT, getMeta, offlineSupported, type OfflineMeta } from '../lib/offline';

function Stat({ label, value, to, icon }: { label: string; value: number; to: string; icon: IconName }) {
  return (
    <Link
      to={to}
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card transition hover:border-ink hover:shadow-lift sm:flex-row sm:items-center"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-ink">
        <Icon name={icon} className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-3xl leading-tight font-black tabular-nums">{value}</span>
        <span className="block font-semibold text-muted">{label}</span>
      </span>
    </Link>
  );
}

/** Baner trwającego alertu / ćwiczeń – prowadzi do centrum alertu albo listy obecności. */
function ActiveAlertBanner({ to, drill, children }: { to: string; drill: boolean; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={`mb-6 flex flex-col items-center gap-3 rounded-3xl border-2 p-6 text-center text-white shadow-lift sm:flex-row sm:text-left ${drill ? 'border-warn bg-warn' : 'border-alarm-dark bg-alarm'}`}
    >
      <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white/15">
        <Icon name="siren" className="size-9" />
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      <Icon name="chevron" className="hidden size-8 sm:block" />
    </Link>
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
          <ActiveAlertBanner to="/obecnosc" drill={active.data.mode === 'DRILL'}>
            <span className="block text-2xl font-black">
              {active.data.mode === 'DRILL' ? 'ĆWICZENIA' : 'ALARM'}: {active.data.eventLabel}
            </span>
            <span className="mt-1 block text-lg font-semibold">Otwórz listę obecności →</span>
          </ActiveAlertBanner>
        ) : (
          <Card className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-green-50 text-ok">
              <Icon name="check" className="size-6" />
            </span>
            <div>
              <p className="text-lg">
                Brak aktywnego alertu. Gdy dyrekcja uruchomi alarm lub ćwiczenia, tutaj pojawi się przycisk do <strong>listy obecności</strong>.
              </p>
              <p className="mt-2 text-muted">Wskazówka: dodaj tę stronę do ekranu głównego telefonu – lista działa także bez zasięgu.</p>
            </div>
          </Card>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Pulpit">{data?.school.name}</PageHeader>

      {active.data ? (
        <ActiveAlertBanner to={`/alarm/${active.data.id}`} drill={active.data.mode === 'DRILL'}>
          <span className="block text-sm font-black uppercase tracking-widest">
            {active.data.mode === 'DRILL' ? 'Trwają ćwiczenia' : 'Trwa alarm'} · od {formatTime(active.data.startedAt)}
          </span>
          <span className="block text-3xl font-black">{active.data.eventLabel}</span>
          <span className="mt-2 block text-lg font-semibold">
            SMS doręczone {active.data.deliveries.DELIVERED}/{active.data.deliveries.total} · obecni {active.data.attendance.PRESENT}/
            {active.data.attendance.total} → Otwórz centrum alertu
          </span>
        </ActiveAlertBanner>
      ) : (
        <div className="mb-6 grid gap-4 lg:grid-cols-3">
          <section aria-label="Alarm" className="rounded-3xl border-2 border-alarm/30 bg-surface p-4 shadow-card sm:p-6 lg:col-span-2">
            <Link
              to="/alarm/nowy"
              className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-alarm-dark bg-alarm px-6 py-8 text-center text-white shadow-lift transition-colors hover:bg-alarm-dark sm:flex-row sm:gap-5 sm:py-10"
            >
              <Icon name="siren" className="size-11 sm:size-12" />
              <span className="text-2xl font-black tracking-wide sm:text-3xl">ROZPOCZNIJ EWAKUACJĘ</span>
            </Link>
            <Link
              to="/alarm/nowy?tryb=cwiczenia"
              className="mt-3 block w-full rounded-2xl border-2 border-warn/60 bg-warn-bg px-6 py-3 text-center text-lg font-black text-warn transition-colors hover:border-warn"
            >
              ĆWICZENIA (bez SMS do rodziców)
            </Link>
            <p className="mt-4 text-center text-muted">
              <Icon name="lock" className="mr-1.5 inline size-4 align-[-0.15em]" />
              Start wymaga PIN-u alarmowego. Przed wysłaniem zobaczysz podgląd SMS-a i liczbę odbiorców.
            </p>
          </section>

          <Link
            to="/wiadomosci/nowa"
            className="group flex flex-col gap-4 rounded-3xl border-2 border-line bg-surface p-5 shadow-card transition hover:border-ink hover:shadow-lift sm:p-6"
          >
            <span className="grid size-14 place-items-center rounded-2xl bg-ink text-white">
              <Icon name="send" className="size-7" />
            </span>
            <span className="flex-1">
              <span className="block text-2xl font-black">WYŚLIJ SMS</span>
              <span className="mt-1 block font-semibold text-muted">nauczyciele · uczniowie · rodzice – całe grupy, klasy albo wybrane osoby</span>
            </span>
            <span className="inline-flex items-center gap-1 font-bold">
              Nowa wiadomość
              <Icon name="chevron" className="size-5 transition-transform group-hover:translate-x-1" />
            </span>
          </Link>
        </div>
      )}

      {isLoading && <Loading />}
      {error && <Notice tone="error">{errorMessage(error)}</Notice>}
      {data && (
        <div className="flex flex-col gap-4">
          <Readiness data={data} hasPin={me!.user.hasLaunchPin} />
          <OfflineReminder />
          <h2 className="mt-2 text-lg font-bold">Baza kontaktów</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat icon="teacher" label="nauczycieli" value={data.counts.teachers} to="/nauczyciele" />
            <Stat
              icon="students"
              label={`uczniów (z własnym numerem: ${data.counts.studentsWithOwnPhone})`}
              value={data.counts.students}
              to="/uczniowie"
            />
            <Stat icon="users" label="rodziców (numerów)" value={data.counts.guardians} to="/uczniowie" />
            <Stat icon="grid" label="klas" value={data.counts.classes} to="/klasy" />
            <Stat icon="pin" label="punktów zbiórki" value={data.counts.assemblyPoints} to="/punkty-zbiorki" />
            <Stat icon="inbox" label="wysłanych wiadomości" value={data.counts.notices} to="/wiadomosci" />
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
    <section className="rounded-2xl border border-warn/40 bg-warn-bg p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 font-bold text-warn">
        <Icon name="warning" className="size-5" />
        Do uzupełnienia przed alarmem:
      </h2>
      <ul className="flex flex-col gap-2">
        {problems.map((p) => (
          <li key={p.text}>
            <Link
              to={p.to}
              className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-warn/20 bg-surface px-4 py-2 font-semibold text-ink shadow-card transition hover:border-warn"
            >
              {p.text}
              <Icon name="chevron" className="size-5 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
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
