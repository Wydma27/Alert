import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  EMPTY_SELECTION,
  GROUP_LABELS,
  RECIPIENT_GROUPS,
  selectionIsEmpty,
  type NoticeOptionsDto,
  type NoticePreviewDto,
  type RecipientSelection,
} from '@alert/shared';
import { composerReady, MessageComposer, type ComposerValue } from '../components/MessageComposer';
import { PinModal } from '../components/PinModal';
import { RecipientPicker } from '../components/RecipientPicker';
import { SmsBubble, SmsCounter } from '../components/SmsCounter';
import { Button, Card, Loading, Notice, PageHeader } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { plural } from '../lib/format';

export function noticePayload(selection: RecipientSelection, c: ComposerValue) {
  return { selection, body: c.body, sender: c.sender.trim() || null, stripDiacritics: c.stripDiacritics };
}

export function NewNoticePage() {
  const navigate = useNavigate();
  const options = useQuery({ queryKey: ['notice-options'], queryFn: () => api.get<NoticeOptionsDto>('/notices/options') });
  const [selection, setSelection] = useState<RecipientSelection>(EMPTY_SELECTION);
  const [composer, setComposer] = useState<ComposerValue>({ body: '', stripDiacritics: true, sender: '' });
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [pinOpen, setPinOpen] = useState(false);

  const preview = useMutation({
    mutationFn: () => api.post<NoticePreviewDto>('/notices/preview', noticePayload(selection, composer)),
  });
  const send = useMutation({
    mutationFn: (pin: string) => api.post<{ id: number }>('/notices', { ...noticePayload(selection, composer), pin, idempotencyKey }),
    onSuccess: (res) => navigate(`/wiadomosci/${res.id}`, { replace: true }),
  });

  if (options.isLoading) return <Loading />;
  if (options.error || !options.data) return <Notice tone="error">{errorMessage(options.error)}</Notice>;
  const o = options.data;
  const ready = !selectionIsEmpty(selection) && composerReady(composer);
  const p = preview.data;
  // Podgląd dotyczy dokładnie tego, co jest na ekranie – po zmianie trzeba sprawdzić ponownie.
  const changeSelection = (s: RecipientSelection) => {
    setSelection(s);
    preview.reset();
  };
  const changeComposer = (c: ComposerValue) => {
    setComposer(c);
    preview.reset();
  };

  return (
    <div className="mx-auto max-w-4xl pb-28">
      <PageHeader title="Wyślij SMS" actions={<Link to="/wiadomosci" className="font-semibold underline">Historia wiadomości</Link>}>
        Nauczyciele, uczniowie, rodzice – całe grupy, klasy albo wybrane osoby. Ewakuację uruchamiasz osobnym przyciskiem na pulpicie.
      </PageHeader>

      {!o.hasPin && (
        <div className="mb-4">
          <Notice tone="error">
            Wysyłka wymaga PIN-u alarmowego.{' '}
            <Link to="/konto" className="underline">
              Ustaw PIN
            </Link>
          </Notice>
        </div>
      )}
      {!o.live && (
        <div className="mb-4">
          <Notice tone="warning">Bramka SMS w trybie fake – SMS-y nie wyjdą do telefonów (ustawienie SMS_PROVIDER).</Notice>
        </div>
      )}

      <h2 className="mb-2 text-xl font-bold">1. Do kogo?</h2>
      <RecipientPicker directory={o.directory} value={selection} onChange={changeSelection} />

      <h2 className="mt-6 mb-2 text-xl font-bold">2. Co i od kogo?</h2>
      <MessageComposer value={composer} onChange={changeComposer} senders={o.senders} defaultSender={o.defaultSender} />

      <h2 className="mt-6 mb-2 text-xl font-bold">3. Sprawdź</h2>
      {preview.error && <Notice tone="error">{errorMessage(preview.error)}</Notice>}
      {!p && (
        <Button disabled={!ready} busy={preview.isPending} onClick={() => preview.mutate()}>
          Sprawdź odbiorców i koszt
        </Button>
      )}
      {p && <PreviewCard p={p} />}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 p-3 shadow-[0_-6px_16px_-6px_rgb(15_23_42/0.15)] backdrop-blur">
        <div className="mx-auto flex max-w-4xl gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => navigate(-1)}>
            Anuluj
          </Button>
          {p ? (
            <Button
              variant="danger"
              className="flex-[2] text-lg"
              disabled={p.blocking.length > 0 || !o.hasPin}
              onClick={() => {
                send.reset();
                setPinOpen(true);
              }}
            >
              WYŚLIJ DO {plural(p.recipients, 'ODBIORCY', 'ODBIORCÓW', 'ODBIORCÓW')}
            </Button>
          ) : (
            <Button className="flex-[2]" disabled={!ready} busy={preview.isPending} onClick={() => preview.mutate()}>
              Dalej: sprawdź
            </Button>
          )}
        </div>
      </div>

      <PinModal
        open={pinOpen}
        title="Wysłać wiadomość?"
        confirmLabel="Wyślij"
        busy={send.isPending}
        error={send.error ? errorMessage(send.error) : null}
        onConfirm={(pin) => send.mutate(pin)}
        onClose={() => setPinOpen(false)}
      >
        {p && (
          <p>
            SMS od <strong>{p.sender}</strong> trafi do <strong>{plural(p.recipients, 'odbiorcy', 'odbiorców', 'odbiorców')}</strong> ({p.summary}).
          </p>
        )}
      </PinModal>
    </div>
  );
}

export function PreviewCard({ p }: { p: NoticePreviewDto }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="odbiorców (numerów)" value={p.recipients} />
        <Tile label="SMS w rozliczeniu" value={p.totalParts} />
        <Tile label="bez numeru" value={p.withoutPhone.length} warn={p.withoutPhone.length > 0} />
        <Tile label="wspólne numery" value={p.duplicates} />
      </div>
      <p className="text-muted">
        {RECIPIENT_GROUPS.filter((g) => p.byGroup[g])
          .map((g) => `${GROUP_LABELS[g]}: ${p.byGroup[g]}`)
          .join(' · ')}
      </p>
      {p.blocking.map((b) => (
        <Notice key={b} tone="error">
          {b}
        </Notice>
      ))}
      {p.warnings.map((w) => (
        <Notice key={w} tone="warning">
          {w}
        </Notice>
      ))}
      <Card>
        <h3 className="mb-2 font-bold">Tak zobaczy to odbiorca</h3>
        <SmsBubble sender={p.sender} text={p.body} />
        <div className="mt-3">
          <SmsCounter info={p.info} />
        </div>
      </Card>
      {p.withoutPhone.length > 0 && (
        <details className="rounded-2xl border border-line bg-surface shadow-card p-3">
          <summary className="cursor-pointer font-semibold">Bez numeru ({p.withoutPhone.length}) – nie dostaną SMS-a</summary>
          <ul className="mt-2 max-h-64 overflow-y-auto">
            {p.withoutPhone.map((x) => (
              <li key={x.key}>
                {x.name} <span className="text-muted">· {GROUP_LABELS[x.group].toLowerCase()}, {x.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
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
