import { useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  IMPORT_FIELD_LABELS,
  IMPORT_FIELDS,
  TEACHER_IMPORT_FIELD_LABELS,
  TEACHER_IMPORT_FIELDS,
  type FullNameOrder,
  type ImportCommitResponse,
  type ImportField,
  type ImportMapping,
  type ImportType,
  type ImportUploadResponse,
  type ImportValidationResponse,
  type TeacherImportField,
} from '@alert/shared';
import { Badge, Button, buttonClass, Card, Checkbox, Field, Notice, PageHeader, Select } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { plural } from '../lib/format';

type Mode = 'upsert' | 'sync';

const FIELD_SETS: Record<ImportType, { fields: readonly (ImportField | TeacherImportField)[]; labels: Record<string, string> }> = {
  students: { fields: IMPORT_FIELDS, labels: IMPORT_FIELD_LABELS },
  teachers: { fields: TEACHER_IMPORT_FIELDS, labels: TEACHER_IMPORT_FIELD_LABELS },
};

export function ImportPage() {
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [type, setType] = useState<ImportType>(params.get('typ') === 'nauczyciele' ? 'teachers' : 'students');
  const [upload, setUpload] = useState<ImportUploadResponse | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [order, setOrder] = useState<FullNameOrder>('LAST_FIRST');
  const [mode, setMode] = useState<Mode>('upsert');
  const [validation, setValidation] = useState<ImportValidationResponse | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [result, setResult] = useState<ImportCommitResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    if (upload) void api.delete(`/import/${upload.importId}`).catch(() => undefined);
    setUpload(null);
    setMapping({});
    setValidation(null);
    setResult(null);
    setError(null);
    setConfirmDelete(false);
    setMode('upsert');
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void run(async () => {
      const form = new FormData();
      form.append('file', file);
      const res = await api.upload<ImportUploadResponse>(`/import/upload?type=${type}`, form);
      setUpload(res);
      setMapping(res.suggestedMapping);
      setValidation(null);
      setResult(null);
    });
  }

  const options = () => ({ mapping, fullNameOrder: order, mode });

  function changeMapping(field: ImportField | TeacherImportField, value: string) {
    setValidation(null);
    setMapping((m) => {
      const next = { ...m };
      if (value === '') delete next[field];
      else next[field] = Number(value);
      return next;
    });
  }

  const teachers = (upload?.type ?? type) === 'teachers';
  const who = (n: number) => (teachers ? plural(n, 'osobę', 'osoby', 'osób') : plural(n, 'ucznia', 'uczniów', 'uczniów'));

  if (result) {
    return (
      <>
        <PageHeader title="Import danych" />
        <Card className="max-w-2xl">
          <Notice tone="success">Import zakończony.</Notice>
          <ul className="my-4 space-y-1 text-lg">
            <li>Dodano: {who(result.created)}</li>
            <li>Zaktualizowano: {who(result.updated)}</li>
            {result.deleted > 0 && <li>Usunięto: {who(result.deleted)}</li>}
            {result.classesCreated > 0 && <li>Nowe klasy: {result.classesCreated}</li>}
            {result.guardiansDeleted > 0 && <li>Usunięte nieużywane numery opiekunów: {result.guardiansDeleted}</li>}
          </ul>
          <div className="flex flex-wrap gap-2">
            {teachers ? (
              <Link to="/nauczyciele" className={buttonClass('primary')}>
                Lista nauczycieli
              </Link>
            ) : (
              <Link to="/klasy" className={buttonClass('primary')}>
                Przypisz punkty zbiórki klasom
              </Link>
            )}
            <Button variant="secondary" onClick={reset}>
              Importuj kolejny plik
            </Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Import danych">
        Uczniowie z numerami rodziców (i własnymi) albo nauczyciele – z pliku CSV lub Excel (XLSX), np. eksport z dziennika elektronicznego.
      </PageHeader>
      {error && (
        <div className="mb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {!upload && (
        <Card className="max-w-2xl">
          <h2 className="mb-2 text-xl font-bold">1. Co importujesz?</h2>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                ['students', 'Uczniowie i rodzice'],
                ['teachers', 'Nauczyciele i pracownicy'],
              ] as [ImportType, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                onClick={() => setType(t)}
                className={`min-h-14 rounded-2xl border-2 px-4 py-2 text-lg font-bold ${type === t ? 'border-ink bg-ink text-white' : 'border-line bg-surface shadow-card hover:border-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <ul className="mb-4 list-disc space-y-1 pl-5">
            <li>Pierwszy wiersz to nagłówki kolumn.</li>
            {type === 'students' ? (
              <>
                <li>
                  Potrzebne kolumny: <strong>imię i nazwisko ucznia</strong> (osobno lub razem), <strong>klasa</strong>,{' '}
                  <strong>telefon opiekuna</strong> (do trzech opiekunów) i/lub <strong>telefon ucznia</strong>.
                </li>
                <li>Jeden wiersz = uczeń albo jeden wiersz = opiekun – oba układy są obsługiwane.</li>
              </>
            ) : (
              <li>
                Potrzebne kolumny: <strong>imię i nazwisko</strong> (osobno lub razem) i <strong>telefon</strong>; opcjonalnie <strong>funkcja</strong>{' '}
                (np. „wychowawca 3B”).
              </li>
            )}
            <li>
              Kolumny typu PESEL, adres czy e-mail są <strong>pomijane</strong> – system przechowuje tylko to, co potrzebne do powiadomień.
            </li>
            <li>Błędne numery (stacjonarne, za krótkie) zobaczysz w raporcie przed zapisem.</li>
            <li>Plik nie jest zapisywany na serwerze. Stary format .xls zapisz w Excelu jako .xlsx albo CSV.</li>
          </ul>
          <label className={buttonClass('primary', 'cursor-pointer')}>
            {busy ? 'Wczytywanie…' : 'Wybierz plik CSV lub XLSX'}
            <input type="file" accept=".csv,.xlsx,.txt" className="sr-only" onChange={onFile} disabled={busy} />
          </label>
        </Card>
      )}

      {upload && (
        <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-bold">2. Przypisz kolumny</h2>
              <Button variant="ghost" onClick={reset}>
                Zmień plik
              </Button>
            </div>
            <p className="mb-3">
              Plik <strong>{upload.filename}</strong>: {plural(upload.totalRows, 'wiersz', 'wiersze', 'wierszy')}. Kolumny dopasowano
              automatycznie – sprawdź je.
            </p>
            {upload.ignoredColumns.length > 0 && (
              <div className="mb-3">
                <Notice tone="info">Pominięte kolumny (dane niepotrzebne do alarmu): {upload.ignoredColumns.join(', ')}</Notice>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              {FIELD_SETS[upload.type].fields.map((field) => (
                <Field key={field} label={FIELD_SETS[upload.type].labels[field]!}>
                  {(id) => (
                    <Select id={id} value={mapping[field] ?? ''} onChange={(e) => changeMapping(field, e.target.value)}>
                      <option value="">— nie importuj —</option>
                      {upload.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ))}
            </div>

            {mapping.fullName !== undefined && (
              <fieldset className="mt-4">
                <legend className="font-semibold">Kolejność w kolumnie „{upload.headers[mapping.fullName]}”</legend>
                <div className="flex flex-wrap gap-4">
                  {(['LAST_FIRST', 'FIRST_LAST'] as const).map((o) => (
                    <label key={o} className="flex min-h-12 items-center gap-2">
                      <input
                        type="radio"
                        name="order"
                        className="size-5 accent-ink"
                        checked={order === o}
                        onChange={() => {
                          setOrder(o);
                          setValidation(null);
                        }}
                      />
                      {o === 'LAST_FIRST' ? 'Nazwisko Imię (np. Kowalski Jan)' : 'Imię Nazwisko (np. Jan Kowalski)'}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <h3 className="mt-5 mb-2 font-bold">Podgląd pierwszych wierszy</h3>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    {upload.headers.map((h, i) => (
                      <th key={i} className="whitespace-nowrap p-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {upload.sampleRows.map((row, r) => (
                    <tr key={r} className="border-t border-line">
                      {row.map((cell, c) => (
                        <td key={c} className="whitespace-nowrap p-2">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <h2 className="mb-2 text-xl font-bold">3. Tryb i sprawdzenie</h2>
            <fieldset className="mb-4 flex flex-col gap-1">
              <legend className="sr-only">Tryb importu</legend>
              <label className="flex min-h-12 items-start gap-2">
                <input
                  type="radio"
                  name="mode"
                  className="mt-1 size-5 accent-ink"
                  checked={mode === 'upsert'}
                  onChange={() => {
                    setMode('upsert');
                    setValidation(null);
                  }}
                />
                <span>
                  <strong>Dodaj i zaktualizuj</strong> – {teachers ? 'osoby' : 'uczniowie'} spoza pliku zostają bez zmian.
                </span>
              </label>
              <label className="flex min-h-12 items-start gap-2">
                <input
                  type="radio"
                  name="mode"
                  className="mt-1 size-5 accent-ink"
                  checked={mode === 'sync'}
                  onChange={() => {
                    setMode('sync');
                    setValidation(null);
                  }}
                />
                <span>
                  <strong>Pełna synchronizacja</strong> – {teachers ? 'osoby' : 'uczniowie'}, których nie ma w pliku, zostaną <strong>usunięci</strong> (np. nowy rok
                  szkolny, pełny eksport z dziennika).
                </span>
              </label>
            </fieldset>
            <Button
              busy={busy && !validation}
              onClick={() =>
                void run(async () => {
                  setConfirmDelete(false);
                  setValidation(await api.post<ImportValidationResponse>(`/import/${upload.importId}/validate`, options()));
                })
              }
            >
              Sprawdź dane
            </Button>
          </Card>

          {validation && (
            <ValidationResult
              v={validation}
              confirmDelete={confirmDelete}
              setConfirmDelete={setConfirmDelete}
              busy={busy}
              onCommit={() =>
                void run(async () => {
                  setResult(await api.post<ImportCommitResponse>(`/import/${upload.importId}/commit`, options()));
                  await queryClient.invalidateQueries();
                })
              }
            />
          )}
        </div>
      )}
    </>
  );
}

function ValidationResult({
  v,
  confirmDelete,
  setConfirmDelete,
  busy,
  onCommit,
}: {
  v: ImportValidationResponse;
  confirmDelete: boolean;
  setConfirmDelete: (b: boolean) => void;
  busy: boolean;
  onCommit: () => void;
}) {
  const errors = v.issues.filter((i) => i.level === 'error');
  const warnings = v.issues.filter((i) => i.level === 'warning');
  const nothingToDo = v.toCreate + v.toUpdate + v.toDelete === 0;
  const teachers = v.type === 'teachers';

  function downloadIssues() {
    const lines = ['wiersz;poziom;opis', ...v.issues.map((i) => `${i.row};${i.level === 'error' ? 'pominięty' : 'ostrzeżenie'};"${i.message.replace(/"/g, '""')}"`)];
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'import-uwagi.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Card>
      <h2 className="mb-3 text-xl font-bold">4. Wynik sprawdzenia</h2>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Summary label="nowych" value={v.toCreate} />
        <Summary label="do zmiany" value={v.toUpdate} />
        <Summary label="bez zmian" value={v.unchanged} />
        <Summary label="do usunięcia" value={v.toDelete} danger={v.toDelete > 0} />
      </div>
      <p className="mb-3">
        {teachers ? (
          <>W pliku: {plural(v.studentsInFile, 'osoba z poprawnym numerem', 'osoby z poprawnym numerem', 'osób z poprawnym numerem')}.</>
        ) : (
          <>
            W pliku: {plural(v.studentsInFile, 'uczeń', 'uczniów', 'uczniów')}, {plural(v.guardiansInFile, 'numer', 'numery', 'numerów')} opiekunów
            {v.studentPhonesInFile > 0 && <>, {plural(v.studentPhonesInFile, 'własny numer ucznia', 'własne numery uczniów', 'własnych numerów uczniów')}</>}.
            {v.newClasses.length > 0 && <> Nowe klasy: {v.newClasses.join(', ')}.</>}
          </>
        )}
      </p>
      {v.studentsWithoutPhone > 0 && (
        <div className="mb-3">
          <Notice tone="warning">
            {plural(v.studentsWithoutPhone, 'uczeń nie ma', 'uczniów nie ma', 'uczniów nie ma')} poprawnego numeru opiekuna – zostaną
            zaimportowani, ale ich rodzice nie dostaną SMS. Uzupełnij numery później.
          </Notice>
        </div>
      )}

      {v.issues.length > 0 && (
        <details className="mb-4" open={v.issues.length <= 15}>
          <summary className="cursor-pointer font-semibold">
            Uwagi do wierszy (w tym błędne numery): {errors.length > 0 && <Badge tone="error">{errors.length} pominiętych</Badge>}{' '}
            {warnings.length > 0 && <Badge tone="warning">{warnings.length} ostrzeżeń</Badge>}
          </summary>
          <button type="button" className="mt-2 font-semibold underline" onClick={downloadIssues}>
            Pobierz listę uwag (CSV)
          </button>
          <ul className="mt-2 max-h-80 overflow-y-auto rounded-xl border border-line">
            {v.issues.map((i, n) => (
              <li key={n} className={`border-b border-line px-3 py-2 last:border-0 ${i.level === 'error' ? 'bg-red-50' : ''}`}>
                <strong>Wiersz {i.row}:</strong> {i.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {v.toDelete > 0 && (
        <div className="mb-4">
          <Notice tone="error">
            <Checkbox
              label={
                teachers
                  ? `Rozumiem, że ${plural(v.toDelete, 'osoba zostanie usunięta', 'osoby zostaną usunięte', 'osób zostanie usuniętych')} z listy nauczycieli.`
                  : `Rozumiem, że ${plural(v.toDelete, 'uczeń zostanie usunięty', 'uczniów zostanie usuniętych', 'uczniów zostanie usuniętych')} razem z numerami opiekunów.`
              }
              checked={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.checked)}
            />
          </Notice>
        </div>
      )}

      {nothingToDo ? (
        <Notice tone="info">Dane w pliku są takie same jak w systemie – nie ma nic do zapisania.</Notice>
      ) : (
        <Button busy={busy} disabled={v.toDelete > 0 && !confirmDelete} onClick={onCommit}>
          Zapisz zmiany
        </Button>
      )}
    </Card>
  );
}

function Summary({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className={`rounded-lg border-2 p-3 ${danger ? 'border-alarm bg-red-50' : 'border-line'}`}>
      <div className="text-2xl font-black">{value}</div>
      <div className="font-semibold text-muted">{label}</div>
    </div>
  );
}
