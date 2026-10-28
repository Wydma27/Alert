// Tryb awaryjny – działa bez bazy danych, a nawet bez serwera:
// A) serwer działa, baza nie: wysyłka przez bramkę SMS z kopii kontaktów na serwerze,
// B) brak serwera: kopia kontaktów zaszyfrowana w tym urządzeniu (hasło do konta) – SMS z telefonu, numery do panelu bramki, telefony.
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  EMPTY_SELECTION,
  GROUP_LABELS,
  describeSelection,
  resolveRecipients,
  selectionIsEmpty,
  toGsmFriendly,
  type Directory,
  type EmergencyJobDto,
  type EmergencyStatusDto,
  type RecipientSelection,
} from '@alert/shared';
import { composerReady, MessageComposer, type ComposerValue } from '../components/MessageComposer';
import { PinModal } from '../components/PinModal';
import { RecipientPicker } from '../components/RecipientPicker';
import { Badge, Button, Card, Field, Loading, Notice, TextInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatDateTime, plural } from '../lib/format';
import { addJournal, getMeta, offlineSupported, PHONE_BATCH, smsAppLink, unlockOffline, type OfflineData, type OfflineMeta } from '../lib/offline';
import { noticePayload } from './NewNotice';

export function EmergencyPage() {
  const status = useQuery({
    queryKey: ['emergency-status'],
    queryFn: () => api.get<EmergencyStatusDto>('/emergency/status'),
    refetchInterval: 10_000,
    retry: false,
  });
  const [meta, setMeta] = useState<OfflineMeta | null | undefined>(undefined);
  useEffect(() => {
    void getMeta().then(setMeta);
  }, []);

  const s = status.data;
  const serverDown = status.isError;
  const commander = s?.user && (s.user.role === 'ADMIN' || s.user.role === 'DYREKCJA');

  return (
    <div className="min-h-dvh">
      <header className="border-b-[3px] border-alarm bg-ink px-4 py-3 text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/icon.svg" alt="" className="size-9 shrink-0 rounded-[0.6rem]" />
            <div className="min-w-0">
              <div className="text-lg font-black">TRYB AWARYJNY</div>
              <div className="text-sm text-slate-300">Wysyłka SMS, gdy baza danych albo serwer nie działają</div>
            </div>
          </div>
          <Link to="/" className="shrink-0 rounded-xl border-2 border-white/70 px-3 py-2 font-semibold hover:bg-white/10">
            Aplikacja
          </Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-5">
        <Card>
          <h1 className="mb-2 text-xl font-bold">Stan</h1>
          <ul className="flex flex-col gap-1">
            <li>
              Serwer:{' '}
              {status.isLoading ? '…' : serverDown ? <Badge tone="error">brak połączenia</Badge> : <Badge tone="success">odpowiada</Badge>}
            </li>
            {s && (
              <li>
                Baza danych:{' '}
                {s.db ? (
                  <Badge tone="success">działa</Badge>
                ) : (
                  <Badge tone="error">nie odpowiada{s.dbDownSince ? ` od ${formatDateTime(s.dbDownSince)}` : ''}</Badge>
                )}
              </li>
            )}
            {s && <li>Kopia kontaktów na serwerze: {s.snapshotAt ? formatDateTime(s.snapshotAt) : <Badge tone="error">brak</Badge>}</li>}
            <li>
              Kopia w tym urządzeniu:{' '}
              {meta === undefined ? '…' : meta?.syncedAt ? `${formatDateTime(meta.syncedAt)} (${meta.userName}, ${meta.people} kontaktów)` : <Badge tone="warning">brak</Badge>}
            </li>
            {s && s.pendingJournal > 0 && <li>Wysyłki awaryjne czekające na zapis w bazie: {s.pendingJournal}</li>}
          </ul>
          {s?.db && (
            <p className="mt-3">
              Baza działa – zwykła wysyłka jest w{' '}
              <Link to="/wiadomosci/nowa" className="font-semibold underline">
                Wyślij SMS
              </Link>
              . Tryb awaryjny przyda się, gdy baza nie zapisuje danych (np. pełny dysk serwera).
            </p>
          )}
        </Card>

        {s && !s.user && !serverDown && (
          <Notice tone="info">
            Serwer odpowiada, ale nie jesteś zalogowany na tym urządzeniu.{' '}
            <Link to="/" className="underline">
              Zaloguj się
            </Link>{' '}
            (logowanie wymaga działającej bazy) albo użyj kopii w tym urządzeniu.
          </Notice>
        )}

        {commander && s?.snapshotAt && <ServerSend />}

        <DeviceCopy meta={meta} />
      </main>
    </div>
  );
}

/** A) Serwer działa (baza nie): wysyłka przez bramkę z kopii na serwerze. Przebieg trafi do historii po powrocie bazy. */
function ServerSend() {
  const options = useQuery({
    queryKey: ['emergency-directory'],
    queryFn: () => api.get<{ directory: Directory; snapshotAt: string; defaultSender: string }>('/emergency/directory'),
  });
  const [selection, setSelection] = useState<RecipientSelection>(EMPTY_SELECTION);
  const [composer, setComposer] = useState<ComposerValue>({ body: '', stripDiacritics: true, sender: '' });
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [pinOpen, setPinOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: (pin: string) => api.post<{ jobId: string }>('/emergency/send', { ...noticePayload(selection, composer), pin, idempotencyKey }),
    onSuccess: (res) => {
      setPinOpen(false);
      setJobId(res.jobId);
    },
  });
  const job = useQuery({
    queryKey: ['emergency-job', jobId],
    queryFn: () => api.get<EmergencyJobDto>(`/emergency/jobs/${jobId}`),
    enabled: jobId !== null,
    refetchInterval: (q) => (q.state.data?.finishedAt ? false : 1_500),
  });

  if (options.isLoading) return <Loading />;
  if (options.error || !options.data) return <Notice tone="error">{errorMessage(options.error)}</Notice>;
  const count = resolveRecipients(options.data.directory, selection).recipients.length;
  const ready = !selectionIsEmpty(selection) && composerReady(composer) && count > 0;

  if (jobId) {
    const j = job.data;
    return (
      <Card>
        <h2 className="mb-2 text-xl font-bold">Wysyłka awaryjna {j?.finishedAt ? 'zakończona' : 'w toku…'}</h2>
        {j && (
          <>
            <p className="text-lg">
              Wysłano <strong>{j.sent}</strong> z {j.total}
              {j.failed > 0 && (
                <>
                  , nie wysłano <strong className="text-alarm">{j.failed}</strong>
                  {j.badNumbers > 0 && ` (błędne numery: ${j.badNumbers})`}
                </>
              )}
              .
            </p>
            {j.errors.length > 0 && (
              <ul className="mt-2 max-h-64 overflow-y-auto text-sm">
                {j.errors.map((e, i) => (
                  <li key={i}>
                    <strong>{e.name}</strong>: {e.error}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-muted">Raporty doręczeń i ponowienie nieudanych będą w „Wiadomości” po powrocie bazy danych.</p>
          </>
        )}
        <Button
          className="mt-3"
          variant="secondary"
          onClick={() => {
            setJobId(null);
            setIdempotencyKey(crypto.randomUUID());
            send.reset();
          }}
        >
          Nowa wysyłka
        </Button>
      </Card>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-2xl font-black">A. Wyślij przez bramkę SMS (serwer)</h2>
      <p className="text-muted">Kontakty z kopii na serwerze z {formatDateTime(options.data.snapshotAt)}. Potwierdzenie PIN-em alarmowym.</p>
      <RecipientPicker directory={options.data.directory} value={selection} onChange={setSelection} />
      <MessageComposer value={composer} onChange={setComposer} senders={null} defaultSender={options.data.defaultSender} />
      <Button
        variant="danger"
        className="text-lg"
        disabled={!ready}
        onClick={() => {
          send.reset();
          setPinOpen(true);
        }}
      >
        WYŚLIJ AWARYJNIE ({plural(count, 'odbiorca', 'odbiorców', 'odbiorców')})
      </Button>
      <PinModal
        open={pinOpen}
        title="Wysłać w trybie awaryjnym?"
        confirmLabel="Wyślij"
        busy={send.isPending}
        error={send.error ? errorMessage(send.error) : null}
        onConfirm={(pin) => send.mutate(pin)}
        onClose={() => setPinOpen(false)}
      >
        <p>
          SMS trafi do <strong>{plural(count, 'osoby', 'osób', 'osób')}</strong> ({describeSelection(selection, options.data.directory.classes)}).
        </p>
      </PinModal>
    </section>
  );
}

/** B) Kopia w tym urządzeniu: działa bez serwera. */
function DeviceCopy({ meta }: { meta: OfflineMeta | null | undefined }) {
  const [password, setPassword] = useState('');
  const [data, setData] = useState<OfflineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!offlineSupported()) {
    return (
      <Notice tone="warning">
        Ta przeglądarka nie pozwala zapisać zaszyfrowanej kopii (wymagany adres HTTPS). Kopia w urządzeniu działa po wdrożeniu aplikacji na serwer z HTTPS.
      </Notice>
    );
  }
  if (meta === undefined) return null;
  if (!meta?.syncedAt) {
    return (
      <Notice tone="warning">
        W tym urządzeniu nie ma kopii kontaktów. Włącz ją w <strong>Moje konto → Kopia kontaktów w tym urządzeniu</strong>, póki serwer działa – wtedy wyślesz
        SMS-y nawet bez serwera.
      </Notice>
    );
  }

  async function unlock(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setData(await unlockOffline(password));
      setPassword('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-2xl font-black">B. Bez serwera – kopia w tym urządzeniu</h2>
      {!data ? (
        <Card>
          <form onSubmit={unlock} className="flex flex-col gap-3">
            <p>
              Kopia z {formatDateTime(meta.syncedAt)} ({meta.people} kontaktów), zabezpieczona hasłem do konta użytkownika <strong>{meta.userName}</strong>.
            </p>
            {error && <Notice tone="error">{error}</Notice>}
            <Field label="Hasło do konta">
              {(id) => (
                <TextInput id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              )}
            </Field>
            <Button type="submit" busy={busy} disabled={!password}>
              Otwórz kopię
            </Button>
          </form>
        </Card>
      ) : (
        <OfflineSend data={data} />
      )}
    </section>
  );
}

function OfflineSend({ data }: { data: OfflineData }) {
  const [selection, setSelection] = useState<RecipientSelection>(EMPTY_SELECTION);
  const [composer, setComposer] = useState<ComposerValue>({ body: '', stripDiacritics: true, sender: '' });
  const [copied, setCopied] = useState(false);
  const resolution = useMemo(() => resolveRecipients(data.directory, selection), [data.directory, selection]);
  const numbers = resolution.recipients.map((r) => r.phone);
  const body = composer.stripDiacritics ? toGsmFriendly(composer.body) : composer.body;
  const summary = describeSelection(selection, data.directory.classes);
  const batches: string[][] = [];
  for (let i = 0; i < numbers.length; i += PHONE_BATCH) batches.push(numbers.slice(i, i + PHONE_BATCH));

  const journal = (action: 'sms_app' | 'copy_numbers' | 'csv' | 'call', recipients: number) =>
    void addJournal({ action, summary, recipients, body: body || null });

  async function copyNumbers() {
    try {
      await navigator.clipboard.writeText(numbers.join('\n'));
      setCopied(true);
      journal('copy_numbers', numbers.length);
    } catch {
      setCopied(false);
    }
  }

  function downloadCsv() {
    const lines = ['telefon;osoba;grupa', ...resolution.recipients.map((r) => `${r.phone};${r.names.join(', ')};${GROUP_LABELS[r.group]}`)];
    const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'odbiorcy-awaryjnie.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    journal('csv', numbers.length);
  }

  return (
    <div className="flex flex-col gap-3">
      <RecipientPicker directory={data.directory} value={selection} onChange={setSelection} />
      <MessageComposer value={composer} onChange={setComposer} senders={null} defaultSender="" />
      {numbers.length > 0 && (
        <Card>
          <h3 className="mb-2 text-lg font-bold">Wyślij z tego telefonu</h3>
          <p className="mb-2 text-muted">
            SMS-y wyjdą z Twojego numeru i taryfy. Telefony ograniczają liczbę odbiorców jednej wiadomości, dlatego paczki po {PHONE_BATCH}. Po wysłaniu
            paczki wróć tutaj i otwórz następną.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {batches.map((batch, i) => (
              <a
                key={i}
                href={smsAppLink(batch, body)}
                onClick={() => journal('sms_app', batch.length)}
                className={`flex min-h-12 items-center justify-center rounded-lg border-2 px-4 font-semibold ${composerReady(composer) ? 'border-alarm-dark bg-alarm text-white' : 'pointer-events-none border-line text-muted'}`}
              >
                Paczka {i + 1}/{batches.length} ({batch.length} numerów)
              </a>
            ))}
          </div>
          <h3 className="mt-4 mb-2 text-lg font-bold">Na komputerze: panel bramki SMS</h3>
          <p className="mb-2 text-muted">Zaloguj się w panelu bramki (SMSAPI, SMS-fly…) i wklej numery albo wczytaj plik CSV.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void copyNumbers()}>
              {copied ? 'Skopiowano ✓' : `Kopiuj ${plural(numbers.length, 'numer', 'numery', 'numerów')}`}
            </Button>
            <Button variant="secondary" onClick={downloadCsv}>
              Pobierz CSV
            </Button>
          </div>
          {resolution.recipients.length <= 30 && (
            <>
              <h3 className="mt-4 mb-2 text-lg font-bold">Zadzwoń</h3>
              <ul className="flex flex-col gap-1">
                {resolution.recipients.map((r) => (
                  <li key={r.phone}>
                    <a href={`tel:${r.phone}`} onClick={() => journal('call', 1)} className="font-semibold underline">
                      {r.names.join(', ')} – {r.phone}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
      {resolution.withoutPhone.length > 0 && <Notice tone="warning">{plural(resolution.withoutPhone.length, 'osoba nie ma', 'osoby nie mają', 'osób nie ma')} numeru.</Notice>}
    </div>
  );
}

