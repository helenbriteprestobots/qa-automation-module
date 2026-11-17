import type { RunEvent } from '@ctp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { type RunDetail, api } from '../api';

export const isLive = (status?: string): boolean => status === 'queued' || status === 'running';

/** Loads a run and keeps it up to date while it is in progress (Server-Sent Events). */
export const useLiveRun = (id: string | undefined) => {
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['run', id], queryFn: () => api.run(id!), enabled: Boolean(id) });
  const live = isLive(detail.data?.run.status);

  useEffect(() => {
    if (!id || !live) return;
    const source = new EventSource(`/api/runs/${id}/events`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as RunEvent;
      queryClient.setQueryData<RunDetail>(['run', id], (current) => {
        if (!current) return current;
        if (event.type === 'run') return { ...current, run: event.run };
        const results = current.results.map((result) => (result.id === event.result.id ? event.result : result));
        return { ...current, results };
      });
      if (event.type === 'run' && !isLive(event.run.status)) {
        source.close();
        void queryClient.invalidateQueries({ queryKey: ['status'] });
        void queryClient.invalidateQueries({ queryKey: ['test-cases'] });
      }
    };
    return () => source.close();
  }, [id, live, queryClient]);

  return { ...detail, live };
};
