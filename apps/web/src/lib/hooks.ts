import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { AlertSummaryDto } from '@alert/shared';
import { api } from './api';

/** Czy trwa alert – odświeżane co 10 s (baner, pulpit, lista obecności). */
export function useActiveAlert() {
  return useQuery({
    queryKey: ['active-alert'],
    queryFn: () => api.get<{ alert: AlertSummaryDto | null }>('/alerts/active'),
    refetchInterval: 10_000,
    select: (d) => d.alert,
  });
}

/**
 * Zdarzenia na żywo z serwera (SSE): przy każdej zmianie odświeża podane zapytania.
 * Zwraca true, gdy połączenie działa (gdy nie – ekrany i tak odświeżają się co kilka sekund).
 */
export function useAlertEvents(alertId: number | null | undefined, queryKeys: unknown[][]) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const keys = JSON.stringify(queryKeys);

  useEffect(() => {
    if (!alertId || typeof EventSource === 'undefined') return;
    const source = new EventSource(`/api/alerts/${alertId}/events`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = () => {
      for (const key of JSON.parse(keys) as unknown[][]) void queryClient.invalidateQueries({ queryKey: key });
    };
    return () => {
      source.close();
      setConnected(false);
    };
  }, [alertId, keys, queryClient]);

  return connected;
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function formatTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '—';
}
