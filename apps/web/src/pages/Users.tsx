import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ROLE_LABELS, ROLES, requiresTwoFactor, type Role, type UserDto } from '@alert/shared';
import { Badge, Button, ConfirmModal, Field, Loading, Modal, Notice, PageHeader, Select, TextInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';

type Action = { user: UserDto; kind: 'reset-2fa' | 'deactivate' | 'activate' | 'unlock' };

export function UsersPage() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserDto[]>('/users') });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [passwordFor, setPasswordFor] = useState<UserDto | null>(null);
  const [action, setAction] = useState<Action | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const runAction = useMutation({
    mutationFn: ({ user, kind }: Action) => {
      if (kind === 'reset-2fa') return api.post(`/users/${user.id}/reset-2fa`);
      if (kind === 'unlock') return api.post(`/users/${user.id}/unlock`);
      return api.patch(`/users/${user.id}`, { isActive: kind === 'activate' });
    },
    onSuccess: async () => {
      setAction(null);
      await refresh();
    },
  });

  const actionText: Record<Action['kind'], { title: string; message: string; label: string }> = {
    'reset-2fa': {
      title: 'Zresetować weryfikację dwuetapową?',
      message: 'Użyj, gdy pracownik zgubił telefon. Przy następnym logowaniu skonfiguruje aplikację od nowa. Zostanie wylogowany.',
      label: 'Resetuj 2FA',
    },
    deactivate: {
      title: 'Dezaktywować konto?',
      message: 'Pracownik nie zaloguje się i zostanie wylogowany ze wszystkich urządzeń. Wpisy w dzienniku zostają.',
      label: 'Dezaktywuj',
    },
    activate: { title: 'Aktywować konto?', message: 'Pracownik znów będzie mógł się logować.', label: 'Aktywuj' },
    unlock: { title: 'Odblokować konto?', message: 'Konto zostało zablokowane po nieudanych próbach logowania.', label: 'Odblokuj' },
  };

  return (
    <>
      <PageHeader title="Użytkownicy" actions={<Button onClick={() => setCreating(true)}>Dodaj użytkownika</Button>}>
        Konta pracowników. Rodzice nie mają kont – dostają tylko SMS.
      </PageHeader>
      {users.isLoading && <Loading />}
      {users.error && <Notice tone="error">{errorMessage(users.error)}</Notice>}

      <ul className="flex flex-col gap-3">
        {users.data?.map((u) => (
          <li key={u.id} className={`rounded-2xl border border-line bg-surface shadow-card p-4 ${u.isActive ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold">
                  {u.fullName} {u.id === me!.user.id && <span className="font-normal text-muted">(Ty)</span>}
                </div>
                <div className="text-muted">{u.email}</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Badge>{ROLE_LABELS[u.role]}</Badge>
                  {!u.isActive && <Badge tone="error">nieaktywne</Badge>}
                  {u.lockedUntil && <Badge tone="error">zablokowane do {formatDateTime(u.lockedUntil)}</Badge>}
                  {u.totpEnabled ? (
                    <Badge tone="success">2FA włączone</Badge>
                  ) : requiresTwoFactor(u.role) ? (
                    <Badge tone="warning">2FA przy pierwszym logowaniu</Badge>
                  ) : (
                    <Badge>bez 2FA</Badge>
                  )}
                </div>
                <div className="mt-1 text-sm text-muted">Ostatnie logowanie: {formatDateTime(u.lastLoginAt)}</div>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button variant="secondary" onClick={() => setEditing(u)}>
                  Edytuj
                </Button>
                <Button variant="ghost" onClick={() => setPasswordFor(u)}>
                  Nowe hasło
                </Button>
                {u.totpEnabled && (
                  <Button variant="ghost" onClick={() => setAction({ user: u, kind: 'reset-2fa' })}>
                    Reset 2FA
                  </Button>
                )}
                {u.lockedUntil && (
                  <Button variant="ghost" onClick={() => setAction({ user: u, kind: 'unlock' })}>
                    Odblokuj
                  </Button>
                )}
                {u.id !== me!.user.id && (
                  <Button variant="ghost" onClick={() => setAction({ user: u, kind: u.isActive ? 'deactivate' : 'activate' })}>
                    {u.isActive ? 'Dezaktywuj' : 'Aktywuj'}
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {creating && <UserFormModal onClose={() => setCreating(false)} onSaved={refresh} />}
      {editing && <UserFormModal user={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {passwordFor && <PasswordModal user={passwordFor} onClose={() => setPasswordFor(null)} onSaved={refresh} />}

      <ConfirmModal
        open={action !== null}
        title={action ? actionText[action.kind].title : ''}
        message={
          <>
            <p className="mb-2">
              <strong>{action?.user.fullName}</strong>
            </p>
            <p>{action && actionText[action.kind].message}</p>
            {runAction.error && <Notice tone="error">{errorMessage(runAction.error)}</Notice>}
          </>
        }
        confirmLabel={action ? actionText[action.kind].label : ''}
        danger={action?.kind === 'deactivate' || action?.kind === 'reset-2fa'}
        busy={runAction.isPending}
        onConfirm={() => action && runAction.mutate(action)}
        onClose={() => {
          runAction.reset();
          setAction(null);
        }}
      />
    </>
  );
}

function UserFormModal({ user, onClose, onSaved }: { user?: UserDto; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ email: user?.email ?? '', fullName: user?.fullName ?? '', role: (user?.role ?? 'NAUCZYCIEL') as Role, password: '' });
  const save = useMutation({
    mutationFn: () =>
      user
        ? api.patch(`/users/${user.id}`, { fullName: form.fullName, role: form.role })
        : api.post('/users', form),
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Modal open title={user ? 'Edycja użytkownika' : 'Nowy użytkownik'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {save.error && <Notice tone="error">{errorMessage(save.error)}</Notice>}
        <Field label="Imię i nazwisko">
          {(id) => <TextInput id={id} required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />}
        </Field>
        {!user && (
          <Field label="E-mail (login)">
            {(id) => <TextInput id={id} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
          </Field>
        )}
        <Field
          label="Rola"
          hint={
            form.role === 'NAUCZYCIEL'
              ? 'Nauczyciel: lista obecności w punkcie zbiórki. Nie widzi numerów rodziców i nie wysyła alertów.'
              : form.role === 'DYREKCJA'
                ? 'Dyrekcja: uruchamia alerty i monitoruje doręczenia. Wymagana weryfikacja dwuetapowa.'
                : 'Administrator: pełna konfiguracja, dane, użytkownicy. Wymagana weryfikacja dwuetapowa.'
          }
        >
          {(id) => (
            <Select id={id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {!user && (
          <Field label="Hasło tymczasowe" hint="Min. 12 znaków. Przekaż je osobiście – pracownik zmieni je w „Moje konto”.">
            {(id) => <TextInput id={id} type="text" autoComplete="off" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
          </Field>
        )}
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

function PasswordModal({ user, onClose, onSaved }: { user: UserDto; onClose: () => void; onSaved: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/users/${user.id}/reset-password`, { password }),
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
  });
  return (
    <Modal open title={`Nowe hasło: ${user.fullName}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="flex flex-col gap-3"
      >
        {save.error && <Notice tone="error">{errorMessage(save.error)}</Notice>}
        <Field label="Hasło tymczasowe" hint="Min. 12 znaków. Konto zostanie odblokowane i wylogowane ze wszystkich urządzeń.">
          {(id) => <TextInput id={id} autoComplete="off" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" type="button" onClick={onClose}>
            Anuluj
          </Button>
          <Button type="submit" busy={save.isPending}>
            Ustaw hasło
          </Button>
        </div>
      </form>
    </Modal>
  );
}
