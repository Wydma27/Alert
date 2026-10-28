import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { MeResponse } from '@alert/shared';
import { Button, Card, Field, Notice, TextInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col items-center px-4 pt-10 pb-10 sm:pt-16">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-80 border-b-[3px] border-alarm bg-ink" />
      <div className="mb-6 flex flex-col items-center text-center text-white">
        <img src="/icon.svg" alt="" className="mb-3 size-16 rounded-2xl shadow-lift" />
        <div className="text-3xl font-black tracking-tight">
          <span className="text-red-400">ALERT</span> SZKOLNY
        </div>
        <p className="text-slate-300">Powiadomienia SMS: nauczyciele, uczniowie, rodzice</p>
      </div>
      <Card className="w-full max-w-md shadow-lift">
        <h1 className="mb-4 text-xl font-bold tracking-tight">{title}</h1>
        {children}
      </Card>
    </div>
  );
}

export function LoginPage() {
  const { setMe } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setMe(await api.post<MeResponse>('/auth/login', { email, password }));
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Logowanie">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="E-mail">
          {(id) => (
            <TextInput id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          )}
        </Field>
        <Field label="Hasło">
          {(id) => (
            <TextInput
              id={id}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" busy={busy}>
          Zaloguj
        </Button>
      </form>
      <p className="mt-5 border-t border-line pt-4 text-sm text-muted">
        Serwer lub baza nie działają?{' '}
        <Link to="/awaryjny" className="font-semibold text-ink underline">
          Tryb awaryjny
        </Link>{' '}
        – wysyłka SMS z kopii kontaktów zapisanej w tym urządzeniu.
      </p>
    </AuthShell>
  );
}
