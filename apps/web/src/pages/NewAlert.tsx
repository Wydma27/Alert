import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { AlertDraft, AlertPreviewDto, AlertScopeValue, StudentListItemDto } from '@alert/shared';
import { PinModal } from '../components/PinModal';
import { SmsBubble, SmsCounter } from '../components/SmsCounter';
import { Badge, Button, Card, Checkbox, Field, Loading, Notice, Select, TextInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { plural } from '../lib/format';

interface Defaults {
  pickupInstruction: string;
  classes: { id: number; name: string; defaultAssemblyPointId: number | null; students: number }[];
  points: { id: number; name: string; address: string }[];
  eventTypes: { id: number; label: string; smsLabel: string }[];
  testNumbers: number;
  hasPin: boolean;
}

const STEPS = ['Co się dzieje?', 'Kogo dotyczy?', 'Dokąd?', 'Sprawdź i wyślij'];

export function NewAlertPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const defaults = useQuery({ queryKey: ['alert-defaults'], queryFn: () => api.get<Defaults>('/alerts/defaults') });
  const [step, setStep] = useState(0);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState<AlertDraft>({
    mode: params.get('tryb') === 'cwiczenia' ? 'DRILL' : 'REAL',
    eventTypeId: null,
    eventCustom: null,
    scope: 'SCHOOL',
    classIds: [],
    studentIds: [],
    points: {},
    pickupInstruction: '',
    sendConfirmations: true,
  });
  const [selectedStudents, setSelectedStudents] = useState<StudentListItemDto[]>([]);
  const [pinOpen, setPinOpen] = useState(false);

  useEffect(() => {
    if (defaults.data && !draft.pickupInstruction) setDraft((d) => ({ ...d, pickupInstruction: defaults.data.pickupInstruction }));
  }, [defaults.data, draft.pickupInstruction]);

  const update = (patch: Partial<AlertDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const drill = draft.mode === 'DRILL';

  /** Klasy objęte zakresem – dla nich wybieramy punkty zbiórki. */
  const classesInScope = useMemo(() => {
    const all = defaults.data?.classes ?? [];
    if (draft.scope === 'SCHOOL') return all;
    if (draft.scope === 'CLASSES') return all.filter((c) => draft.classIds.includes(c.id));
    const ids = new Set(selectedStudents.map((s) => s.classId));
    return all.filter((c) => ids.has(c.id));
  }, [defaults.data, draft.scope, draft.classIds, selectedStudents]);

  const pointFor = (classId: number) =>
    draft.points[String(classId)] ?? defaults.data?.classes.find((c) => c.id === classId)?.defaultAssemblyPointId ?? null;

  const stepValid = [
    draft.eventTypeId !== null || !!draft.eventCustom?.trim(),
    draft.scope === 'SCHOOL' || (draft.scope === 'CLASSES' ? draft.classIds.length > 0 : draft.studentIds.length > 0),
    classesInScope.every((c) => pointFor(c.id)) && draft.pickupInstruction.trim().length >= 3,
    true,
  ];

  const payload = (): AlertDraft => ({
    ...draft,
    eventCustom: draft.eventCustom?.trim() || null,
    eventTypeId: draft.eventCustom?.trim() ? null : draft.eventTypeId,
    points: Object.fromEntries(classesInScope.map((c) => [String(c.id), pointFor(c.id)!])),
  });

  const preview = useQuery({
    queryKey: ['alert-preview', JSON.stringify(payload())],
    queryFn: () => api.post<AlertPreviewDto>('/alerts/preview', payload()),
    enabled: step === 3,
    retry: false,
  });

  const start = useMutation({
    mutationFn: (pin: string) => api.post<{ id: number }>('/alerts', { ...payload(), pin, idempotencyKey }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['active-alert'] });
      navigate(`/alarm/${res.id}`, { replace: true });
    },
  });

  if (defaults.isLoading) return <Loading />;
  if (defaults.error || !defaults.data) return <Notice tone="error">{errorMessage(defaults.error)}</Notice>;
  const d = defaults.data;

  return (
    <div className="mx-auto max-w-3xl pb-28">
      <div className={`mb-4 rounded-2xl border-2 p-4 ${drill ? 'border-warn bg-warn-bg' : 'border-alarm bg-red-50'}`}>
        <div className="text-sm font-bold uppercase tracking-wide text-muted">
          Krok {step + 1} z {STEPS.length}
        </div>
        <h1 className="text-2xl font-black">{STEPS[step]}</h1>
        <div className="mt-2 flex gap-1" aria-hidden>
          {STEPS.map((_, i) => (
            <div key={i} className={`h-2 flex-1 rounded ${i <= step ? (drill ? 'bg-warn' : 'bg-alarm') : 'bg-slate-300'}`} />
          ))}
        </div>
      </div>

      {!d.hasPin && (
        <div className="mb-4">
          <Notice tone="error">
            Nie masz ustawionego PIN-u alarmowego – bez niego nie wyślesz alertu.{' '}
            <Link to="/konto" className="underline">
              Ustaw PIN
            </Link>
          </Notice>
        </div>
      )}

      {step === 0 && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <ChoiceButton active={!drill} tone="alarm" onClick={() => update({ mode: 'REAL' })}>
              PRAWDZIWY ALARM
            </ChoiceButton>
            <ChoiceButton active={drill} tone="warn" onClick={() => update({ mode: 'DRILL' })}>
              ĆWICZENIA
            </ChoiceButton>
          </div>
          {drill && (
            <Notice tone="warning">
              Ćwiczenia: rodzice NIE dostaną SMS-ów (tylko symulacja). Przykładowy SMS z dopiskiem „CWICZENIA” trafi na{' '}
              {plural(d.testNumbers, 'numer testowy', 'numery testowe', 'numerów testowych')}.
            </Notice>
          )}
          <h2 className="text-lg font-bold">Rodzaj zdarzenia</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {d.eventTypes.map((e) => (
              <ChoiceButton
                key={e.id}
                active={draft.eventTypeId === e.id && !draft.eventCustom}
                onClick={() => update({ eventTypeId: e.id, eventCustom: null })}
              >
                {e.label}
              </ChoiceButton>
            ))}
          </div>
          <Field label="…albo własny krótki opis (trafi do SMS)" hint="Np. „ulatnianie gazu”. Bez polskich znaków SMS jest tańszy.">
            {(id) => (
              <TextInput id={id} maxLength={60} value={draft.eventCustom ?? ''} onChange={(e) => update({ eventCustom: e.target.value })} />
            )}
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(
              [
                ['SCHOOL', 'Cała szkoła'],
                ['CLASSES', 'Wybrane klasy'],
                ['STUDENTS', 'Wybrani uczniowie'],
              ] as [AlertScopeValue, string][]
            ).map(([scope, label]) => (
              <ChoiceButton key={scope} active={draft.scope === scope} onClick={() => update({ scope })}>
                {label}
              </ChoiceButton>
            ))}
          </div>
          {draft.scope === 'SCHOOL' && (
            <Notice>
              {plural(d.classes.length, 'klasa', 'klasy', 'klas')}, {plural(d.classes.reduce((n, c) => n + c.students, 0), 'uczeń', 'uczniów', 'uczniów')}.
            </Notice>
          )}
          {draft.scope === 'CLASSES' && (
            <Card>
              <div className="mb-2 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => update({ classIds: d.classes.map((c) => c.id) })}>
                  Zaznacz wszystkie
                </Button>
                <Button variant="ghost" onClick={() => update({ classIds: [] })}>
                  Odznacz
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-4">
                {d.classes.map((c) => (
                  <Checkbox
                    key={c.id}
                    label={
                      <>
                        <strong>{c.name}</strong> <span className="text-muted">({c.students})</span>
                      </>
                    }
                    checked={draft.classIds.includes(c.id)}
                    onChange={(e) =>
                      update({ classIds: e.target.checked ? [...draft.classIds, c.id] : draft.classIds.filter((x) => x !== c.id) })
                    }
                  />
                ))}
              </div>
            </Card>
          )}
          {draft.scope === 'STUDENTS' && (
            <StudentPicker
              selected={selectedStudents}
              onChange={(list) => {
                setSelectedStudents(list);
                update({ studentIds: list.map((s) => s.id) });
              }}
            />
          )}
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <Card>
            <Field label="Ustaw wszystkim klasom">
              {(id) => (
                <Select
                  id={id}
                  value=""
                  onChange={(e) => {
                    const pointId = Number(e.target.value);
                    if (pointId) update({ points: Object.fromEntries(classesInScope.map((c) => [String(c.id), pointId])) });
                  }}
                >
                  <option value="">— wybierz, aby ustawić wszystkim —</option>
                  {d.points.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </Card>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            {classesInScope.map((c) => (
              <li key={c.id} className="flex items-center gap-3 p-3">
                <span className="w-12 text-lg font-black">{c.name}</span>
                <Select
                  aria-label={`Punkt zbiórki klasy ${c.name}`}
                  value={pointFor(c.id) ?? ''}
                  onChange={(e) => update({ points: { ...draft.points, [String(c.id)]: Number(e.target.value) } })}
                  className={pointFor(c.id) ? '' : 'border-alarm'}
                >
                  <option value="">— wybierz punkt —</option>
                  {d.points.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
          <Field label="Odbiór dziecka (trafi do SMS)" hint="Krótko – każdy znak kosztuje.">
            {(id) => (
              <TextInput id={id} maxLength={150} value={draft.pickupInstruction} onChange={(e) => update({ pickupInstruction: e.target.value })} />
            )}
          </Field>
          <Checkbox
            label="Wysyłaj potwierdzenie „dziecko jest obecne w punkcie zbiórki” po odhaczeniu przez nauczyciela"
            checked={draft.sendConfirmations}
            onChange={(e) => update({ sendConfirmations: e.target.checked })}
          />
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          {preview.isLoading && <Loading />}
          {preview.error && <Notice tone="error">{errorMessage(preview.error)}</Notice>}
          {preview.data && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile label="uczniów" value={preview.data.students} />
                <Tile label={drill ? 'SMS (symulacja)' : 'SMS do rodziców'} value={preview.data.recipients} />
                <Tile label="części SMS łącznie" value={preview.data.smsParts} />
                <Tile label="bez numeru" value={preview.data.studentsWithoutPhone} warn={preview.data.studentsWithoutPhone > 0} />
              </div>
              {preview.data.warnings.map((w) => (
                <Notice key={w} tone="warning">
                  {w}
                </Notice>
              ))}
              <Card>
                <h2 className="mb-2 font-bold">Przykładowy SMS</h2>
                <SmsBubble text={preview.data.sample} />
                <div className="mt-3">
                  <SmsCounter info={preview.data.sampleInfo} />
                </div>
              </Card>
              <Card>
                <h2 className="mb-2 font-bold">Klasy i punkty zbiórki</h2>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {preview.data.classes.map((c) => (
                    <li key={c.classId}>
                      <strong>{c.className}</strong> ({c.students}) → {c.pointName}
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          )}
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 p-3 shadow-[0_-6px_16px_-6px_rgb(15_23_42/0.15)] backdrop-blur">
        <div className="mx-auto flex max-w-3xl gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => (step === 0 ? navigate('/') : setStep(step - 1))}>
            {step === 0 ? 'Anuluj' : 'Wstecz'}
          </Button>
          {step < 3 ? (
            <Button className="flex-[2]" disabled={!stepValid[step]} onClick={() => setStep(step + 1)}>
              Dalej
            </Button>
          ) : (
            <Button
              variant={drill ? 'primary' : 'danger'}
              className={`flex-[2] text-lg ${drill ? '!border-warn !bg-warn' : ''}`}
              disabled={!preview.data || !d.hasPin}
              onClick={() => {
                start.reset();
                setPinOpen(true);
              }}
            >
              {drill ? 'ROZPOCZNIJ ĆWICZENIA' : 'WYŚLIJ ALERT'}
            </Button>
          )}
        </div>
      </div>

      <PinModal
        open={pinOpen}
        title={drill ? 'Rozpocząć ćwiczenia?' : 'Wysłać alert do rodziców?'}
        confirmLabel={drill ? 'Rozpocznij ćwiczenia' : 'WYŚLIJ ALERT'}
        danger={!drill}
        busy={start.isPending}
        error={start.error ? errorMessage(start.error) : null}
        onConfirm={(pin) => start.mutate(pin)}
        onClose={() => setPinOpen(false)}
      >
        {preview.data && (
          <p>
            {drill ? 'Symulacja dla' : 'SMS trafi do'} <strong>{plural(preview.data.recipients, 'opiekuna', 'opiekunów', 'opiekunów')}</strong>{' '}
            ({plural(preview.data.students, 'uczeń', 'uczniów', 'uczniów')}).
          </p>
        )}
      </PinModal>
    </div>
  );
}

function ChoiceButton({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone?: 'alarm' | 'warn';
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activeClass = tone === 'alarm' ? 'border-alarm bg-alarm text-white' : tone === 'warn' ? 'border-warn bg-warn text-white' : 'border-ink bg-ink text-white';
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-16 rounded-2xl border-2 px-4 py-3 text-lg font-bold ${active ? activeClass : 'border-line bg-surface shadow-card hover:border-ink'}`}
    >
      {children}
    </button>
  );
}

function Tile({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`rounded-xl border-2 p-3 ${warn ? 'border-warn bg-warn-bg' : 'border-line bg-surface'}`}>
      <div className="text-3xl font-black">{value}</div>
      <div className="font-semibold text-muted">{label}</div>
    </div>
  );
}

function StudentPicker({ selected, onChange }: { selected: StudentListItemDto[]; onChange: (s: StudentListItemDto[]) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const results = useQuery({
    queryKey: ['students', `q=${debounced}`],
    queryFn: () => api.get<StudentListItemDto[]>(`/students?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  });
  const ids = new Set(selected.map((s) => s.id));
  return (
    <Card>
      <Field label="Szukaj ucznia" hint="Wpisz co najmniej 2 litery imienia lub nazwiska.">
        {(id) => <TextInput id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} />}
      </Field>
      {selected.length > 0 && (
        <div className="my-3 flex flex-wrap gap-2">
          {selected.map((s) => (
            <button
              key={s.id}
              type="button"
              className="rounded-lg border-2 border-ink px-2 py-1 font-semibold"
              onClick={() => onChange(selected.filter((x) => x.id !== s.id))}
              aria-label={`Usuń ${s.firstName} ${s.lastName}`}
            >
              {s.firstName} {s.lastName} ({s.className}) ✕
            </button>
          ))}
        </div>
      )}
      <ul className="mt-2 flex flex-col gap-1">
        {results.data
          ?.filter((s) => !ids.has(s.id))
          .slice(0, 20)
          .map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="flex min-h-12 w-full items-center justify-between rounded-xl border border-line px-3 text-left hover:border-ink"
                onClick={() => onChange([...selected, s])}
              >
                <span>
                  <strong>
                    {s.lastName} {s.firstName}
                  </strong>{' '}
                  · {s.className}
                </span>
                {s.alertableGuardianCount === 0 && <Badge tone="warning">brak numeru</Badge>}
              </button>
            </li>
          ))}
      </ul>
    </Card>
  );
}
