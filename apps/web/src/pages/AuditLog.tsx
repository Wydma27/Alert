import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { AuditEntryDto } from '@alert/shared';
import { Button, Field, Loading, Notice, PageHeader, Select, TextInput } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Logowanie',
  'auth.login.password_ok': 'Hasło poprawne (oczekuje na kod)',
  'auth.login.failed': 'Nieudane logowanie',
  'auth.login.blocked': 'Próba logowania na zablokowane konto',
  'auth.logout': 'Wylogowanie',
  'auth.2fa.failed': 'Błędny kod 2FA',
  'auth.2fa.enabled': 'Włączenie 2FA',
  'auth.password.changed': 'Zmiana hasła',
  'auth.pin.set': 'Ustawienie PIN-u alarmowego',
  'school.update': 'Zmiana danych szkoły',
  'assembly_point.create': 'Dodanie punktu zbiórki',
  'assembly_point.update': 'Zmiana punktu zbiórki',
  'assembly_point.delete': 'Usunięcie punktu zbiórki',
  'class.create': 'Dodanie klasy',
  'class.update': 'Zmiana klasy',
  'class.delete': 'Usunięcie klasy',
  'student.view': 'Podgląd danych ucznia',
  'student.create': 'Dodanie ucznia',
  'student.update': 'Zmiana danych ucznia',
  'student.delete': 'Usunięcie ucznia',
  'guardian.link': 'Dodanie opiekuna',
  'guardian.update': 'Zmiana opiekuna',
  'guardian.unlink': 'Usunięcie opiekuna',
  'guardian.phone.reveal': 'Odsłonięcie numeru telefonu',
  'import.commit': 'Import danych',
  'user.create': 'Dodanie użytkownika',
  'user.update': 'Zmiana użytkownika',
  'user.password.reset': 'Reset hasła użytkownika',
  'user.2fa.reset': 'Reset 2FA użytkownika',
  'user.unlock': 'Odblokowanie konta',
  'audit.verify': 'Weryfikacja dziennika',
  'test_number.create': 'Dodanie numeru testowego',
  'test_number.delete': 'Usunięcie numeru testowego',
  'sms.test_send': 'Wysłanie SMS-a testowego',
  'template.update': 'Zmiana szablonu SMS',
  'template.reset': 'Przywrócenie domyślnego szablonu',
  'event_type.create': 'Dodanie typu zdarzenia',
  'event_type.update': 'Zmiana typu zdarzenia',
  'alert.start': 'URUCHOMIENIE ALERTU',
  'alert.pin.failed': 'Błędny PIN alarmowy',
  'alert.change_point': 'Zmiana punktu zbiórki',
  'alert.close': 'Zakończenie alertu',
  'alert.call': 'Telefon do rodzica',
  'alert.report': 'Pobranie raportu z alertu',
  'alert.purged': 'Anonimizacja starego alertu (retencja)',
  'attendance.mark': 'Lista obecności',
  'delivery.resend': 'Ponowna wysyłka SMS',
  'delivery.resend_all': 'Ponowna wysyłka niedoręczonych SMS',
  'delivery.phone.reveal': 'Odsłonięcie numeru (nie dotarło)',
  'seed.demo_data': 'Wgranie danych demonstracyjnych',
};

const FILTERS = [
  { value: '', label: 'Wszystkie' },
  { value: 'alert.', label: 'Alerty' },
  { value: 'attendance.', label: 'Lista obecności' },
  { value: 'delivery.', label: 'Doręczenia SMS' },
  { value: 'auth.', label: 'Logowania i konta' },
  { value: 'guardian.phone.reveal', label: 'Odsłonięcia numerów' },
  { value: 'student.', label: 'Uczniowie' },
  { value: 'guardian.', label: 'Opiekunowie' },
  { value: 'import.', label: 'Importy' },
  { value: 'user.', label: 'Użytkownicy' },
];

type Page = { entries: AuditEntryDto[]; nextBefore: string | null };

export function AuditLogPage() {
  const { hasRole } = useAuth();
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = new URLSearchParams();
  if (action) params.set('action', action);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const log = useInfiniteQuery({
    queryKey: ['audit', params.toString()],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(params);
      if (pageParam) p.set('before', pageParam);
      return api.get<Page>(`/audit?${p.toString()}`);
    },
    getNextPageParam: (last) => last.nextBefore,
  });

  const verify = useMutation({ mutationFn: () => api.post<{ ok: boolean; checked: number; brokenIds: string[] }>('/audit/verify') });
  const entries = log.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <>
      <PageHeader
        title="Dziennik zdarzeń"
        actions={
          hasRole('ADMIN') && (
            <Button variant="secondary" busy={verify.isPending} onClick={() => verify.mutate()}>
              Sprawdź integralność
            </Button>
          )
        }
      >
        Kto, kiedy i co zrobił. Wpisów nie da się zmienić ani usunąć.
      </PageHeader>

      {verify.data && (
        <div className="mb-4">
          {verify.data.ok ? (
            <Notice tone="success">Dziennik nienaruszony – sprawdzono {verify.data.checked} wpisów.</Notice>
          ) : (
            <Notice tone="error">
              Wykryto zmienione wpisy ({verify.data.brokenIds.length}): {verify.data.brokenIds.join(', ')}. Zgłoś to administratorowi i IOD.
            </Notice>
          )}
        </div>
      )}
      {verify.error && <Notice tone="error">{errorMessage(verify.error)}</Notice>}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Rodzaj">
          {(id) => (
            <Select id={id} value={action} onChange={(e) => setAction(e.target.value)}>
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Od dnia">{(id) => <TextInput id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="Do dnia">{(id) => <TextInput id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
      </div>

      {log.isLoading && <Loading />}
      {log.error && <Notice tone="error">{errorMessage(log.error)}</Notice>}
      {log.data && entries.length === 0 && <Notice>Brak wpisów.</Notice>}

      {entries.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border-2 border-line bg-surface">
          {entries.map((e) => (
            <li key={e.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-semibold">{ACTION_LABELS[e.action] ?? e.action}</span>
                <span className="font-mono text-sm text-muted">{formatDateTime(e.at)}</span>
              </div>
              <div className="text-sm text-muted">
                {e.userName ?? (e.userId ? `użytkownik #${e.userId}` : 'system / niezalogowany')}
                {e.ip && <> · IP {e.ip}</>}
                {e.entity && (
                  <>
                    {' '}
                    · {e.entity} #{e.entityId}
                  </>
                )}
              </div>
              {e.details !== null && typeof e.details === 'object' && Object.keys(e.details).length > 0 && (
                <div className="mt-1 break-all font-mono text-xs text-muted">{JSON.stringify(e.details)}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      {log.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" busy={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
            Starsze wpisy
          </Button>
        </div>
      )}
    </>
  );
}
