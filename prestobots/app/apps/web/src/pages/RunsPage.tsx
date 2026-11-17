import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api';
import { StatusPill } from '../components/StatusPill';
import { Card, ErrorBox, Loading, PageTitle } from '../components/ui';
import { formatDateTime, formatDuration } from '../format';

export const RunsPage = () => {
  const runs = useQuery({ queryKey: ['runs'], queryFn: api.runs, refetchInterval: 5_000 });

  return (
    <>
      <PageTitle title="Runs" subtitle="Every time test cases were played against the chatbot." />
      <ErrorBox error={runs.error} />
      {runs.isLoading ? (
        <Loading />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Run</th>
                <th className="px-2 py-3">Started</th>
                <th className="px-2 py-3">Status</th>
                <th className="px-2 py-3">Results</th>
                <th className="hidden px-2 py-3 md:table-cell">Chatbot</th>
                <th className="px-4 py-3">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(runs.data ?? []).map((run) => (
                <tr key={run.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    <Link to={`/runs/${run.id}`} className="text-sky-700 hover:underline">
                      #{run.id}
                    </Link>
                    {run.trial && <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800">Try-out</span>}
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap text-slate-600">{formatDateTime(run.startedAt ?? run.createdAt)}</td>
                  <td className="px-2 py-3">
                    <StatusPill status={run.status} />
                  </td>
                  <td className="px-2 py-3 whitespace-nowrap">
                    <span className="text-emerald-700">{run.counts.passed} passed</span>
                    {run.counts.failed > 0 && <span className="ml-2 text-red-700">{run.counts.failed} failed</span>}
                    {run.counts.error > 0 && <span className="ml-2 text-amber-800">{run.counts.error} couldn't run</span>}
                    <span className="ml-2 text-slate-400">of {run.counts.total}</span>
                  </td>
                  <td className="hidden px-2 py-3 text-slate-600 md:table-cell">{run.target}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {formatDuration(run.startedAt, run.finishedAt)}
                  </td>
                </tr>
              ))}
              {runs.data?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No runs yet. Start one from the Test cases page.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
};
