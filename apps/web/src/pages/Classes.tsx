import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { AssemblyPointDto, ClassDto } from '@alert/shared';
import { Badge, Button, ConfirmModal, Field, Loading, Modal, Notice, PageHeader, Select, TextInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { plural } from '../lib/format';

export function ClassesPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('ADMIN');
  const queryClient = useQueryClient();
  const classes = useQuery({ queryKey: ['classes'], queryFn: () => api.get<ClassDto[]>('/classes') });
  const points = useQuery({ queryKey: ['assembly-points'], queryFn: () => api.get<AssemblyPointDto[]>('/assembly-points') });
  const [editing, setEditing] = useState<{ id: number | null; name: string; pointId: string } | null>(null);
  const [toDelete, setToDelete] = useState<ClassDto | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['classes'] });
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const save = useMutation({
    mutationFn: (v: { id: number | null; name: string; pointId: string }) => {
      const body = { name: v.name, defaultAssemblyPointId: v.pointId ? Number(v.pointId) : null };
      return v.id ? api.put(`/classes/${v.id}`, body) : api.post('/classes', body);
    },
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
  });
  /** Szybka zmiana punktu prosto z tabeli. */
  const setPoint = useMutation({
    mutationFn: ({ cls, pointId }: { cls: ClassDto; pointId: string }) =>
      api.put(`/classes/${cls.id}`, { name: cls.name, defaultAssemblyPointId: pointId ? Number(pointId) : null }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/classes/${id}`),
    onSuccess: async () => {
      setToDelete(null);
      await refresh();
    },
  });

  const pointName = new Map(points.data?.map((p) => [p.id, p.name]));
  const activePoints = points.data?.filter((p) => p.active) ?? [];

  function submit(e: FormEvent) {
    e.preventDefault();
    if (editing) save.mutate(editing);
  }

  return (
    <>
      <PageHeader
        title="Klasy"
        actions={
          canEdit && (
            <Button
              onClick={() => {
                save.reset();
                setEditing({ id: null, name: '', pointId: '' });
              }}
            >
              Dodaj klasę
            </Button>
          )
        }
      >
        Domyślny punkt zbiórki podpowiada się przy uruchamianiu alertu (można go wtedy zmienić).
      </PageHeader>

      {(classes.isLoading || points.isLoading) && <Loading />}
      {classes.error && <Notice tone="error">{errorMessage(classes.error)}</Notice>}
      {setPoint.error && <Notice tone="error">{errorMessage(setPoint.error)}</Notice>}
      {classes.data?.length === 0 && <Notice tone="info">Brak klas. Dodaj je ręcznie albo zaimportuj plik z dziennika.</Notice>}

      {classes.data && classes.data.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border-2 border-line bg-surface">
          {classes.data.map((c) => (
            <li key={c.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-4">
              <div className="flex items-baseline gap-4 md:w-56 md:shrink-0">
                <span className="w-12 text-xl font-black">{c.name}</span>
                <span>
                  <Link to={`/uczniowie?klasa=${c.id}`} className="font-semibold underline">
                    {plural(c.studentCount, 'uczeń', 'uczniów', 'uczniów')}
                  </Link>
                  {c.studentsWithoutPhone > 0 && (
                    <span className="block">
                      <Badge tone="warning">{c.studentsWithoutPhone} bez numeru</Badge>
                    </span>
                  )}
                </span>
              </div>
              <div className="flex-1">
                {canEdit ? (
                  <Select
                    aria-label={`Domyślny punkt zbiórki klasy ${c.name}`}
                    value={c.defaultAssemblyPointId ?? ''}
                    onChange={(e) => setPoint.mutate({ cls: c, pointId: e.target.value })}
                  >
                    <option value="">— brak punktu zbiórki —</option>
                    {activePoints.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                ) : c.defaultAssemblyPointId ? (
                  <span>
                    <span className="text-muted">Punkt zbiórki: </span>
                    <strong>{pointName.get(c.defaultAssemblyPointId)}</strong>
                  </span>
                ) : (
                  <Badge tone="warning">brak punktu zbiórki</Badge>
                )}
              </div>
              {canEdit && (
                <div className="flex gap-1 md:shrink-0">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      save.reset();
                      setEditing({ id: c.id, name: c.name, pointId: c.defaultAssemblyPointId ? String(c.defaultAssemblyPointId) : '' });
                    }}
                  >
                    Zmień nazwę
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      remove.reset();
                      setToDelete(c);
                    }}
                  >
                    Usuń
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={editing !== null} title={editing?.id ? 'Edycja klasy' : 'Nowa klasa'} onClose={() => setEditing(null)}>
        {editing && (
          <form onSubmit={submit} className="flex flex-col gap-3">
            {save.error && <Notice tone="error">{errorMessage(save.error)}</Notice>}
            <Field label="Nazwa klasy" hint="Np. 3B – tak, jak w SMS.">
              {(id) => <TextInput id={id} required maxLength={20} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />}
            </Field>
            <Field label="Domyślny punkt zbiórki">
              {(id) => (
                <Select id={id} value={editing.pointId} onChange={(e) => setEditing({ ...editing, pointId: e.target.value })}>
                  <option value="">— brak —</option>
                  {activePoints.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
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
        title={`Usunąć klasę ${toDelete?.name ?? ''}?`}
        message={
          <>
            <p className="mb-2">
              Zostanie usunięta klasa razem z{' '}
              <strong>{plural(toDelete?.studentCount ?? 0, 'uczniem', 'uczniami', 'uczniami')}</strong> i numerami ich opiekunów (o ile
              nie mają innych dzieci w szkole). Tego nie można cofnąć.
            </p>
            <p className="text-muted">Używaj np. po zakończeniu roku szkolnego dla klas absolwentów.</p>
            {remove.error && <Notice tone="error">{errorMessage(remove.error)}</Notice>}
          </>
        }
        confirmLabel="Usuń klasę i uczniów"
        danger
        busy={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        onClose={() => setToDelete(null)}
      />
    </>
  );
}
