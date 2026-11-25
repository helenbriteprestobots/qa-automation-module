import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';

import { api } from '../api';
import { RealBotCard } from '../components/RealBotCard';
import { Button, Card, ErrorBox, Loading, PageTitle } from '../components/ui';
import { formatUsd } from '../format';

const PURPOSE_LABELS: Record<string, string> = {
  write_test: 'Writing and changing test cases',
  judge: 'AI judge (during runs)',
  analyze_failure: 'Explaining failures',
  summarize_run: 'Run summaries',
  jira_card: 'Writing Jira cards',
  generate_tests: 'Generating test cases',
};

export const SettingsPage = () => {
  const queryClient = useQueryClient();
  const usage = useQuery({ queryKey: ['ai-usage'], queryFn: api.aiUsage });
  const platform = useQuery({ queryKey: ['status'], queryFn: api.status });
  const jiraCheck = useMutation({ mutationFn: api.jiraCheck });
  const [limit, setLimit] = useState('');

  useEffect(() => {
    if (usage.data) setLimit(String(usage.data.status.budget.limitUsd));
  }, [usage.data]);

  const save = useMutation({
    mutationFn: (value: number) => api.setBudget(value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-usage'] });
      void queryClient.invalidateQueries({ queryKey: ['status'] });
    },
  });

  if (usage.isLoading) return <Loading />;
  if (!usage.data) return <ErrorBox error={usage.error} />;
  const { status, breakdown } = usage.data;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(limit.replace(',', '.'));
    if (Number.isFinite(value) && value >= 0) save.mutate(value);
  };

  return (
    <>
      <PageTitle title="Settings" subtitle="The real bot, AI, its monthly budget, and Jira." />
      <ErrorBox error={save.error} />

      <div className="grid gap-6 lg:grid-cols-2">
        <RealBotCard demo={platform.data?.mode !== 'stage'} />

        <Card className="p-5">
          <h2 className="font-semibold">AI</h2>
          {status.enabled ? (
            <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">Status</dt>
              <dd className="text-emerald-700">On</dd>
              <dt className="text-slate-500">Writes tests and explains failures</dt>
              <dd className="font-mono text-xs">{status.models.author}</dd>
              <dt className="text-slate-500">AI judge</dt>
              <dd className="font-mono text-xs">{status.models.judge}</dd>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              Off. Add <code className="rounded bg-slate-100 px-1">ANTHROPIC_API_KEY</code> to the{' '}
              <code className="rounded bg-slate-100 px-1">.env</code> file and restart the platform. Tests still run with their
              rule checks; AI-judge checks are skipped.
            </p>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold">Monthly budget</h2>
          <p className="mt-1 text-sm text-slate-600">
            Spent in {status.budget.month}: <strong>{formatUsd(status.budget.spentUsd)}</strong> of{' '}
            {formatUsd(status.budget.limitUsd)}. At 80% the header legend turns yellow. At 100% AI features pause until the next
            month or until you raise the budget; tests still run with their rule checks.
          </p>
          <form onSubmit={onSubmit} className="mt-4 flex items-end gap-2">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Budget (US$ per month)</span>
              <input
                type="number"
                min={0}
                step="1"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                className="w-32 rounded-md border border-slate-300 px-2 py-1.5"
              />
            </label>
            <Button type="submit" disabled={save.isPending}>
              Save
            </Button>
            {save.isSuccess && <span className="pb-1.5 text-sm text-emerald-700">Saved</span>}
          </form>
          <p className="mt-4 text-xs text-slate-500">
            The amount is an estimate from Claude's price list for this platform's own calls. Anthropic's invoice is the source of
            truth. Also set a spend limit on the API key in the Claude Console as a hard stop.
          </p>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="font-semibold">Jira</h2>
          {platform.data?.jira.configured ? (
            <>
              <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-slate-500">Site</dt>
                <dd>{platform.data.jira.site}</dd>
                <dt className="text-slate-500">Project</dt>
                <dd className="font-mono text-xs">{platform.data.jira.projectKey}</dd>
                <dt className="text-slate-500">Labels on every card</dt>
                <dd>{platform.data.jira.labels.join(', ') || '—'} + the test case id</dd>
                <dt className="text-slate-500">Priority</dt>
                <dd>{platform.data.jira.priority ?? "Jira's default"}</dd>
                <dt className="text-slate-500">Assignee</dt>
                <dd>Nobody (the team assigns in Jira)</dd>
              </dl>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={() => jiraCheck.mutate()} disabled={jiraCheck.isPending}>
                  {jiraCheck.isPending ? 'Checking…' : 'Test the connection'}
                </Button>
                {jiraCheck.data && (
                  <span className="text-sm text-emerald-700">
                    Connected as {jiraCheck.data.user} to project “{jiraCheck.data.projectName}”.{' '}
                    {jiraCheck.data.issueTypes.Bug && jiraCheck.data.issueTypes.Task ? (
                      <>
                        Bug → “{jiraCheck.data.issueTypes.Bug}”, Task → “{jiraCheck.data.issueTypes.Task}”.
                      </>
                    ) : (
                      <span className="text-amber-800">
                        Missing card type: {[!jiraCheck.data.issueTypes.Bug && 'Bug', !jiraCheck.data.issueTypes.Task && 'Task'].filter(Boolean).join(' and ')}.
                        Ask the Jira admin to add it to the project.
                      </span>
                    )}
                  </span>
                )}
              </div>
              <ErrorBox error={jiraCheck.error} />
              <p className="mt-2 text-xs text-slate-500">The test only reads: it doesn't create anything in Jira.</p>
            </>
          ) : (
            <div className="mt-2 text-sm text-slate-600">
              <p>
                Not set up. Add the Jira lines from <code className="rounded bg-slate-100 px-1">.env.example</code> to{' '}
                <code className="rounded bg-slate-100 px-1">.env</code> and restart the platform.
              </p>
              {platform.data && platform.data.jira.problems.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-slate-500">
                  {platform.data.jira.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="font-semibold">Spending this month</h2>
          {breakdown.byPurpose.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No AI calls yet this month.</p>
          ) : (
            <div className="mt-3 grid gap-6 md:grid-cols-2">
              <table className="text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-1">Used for</th>
                    <th className="py-1 text-right">Calls</th>
                    <th className="py-1 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.byPurpose.map((row) => (
                    <tr key={row.purpose}>
                      <td className="py-1">{PURPOSE_LABELS[row.purpose] ?? row.purpose}</td>
                      <td className="py-1 text-right">{row.calls}</td>
                      <td className="py-1 text-right">{formatUsd(row.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-1">Model</th>
                    <th className="py-1 text-right">Calls</th>
                    <th className="py-1 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.byModel.map((row) => (
                    <tr key={row.model}>
                      <td className="py-1 font-mono text-xs">{row.model}</td>
                      <td className="py-1 text-right">{row.calls}</td>
                      <td className="py-1 text-right">{formatUsd(row.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
};
