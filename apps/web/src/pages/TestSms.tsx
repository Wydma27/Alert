import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  MESSAGE_KINDS,
  MESSAGE_KIND_LABELS,
  type GatewayStatusDto,
  type MessageKind,
  type SmsExampleDto,
  type TestNumberDto,
  type TestSendResponse,
} from '@alert/shared';
import { SmsBubble, SmsCounter } from '../components/SmsCounter';
import { Button, Card, Checkbox, ConfirmModal, Field, Loading, Notice, PageHeader, Select, TextInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { plural } from '../lib/format';

export function TestSmsPage() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN');
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<MessageKind>('START');
  const gateway = useQuery({ queryKey: ['sms-gateway'], queryFn: () => api.get<GatewayStatusDto[]>('/sms/gateway') });
  const example = useQuery({ queryKey: ['sms-example', kind], queryFn: () => api.get<SmsExampleDto>(`/sms/example?kind=${kind}`) });
  const numbers = useQuery({ queryKey: ['test-numbers'], queryFn: () => api.get<TestNumberDto[]>('/test-numbers') });

  const [useDefaultSender, setUseDefaultSender] = useState(false);
  const [target, setTarget] = useState<TestNumberDto | null>(null);
  const [result, setResult] = useState<{ number: TestNumberDto; res: TestSendResponse } | null>(null);

  const send = useMutation({
    mutationFn: (n: TestNumberDto) => api.post<TestSendResponse>('/sms/test-send', { testNumberId: n.id, useDefaultSender, kind }),
    onSuccess: (res, n) => {
      setResult({ number: n, res });
      setTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['sms-gateway'] });
    },
  });

  const live = gateway.data?.some((g) => g.live) ?? false;

  return (
    <>
      <PageHeader title="Test SMS">Przykładowy SMS alarmowy wysyłany wyłącznie na numery testowe – z dopiskiem „TEST, NIE ALARM”.</PageHeader>

      <div className="flex flex-col gap-4">
        <Card>
          <h2 className="mb-2 text-xl font-bold">Bramka SMS</h2>
          {gateway.isLoading && <Loading />}
          {gateway.error && <Notice tone="error">{errorMessage(gateway.error)}</Notice>}
          {gateway.data?.map((g, i) => (
            <div key={g.provider} className="mb-2">
              <Notice tone={!g.ok ? 'error' : g.live ? 'success' : 'warning'}>
                <p>
                  <strong>
                    {i === 0 ? 'Bramka główna' : 'Bramka zapasowa'}: {g.live ? g.provider.toUpperCase() : 'tryb testowy (fake)'}
                  </strong>{' '}
                  – {g.message}
                  {g.points !== null && <> Saldo: {g.points} pkt.</>}
                </p>
                {!g.live && (
                  <p className="mt-1">
                    Żeby SMS dotarł na telefon, wpisz w pliku <code>.env</code>: <code>SMS_PROVIDER=smsfly</code> i{' '}
                    <code>SMSFLY_API_KEY=…</code> (klucz z panelu SMS-fly → Ustawienia API), potem uruchom serwer ponownie.
                  </p>
                )}
              </Notice>
            </div>
          ))}
        </Card>

        <Card>
          <h2 className="mb-2 text-xl font-bold">Treść przykładowego SMS-a</h2>
          {example.isLoading && <Loading />}
          {example.error && <Notice tone="error">{errorMessage(example.error)}</Notice>}
          <div className="mb-3 max-w-sm">
            <Field label="Rodzaj komunikatu">
              {(id) => (
                <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as MessageKind)}>
                  {MESSAGE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {MESSAGE_KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {example.data && (
            <>
              <SmsBubble sender={useDefaultSender || !example.data.senderName ? 'domyślny nadawca konta' : example.data.senderName} text={example.data.text} />
              <div className="mt-3">
                <SmsCounter info={example.data.info} />
              </div>
              <p className="mt-2 text-sm text-muted">
                Dane przykładowe: szkoła i telefon z „Dane szkoły”, pierwszy aktywny punkt zbiórki, fikcyjna uczennica Zuzanna z 3B. Treść
                pochodzi z aktualnego szablonu (zakładka „Szablony SMS”).
              </p>
            </>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 text-xl font-bold">Numery testowe</h2>
          {numbers.isLoading && <Loading />}
          {numbers.error && <Notice tone="error">{errorMessage(numbers.error)}</Notice>}
          {numbers.data?.length === 0 && <Notice>Brak numerów testowych{isAdmin ? ' – dodaj swój poniżej.' : '.'}</Notice>}

          {result && (
            <div className="mb-3">
              {result.res.ok ? (
                <Notice tone={result.res.live ? 'success' : 'warning'}>
                  {result.res.live
                    ? `Wysłano na ${result.number.phoneMasked} (${plural(result.res.parts, 'część', 'części', 'części')}). Identyfikator w SMSAPI: ${result.res.messageId}. SMS powinien dotrzeć w ciągu kilkunastu sekund.`
                    : `Tryb testowy (fake): SMS NIE został wysłany na ${result.number.phoneMasked} – powyżej widzisz dokładną treść, która by wyszła.`}
                </Notice>
              ) : (
                <Notice tone="error">Nie wysłano: {result.res.error}</Notice>
              )}
            </div>
          )}
          {send.error && (
            <div className="mb-3">
              <Notice tone="error">{errorMessage(send.error)}</Notice>
            </div>
          )}

          <ul className="mb-3 flex flex-col gap-2">
            {numbers.data?.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3">
                <span>
                  <strong>{n.label}</strong> <span className="font-mono">{n.phoneMasked}</span>
                </span>
                <span className="flex gap-1">
                  <Button
                    variant={live ? 'danger' : 'primary'}
                    onClick={() => {
                      send.reset();
                      setTarget(n);
                    }}
                    disabled={!example.data}
                  >
                    Wyślij przykładowy SMS
                  </Button>
                  {isAdmin && <RemoveNumber number={n} />}
                </span>
              </li>
            ))}
          </ul>
          {live && (
            <Checkbox
              label="Wyślij z domyślnym nadawcą konta SMSAPI (gdy nazwa szkoły nie jest jeszcze zarejestrowana w bramce)"
              checked={useDefaultSender}
              onChange={(e) => setUseDefaultSender(e.target.checked)}
            />
          )}
          {isAdmin && <AddNumberForm />}
        </Card>
      </div>

      <ConfirmModal
        open={target !== null}
        title={live ? 'Wysłać prawdziwy SMS?' : 'Wysłać SMS w trybie testowym?'}
        message={
          <p>
            {live ? (
              <>
                SMS zostanie wysłany przez SMSAPI na <strong>{target?.phoneMasked}</strong> ({target?.label}) i zużyje{' '}
                {plural(example.data?.info.parts ?? 0, 'część', 'części', 'części')} z salda.
              </>
            ) : (
              <>Tryb fake – nic nie zostanie wysłane, zobaczysz tylko wynik.</>
            )}
          </p>
        }
        confirmLabel="Wyślij"
        danger={live}
        busy={send.isPending}
        onConfirm={() => target && send.mutate(target)}
        onClose={() => setTarget(null)}
      />
    </>
  );
}

function AddNumberForm() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [phone, setPhone] = useState('');
  const add = useMutation({
    mutationFn: () => api.post<TestNumberDto>('/test-numbers', { label, phone }),
    onSuccess: async () => {
      setLabel('');
      setPhone('');
      await queryClient.invalidateQueries({ queryKey: ['test-numbers'] });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate();
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      {add.error && (
        <div className="sm:col-span-3">
          <Notice tone="error">{errorMessage(add.error)}</Notice>
        </div>
      )}
      <Field label="Opis">{(id) => <TextInput id={id} required placeholder="np. telefon dyrektora" value={label} onChange={(e) => setLabel(e.target.value)} />}</Field>
      <Field label="Numer komórkowy">
        {(id) => <TextInput id={id} required inputMode="tel" placeholder="600 100 200" value={phone} onChange={(e) => setPhone(e.target.value)} />}
      </Field>
      <Button type="submit" busy={add.isPending}>
        Dodaj numer
      </Button>
    </form>
  );
}

function RemoveNumber({ number }: { number: TestNumberDto }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.delete(`/test-numbers/${number.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['test-numbers'] }),
  });
  return (
    <Button variant="ghost" busy={remove.isPending} onClick={() => remove.mutate()} aria-label={`Usuń numer ${number.label}`}>
      Usuń
    </Button>
  );
}
