import { useMemo, useState } from 'react';
import {
  CLASS_GROUPS,
  GROUP_LABELS,
  RECIPIENT_GROUPS,
  resolveRecipients,
  searchKey,
  type ClassGroupValue,
  type Directory,
  type RecipientGroupValue,
  type RecipientSelection,
} from '@alert/shared';
import { plural } from '../lib/format';
import { Badge, Button, Card, Checkbox, Field, TextInput } from './ui';

const GROUP_TONE: Record<RecipientGroupValue, 'info' | 'success' | 'warning'> = {
  TEACHERS: 'info',
  STUDENTS: 'success',
  PARENTS: 'warning',
};

function toggle<T>(list: T[], item: T, on: boolean): T[] {
  return on ? [...new Set([...list, item])] : list.filter((x) => x !== item);
}

/** Wybór odbiorców: całe grupy, klasy (uczniowie / rodzice) albo pojedyncze osoby. */
export function RecipientPicker({
  directory,
  value,
  onChange,
}: {
  directory: Directory;
  value: RecipientSelection;
  onChange: (s: RecipientSelection) => void;
}) {
  const [q, setQ] = useState('');
  const [groupFilter, setGroupFilter] = useState<RecipientGroupValue | 'ALL'>('ALL');

  const stats = useMemo(() => {
    const out = {} as Record<RecipientGroupValue, { all: number; withPhone: number }>;
    for (const g of RECIPIENT_GROUPS) {
      const people = directory.people.filter((p) => p.group === g);
      out[g] = { all: people.length, withPhone: people.filter((p) => p.hasPhone).length };
    }
    return out;
  }, [directory]);

  const indexed = useMemo(() => directory.people.map((p) => ({ p, key: searchKey(`${p.name} ${p.detail}`) })), [directory]);
  const results = useMemo(() => {
    const words = searchKey(q).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return indexed
      .filter(({ p, key }) => (groupFilter === 'ALL' || p.group === groupFilter) && words.every((w) => key.includes(w)))
      .slice(0, 30)
      .map(({ p }) => p);
  }, [indexed, q, groupFilter]);

  const resolution = useMemo(() => resolveRecipients(directory, value), [directory, value]);
  const byKey = useMemo(() => new Map(directory.people.map((p) => [p.key, p])), [directory]);
  const selectedKeys = new Set(value.personKeys);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h3 className="mb-2 text-lg font-bold">Całe grupy</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {RECIPIENT_GROUPS.map((g) => {
            const active = value.groups.includes(g);
            return (
              <button
                key={g}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ ...value, groups: toggle(value.groups, g, !active) })}
                className={`min-h-16 rounded-2xl border-2 px-4 py-3 text-left font-bold ${active ? 'border-ink bg-ink text-white' : 'border-line bg-surface shadow-card hover:border-ink'}`}
              >
                <span className="block text-lg">
                  {active ? '✓ ' : ''}
                  {GROUP_LABELS[g]}
                </span>
                <span className={`block text-sm font-semibold ${active ? 'text-slate-300' : 'text-muted'}`}>
                  {stats[g].withPhone} z numerem
                  {stats[g].all !== stats[g].withPhone && ` (z ${stats[g].all})`}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <h3 className="mb-1 text-lg font-bold">Klasy</h3>
        <p className="mb-2 text-muted">Wybierz klasy i kogo z nich powiadomić.</p>
        <div className="mb-2 flex flex-wrap gap-x-6">
          {CLASS_GROUPS.map((g: ClassGroupValue) => (
            <Checkbox
              key={g}
              label={<strong>{GROUP_LABELS[g]}</strong>}
              checked={value.classGroups.includes(g)}
              onChange={(e) => onChange({ ...value, classGroups: toggle(value.classGroups, g, e.target.checked) })}
            />
          ))}
        </div>
        <div className="mb-2 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => onChange({ ...value, classIds: directory.classes.map((c) => c.id) })}>
            Zaznacz wszystkie
          </Button>
          <Button variant="ghost" onClick={() => onChange({ ...value, classIds: [] })}>
            Odznacz
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-x-4 sm:grid-cols-6">
          {directory.classes.map((c) => (
            <Checkbox
              key={c.id}
              label={<strong>{c.name}</strong>}
              checked={value.classIds.includes(c.id)}
              onChange={(e) => onChange({ ...value, classIds: toggle(value.classIds, c.id, e.target.checked) })}
            />
          ))}
        </div>
        {value.classIds.length > 0 && value.classGroups.length === 0 && (
          <p className="mt-2 font-semibold text-warn">Zaznacz „Uczniowie” lub „Rodzice” – inaczej klasy nie dodadzą odbiorców.</p>
        )}
      </Card>

      <Card>
        <h3 className="mb-2 text-lg font-bold">Pojedyncze osoby</h3>
        <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Szukaj w grupie">
          {(['ALL', ...RECIPIENT_GROUPS] as const).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={groupFilter === g}
              onClick={() => setGroupFilter(g)}
              className={`min-h-10 rounded-lg border-2 px-3 font-semibold ${groupFilter === g ? 'border-ink bg-ink text-white' : 'border-line'}`}
            >
              {g === 'ALL' ? 'Wszyscy' : GROUP_LABELS[g]}
            </button>
          ))}
        </div>
        <Field label="Szukaj" hint="Imię, nazwisko, klasa, funkcja albo imię dziecka (dla rodziców).">
          {(id) => <TextInput id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />}
        </Field>
        {value.personKeys.length > 0 && (
          <div className="my-3 flex flex-wrap gap-2">
            {value.personKeys.map((key) => {
              const p = byKey.get(key);
              return (
                <button
                  key={key}
                  type="button"
                  className="rounded-lg border-2 border-ink px-2 py-1 text-left font-semibold"
                  onClick={() => onChange({ ...value, personKeys: value.personKeys.filter((k) => k !== key) })}
                  aria-label={`Usuń ${p?.name ?? key}`}
                >
                  {p?.name ?? key} <span className="font-normal text-muted">({p ? GROUP_LABELS[p.group].toLowerCase() : '?'})</span> ✕
                </button>
              );
            })}
          </div>
        )}
        <ul className="mt-2 flex flex-col gap-1">
          {results.map((p) => (
            <li key={p.key}>
              <button
                type="button"
                disabled={selectedKeys.has(p.key)}
                className="flex min-h-12 w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-1 text-left hover:border-ink disabled:opacity-50"
                onClick={() => onChange({ ...value, personKeys: [...value.personKeys, p.key] })}
              >
                <span>
                  <strong>{p.name}</strong> <span className="text-muted">· {p.detail}</span>
                </span>
                <span className="flex gap-1">
                  <Badge tone={GROUP_TONE[p.group]}>{GROUP_LABELS[p.group]}</Badge>
                  {!p.hasPhone && <Badge tone="error">brak numeru</Badge>}
                </span>
              </button>
            </li>
          ))}
          {q.trim() && results.length === 0 && <li className="text-muted">Nic nie znaleziono.</li>}
        </ul>
      </Card>

      <div className="rounded-xl border-2 border-ink bg-surface p-4" role="status">
        <div className="text-2xl font-black">{plural(resolution.recipients.length, 'odbiorca', 'odbiorców', 'odbiorców')}</div>
        <div className="text-muted">
          {RECIPIENT_GROUPS.filter((g) => resolution.byGroup[g])
            .map((g) => `${GROUP_LABELS[g]}: ${resolution.byGroup[g]}`)
            .join(' · ') || 'Nikogo nie wybrano.'}
          {resolution.withoutPhone.length > 0 && ` · bez numeru: ${resolution.withoutPhone.length}`}
        </div>
      </div>
    </div>
  );
}
