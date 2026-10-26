import { useState } from 'react';
import { api, errorMessage } from '../lib/api';

/** Numer jest maskowany; pełny pobierany na żądanie (wpis w dzienniku zdarzeń). */
export function PhoneReveal({ path, masked }: { path: string; masked: string }) {
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reveal() {
    setBusy(true);
    try {
      setPhone((await api.get<{ phone: string }>(path)).phone);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (phone) {
    return (
      <a href={`tel:${phone.replace(/\s/g, '')}`} className="font-mono text-lg font-semibold underline">
        {phone}
      </a>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-lg">{masked}</span>
      <button type="button" className="text-sm font-semibold underline" onClick={() => void reveal()} disabled={busy}>
        {busy ? 'Pobieranie…' : 'Pokaż numer'}
      </button>
      {error && <span className="text-sm text-alarm">{error}</span>}
    </div>
  );
}
