import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ATTENDANCE_LABELS,
  type AttendanceOverviewDto,
  type AttendanceStudentDto,
  type AttendanceValue,
} from '@alert/shared';
import { Button, Field, Loading, Modal, Notice, PageHeader, TextInput } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatTime, useAlertEvents, useOnline } from '../lib/hooks';
import { enqueue, fetchWithCache, flush, pending, usePendingCount } from '../lib/outbox';

const TILE: Record<AttendanceValue, string> = {
  UNKNOWN: 'border-line bg-surface',
  PRESENT: 'border-ok bg-green-100',
  ABSENT_TODAY: 'border-slate-400 bg-slate-200 text-muted',
  MISSING: 'border-alarm bg-alarm text-white',
  PICKED_UP: 'border-ink bg-slate-800 text-white',
};

/** Niewysłane zmiany z telefonu nakładamy na dane z serwera/pamięci – ekran nie cofa świeżych odhaczeń. */
function applyPending(list: AttendanceStudentDto[]): AttendanceStudentDto[] {
  const items = pending();
  return list.map((s) => {
    const item = items.find((i) => i.alertStudentId === s.id);
    if (!item) return s;
    const pickedUpByName =
      item.attendance === 'PICKED_UP'
        ? (item.pickedUpByName ?? s.pickupPersons.find((p) => p.guardianId === item.pickedUpByGuardianId)?.name ?? null)
        : null;
    return { ...s, attendance: item.attendance, attendanceAt: item.clientTime, pickedUpByName };
  });
}

function SyncBanner() {
  const online = useOnline();
  const count = usePendingCount();
  if (online && count === 0) return null;
  return (
    <div className="mb-3">
      <Notice tone="warning">
        {online ? `Wysyłanie zapisanych zmian: ${count}…` : `Brak sieci – zmiany zapisują się w telefonie${count ? ` (${count})` : ''} i wyślą się same.`}
      </Notice>
    </div>
  );
}

/** Wybór klasy w aktywnym alercie. */
export function AttendancePage() {
  const overview = useQuery({
    queryKey: ['attendance-overview'],
    queryFn: () => fetchWithCache<AttendanceOverviewDto>('attendance-overview', '/attendance/active'),
    refetchInterval: 10_000,
  });
  useAlertEvents(overview.data?.alert?.id, [['attendance-overview']]);

  if (overview.isLoading) return <Loading />;
  if (overview.error) return <Notice tone="error">{errorMessage(overview.error)}</Notice>;
  const data = overview.data!;
  if (!data.alert) {
    return (
      <>
        <PageHeader title="Lista obecności" />
        <Notice>Nie ma aktywnego alertu. Lista pojawi się tu automatycznie, gdy dyrekcja uruchomi alarm lub ćwiczenia.</Notice>
      </>
    );
  }
  const drill = data.alert.mode === 'DRILL';
  return (
    <>
      <SyncBanner />
      <div className={`mb-4 rounded-2xl border-2 p-3 ${drill ? 'border-warn bg-warn-bg' : 'border-alarm bg-red-50'}`}>
        <div className="text-sm font-black uppercase">{drill ? 'Ćwiczenia' : 'Alarm'} · od {formatTime(data.alert.startedAt)}</div>
        <h1 className="text-2xl font-black">Lista obecności – wybierz klasę</h1>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {data.classes.map((c) => {
          const done = c.attendance.PRESENT + c.attendance.PICKED_UP + c.attendance.ABSENT_TODAY;
          return (
            <li key={c.id}>
              <Link to={`/obecnosc/${c.id}`} className="block min-h-24 rounded-2xl border border-line bg-surface shadow-card p-3 hover:border-ink">
                <div className="text-2xl font-black">{c.className}</div>
                <div className="font-semibold">
                  {done} / {c.attendance.total}
                </div>
                <div className="truncate text-sm text-muted">{c.pointName}</div>
                {c.attendance.MISSING > 0 && <div className="mt-1 font-bold text-alarm">nieodnalezieni: {c.attendance.MISSING}</div>}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Odhaczanie uczniów jednej klasy – duże kafelki, działa offline. */
export function AttendanceClassPage() {
  const alertClassId = Number(useParams().alertClassId);
  const { hasRole } = useAuth();
  const queryClient = useQueryClient();
  const key = ['attendance-class', alertClassId];
  const overview = useQuery({
    queryKey: ['attendance-overview'],
    queryFn: () => fetchWithCache<AttendanceOverviewDto>('attendance-overview', '/attendance/active'),
  });
  const students = useQuery({
    queryKey: key,
    queryFn: async () =>
      applyPending(await fetchWithCache<AttendanceStudentDto[]>(`attendance-class-${alertClassId}`, `/attendance/class/${alertClassId}`)),
    refetchInterval: 10_000,
  });
  useAlertEvents(overview.data?.alert?.id, [key]);
  const [menuFor, setMenuFor] = useState<AttendanceStudentDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const cls = overview.data?.classes.find((c) => c.id === alertClassId);

  function mark(student: AttendanceStudentDto, attendance: AttendanceValue, pickup?: { guardianId?: number; name?: string }) {
    const item = {
      alertStudentId: student.id,
      attendance,
      pickedUpByGuardianId: pickup?.guardianId ?? null,
      pickedUpByName: pickup?.name ?? null,
      clientTime: new Date().toISOString(),
    };
    // Najpierw do kolejki w telefonie (przetrwa brak sieci), od razu na ekranie, potem na serwer.
    enqueue(item);
    queryClient.setQueryData<AttendanceStudentDto[]>(key, (list) => (list ? applyPending(list) : list));
    void flush().then(({ rejected }) => {
      if (rejected.length) {
        setNotice(rejected.join(' '));
        void queryClient.invalidateQueries({ queryKey: key });
      }
    });
    setMenuFor(null);
  }

  if (students.isLoading) return <Loading />;
  if (students.error) return <Notice tone="error">{errorMessage(students.error)}</Notice>;
  if (overview.data && !cls) {
    return (
      <>
        <PageHeader title="Lista obecności" />
        <Notice>
          Alert został zakończony – lista obecności jest zamknięta.{' '}
          <Link to="/obecnosc" className="underline">
            Wróć
          </Link>
        </Notice>
      </>
    );
  }
  const list = students.data ?? [];
  const counts = list.reduce(
    (acc, s) => ({ ...acc, [s.attendance]: (acc[s.attendance] ?? 0) + 1 }),
    {} as Partial<Record<AttendanceValue, number>>,
  );

  return (
    <div className="pb-6">
      <SyncBanner />
      <Link to={hasRole('ADMIN', 'DYREKCJA') && overview.data?.alert ? `/alarm/${overview.data.alert.id}` : '/obecnosc'} className="mb-2 inline-block font-semibold underline">
        ← {hasRole('ADMIN', 'DYREKCJA') ? 'Centrum alertu' : 'Wszystkie klasy'}
      </Link>
      <header className="sticky top-[71px] z-10 -mx-4 mb-3 border-b border-line bg-page px-4 py-2">
        <h1 className="text-2xl font-black">
          Klasa {cls?.className ?? ''} <span className="text-lg font-semibold text-muted">· {cls?.pointName}</span>
        </h1>
        <p className="font-semibold">
          obecni {counts.PRESENT ?? 0} · odebrani {counts.PICKED_UP ?? 0} · nieobecni {counts.ABSENT_TODAY ?? 0} ·{' '}
          <span className={counts.MISSING ? 'text-alarm' : ''}>nieodnalezieni {counts.MISSING ?? 0}</span> · do sprawdzenia {counts.UNKNOWN ?? 0}
        </p>
      </header>
      {notice && (
        <div className="mb-3">
          <Notice tone="error">{notice}</Notice>
        </div>
      )}
      <p className="mb-3 text-muted">Dotknij ucznia = obecny. „Więcej” = nieobecny, nieodnaleziony, odbiór przez rodzica.</p>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((s) => (
          <li key={s.id} className={`flex items-stretch overflow-hidden rounded-xl border-4 ${TILE[s.attendance]}`}>
            <button
              type="button"
              className="flex min-h-16 flex-1 flex-col justify-center px-3 text-left"
              onClick={() => (s.attendance === 'PRESENT' ? setMenuFor(s) : mark(s, 'PRESENT'))}
            >
              <span className="text-lg font-bold">
                {s.lastName} {s.firstName}
              </span>
              <span className="text-sm font-semibold">
                {ATTENDANCE_LABELS[s.attendance]}
                {s.attendance !== 'UNKNOWN' && ` · ${formatTime(s.attendanceAt)}`}
                {s.pickedUpByName && ` · ${s.pickedUpByName}`}
              </span>
            </button>
            <button
              type="button"
              className="min-w-16 border-l-2 border-current/30 px-3 font-bold"
              onClick={() => setMenuFor(s)}
              aria-label={`Więcej opcji: ${s.firstName} ${s.lastName}`}
            >
              Więcej
            </button>
          </li>
        ))}
      </ul>

      {menuFor && <StudentMenu student={menuFor} onMark={(a, p) => mark(menuFor, a, p)} onClose={() => setMenuFor(null)} />}
    </div>
  );
}

function StudentMenu({
  student,
  onMark,
  onClose,
}: {
  student: AttendanceStudentDto;
  onMark: (a: AttendanceValue, pickup?: { guardianId?: number; name?: string }) => void;
  onClose: () => void;
}) {
  const [pickupMode, setPickupMode] = useState(false);
  const [otherName, setOtherName] = useState('');
  return (
    <Modal open title={`${student.firstName} ${student.lastName}`} onClose={onClose}>
      {!pickupMode ? (
        <div className="flex flex-col gap-2">
          <Button className="!border-ok !bg-ok" onClick={() => onMark('PRESENT')}>
            Obecny w punkcie zbiórki
          </Button>
          <Button variant="secondary" onClick={() => setPickupMode(true)}>
            Odebrany przez opiekuna…
          </Button>
          <Button variant="secondary" onClick={() => onMark('ABSENT_TODAY')}>
            Nieobecny dziś w szkole
          </Button>
          <Button variant="danger" onClick={() => onMark('MISSING')}>
            NIEODNALEZIONY – zgłoś dyrekcji
          </Button>
          <Button variant="ghost" onClick={() => onMark('UNKNOWN')}>
            Cofnij (nie sprawdzono)
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">Kto odbiera dziecko? Sprawdź dokument tożsamości.</p>
          {student.pickupPersons.map((p) =>
            p.canPickUp ? (
              <Button key={p.guardianId} variant="secondary" onClick={() => onMark('PICKED_UP', { guardianId: p.guardianId })}>
                {p.name}
              </Button>
            ) : (
              <div key={p.guardianId} className="rounded-lg border-4 border-alarm bg-red-50 p-3 font-bold text-alarm">
                {p.name} – NIE MOŻE ODEBRAĆ DZIECKA
              </div>
            ),
          )}
          {student.pickupPersons.length === 0 && <Notice tone="warning">Brak zapisanych opiekunów – ustal tożsamość osoby i wpisz ją poniżej.</Notice>}
          <form
            className="mt-2 flex flex-col gap-2 border-t border-line pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (otherName.trim()) onMark('PICKED_UP', { name: otherName.trim() });
            }}
          >
            <Field label="Inna osoba upoważniona (imię, nazwisko)">
              {(id) => <TextInput id={id} value={otherName} onChange={(e) => setOtherName(e.target.value)} />}
            </Field>
            <Button type="submit" variant="secondary" disabled={!otherName.trim()}>
              Zapisz odbiór
            </Button>
          </form>
          <Button variant="ghost" onClick={() => setPickupMode(false)}>
            ← Wstecz
          </Button>
        </div>
      )}
    </Modal>
  );
}
