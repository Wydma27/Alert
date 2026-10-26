import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { MeResponse } from '@alert/shared';
import { Button, Card, Field, Notice, TextInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-8">
      <div className="mb-6 text-center">
        <div className="text-3xl font-black tracking-tight">
          <span className="text-alarm">ALERT</span> SZKOLNY
        </div>
        <p className="text-muted">Powiadomienia SMS: nauczyciele, uczniowie, rodzice</p>
      </div>
      <Card className="w-full max-w-md">
        <h1 className="mb-4 text-xl font-bold">{title}</h1>
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
      <p className="mt-4 border-t-2 border-line pt-3 text-sm">
        Serwer lub baza nie działają?{' '}
        <Link to="/awaryjny" className="font-semibold underline">
          Tryb awaryjny
        </Link>{' '}
        – wysyłka SMS z kopii kontaktów zapisanej w tym urządzeniu.
      </p>
    </AuthShell>
  );
}
