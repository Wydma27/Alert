import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { AlertListItemDto } from '@alert/shared';
import { Badge, Loading, Notice, PageHeader } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';

export function AlertHistoryPage() {
  const list = useQuery({ queryKey: ['alerts'], queryFn: () => api.get<AlertListItemDto[]>('/alerts') });
  return (
    <>
      <PageHeader title="Historia alertów">Alarmy i ćwiczenia z przebiegiem, doręczeniami i raportem CSV.</PageHeader>
      {list.isLoading && <Loading />}
      {list.error && <Notice tone="error">{errorMessage(list.error)}</Notice>}
      {list.data?.length === 0 && <Notice>Nie było jeszcze żadnego alertu ani ćwiczeń.</Notice>}
      <ul className="flex flex-col gap-2">
        {list.data?.map((a) => (
          <li key={a.id}>
            <Link to={`/alarm/${a.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface shadow-card p-4 hover:border-ink">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-lg">{a.eventLabel}</strong>
                  {a.mode === 'DRILL' ? <Badge tone="warning">ćwiczenia</Badge> : <Badge tone="error">alarm</Badge>}
                  {a.status === 'ACTIVE' && <Badge tone="error">TRWA</Badge>}
                </div>
                <div className="text-muted">
                  {formatDateTime(a.startedAt)} · {a.startedBy ?? '—'}
                </div>
              </div>
              <div className="text-right text-sm text-muted">
                uczniów: {a.students}
                <br />
                SMS: {a.deliveries}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
