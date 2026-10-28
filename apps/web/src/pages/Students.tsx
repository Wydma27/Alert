import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { ClassDto, StudentDetailDto, StudentListItemDto } from '@alert/shared';
import { Badge, Button, Checkbox, Field, Loading, Modal, Notice, PageHeader, Select, TextInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { plural } from '../lib/format';

export function StudentsPage() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('ADMIN');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const classId = params.get('klasa') ?? '';
  const withoutPhone = params.get('bezTelefonu') === '1';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(search);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const classes = useQuery({ queryKey: ['classes'], queryFn: () => api.get<ClassDto[]>('/classes') });
  const query = new URLSearchParams();
  if (classId) query.set('classId', classId);
  if (debounced) query.set('q', debounced);
  if (withoutPhone) query.set('withoutPhone', '1');
  const students = useQuery({
    queryKey: ['students', query.toString()],
    queryFn: () => api.get<StudentListItemDto[]>(`/students?${query.toString()}`),
  });

  return (
    <>
      <PageHeader title="Uczniowie" actions={canEdit && <Button onClick={() => setAdding(true)}>Dodaj ucznia</Button>}>
        {students.data && plural(students.data.length, 'uczeń', 'uczniów', 'uczniów')}
      </PageHeader>

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_12rem] lg:grid-cols-[1fr_12rem_auto]">
        <Field label="Szukaj">
          {(id) => <TextInput id={id} type="search" placeholder="Imię lub nazwisko" value={search} onChange={(e) => setSearch(e.target.value)} />}
        </Field>
        <Field label="Klasa">
          {(id) => (
            <Select id={id} value={classId} onChange={(e) => updateParam('klasa', e.target.value)}>
              <option value="">Wszystkie</option>
              {classes.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="self-end">
          <Checkbox label="Tylko bez numeru" checked={withoutPhone} onChange={(e) => updateParam('bezTelefonu', e.target.checked ? '1' : '')} />
        </div>
      </div>

      {students.isLoading && <Loading />}
      {students.error && <Notice tone="error">{errorMessage(students.error)}</Notice>}
      {students.data?.length === 0 && <Notice>Brak uczniów spełniających kryteria.</Notice>}

      {students.data && students.data.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          {students.data.map((s) => (
            <li key={s.id}>
              <Link to={`/uczniowie/${s.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-slate-100">
                <span>
                  <span className="font-semibold">
                    {s.lastName} {s.firstName}
                  </span>{' '}
                  <span className="text-muted">· {s.className}</span>
                </span>
                {s.alertableGuardianCount === 0 ? (
                  <Badge tone="warning">brak numeru</Badge>
                ) : (
                  <span className="text-sm text-muted">{plural(s.alertableGuardianCount, 'numer', 'numery', 'numerów')}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <AddStudentModal
          open
          classes={classes.data ?? []}
          defaultClassId={classId}
          onClose={() => setAdding(false)}
          onCreated={(id) => navigate(`/uczniowie/${id}`)}
        />
      )}
    </>
  );
}

function AddStudentModal({
  open,
  classes,
  defaultClassId,
  onClose,
  onCreated,
}: {
  open: boolean;
  classes: ClassDto[];
  defaultClassId: string;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [form, setForm] = useState({ firstName: '', lastName: '', classId: defaultClassId, externalId: '' });
  const create = useMutation({
    mutationFn: () =>
      api.post<StudentDetailDto>('/students', {
        firstName: form.firstName,
        lastName: form.lastName,
        classId: Number(form.classId),
        externalId: form.externalId || null,
      }),
    onSuccess: (s) => onCreated(s.id),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Modal open={open} title="Nowy uczeń" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {create.error && <Notice tone="error">{errorMessage(create.error)}</Notice>}
        <Field label="Imię">
          {(id) => <TextInput id={id} required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />}
        </Field>
        <Field label="Nazwisko">
          {(id) => <TextInput id={id} required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />}
        </Field>
        <Field label="Klasa">
          {(id) => (
            <Select id={id} required value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
              <option value="">— wybierz —</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Identyfikator z dziennika (opcjonalnie)" hint="Ułatwia kolejne importy. Nie wpisuj numeru PESEL.">
          {(id) => <TextInput id={id} value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} />}
        </Field>
        <p className="text-muted">Numery opiekunów dodasz na następnym ekranie.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" type="button" onClick={onClose}>
            Anuluj
          </Button>
          <Button type="submit" busy={create.isPending}>
            Dodaj
          </Button>
        </div>
      </form>
    </Modal>
  );
}
