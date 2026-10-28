import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  CALL_RESULT_LABELS,
  DELIVERY_STATUS_LABELS,
  MESSAGE_KIND_LABELS,
  type AlertDetailDto,
  type CallResultValue,
  type DeliveryDto,
  type DeliveryStatusValue,
} from '@alert/shared';
import { PinModal } from '../components/PinModal';
import { Badge, Button, buttonClass, Card, Checkbox, Field, Loading, Notice, Select, Tabs } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { formatTime, useAlertEvents } from '../lib/hooks';

type Tab = 'problems' | 'classes' | 'messages' | 'all';

const STATUS_TONE: Record<DeliveryStatusValue, 'success' | 'warning' | 'error' | 'info'> = {
  QUEUED: 'info',
  SENDING: 'info',
  SENT: 'info',
  DELIVERED: 'success',
  UNDELIVERED: 'error',
  FAILED: 'error',
};

export function CommandCenterPage() {
  const id = Number(useParams().id);
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['alert', id],
    queryFn: () => api.get<AlertDetailDto>(`/alerts/${id}`),
    refetchInterval: (q) => (q.state.data?.alert.status === 'ACTIVE' ? 8_000 : false),
  });
  const live = useAlertEvents(id, [['alert', id], ['deliveries', id], ['active-alert']]);
  const [tab, setTab] = useState<Tab>('problems');
  const [dialog, setDialog] = useState<'point' | 'close' | null>(null);

  if (detail.isLoading) return <Loading />;
  if (detail.error || !detail.data) return <Notice tone="error">{errorMessage(detail.error)}</Notice>;
  const { alert, classes, messages, missing } = detail.data;
  const active = alert.status === 'ACTIVE';
  const drill = alert.mode === 'DRILL';
  const dl = alert.deliveries;
  const att = alert.attendance;
  const problemsCount = dl.FAILED + dl.UNDELIVERED;
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['alert', id] });
    await queryClient.invalidateQueries({ queryKey: ['active-alert'] });
  };

  return (
    <>
      <header className={`mb-4 rounded-2xl border-2 p-4 ${drill ? 'border-warn bg-warn-bg' : active ? 'border-alarm bg-red-50' : 'border-line bg-surface'}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-sm font-black uppercase tracking-wider">
              {drill ? 'Ćwiczenia' : 'Alarm'} · {active ? 'trwa' : 'zakończony'}
              {active && (
                <span className={`ml-2 inline-block size-2 rounded-full ${live ? 'bg-ok' : 'bg-slate-400'}`} title={live ? 'na żywo' : 'odświeżanie co kilka sekund'} />
              )}
            </div>
            <h1 className="text-2xl font-black sm:text-3xl">{alert.eventLabel}</h1>
            <p className="text-muted">
              Start {formatDateTime(alert.startedAt)} · {alert.startedBy ?? '—'}
              {alert.closedAt && (
                <>
                  {' '}
                  · koniec {formatDateTime(alert.closedAt)} · {alert.closedBy ?? '—'}
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/obecnosc" className={buttonClass('secondary')}>
              Lista obecności
            </Link>
            <a href={`/api/alerts/${id}/report.csv`} className={buttonClass('secondary')}>
              Raport CSV
            </a>
          </div>
        </div>
        {!detail.data.live && !drill && (
          <p className="mt-2 font-semibold text-warn">Bramka SMS w trybie fake – SMS-y nie wychodzą do rodziców.</p>
        )}
        {alert.purged && <p className="mt-2 text-muted">Dane osobowe tego alertu zostały usunięte zgodnie z zasadami retencji.</p>}
      </header>

      {missing.length > 0 && (
        <div className="mb-4 rounded-2xl border-2 border-alarm-dark bg-alarm p-4 text-white shadow-lift">
          <h2 className="text-xl font-black">
            NIEODNALEZIENI{active ? '' : ' (w chwili zakończenia)'}: {missing.length}
          </h2>
          <ul className="mt-1 text-lg font-semibold">
            {missing.map((m) => (
              <li key={m.id}>
                {m.firstName} {m.lastName} ({m.className}) – zgłoszono {formatTime(m.at)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="SMS doręczone" value={`${dl.DELIVERED} / ${dl.total}`} />
        <Kpi label="w drodze" value={dl.QUEUED + dl.SENDING + dl.SENT} />
        <Kpi label="nie dotarło" value={problemsCount} danger={problemsCount > 0} />
        <Kpi label="obecni / odebrani" value={`${att.PRESENT} / ${att.PICKED_UP}`} />
        <Kpi label="niesprawdzeni" value={att.UNKNOWN} />
        <Kpi label="nieobecni w szkole" value={att.ABSENT_TODAY} />
        <Kpi label="nieodnalezieni" value={att.MISSING} danger={att.MISSING > 0} />
        <Kpi label="uczniów" value={att.total} />
      </div>
      {drill && dl.simulated > 0 && <p className="mb-4 text-muted">Ćwiczenia: SMS-y do rodziców są symulowane – nic do nich nie wyszło.</p>}

      {active && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setDialog('point')}>
            Zmień punkt zbiórki
          </Button>
          <Button variant="danger" onClick={() => setDialog('close')}>
            Zakończ / odwołaj alarm
          </Button>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['problems', `Nie dotarło (${problemsCount})`],
          ['classes', 'Klasy'],
          ['messages', `Komunikaty (${messages.length})`],
          ['all', 'Wszystkie SMS'],
        ]}
      />

      {tab === 'problems' && <DeliveriesTab alertId={id} filter="problems" active={active} />}
      {tab === 'all' && <DeliveriesTab alertId={id} filter="all" active={active} />}
      {tab === 'classes' && (
        <ul className="grid gap-3 md:grid-cols-2">
          {classes.map((c) => {
            const done = c.attendance.PRESENT + c.attendance.PICKED_UP + c.attendance.ABSENT_TODAY;
            return (
              <li key={c.id}>
                <Link to={`/obecnosc/${c.id}`} className="block rounded-2xl border border-line bg-surface shadow-card p-4 hover:border-ink">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xl font-black">{c.className}</span>
                    <span className="font-semibold">
                      {done} / {c.attendance.total}
                    </span>
                  </div>
                  <div className="text-muted">{c.pointName}</div>
                  <div className="mt-2 h-3 overflow-hidden rounded bg-slate-200">
                    <div className="h-full bg-ok" style={{ width: `${c.attendance.total ? (done / c.attendance.total) * 100 : 0}%` }} />
                  </div>
                  {c.attendance.MISSING > 0 && (
                    <div className="mt-2">
                      <Badge tone="error">nieodnalezieni: {c.attendance.MISSING}</Badge>
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {tab === 'messages' && (
        <ul className="flex flex-col gap-3">
          {messages.map((m) => (
            <li key={m.id}>
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <strong>{MESSAGE_KIND_LABELS[m.kind]}</strong>
                  <span className="text-muted">
                    {formatTime(m.createdAt)} · {m.createdBy ?? 'automatycznie'}
                  </span>
                </div>
                {m.note && <p>{m.note}</p>}
                <p className="mt-1">
                  SMS: {m.counts.total} · doręczone {m.counts.DELIVERED} · problem {m.counts.FAILED + m.counts.UNDELIVERED}
                </p>
                <details className="mt-1 text-sm text-muted">
                  <summary className="cursor-pointer">Szablon</summary>
                  <p className="mt-1 font-mono">{m.template}</p>
                </details>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {dialog === 'point' && (
        <ChangePointDialog
          alertId={id}
          classes={classes}
          onDone={() => {
            setDialog(null);
            void refresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'close' && (
        <CloseDialog
          alertId={id}
          drill={drill}
          onDone={() => {
            setDialog(null);
            void refresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

function Kpi({ label, value, danger }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <div className={`rounded-xl border-2 p-3 ${danger ? 'border-alarm bg-red-50' : 'border-line bg-surface'}`}>
      <div className={`text-2xl font-black sm:text-3xl ${danger ? 'text-alarm' : ''}`}>{value}</div>
      <div className="font-semibold text-muted">{label}</div>
    </div>
  );
}

function DeliveriesTab({ alertId, filter, active }: { alertId: number; filter: 'problems' | 'all'; active: boolean }) {
  const queryClient = useQueryClient();
  const deliveries = useQuery({
    queryKey: ['deliveries', alertId, filter],
    queryFn: () => api.get<DeliveryDto[]>(`/alerts/${alertId}/deliveries?filter=${filter}`),
    refetchInterval: active ? 10_000 : false,
  });
  const [statusFilter, setStatusFilter] = useState<'' | DeliveryStatusValue>('');
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['deliveries', alertId] });
    void queryClient.invalidateQueries({ queryKey: ['alert', alertId] });
  };
  const resendAll = useMutation({ mutationFn: () => api.post<{ count: number }>(`/alerts/${alertId}/resend-failed`), onSuccess: refresh });

  if (deliveries.isLoading) return <Loading />;
  if (deliveries.error) return <Notice tone="error">{errorMessage(deliveries.error)}</Notice>;
  const rows = (deliveries.data ?? []).filter((d) => !statusFilter || d.status === statusFilter);

  return (
    <div className="flex flex-col gap-3">
      {filter === 'problems' && rows.length === 0 && <Notice tone="success">Wszystkie SMS-y doręczone albo w drodze.</Notice>}
      {filter === 'problems' && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" busy={resendAll.isPending} onClick={() => resendAll.mutate()}>
            Wyślij ponownie wszystkie ({rows.length})
          </Button>
          <span className="text-muted">albo zadzwoń do rodziców poniżej.</span>
        </div>
      )}
      {filter === 'all' && (
        <Field label="Status">
          {(fid) => (
            <Select id={fid} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as DeliveryStatusValue | '')} className="max-w-xs">
              <option value="">wszystkie ({deliveries.data?.length})</option>
              {Object.entries(DELIVERY_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <ul className="flex flex-col gap-2">
        {rows.slice(0, 500).map((d) => (
          <DeliveryRow key={d.id} alertId={alertId} delivery={d} detailed={filter === 'problems'} onChanged={refresh} />
        ))}
      </ul>
      {rows.length > 500 && <p className="text-muted">Pokazano 500 z {rows.length}. Zawęź filtr statusu.</p>}
    </div>
  );
}

function DeliveryRow({ alertId, delivery: d, detailed, onChanged }: { alertId: number; delivery: DeliveryDto; detailed: boolean; onChanged: () => void }) {
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resend = useMutation({ mutationFn: () => api.post(`/alerts/${alertId}/deliveries/${d.id}/resend`), onSuccess: onChanged, onError: (e) => setError(errorMessage(e)) });
  const call = useMutation({
    mutationFn: (result: CallResultValue) => api.post(`/alerts/${alertId}/calls`, { deliveryId: d.id, result }),
    onSuccess: onChanged,
    onError: (e) => setError(errorMessage(e)),
  });
  async function reveal() {
    try {
      setPhone((await api.get<{ phone: string }>(`/alerts/${alertId}/deliveries/${d.id}/phone`)).phone);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const lastCall = d.calls[d.calls.length - 1];

  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-bold">
            {d.studentName ?? (d.testNumber ? 'Numer testowy' : '—')} {d.className && <span className="font-normal text-muted">· {d.className}</span>}
          </div>
          <div>
            {d.guardianName ?? 'opiekun'} · <span className="font-mono">{d.phoneMasked}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge tone={STATUS_TONE[d.status]}>{DELIVERY_STATUS_LABELS[d.status]}</Badge>
            <Badge>{MESSAGE_KIND_LABELS[d.messageKind]}</Badge>
            {d.simulated && <Badge tone="warning">symulacja</Badge>}
            {d.attempts > 1 && <Badge>prób: {d.attempts}</Badge>}
          </div>
          {d.lastError && <p className="mt-1 text-sm text-alarm">{d.lastError}</p>}
          {lastCall && (
            <p className="mt-1 text-sm text-muted">
              Telefon {formatTime(lastCall.at)}: {CALL_RESULT_LABELS[lastCall.result]} ({lastCall.by ?? '—'})
            </p>
          )}
          {error && <p className="mt-1 text-sm font-semibold text-alarm">{error}</p>}
        </div>
        {detailed && (
          <div className="flex flex-col gap-1 sm:items-end">
            {phone ? (
              <a href={`tel:${phone.replace(/\s/g, '')}`} className="inline-flex min-h-12 items-center rounded-lg border-2 border-ok bg-ok px-4 font-bold text-white">
                Zadzwoń {phone}
              </a>
            ) : (
              <Button variant="secondary" onClick={() => void reveal()}>
                Pokaż numer
              </Button>
            )}
            <Button variant="ghost" busy={resend.isPending} onClick={() => resend.mutate()}>
              Wyślij ponownie
            </Button>
          </div>
        )}
      </div>
      {detailed && phone && (
        <div className="mt-2 flex flex-wrap gap-1 border-t border-line pt-2">
          <span className="self-center text-sm text-muted">Wynik rozmowy:</span>
          {(Object.keys(CALL_RESULT_LABELS) as CallResultValue[]).map((r) => (
            <Button key={r} variant="secondary" className="!min-h-10 text-sm" busy={call.isPending && call.variables === r} onClick={() => call.mutate(r)}>
              {CALL_RESULT_LABELS[r]}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}

function ChangePointDialog({
  alertId,
  classes,
  onDone,
  onClose,
}: {
  alertId: number;
  classes: AlertDetailDto['classes'];
  onDone: () => void;
  onClose: () => void;
}) {
  const points = useQuery({
    queryKey: ['assembly-points'],
    queryFn: () => api.get<{ id: number; name: string; active: boolean }[]>('/assembly-points'),
  });
  const [selected, setSelected] = useState<number[]>([]);
  const [pointId, setPointId] = useState('');
  const change = useMutation({
    mutationFn: (pin: string) =>
      api.post<{ recipients: number }>(`/alerts/${alertId}/change-point`, { alertClassIds: selected, assemblyPointId: Number(pointId), pin }),
    onSuccess: onDone,
  });
  return (
    <PinModal
      open
      title="Zmiana punktu zbiórki"
      confirmLabel="Zmień i wyślij SMS"
      busy={change.isPending}
      error={change.error ? errorMessage(change.error) : null}
      onConfirm={(pin) => {
        if (selected.length && pointId) change.mutate(pin);
      }}
      onClose={onClose}
    >
      <p>Rodzice uczniów z zaznaczonych klas (poza odebranymi) dostaną SMS z nowym miejscem.</p>
      <div className="grid max-h-56 grid-cols-2 overflow-y-auto">
        {classes.map((c) => (
          <Checkbox
            key={c.id}
            label={
              <>
                <strong>{c.className}</strong> <span className="text-sm text-muted">{c.pointName}</span>
              </>
            }
            checked={selected.includes(c.id)}
            onChange={(e) => setSelected(e.target.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id))}
          />
        ))}
      </div>
      <Field label="Nowy punkt zbiórki">
        {(fid) => (
          <Select id={fid} value={pointId} onChange={(e) => setPointId(e.target.value)} required>
            <option value="">— wybierz —</option>
            {points.data
              ?.filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        )}
      </Field>
      {(!selected.length || !pointId) && <p className="text-sm text-muted">Zaznacz klasy i wybierz punkt.</p>}
    </PinModal>
  );
}

function CloseDialog({ alertId, drill, onDone, onClose }: { alertId: number; drill: boolean; onDone: () => void; onClose: () => void }) {
  const [sendCancelSms, setSendCancelSms] = useState(true);
  const close = useMutation({
    mutationFn: (pin: string) => api.post<{ recipients: number }>(`/alerts/${alertId}/close`, { sendCancelSms, pin }),
    onSuccess: onDone,
  });
  return (
    <PinModal
      open
      title={drill ? 'Zakończyć ćwiczenia?' : 'Zakończyć alarm?'}
      confirmLabel="Zakończ"
      busy={close.isPending}
      error={close.error ? errorMessage(close.error) : null}
      onConfirm={(pin) => close.mutate(pin)}
      onClose={onClose}
    >
      <fieldset className="flex flex-col gap-1">
        <label className="flex min-h-12 items-start gap-2">
          <input type="radio" name="close" className="mt-1 size-5 accent-ink" checked={sendCancelSms} onChange={() => setSendCancelSms(true)} />
          <span>
            <strong>Odwołanie alarmu z SMS-em</strong> – rodzice dzieci, które nie zostały odebrane, dostaną informację o powrocie do szkoły.
          </span>
        </label>
        <label className="flex min-h-12 items-start gap-2">
          <input type="radio" name="close" className="mt-1 size-5 accent-ink" checked={!sendCancelSms} onChange={() => setSendCancelSms(false)} />
          <span>
            <strong>Zakończ bez SMS-a</strong> – np. wszystkie dzieci zostały już odebrane.
          </span>
        </label>
      </fieldset>
      <p className="text-sm text-muted">Po zakończeniu lista obecności zostaje zamknięta, a alert trafia do historii (z raportem).</p>
    </PinModal>
  );
}
