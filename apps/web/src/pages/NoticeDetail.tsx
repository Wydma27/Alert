import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  DELIVERY_STATUS_LABELS,
  GROUP_LABELS,
  contactLink,
  type DeliveryStatusValue,
  type NoticeDeliveryDto,
  type NoticeDetailDto,
} from '@alert/shared';
import { SmsBubble } from '../components/SmsCounter';
import { Badge, Button, buttonClass, Card, Loading, Notice, Tabs } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';

type Tab = 'problems' | 'pending' | 'all';

const STATUS_TONE: Record<DeliveryStatusValue, 'success' | 'warning' | 'error' | 'info'> = {
  QUEUED: 'info',
  SENDING: 'info',
  SENT: 'info',
  DELIVERED: 'success',
  UNDELIVERED: 'error',
  FAILED: 'error',
};

export function NoticeDetailPage() {
  const id = Number(useParams().id);
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['notice', id],
    queryFn: () => api.get<NoticeDetailDto>(`/notices/${id}`),
    // Na bieżąco, dopóki coś jest w kolejce; potem rzadziej (raporty doręczeń przychodzą z opóźnieniem).
    refetchInterval: (q) => {
      const c = q.state.data?.counts;
      if (!c) return false;
      if (c.QUEUED + c.SENDING > 0) return 2_000;
      return c.SENT > 0 ? 10_000 : false;
    },
  });
  const [tab, setTab] = useState<Tab>('problems');
  const deliveries = useQuery({
    queryKey: ['notice-deliveries', id, tab, detail.dataUpdatedAt],
    queryFn: () => api.get<NoticeDeliveryDto[]>(`/notices/${id}/deliveries?filter=${tab}`),
    enabled: detail.isSuccess,
  });
  const resend = useMutation({
    mutationFn: () => api.post<{ count: number }>(`/notices/${id}/resend-failed`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notice', id] }),
  });

  if (detail.isLoading) return <Loading />;
  if (detail.error || !detail.data) return <Notice tone="error">{errorMessage(detail.error)}</Notice>;
  const n = detail.data;
  const c = n.counts;
  const failed = c.FAILED + c.UNDELIVERED;
  const retryable = failed - c.badNumbers;

  return (
    <>
      <Link to="/wiadomosci" className="mb-2 inline-block font-semibold underline">
        ← Wiadomości
      </Link>
      <header className="mb-4 rounded-2xl border border-line bg-surface shadow-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-sm font-black uppercase tracking-wider text-muted">
              Wiadomość #{n.id} {n.emergency && <Badge tone="warning">wysłana w trybie awaryjnym</Badge>}
            </div>
            <h1 className="text-2xl font-black">{n.summary}</h1>
            <p className="text-muted">
              {formatDateTime(n.createdAt)} · {n.createdBy ?? '—'} · nadawca: {n.sender ?? 'domyślny'}
            </p>
          </div>
          <a href={`/api/notices/${id}/report.csv`} className={buttonClass('secondary')}>
            Raport CSV
          </a>
        </div>
        {!n.live && <p className="mt-2 font-semibold text-warn">Bramka SMS w trybie fake – SMS-y nie wyszły do telefonów.</p>}
        {n.purged && <p className="mt-2 text-muted">Treść i numery usunięte zgodnie z zasadami retencji.</p>}
        {!n.purged && (
          <div className="mt-3">
            <SmsBubble sender={n.sender ?? undefined} text={n.body} />
          </div>
        )}
      </header>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="doręczone" value={`${c.DELIVERED} / ${c.total}`} />
        <Kpi label="wysłane, bez raportu" value={c.SENT} />
        <Kpi label="w kolejce" value={c.QUEUED + c.SENDING} />
        <Kpi label="nie dotarło" value={failed} danger={failed > 0} />
        <Kpi label="błędne numery" value={c.badNumbers} danger={c.badNumbers > 0} />
      </div>

      {failed > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {c.badNumbers > 0 && (
            <Notice tone="error">
              {c.badNumbers} numerów bramka odrzuciła jako błędne – popraw je w danych (lista poniżej albo{' '}
              <Link to="/wiadomosci?widok=numery" className="underline">
                Numery do poprawy
              </Link>
              ).
            </Notice>
          )}
          {retryable > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" busy={resend.isPending} onClick={() => resend.mutate()}>
                Ponów nieudane ({retryable})
              </Button>
              {resend.data && <span className="font-semibold">Ponownie w kolejce: {resend.data.count}</span>}
              {resend.error && <span className="text-alarm">{errorMessage(resend.error)}</span>}
            </div>
          )}
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ['problems', `Nie dotarło (${failed})`],
          ['pending', `W drodze (${c.QUEUED + c.SENDING + c.SENT})`],
          ['all', `Wszystkie (${c.total})`],
        ]}
      />

      {deliveries.isLoading && <Loading />}
      {deliveries.data && deliveries.data.length === 0 && <Notice tone="success">Brak pozycji.</Notice>}
      {deliveries.data && deliveries.data.length > 0 && (
        <Card className="overflow-x-auto p-0 sm:p-0">
          <table className="w-full text-left">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-2">Odbiorca</th>
                <th className="p-2">Numer</th>
                <th className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.data.map((d) => {
                const link = d.contactKey && !d.contactKey.startsWith('p:') ? contactLink(d.contactKey) : null;
                return (
                  <tr key={d.id} className="border-t border-line align-top">
                    <td className="p-2">
                      <div className="font-semibold">{d.recipientName ?? '—'}</div>
                      <div className="text-sm text-muted">{d.audience ? GROUP_LABELS[d.audience] : ''}</div>
                    </td>
                    <td className="whitespace-nowrap p-2 font-mono">{d.phoneMasked}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={STATUS_TONE[d.status]}>{DELIVERY_STATUS_LABELS[d.status]}</Badge>
                        {d.badNumber && <Badge tone="error">błędny numer</Badge>}
                      </div>
                      {d.lastError && <div className="text-sm text-muted">{d.lastError}</div>}
                      {d.badNumber && link && (
                        <Link to={link} className="text-sm font-semibold underline">
                          Popraw numer
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function Kpi({ label, value, danger }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <div className={`rounded-xl border-2 p-3 ${danger ? 'border-alarm bg-red-50' : 'border-line bg-surface'}`}>
      <div className="text-2xl font-black">{value}</div>
      <div className="font-semibold text-muted">{label}</div>
    </div>
  );
}
