import { useState, type FormEvent } from 'react';
import { ROLE_LABELS, SENDER_ROLES } from '@alert/shared';
import { TotpEnrollment } from '../components/TotpEnrollment';
import { Button, Card, Field, Notice, PageHeader, TextInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

function useFormState() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      setSuccess(await fn());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, success, run };
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const form = useFormState();

  function submit(e: FormEvent) {
    e.preventDefault();
    void form.run(async () => {
      if (next !== repeat) throw new Error('Nowe hasła nie są takie same.');
      await api.post('/auth/password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setRepeat('');
      return 'Hasło zmienione. Inne urządzenia zostały wylogowane.';
    });
  }

  return (
    <Card>
      <h2 className="mb-3 text-xl font-bold">Zmiana hasła</h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {form.error && <Notice tone="error">{form.error}</Notice>}
        {form.success && <Notice tone="success">{form.success}</Notice>}
        <Field label="Obecne hasło">
          {(id) => <TextInput id={id} type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
        <Field label="Nowe hasło" hint="Co najmniej 12 znaków. Najlepiej kilka słów.">
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        <Field label="Powtórz nowe hasło">
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />}
        </Field>
        <Button type="submit" busy={form.busy} className="self-start">
          Zmień hasło
        </Button>
      </form>
    </Card>
  );
}

function PinForm({ hasPin }: { hasPin: boolean }) {
  const { me, setMe } = useAuth();
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const form = useFormState();

  function submit(e: FormEvent) {
    e.preventDefault();
    void form.run(async () => {
      await api.post('/auth/pin', { currentPassword: password, pin });
      setPassword('');
      setPin('');
      setMe({ ...me!, user: { ...me!.user, hasLaunchPin: true } });
      return 'PIN alarmowy zapisany.';
    });
  }

  return (
    <Card>
      <h2 className="mb-1 text-xl font-bold">PIN alarmowy</h2>
      <p className="mb-3 text-muted">
        Wpisujesz go przy uruchamianiu, zmianie i odwołaniu alertu – chroni przed przypadkowym kliknięciem.{' '}
        {hasPin ? 'PIN jest ustawiony.' : <strong className="text-alarm">PIN nie jest jeszcze ustawiony.</strong>}
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {form.error && <Notice tone="error">{form.error}</Notice>}
        {form.success && <Notice tone="success">{form.success}</Notice>}
        <Field label={hasPin ? 'Nowy PIN (4–8 cyfr)' : 'PIN (4–8 cyfr)'} hint="Bez oczywistych ciągów typu 1234 czy 1111.">
          {(id) => (
            <TextInput
              id={id}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              required
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              className="font-mono text-xl tracking-widest"
            />
          )}
        </Field>
        <Field label="Twoje hasło (potwierdzenie)">
          {(id) => <TextInput id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" busy={form.busy} className="self-start">
          Zapisz PIN
        </Button>
      </form>
    </Card>
  );
}

function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const { setMe } = useAuth();
  const [mode, setMode] = useState<'idle' | 'password' | 'enroll'>('idle');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);

  return (
    <Card>
      <h2 className="mb-1 text-xl font-bold">Weryfikacja dwuetapowa</h2>
      <p className="mb-3 text-muted">
        {enabled ? 'Włączona – przy logowaniu podajesz kod z aplikacji w telefonie.' : 'Wyłączona – logujesz się samym hasłem.'}
      </p>
      {done && <Notice tone="success">Gotowe – nowa konfiguracja i nowe kody zapasowe są aktywne.</Notice>}
      {mode === 'idle' && (
        <Button variant="secondary" onClick={() => setMode(enabled ? 'password' : 'enroll')}>
          {enabled ? 'Nowy telefon / nowe kody zapasowe' : 'Włącz weryfikację dwuetapową'}
        </Button>
      )}
      {mode === 'password' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setMode('enroll');
          }}
          className="flex flex-col gap-3"
        >
          <Field label="Potwierdź hasłem" hint="Poprzednia konfiguracja i kody zapasowe przestaną działać po potwierdzeniu nowej.">
            {(id) => <TextInput id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <div className="flex gap-2">
            <Button type="submit">Dalej</Button>
            <Button variant="ghost" type="button" onClick={() => setMode('idle')}>
              Anuluj
            </Button>
          </div>
        </form>
      )}
      {mode === 'enroll' && (
        <TotpEnrollment
          password={enabled ? password : undefined}
          onFinished={(me) => {
            setMe(me);
            setMode('idle');
            setPassword('');
            setDone(true);
          }}
        />
      )}
    </Card>
  );
}

export function AccountPage() {
  const { me } = useAuth();
  const user = me!.user;
  const isSender = SENDER_ROLES.includes(user.role);
  return (
    <>
      <PageHeader title="Moje konto">
        {user.fullName} · {user.email} · {ROLE_LABELS[user.role]}
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-2">
        {isSender && <PinForm hasPin={user.hasLaunchPin} />}
        <TwoFactorCard enabled={user.totpEnabled} />
        <PasswordForm />
      </div>
    </>
  );
}
