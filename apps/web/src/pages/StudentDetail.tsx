import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ClassDto, GuardianLinkDto, StudentDetailDto } from '@alert/shared';
import { PhoneReveal } from '../components/PhoneReveal';
import { Badge, Button, Card, Checkbox, ConfirmModal, Field, Loading, Modal, Notice, PageHeader, Select, TextInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

type GuardianDraft = { displayName: string; phone: string; priority: number; receivesAlerts: boolean; canPickUp: boolean };

export function StudentDetailPage() {
  const id = Number(useParams().id);
  const { hasRole } = useAuth();
  const canEdit = hasRole('ADMIN');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const key = ['student', id];
  const student = useQuery({ queryKey: key, queryFn: () => api.get<StudentDetailDto>(`/students/${id}`) });
  const classes = useQuery({ queryKey: ['classes'], queryFn: () => api.get<ClassDto[]>('/classes'), enabled: canEdit });

  const [editingData, setEditingData] = useState(false);
  const [guardianForm, setGuardianForm] = useState<{ guardianId: number | null; draft: GuardianDraft } | null>(null);
  const [toUnlink, setToUnlink] = useState<GuardianLinkDto | null>(null);
  const [deleting, setDeleting] = useState(false);

  const afterChange = async (data?: StudentDetailDto) => {
    if (data) queryClient.setQueryData(key, data);
    await queryClient.invalidateQueries({ queryKey: ['students'] });
    await queryClient.invalidateQueries({ queryKey: ['classes'] });
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const saveGuardian = useMutation({
    mutationFn: ({ guardianId, draft }: { guardianId: number | null; draft: GuardianDraft }) => {
      const body: Record<string, unknown> = {
        displayName: draft.displayName,
        priority: draft.priority,
        receivesAlerts: draft.receivesAlerts,
        canPickUp: draft.canPickUp,
      };
      if (draft.phone) body.phone = draft.phone;
      return guardianId
        ? api.put<StudentDetailDto>(`/students/${id}/guardians/${guardianId}`, body)
        : api.post<StudentDetailDto>(`/students/${id}/guardians`, body);
    },
    onSuccess: async (data) => {
      setGuardianForm(null);
      await afterChange(data);
    },
  });
  const unlink = useMutation({
    mutationFn: (guardianId: number) => api.delete<StudentDetailDto>(`/students/${id}/guardians/${guardianId}`),
    onSuccess: async (data) => {
      setToUnlink(null);
      await afterChange(data);
    },
  });
  const removeStudent = useMutation({
    mutationFn: () => api.delete(`/students/${id}`),
    onSuccess: async () => {
      await afterChange();
      navigate('/uczniowie', { replace: true });
    },
  });

  if (student.isLoading) return <Loading />;
  if (student.error || !student.data) return <Notice tone="error">{errorMessage(student.error)}</Notice>;
  const s = student.data;
  const nextPriority = Math.max(0, ...s.guardians.map((g) => g.priority)) + 1;

  return (
    <>
      <Link to={`/uczniowie?klasa=${s.classId}`} className="mb-2 inline-block font-semibold underline">
        ← Klasa {s.className}
      </Link>
      <PageHeader
        title={`${s.firstName} ${s.lastName}`}
        actions={
          canEdit && (
            <>
              <Button variant="secondary" onClick={() => setEditingData(true)}>
                Edytuj dane
              </Button>
              <Button variant="ghost" onClick={() => setDeleting(true)}>
                Usuń ucznia
              </Button>
            </>
          )
        }
      >
        Klasa {s.className}
        {s.externalId && <> · ID w dzienniku: {s.externalId}</>}
      </PageHeader>

      <OwnPhoneCard student={s} canEdit={canEdit} onSaved={afterChange} />

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold">Opiekunowie</h2>
          {canEdit && (
            <Button
              onClick={() => {
                saveGuardian.reset();
                setGuardianForm({
                  guardianId: null,
                  draft: { displayName: '', phone: '', priority: nextPriority, receivesAlerts: true, canPickUp: true },
                });
              }}
            >
              Dodaj opiekuna
            </Button>
          )}
        </div>

        {s.guardians.length === 0 && <Notice tone="warning">Brak numeru opiekuna – rodzice tego ucznia nie dostaną SMS.</Notice>}
        {s.guardians.length > 0 && s.alertableGuardianCount === 0 && (
          <Notice tone="warning">Żaden opiekun nie ma włączonych SMS-ów alarmowych.</Notice>
        )}

        <ul className="flex flex-col gap-3">
          {s.guardians.map((g) => (
            <li key={g.guardianId} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-bold">
                    {g.priority}. {g.displayName ?? 'Opiekun (bez nazwiska)'}
                  </div>
                  <PhoneReveal path={`/guardians/${g.guardianId}/phone`} masked={g.phoneMasked} />
                  <div className="mt-1 flex flex-wrap gap-2">
                    {g.receivesAlerts ? <Badge tone="success">dostaje SMS</Badge> : <Badge tone="warning">bez SMS</Badge>}
                    {g.canPickUp ? <Badge>może odebrać dziecko</Badge> : <Badge tone="error">NIE może odebrać dziecka</Badge>}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        saveGuardian.reset();
                        setGuardianForm({
                          guardianId: g.guardianId,
                          draft: {
                            displayName: g.displayName ?? '',
                            phone: '',
                            priority: g.priority,
                            receivesAlerts: g.receivesAlerts,
                            canPickUp: g.canPickUp,
                          },
                        });
                      }}
                    >
                      Edytuj
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        unlink.reset();
                        setToUnlink(g);
                      }}
                    >
                      Usuń
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {canEdit && editingData && (
        <EditStudentModal
          student={s}
          classes={classes.data ?? []}
          onClose={() => setEditingData(false)}
          onSaved={async (data) => {
            setEditingData(false);
            await afterChange(data);
          }}
        />
      )}

      <Modal open={guardianForm !== null} title={guardianForm?.guardianId ? 'Edycja opiekuna' : 'Nowy opiekun'} onClose={() => setGuardianForm(null)}>
        {guardianForm && (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              saveGuardian.mutate(guardianForm);
            }}
            className="flex flex-col gap-3"
          >
            {saveGuardian.error && <Notice tone="error">{errorMessage(saveGuardian.error)}</Notice>}
            <Field label="Imię i nazwisko (opcjonalnie)" hint="Przydaje się przy telefonie i odbiorze dziecka.">
              {(fid) => (
                <TextInput
                  id={fid}
                  value={guardianForm.draft.displayName}
                  onChange={(e) => setGuardianForm({ ...guardianForm, draft: { ...guardianForm.draft, displayName: e.target.value } })}
                />
              )}
            </Field>
            <Field
              label={guardianForm.guardianId ? 'Nowy numer telefonu (puste = bez zmian)' : 'Numer telefonu komórkowego'}
              hint={guardianForm.guardianId ? 'Zmiana dotyczy wszystkich dzieci tego opiekuna.' : 'Np. 600 100 200 albo +380… dla numerów zagranicznych.'}
            >
              {(fid) => (
                <TextInput
                  id={fid}
                  inputMode="tel"
                  autoComplete="off"
                  required={!guardianForm.guardianId}
                  value={guardianForm.draft.phone}
                  onChange={(e) => setGuardianForm({ ...guardianForm, draft: { ...guardianForm.draft, phone: e.target.value } })}
                />
              )}
            </Field>
            <Field label="Kolejność kontaktu">
              {(fid) => (
                <Select
                  id={fid}
                  value={guardianForm.draft.priority}
                  onChange={(e) => setGuardianForm({ ...guardianForm, draft: { ...guardianForm.draft, priority: Number(e.target.value) } })}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Checkbox
              label="Dostaje SMS-y alarmowe"
              checked={guardianForm.draft.receivesAlerts}
              onChange={(e) => setGuardianForm({ ...guardianForm, draft: { ...guardianForm.draft, receivesAlerts: e.target.checked } })}
            />
            <Checkbox
              label="Może odebrać dziecko z punktu zbiórki"
              checked={guardianForm.draft.canPickUp}
              onChange={(e) => setGuardianForm({ ...guardianForm, draft: { ...guardianForm.draft, canPickUp: e.target.checked } })}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" type="button" onClick={() => setGuardianForm(null)}>
                Anuluj
              </Button>
              <Button type="submit" busy={saveGuardian.isPending}>
                Zapisz
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmModal
        open={toUnlink !== null}
        title="Usunąć opiekuna?"
        message={
          <>
            <p>
              {toUnlink?.displayName ?? 'Opiekun'} ({toUnlink?.phoneMasked}) przestanie być przypisany do tego ucznia. Jeśli nie ma innych
              dzieci w szkole, jego numer zostanie usunięty z systemu.
            </p>
            {unlink.error && <Notice tone="error">{errorMessage(unlink.error)}</Notice>}
          </>
        }
        confirmLabel="Usuń"
        danger
        busy={unlink.isPending}
        onConfirm={() => toUnlink && unlink.mutate(toUnlink.guardianId)}
        onClose={() => setToUnlink(null)}
      />

      <ConfirmModal
        open={deleting}
        title="Usunąć ucznia?"
        message={
          <>
            <p>
              Dane ucznia <strong>{s.firstName} {s.lastName}</strong> zostaną trwale usunięte, razem z numerami opiekunów, którzy nie mają innych
              dzieci w szkole.
            </p>
            {removeStudent.error && <Notice tone="error">{errorMessage(removeStudent.error)}</Notice>}
          </>
        }
        confirmLabel="Usuń trwale"
        danger
        busy={removeStudent.isPending}
        onConfirm={() => removeStudent.mutate()}
        onClose={() => setDeleting(false)}
      />
    </>
  );
}

/** Własny numer ucznia – grupa „Uczniowie” w wiadomościach SMS (np. starsze klasy). */
function OwnPhoneCard({
  student,
  canEdit,
  onSaved,
}: {
  student: StudentDetailDto;
  canEdit: boolean;
  onSaved: (s: StudentDetailDto) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const save = useMutation({
    mutationFn: (value: string | null) => api.put<StudentDetailDto>(`/students/${student.id}/phone`, { phone: value }),
    onSuccess: async (data) => {
      setEditing(false);
      setPhone('');
      await onSaved(data);
    },
  });

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">Telefon ucznia</h2>
          <p className="text-muted">Własny numer ucznia – do wiadomości dla grupy „Uczniowie”. Alarm ewakuacyjny idzie do opiekunów.</p>
          <div className="mt-1">
            {student.phoneMasked ? (
              <PhoneReveal path={`/students/${student.id}/phone`} masked={student.phoneMasked} />
            ) : (
              <span className="text-muted">brak numeru</span>
            )}
          </div>
        </div>
        {canEdit && !editing && (
          <div className="flex gap-1">
            <Button
              variant="secondary"
              onClick={() => {
                save.reset();
                setEditing(true);
              }}
            >
              {student.phoneMasked ? 'Zmień' : 'Dodaj numer'}
            </Button>
            {student.phoneMasked && (
              <Button variant="ghost" busy={save.isPending} onClick={() => save.mutate(null)}>
                Usuń
              </Button>
            )}
          </div>
        )}
      </div>
      {editing && (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(phone);
          }}
        >
          <div className="flex-1">
            <Field label="Numer komórkowy ucznia">
              {(id) => <TextInput id={id} inputMode="tel" autoComplete="off" required value={phone} onChange={(e) => setPhone(e.target.value)} />}
            </Field>
          </div>
          <Button type="submit" busy={save.isPending}>
            Zapisz
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Anuluj
          </Button>
        </form>
      )}
      {save.error && (
        <div className="mt-2">
          <Notice tone="error">{errorMessage(save.error)}</Notice>
        </div>
      )}
    </Card>
  );
}

function EditStudentModal({
  student,
  classes,
  onClose,
  onSaved,
}: {
  student: StudentDetailDto;
  classes: ClassDto[];
  onClose: () => void;
  onSaved: (s: StudentDetailDto) => Promise<void>;
}) {
  const [form, setForm] = useState({
    firstName: student.firstName,
    lastName: student.lastName,
    classId: String(student.classId),
    externalId: student.externalId ?? '',
  });
  const save = useMutation({
    mutationFn: () =>
      api.put<StudentDetailDto>(`/students/${student.id}`, {
        firstName: form.firstName,
        lastName: form.lastName,
        classId: Number(form.classId),
        externalId: form.externalId || null,
      }),
    onSuccess: onSaved,
  });

  return (
    <Modal open title="Dane ucznia" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="flex flex-col gap-3"
      >
        {save.error && <Notice tone="error">{errorMessage(save.error)}</Notice>}
        <Field label="Imię">
          {(id) => <TextInput id={id} required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />}
        </Field>
        <Field label="Nazwisko">
          {(id) => <TextInput id={id} required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />}
        </Field>
        <Field label="Klasa">
          {(id) => (
            <Select id={id} value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Identyfikator z dziennika">
          {(id) => <TextInput id={id} value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} />}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" type="button" onClick={onClose}>
            Anuluj
          </Button>
          <Button type="submit" busy={save.isPending}>
            Zapisz
          </Button>
        </div>
      </form>
    </Modal>
  );
}
