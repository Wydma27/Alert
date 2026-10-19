import { useState, type FormEvent } from 'react';
import type { MeResponse } from '@alert/shared';
import { TotpEnrollment } from '../components/TotpEnrollment';
import { Button, Field, Notice, TextInput } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { AuthShell } from './Login';

export function TwoFactorPage() {
  const { me, setMe, refresh, logout } = useAuth();
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const logoutLink = (
    <button type="button" className="mt-4 text-sm font-semibold underline" onClick={() => void logout()}>
      Wyloguj i wróć do logowania
    </button>
  );

  if (me?.mfa === 'setup') {
    return (
      <AuthShell title="Włącz weryfikację dwuetapową">
        <p className="mb-4">
          Twoje konto może uruchamiać alerty, dlatego oprócz hasła wymagany jest kod z telefonu. Skonfigurujesz to raz.
        </p>
        <TotpEnrollment onFinished={setMe} />
        {logoutLink}
      </AuthShell>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<MeResponse & { recoveryCodesLeft?: number }>('/auth/2fa/verify', { code });
      if (res.recoveryCodesLeft !== undefined && res.recoveryCodesLeft <= 3) {
        window.alert(`Zostało ${res.recoveryCodesLeft} kodów zapasowych. Wygeneruj nowe w „Moje konto”, konfigurując 2FA ponownie.`);
      }
      setMe(res);
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
      // Blokada konta lub wygasła sesja logowania – serwer zakończył sesję, wracamy do ekranu logowania.
      if (err instanceof ApiError && (err.status === 423 || err.message === 'Zaloguj się.')) await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Kod weryfikacyjny">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <Notice tone="error">{error}</Notice>}
        {useRecovery ? (
          <Field label="Kod zapasowy" hint="Format XXXX-XXXX. Każdy kod działa tylko raz.">
            {(id) => (
              <TextInput id={id} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" required className="font-mono text-xl" />
            )}
          </Field>
        ) : (
          <Field label="6-cyfrowy kod z aplikacji uwierzytelniającej">
            {(id) => (
              <TextInput
                id={id}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                className="text-center font-mono text-2xl tracking-[0.4em]"
              />
            )}
          </Field>
        )}
        <Button type="submit" busy={busy} disabled={!useRecovery && code.length !== 6}>
          Potwierdź
        </Button>
        <button
          type="button"
          className="text-left font-semibold underline"
          onClick={() => {
            setUseRecovery((v) => !v);
            setCode('');
            setError(null);
          }}
        >
          {useRecovery ? 'Użyj kodu z aplikacji' : 'Nie mam telefonu – użyj kodu zapasowego'}
        </button>
      </form>
      {logoutLink}
    </AuthShell>
  );
}
