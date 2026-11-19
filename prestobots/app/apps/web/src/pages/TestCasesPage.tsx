import { AREA_LABELS, type TestCaseStatus } from '@ctp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Plus, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api } from '../api';
import { StatusPill } from '../components/StatusPill';
import { Button, Card, ErrorBox, Loading, PageTitle } from '../components/ui';

const FILTERS: Array<{ value: TestCaseStatus | 'all'; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'proposed', label: 'To review' },
  { value: 'archived', label: 'Archived' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

export const TestCasesPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<TestCaseStatus | 'all'>('active');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const testCases = useQuery({ queryKey: ['test-cases'], queryFn: api.testCases });
  const startRun = useMutation({
    mutationFn: api.startRun,
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ['status'] });
      navigate(`/runs/${run.id}`);
    },
  });

  const all = testCases.data ?? [];
  const visible = filter === 'all' ? all : all.filter((testCase) => testCase.status === filter);
  const activeCount = all.filter((testCase) => testCase.status === 'active').length;
  const toReview = all.filter((testCase) => testCase.status === 'proposed').length;

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <PageTitle
        title="Test cases"
        subtitle="Patient stories the platform plays against the chatbot. Each one has a permanent id."
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/generate')}>
              <Wand2 className="h-4 w-4" aria-hidden />
              Generate test cases
            </Button>
            <Button variant="secondary" onClick={() => navigate('/test-cases/new')}>
              <Plus className="h-4 w-4" aria-hidden />
              New test case
            </Button>
            <Button
              variant="secondary"
              disabled={selected.size === 0 || startRun.isPending}
              onClick={() => startRun.mutate({ testCaseIds: [...selected] })}
            >
              <Play className="h-4 w-4" aria-hidden />
              Run selected ({selected.size})
            </Button>
            <Button disabled={activeCount === 0 || startRun.isPending} onClick={() => startRun.mutate({ allActive: true })}>
              <Play className="h-4 w-4" aria-hidden />
              Run all active ({activeCount})
            </Button>
          </>
        }
      />

      <ErrorBox error={startRun.error ?? testCases.error} />

      <div className="mb-3 flex gap-1">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilter(option.value)}
            className={`rounded-md px-3 py-1 text-sm ${
              filter === option.value ? 'bg-white font-medium shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {option.label}
            {option.value === 'proposed' && toReview > 0 && (
              <span className="ml-1.5 rounded-full bg-violet-600 px-1.5 text-xs font-medium text-white">{toReview}</span>
            )}
          </button>
        ))}
      </div>

      {testCases.isLoading ? (
        <Loading />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 px-4 py-3">
                  <span className="sr-only">Select</span>
                </th>
                <th className="px-2 py-3">Id</th>
                <th className="px-2 py-3">Story</th>
                <th className="hidden px-2 py-3 md:table-cell">Area</th>
                <th className="px-2 py-3">Status</th>
                <th className="px-4 py-3">Last result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((testCase) => (
                <tr key={testCase.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${testCase.id}`}
                      checked={selected.has(testCase.id)}
                      onChange={() => toggle(testCase.id)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </td>
                  <td className="px-2 py-3 font-mono text-xs whitespace-nowrap">
                    <Link to={`/test-cases/${testCase.id}`} className="text-sky-700 hover:underline">
                      {testCase.id}
                    </Link>
                  </td>
                  <td className="px-2 py-3">
                    <Link to={`/test-cases/${testCase.id}`} className="font-medium hover:underline">
                      {testCase.title}
                    </Link>
                    <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{testCase.story}</p>
                  </td>
                  <td className="hidden px-2 py-3 text-slate-600 md:table-cell">{AREA_LABELS[testCase.area]}</td>
                  <td className="px-2 py-3">
                    <StatusPill status={testCase.status} />
                  </td>
                  <td className="px-4 py-3">
                    {testCase.lastResult ? (
                      <Link to={`/runs/${testCase.lastResult.runId}`} className="inline-flex items-center gap-2">
                        <StatusPill status={testCase.lastResult.status} />
                        <span className="text-xs whitespace-nowrap text-slate-500">Run #{testCase.lastResult.runId}</span>
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-400">Never run</span>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    No test cases here.
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
