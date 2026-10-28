import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { GROUP_LABELS, type NoticeListItemDto, type ProblemNumberDto } from '@alert/shared';
import { Badge, buttonClass, Card, Loading, Notice, PageHeader, Tabs } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';

type Tab = 'sent' | 'problems';

export function NoticesPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('widok') === 'numery' ? 'problems' : 'sent');
  return (
    <>
      <PageHeader
        title="Wiadomości SMS"
        actions={
          <Link to="/wiadomosci/nowa" className={buttonClass('danger')}>
            Nowa wiadomość
          </Link>
        }
      >
        Wysłane wiadomości z raportem doręczeń i lista numerów, na które SMS nie dotarł.
      </PageHeader>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['sent', 'Wysłane'],
          ['problems', 'Numery do poprawy'],
        ]}
      />
      {tab === 'sent' ? <SentList /> : <ProblemNumbers />}
    </>
  );
}

function SentList() {
  const list = useQuery({ queryKey: ['notices'], queryFn: () => api.get<NoticeListItemDto[]>('/notices'), refetchInterval: 10_000 });
  if (list.isLoading) return <Loading />;
  if (list.error || !list.data) return <Notice tone="error">{errorMessage(list.error)}</Notice>;
  if (list.data.length === 0) return <Notice>Nie wysłano jeszcze żadnej wiadomości.</Notice>;
  return (
    <ul className="flex flex-col gap-2">
      {list.data.map((n) => {
        const failed = n.counts.FAILED + n.counts.UNDELIVERED;
        const pending = n.counts.QUEUED + n.counts.SENDING;
        return (
          <li key={n.id}>
            <Link to={`/wiadomosci/${n.id}`} className="block rounded-2xl border border-line bg-surface shadow-card p-3 hover:border-ink">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-bold">{n.summary}</div>
                  <div className="text-sm text-muted">
                    {formatDateTime(n.createdAt)} · {n.createdBy ?? '—'} · nadawca: {n.sender ?? 'domyślny'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {n.emergency && <Badge tone="warning">tryb awaryjny</Badge>}
                  <Badge tone="success">
                    doręczone {n.counts.DELIVERED}/{n.counts.total}
                  </Badge>
                  {pending > 0 && <Badge>w kolejce {pending}</Badge>}
                  {failed > 0 && <Badge tone="error">nie dotarło {failed}</Badge>}
                  {n.counts.badNumbers > 0 && <Badge tone="error">błędne numery {n.counts.badNumbers}</Badge>}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ProblemNumbers() {
  const rows = useQuery({ queryKey: ['problem-numbers'], queryFn: () => api.get<ProblemNumberDto[]>('/reports/problem-numbers') });
  if (rows.isLoading) return <Loading />;
  if (rows.error || !rows.data) return <Notice tone="error">{errorMessage(rows.error)}</Notice>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted">
        Osoby, do których ostatni SMS (wiadomość lub alert, 90 dni) nie dotarł. <strong>Błędny numer</strong> = bramka odrzuciła numer – popraw go w
        danych. Pozostałe to zwykle wyłączony telefon lub brak zasięgu.
      </p>
      <div>
        <a href="/api/reports/problem-numbers.csv" className={buttonClass('secondary')}>
          Pobierz raport CSV
        </a>
      </div>
      {rows.data.length === 0 ? (
        <Notice tone="success">Brak problemów – wszystkie ostatnie wysyłki dotarły albo czekają na raport.</Notice>
      ) : (
        <Card className="overflow-x-auto p-0 sm:p-0">
          <table className="w-full text-left">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-2">Osoba</th>
                <th className="p-2">Numer</th>
                <th className="p-2">Problem</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {rows.data.map((r) => (
                <tr key={r.contactKey} className="border-t border-line align-top">
                  <td className="p-2">
                    <div className="font-bold">{r.name}</div>
                    <div className="text-sm text-muted">
                      {r.group ? GROUP_LABELS[r.group] : ''}
                      {r.detail && ` · ${r.detail}`}
                    </div>
                  </td>
                  <td className="whitespace-nowrap p-2 font-mono">{r.phoneMasked ?? '—'}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {r.badNumber ? <Badge tone="error">błędny numer</Badge> : <Badge tone="warning">nie dotarło</Badge>}
                      {r.failures > 1 && <Badge>{r.failures}×</Badge>}
                    </div>
                    <div className="text-sm text-muted">
                      {r.lastError ?? '—'} · {formatDateTime(r.lastAt)}
                    </div>
                  </td>
                  <td className="p-2">
                    {r.link ? (
                      <Link to={r.link} className="font-semibold underline">
                        Popraw numer
                      </Link>
                    ) : (
                      <span className="text-muted">{r.exists ? '' : 'usunięty z bazy'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
