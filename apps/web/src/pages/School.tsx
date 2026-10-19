import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import type { SchoolDto } from '@alert/shared';
import { Button, Card, Field, Loading, Notice, PageHeader, TextInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';

export function SchoolPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['school'], queryFn: () => api.get<SchoolDto>('/school') });
  const [form, setForm] = useState<SchoolDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  if (isLoading || !form) return <Loading />;

  const set = (key: keyof SchoolDto) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false);
    setForm({ ...form, [key]: e.target.value });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put('/school', form);
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['school'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Dane szkoły">Te dane trafiają do treści SMS – pisz krótko.</PageHeader>
      <Card className="max-w-2xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && <Notice tone="error">{error}</Notice>}
          {saved && <Notice tone="success">Zapisano.</Notice>}
          <Field label="Pełna nazwa szkoły">
            {(id) => <TextInput id={id} required value={form.name} onChange={set('name')} />}
          </Field>
          <Field label="Nazwa w SMS" hint={`Krótka, np. „SP12 Lublin”. Każdy znak kosztuje – teraz ${form.smsName.length} znaków.`}>
            {(id) => <TextInput id={id} required maxLength={40} value={form.smsName} onChange={set('smsName')} />}
          </Field>
          <Field label="Adres">
            {(id) => <TextInput id={id} required value={form.address} onChange={set('address')} />}
          </Field>
          <Field label="Telefon kontaktowy dla rodziców" hint="Podawany w SMS. Najlepiej numer, który ktoś odbierze w trakcie ewakuacji.">
            {(id) => <TextInput id={id} required inputMode="tel" value={form.contactPhone} onChange={set('contactPhone')} />}
          </Field>
          <Field
            label="Nadawca SMS"
            hint="Tak podpisany będzie SMS, np. „SP12-ALERT”. Do 11 znaków, bez polskich liter. Nazwę trzeba zarejestrować w panelu bramki SMS."
          >
            {(id) => <TextInput id={id} required maxLength={11} value={form.senderName} onChange={set('senderName')} className="font-mono uppercase" />}
          </Field>
          <Button type="submit" busy={busy} className="self-start">
            Zapisz
          </Button>
        </form>
      </Card>
    </>
  );
}
