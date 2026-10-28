import { useState, type FormEvent } from 'react';
import type { MeResponse } from '@alert/shared';
import { api, errorMessage } from '../lib/api';
import { Button, Field, Notice, TextInput } from './ui';

interface SetupStart {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
}

/**
 * Konfiguracja aplikacji uwierzytelniającej: QR -> kod -> kody zapasowe.
 * `password` jest wymagane przy zmianie istniejącej konfiguracji.
 */
export function TotpEnrollment({
  password,
  onFinished,
}: {
  password?: string;
  onFinished: (me: MeResponse) => void;
}) {
  const [setup, setSetup] = useState<SetupStart | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ me: MeResponse; codes: string[] } | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setSetup(await api.post<SetupStart>('/auth/2fa/setup/start', password ? { password } : {}));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<MeResponse & { recoveryCodes: string[] }>('/auth/2fa/setup/confirm', { code });
      const { recoveryCodes, ...me } = res;
      setResult({ me, codes: recoveryCodes });
    } catch (err) {
      setError(errorMessage(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success">Weryfikacja dwuetapowa jest włączona.</Notice>
        <div>
          <h3 className="mb-2 text-lg font-bold">Kody zapasowe</h3>
          <p className="mb-3">
            Każdy kod działa jeden raz – użyjesz go, gdy nie będziesz mieć telefonu. Zapisz je teraz (wydruk, sejf, menedżer
            haseł). <strong>Nie zobaczysz ich ponownie.</strong>
          </p>
          <ol className="grid grid-cols-2 gap-2 rounded-lg border-2 border-ink bg-slate-50 p-4 font-mono text-lg">
            {result.codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(result.codes.join('\n'))}>
            Kopiuj kody
          </Button>
          <Button onClick={() => onFinished(result.me)}>Zapisałem kody – dalej</Button>
        </div>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="flex flex-col gap-3">
        <p>
          Potrzebujesz aplikacji uwierzytelniającej w telefonie, np. <strong>Google Authenticator</strong> lub{' '}
          <strong>Microsoft Authenticator</strong>.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        <Button onClick={() => void start()} busy={busy}>
          Rozpocznij konfigurację
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="flex flex-col gap-4">
      <ol className="list-decimal space-y-2 pl-5">
        <li>Otwórz aplikację uwierzytelniającą i dodaj konto (zeskanuj kod QR).</li>
        <li>Wpisz 6-cyfrowy kod, który pokaże aplikacja.</li>
      </ol>
      <img src={setup.qrDataUrl} alt="Kod QR do aplikacji uwierzytelniającej" className="size-60 self-center border-2 border-ink" />
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">Nie mogę zeskanować – pokaż klucz</summary>
        <p className="mt-2 break-all font-mono text-base">{setup.secret.match(/.{1,4}/g)?.join(' ')}</p>
      </details>
      <Field label="Kod z aplikacji" error={error}>
        {(id) => (
          <TextInput
            id={id}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            required
            className="text-center font-mono text-2xl tracking-[0.4em]"
          />
        )}
      </Field>
      <Button type="submit" busy={busy} disabled={code.length !== 6}>
        Potwierdź
      </Button>
    </form>
  );
}
