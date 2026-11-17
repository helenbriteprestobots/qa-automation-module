import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Sparkles, Square } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { api } from '../api';
import { ResultCard } from '../components/ResultCard';
import { StatusPill } from '../components/StatusPill';
import { Button, Card, ErrorBox, Loading, PageTitle } from '../components/ui';
import { useLiveRun } from '../components/useLiveRun';
import { formatDateTime, formatDuration } from '../format';

export const RunDetailPage = () => {
  const { id = '' } = useParams();
  const detail = useLiveRun(id);
  const cancel = useMutation({ mutationFn: () => api.cancelRun(id) });
  const status = useQuery({ queryKey: ['status'], queryFn: api.status });

  if (detail.isLoading) return <Loading />;
  if (!detail.data) return <ErrorBox error={detail.error ?? 'Not found'} />;

  const { run, results, jiraCards = [] } = detail.data;
  const done = results.filter((result) => !['pending', 'running'].includes(result.status)).length;
  const analysing = detail.live && done === results.length && run.counts.failed + run.counts.error > 0;

  return (
    <>
      <Link to="/runs" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Runs
      </Link>

      <PageTitle
        title={
          <span className="flex items-center gap-3">
            Run #{run.id} <StatusPill status={run.status} />
            {run.trial && <span className="rounded bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800">Try-out</span>}
          </span>
        }
        subtitle={`${run.target} · started ${formatDateTime(run.startedAt ?? run.createdAt)} · ${formatDuration(run.startedAt, run.finishedAt)}`}
        actions={
          detail.live && (
            <Button variant="danger" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              <Square className="h-4 w-4" aria-hidden /> Cancel run
            </Button>
          )
        }
      />
      <ErrorBox error={cancel.error} />

      {run.summary && (
        <Card className="mb-6 flex gap-3 px-5 py-4">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" aria-hidden />
          <p className="text-sm">{run.summary}</p>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Passed" value={run.counts.passed} className="text-emerald-700" />
        <Stat label="Failed" value={run.counts.failed} className="text-red-700" />
        <Stat label="Couldn't run" value={run.counts.error} className="text-amber-800" />
        <Stat label="Skipped" value={run.counts.skipped} className="text-slate-500" />
      </div>

      {detail.live && (
        <div className="mb-6">
          <div className="mb-1 text-xs text-slate-500">
            {analysing ? 'All tests done. The AI is explaining the failures…' : `${done} of ${results.length} test cases done`}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-sky-500 transition-all" style={{ width: `${(done / Math.max(1, results.length)) * 100}%` }} />
          </div>
        </div>
      )}

      <div className="space-y-3">
        {results.map((result) => (
          <ResultCard
            key={result.id}
            result={result}
            trial={run.trial}
            jiraCards={jiraCards.filter((card) => card.resultId === result.id)}
            jiraEnabled={Boolean(status.data?.jira.configured)}
            runFinished={!detail.live}
          />
        ))}
      </div>
    </>
  );
};

const Stat = ({ label, value, className }: { label: string; value: number; className: string }) => (
  <Card className="px-4 py-3">
    <div className={`text-2xl font-semibold ${className}`}>{value}</div>
    <div className="text-xs text-slate-500">{label}</div>
  </Card>
);
