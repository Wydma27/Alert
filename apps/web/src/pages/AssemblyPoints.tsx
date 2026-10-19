import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { AssemblyPointDto } from '@alert/shared';
import { Badge, Button, Card, Checkbox, ConfirmModal, Field, Loading, Modal, Notice, PageHeader, TextInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

type Draft = { name: string; address: string; mapUrl: string; notes: string; active: boolean };
const EMPTY: Draft = { name: '', address: '', mapUrl: '', notes: '', active: true };

export function AssemblyPointsPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('ADMIN');
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['assembly-points'],
    queryFn: () => api.get<AssemblyPointDto[]>('/assembly-points'),
  });
  const [editing, setEditing] = useState<{ id: number | null; draft: Draft } | null>(null);
  const [toDelete, setToDelete] = useState<AssemblyPointDto | null>(null);

  const save = useMutation({
    mutationFn: ({ id, draft }: { id: number | null; draft: Draft }) =>
      id ? api.put(`/assembly-points/${id}`, draft) : api.post('/assembly-points', draft),
    onSuccess: async () => {
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['assembly-points'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/assembly-points/${id}`),
    onSuccess: async () => {
      setToDelete(null);
      await queryClient.invalidateQueries({ queryKey: ['assembly-points'] });
      await queryClient.invalidateQueries({ queryKey: ['classes'] });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (editing) save.mutate(editing);
  }

  const setField = (key: keyof Draft, value: string | boolean) =>
    setEditing((prev) => (prev ? { ...prev, draft: { ...prev.draft, [key]: value } } : prev));

  return (
    <>
      <PageHeader
        title="Punkty zbiórki"
        actions={
          canEdit && (
            <Button
              onClick={() => {
                save.reset();
                setEditing({ id: null, draft: EMPTY });
              }}
            >
              Dodaj punkt
            </Button>
          )
        }
      >
        Miejsca, do których ewakuowane są klasy. Adres trafia do SMS – podaj go tak, by rodzic trafił bez mapy.
      </PageHeader>

      {isLoading && <Loading />}
      {error && <Notice tone="error">{errorMessage(error)}</Notice>}
      {data?.length === 0 && <Notice tone="warning">Nie ma jeszcze żadnego punktu zbiórki.</Notice>}

      <div className="grid gap-3 md:grid-cols-2">
        {data?.map((p) => (
          <Card key={p.id} className={p.active ? '' : 'opacity-60'}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-bold">{p.name}</h2>
              {!p.active && <Badge>nieaktywny</Badge>}
            </div>
            <p>{p.address}</p>
            {p.notes && <p className="text-muted">{p.notes}</p>}
            {p.mapUrl && (
              <a href={p.mapUrl} target="_blank" rel="noreferrer noopener" className="font-semibold underline">
                Mapa
              </a>
            )}
            {canEdit && (
              <div className="mt-3 flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    save.reset();
                    setEditing({
                      id: p.id,
                      draft: { name: p.name, address: p.address, mapUrl: p.mapUrl ?? '', notes: p.notes ?? '', active: p.active },
                    });
                  }}
                >
                  Edytuj
                </Button>
                <Button variant="ghost" onClick={() => setToDelete(p)}>
                  Usuń
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>

      <Modal open={editing !== null} title={editing?.id ? 'Edycja punktu zbiórki' : 'Nowy punkt zbiórki'} onClose={() => setEditing(null)}>
        {editing && (
          <form onSubmit={submit} className="flex flex-col gap-3">
            {save.error && <Notice tone="error">{errorMessage(save.error)}</Notice>}
            <Field label="Nazwa" hint="Krótko, np. „Hala MOSiR”.">
              {(id) => <TextInput id={id} required value={editing.draft.name} onChange={(e) => setField('name', e.target.value)} />}
            </Field>
            <Field label="Adres">
              {(id) => <TextInput id={id} required value={editing.draft.address} onChange={(e) => setField('address', e.target.value)} />}
            </Field>
            <Field label="Link do mapy (opcjonalnie)" hint="https://… – np. z Google Maps lub OpenStreetMap.">
              {(id) => <TextInput id={id} type="url" value={editing.draft.mapUrl} onChange={(e) => setField('mapUrl', e.target.value)} />}
            </Field>
            <Field label="Uwagi dla personelu (opcjonalnie)" hint="Nie trafiają do SMS.">
              {(id) => <TextInput id={id} value={editing.draft.notes} onChange={(e) => setField('notes', e.target.value)} />}
            </Field>
            <Checkbox label="Aktywny" checked={editing.draft.active} onChange={(e) => setField('active', e.target.checked)} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" type="button" onClick={() => setEditing(null)}>
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
        title="Usunąć punkt zbiórki?"
        message={
          <>
            <p>
              <strong>{toDelete?.name}</strong> zostanie usunięty. Klasy, które miały go jako domyślny, zostaną bez punktu.
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
