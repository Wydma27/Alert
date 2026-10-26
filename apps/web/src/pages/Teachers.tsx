import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { searchKey, type TeacherDto } from '@alert/shared';
import { PhoneReveal } from '../components/PhoneReveal';
import { Button, Card, ConfirmModal, Field, Loading, Modal, Notice, PageHeader, TextInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { plural } from '../lib/format';

type Draft = { firstName: string; lastName: string; position: string; phone: string };
const EMPTY: Draft = { firstName: '', lastName: '', position: '', phone: '' };

export function TeachersPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('ADMIN');
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const list = useQuery({ queryKey: ['teachers'], queryFn: () => api.get<TeacherDto[]>('/teachers') });
  const [q, setQ] = useState('');
  const [form, setForm] = useState<{ id: number | null; draft: Draft } | null>(null);
  const [toDelete, setToDelete] = useState<TeacherDto | null>(null);

  // Link z raportu „Numery do poprawy”: /nauczyciele?id=5 otwiera edycję.
  useEffect(() => {
    const id = Number(params.get('id'));
    const t = list.data?.find((x) => x.id === id);
    if (t && canEdit) {
      setForm({ id: t.id, draft: { firstName: t.firstName, lastName: t.lastName, position: t.position ?? '', phone: '' } });
      setParams({}, { replace: true });
    }
  }, [params, list.data, canEdit, setParams]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['teachers'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['notice-options'] });
  };
  const save = useMutation({
    mutationFn: ({ id, draft }: { id: number | null; draft: Draft }) => {
      const body: Record<string, unknown> = { firstName: draft.firstName, lastName: draft.lastName, position: draft.position || null };
      if (draft.phone) body.phone = draft.phone;
      return id ? api.put<TeacherDto>(`/teachers/${id}`, body) : api.post<TeacherDto>('/teachers', body);
    },
    onSuccess: () => {
      setForm(null);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/teachers/${id}`),
    onSuccess: () => {
      setToDelete(null);
      refresh();
    },
  });

  const filtered = useMemo(() => {
    const words = searchKey(q).split(/\s+/).filter(Boolean);
    return (list.data ?? []).filter((t) => {
      const key = searchKey(`${t.firstName} ${t.lastName} ${t.position ?? ''}`);
      return words.every((w) => key.includes(w));
    });
  }, [list.data, q]);

  return (
    <>
      <PageHeader
        title="Nauczyciele i pracownicy"
        actions={
          canEdit && (
            <>
              <Link to="/import?typ=nauczyciele" className="inline-flex min-h-12 items-center rounded-lg border-2 border-ink bg-surface px-4 font-semibold">
                Import z pliku
              </Link>
              <Button
                onClick={() => {
                  save.reset();
                  setForm({ id: null, draft: EMPTY });
                }}
              >
                Dodaj osobę
              </Button>
            </>
          )
        }
      >
        Grupa „Nauczyciele” w wiadomościach SMS. Numery są szyfrowane w bazie i maskowane na ekranie.
      </PageHeader>

      {list.isLoading && <Loading />}
      {list.error && <Notice tone="error">{errorMessage(list.error)}</Notice>}
      {list.data && (
        <>
          <div className="mb-3 max-w-md">
            <Field label="Szukaj">{(id) => <TextInput id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
          </div>
          <p className="mb-2 text-muted">{plural(filtered.length, 'osoba', 'osoby', 'osób')}</p>
          {list.data.length === 0 ? (
            <Notice>Lista jest pusta. Dodaj osoby ręcznie albo zaimportuj plik CSV / XLSX (imię, nazwisko, telefon, funkcja).</Notice>
          ) : (
            <ul className="flex flex-col gap-2">
              {filtered.map((t) => (
                <li key={t.id}>
                  <Card className="!p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-bold">
                          {t.lastName} {t.firstName}
                        </div>
                        {t.position && <div className="text-muted">{t.position}</div>}
                        <PhoneReveal path={`/teachers/${t.id}/phone`} masked={t.phoneMasked} />
                      </div>
                      {canEdit && (
                        <div className="flex gap-1">
                          <Button
                            variant="secondary"
                            onClick={() => {
                              save.reset();
                              setForm({ id: t.id, draft: { firstName: t.firstName, lastName: t.lastName, position: t.position ?? '', phone: '' } });
                            }}
                          >
                            Edytuj
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              remove.reset();
                              setToDelete(t);
                            }}
                          >
                            Usuń
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Modal open={form !== null} title={form?.id ? 'Edycja' : 'Nowa osoba'} onClose={() => setForm(null)}>
        {form && (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              save.mutate(form);
            }}
            className="flex flex-col gap-3"
          >
            {save.error && <Notice tone="error">{errorMessage(save.error)}</Notice>}
            <Field label="Imię">
              {(id) => (
                <TextInput id={id} required value={form.draft.firstName} onChange={(e) => setForm({ ...form, draft: { ...form.draft, firstName: e.target.value } })} />
              )}
            </Field>
            <Field label="Nazwisko">
              {(id) => (
                <TextInput id={id} required value={form.draft.lastName} onChange={(e) => setForm({ ...form, draft: { ...form.draft, lastName: e.target.value } })} />
              )}
            </Field>
            <Field label="Funkcja (opcjonalnie)" hint="Np. wychowawca 3B, sekretariat, woźny.">
              {(id) => (
                <TextInput id={id} value={form.draft.position} onChange={(e) => setForm({ ...form, draft: { ...form.draft, position: e.target.value } })} />
              )}
            </Field>
            <Field label={form.id ? 'Nowy numer telefonu (puste = bez zmian)' : 'Numer telefonu komórkowego'}>
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="tel"
                  autoComplete="off"
                  required={!form.id}
                  value={form.draft.phone}
                  onChange={(e) => setForm({ ...form, draft: { ...form.draft, phone: e.target.value } })}
                />
              )}
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" type="button" onClick={() => setForm(null)}>
                Anuluj
              </Button>
              <Button type="submit" busy={save.isPending}>
                Zapisz
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmModal
        open={toDelete !== null}
        title="Usunąć z listy?"
        message={
          <>
            <p>
              {toDelete?.firstName} {toDelete?.lastName} ({toDelete?.phoneMasked}) zniknie z grupy „Nauczyciele”. Numer zostanie usunięty z bazy.
            </p>
            {remove.error && <Notice tone="error">{errorMessage(remove.error)}</Notice>}
          </>
        }
        confirmLabel="Usuń"
        danger
        busy={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        onClose={() => setToDelete(null)}
      />
    </>
  );
}
