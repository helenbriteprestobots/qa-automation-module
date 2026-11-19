import { AREA_LABELS, type Generation, type ProposalTrial, isGenerationBusy } from '@ctp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Map as MapIcon, ShieldCheck, Sparkles, Square, Wand2, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { type TestCaseRow, api } from '../api';
import { StatusPill, TrialBadge } from '../components/StatusPill';
import { Button, Card, ErrorBox, Loading, PageTitle } from '../components/ui';
import { formatDateTime, formatUsd } from '../format';

const STEPS = [
  { key: 'exploring', title: 'Explore the bot', text: 'The platform says "Hola" and taps through the menus, without typing and without risky options.' },
  { key: 'awaiting_confirmation', title: 'Your OK', text: 'You see what was found and the estimated AI cost before anything is paid.' },
  { key: 'writing', title: 'AI writes proposals', text: 'Claude proposes stories for what no test covers yet.' },
  { key: 'trying', title: 'Try each twice', text: 'Proposals that fail or give different results are flagged.' },
  { key: 'finished', title: 'You review', text: 'Approve, change with AI, or reject each one.' },
] as const;

const stepIndex = (status: Generation['status']): number => {
  const index = STEPS.findIndex((step) => step.key === status);
  return index === -1 ? STEPS.length : index;
};

/** "Generate test cases": start page (no id) or one generation (with id). */
export const GeneratePage = () => {
  const { id } = useParams();
  return id ? <GenerationDetail id={id} /> : <GenerateStart />;
};

const GenerateStart = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['status'], queryFn: api.status });
  const list = useQuery({ queryKey: ['generations'], queryFn: api.generations });
  const start = useMutation({
    mutationFn: api.startGeneration,
    onSuccess: (generation) => {
      void queryClient.invalidateQueries({ queryKey: ['status'] });
      navigate(`/generate/${generation.id}`);
    },
  });
  const aiOn = status.data?.ai.enabled ?? false;

  return (
    <>
      <Link to="/test-cases" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Test cases
      </Link>
      <PageTitle title="Generate test cases" subtitle="The platform finds what the bot can do and proposes tests for what isn't covered yet." />
      <ErrorBox error={start.error} />

      <Card className="p-5">
        <ol className="grid gap-4 md:grid-cols-5">
          {STEPS.map((step, index) => (
            <li key={step.key} className="text-sm">
              <span className="mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{index + 1}</span>
              <p className="font-medium">{step.title}</p>
              <p className="text-slate-600">{step.text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 flex gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          The explorer never taps options that could book, confirm or cancel an appointment, pick an appointment time, or hand the chat
          over to clinic staff. Runs can't start while it is exploring or trying proposals, because both use the same test patient.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => start.mutate()} disabled={!aiOn || start.isPending || Boolean(status.data?.activeRunId)}>
            <Wand2 className="h-4 w-4" aria-hidden /> Start
          </Button>
          {!aiOn && status.data && <span className="text-sm text-slate-600">Needs the AI: add ANTHROPIC_API_KEY to .env and restart.</span>}
          {status.data?.activeRunId && <span className="text-sm text-slate-600">Wait for run #{status.data.activeRunId} to finish.</span>}
          {status.data?.mode === 'demo' && aiOn && (
            <span className="text-sm text-slate-600">Demo mode: proposals will be about the simulated demo bot.</span>
          )}
        </div>
      </Card>

      <h2 className="mt-8 mb-3 font-semibold">Earlier</h2>
      {list.isLoading ? (
        <Loading />
      ) : (list.data ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">None yet.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-2 py-3">Started</th>
                <th className="px-2 py-3">Status</th>
                <th className="px-2 py-3">Menu paths</th>
                <th className="px-2 py-3">Proposals</th>
                <th className="px-4 py-3">AI cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.data!.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link to={`/generate/${row.id}`} className="font-medium text-sky-700 hover:underline">
                      #{row.id}
                    </Link>
                  </td>
                  <td className="px-2 py-3 text-slate-600">{formatDateTime(row.createdAt)}</td>
                  <td className="px-2 py-3">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="px-2 py-3">{row.paths}</td>
                  <td className="px-2 py-3">{row.proposals.length}</td>
                  <td className="px-4 py-3">{formatUsd(row.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
};

const GenerationDetail = ({ id }: { id: string }) => {
  const queryClient = useQueryClient();
  const generation = useQuery({
    queryKey: ['generation', id],
    queryFn: () => api.generation(id),
    refetchInterval: (query) => (query.state.data && isGenerationBusy(query.state.data.status) ? 1500 : false),
  });
  const testCases = useQuery({ queryKey: ['test-cases'], queryFn: api.testCases });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['generation', id] });
    void queryClient.invalidateQueries({ queryKey: ['generations'] });
    void queryClient.invalidateQueries({ queryKey: ['status'] });
    void queryClient.invalidateQueries({ queryKey: ['test-cases'] });
  };
  const confirm = useMutation({ mutationFn: () => api.confirmGeneration(id), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: () => api.cancelGeneration(id), onSuccess: refresh });

  // Refresh the test case list once the job stops.
  const [wasBusy, setWasBusy] = useState(false);
  const data = generation.data;
  if (data && isGenerationBusy(data.status) !== wasBusy) {
    setWasBusy(isGenerationBusy(data.status));
    if (!isGenerationBusy(data.status)) refresh();
  }

  if (generation.isLoading) return <Loading />;
  if (!data) return <ErrorBox error={generation.error ?? 'Not found'} />;

  const busy = isGenerationBusy(data.status);
  const current = stepIndex(data.status);
  const byId = new Map((testCases.data ?? []).map((t) => [t.id, t]));

  return (
    <>
      <Link to="/generate" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Generate test cases
      </Link>
      <PageTitle
        title={
          <span className="flex items-center gap-3">
            Generation #{data.id} <StatusPill status={data.status} />
          </span>
        }
        subtitle={`${data.mode === 'demo' ? 'Demo bot (simulated)' : 'Real chatbot on salud-stage'} · started ${formatDateTime(data.createdAt)} · AI cost so far ${formatUsd(data.costUsd)}`}
        actions={
          busy && (
            <Button variant="danger" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              <Square className="h-4 w-4" aria-hidden /> Cancel
            </Button>
          )
        }
      />
      <ErrorBox error={confirm.error ?? cancel.error ?? data.error} />

      <ol className="mb-6 flex flex-wrap gap-2 text-xs">
        {STEPS.map((step, index) => (
          <li
            key={step.key}
            className={`rounded-full px-3 py-1 ${
              index < current || data.status === 'finished'
                ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
                : index === current
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-500 ring-1 ring-slate-200'
            }`}
          >
            {index + 1}. {step.title}
          </li>
        ))}
      </ol>

      <Card className="mb-6 px-5 py-4">
        <p className="text-sm">{data.progress}</p>
        {data.status === 'awaiting_confirmation' && data.estimate && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-sm text-slate-700">
              Letting the AI write proposals will cost about{' '}
              <strong>
                {formatUsd(data.estimate.lowUsd)} – {formatUsd(data.estimate.highUsd)}
              </strong>
              , plus a little for AI-judge checks while trying them.
            </p>
            <Button onClick={() => confirm.mutate()} disabled={confirm.isPending}>
              <Sparkles className="h-4 w-4" aria-hidden /> Continue
            </Button>
            <Button variant="secondary" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              Stop here
            </Button>
          </div>
        )}
      </Card>

      {data.proposals.length > 0 && (
        <>
          <h2 className="mb-3 font-semibold">Proposals</h2>
          <div className="mb-6 space-y-3">
            {data.proposals.map((testCaseId) => (
              <ProposalRow
                key={testCaseId}
                testCase={byId.get(testCaseId)}
                testCaseId={testCaseId}
                trial={data.trials.find((t) => t.testCaseId === testCaseId)}
                onChange={refresh}
              />
            ))}
          </div>
        </>
      )}

      {data.notes.length > 0 && (
        <Card className="mb-6 px-5 py-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Notes from the AI</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {data.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Card>
      )}

      {data.map && <BotMapCard generation={data} />}
    </>
  );
};

const ProposalRow = ({
  testCase,
  testCaseId,
  trial,
  onChange,
}: {
  testCase: TestCaseRow | undefined;
  testCaseId: string;
  trial: Omit<ProposalTrial, 'result'> | undefined;
  onChange: () => void;
}) => {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const setStatus = useMutation({
    mutationFn: (input: { status: 'active' | 'rejected'; reason?: string }) => api.setTestCaseStatus(testCaseId, input.status, input.reason),
    onSuccess: () => {
      setRejecting(false);
      onChange();
    },
  });

  return (
    <Card className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={`/test-cases/${testCaseId}`} className="font-mono text-xs text-sky-700 hover:underline">
          {testCaseId}
        </Link>
        <Link to={`/test-cases/${testCaseId}`} className="flex-1 font-medium hover:underline">
          {testCase?.title ?? '…'}
        </Link>
        {trial ? <TrialBadge outcome={trial.outcome} /> : <span className="text-xs text-slate-400">Not tried yet</span>}
        {testCase && <StatusPill status={testCase.status} />}
      </div>
      {testCase && (
        <p className="mt-1 text-sm text-slate-600">
          <span className="text-slate-400">{AREA_LABELS[testCase.area]} · </span>
          {testCase.proposal?.why}
        </p>
      )}
      <ErrorBox error={setStatus.error} />
      {testCase?.status === 'proposed' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {rejecting ? (
            <>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why? (optional, helps the AI not propose it again)"
                className="min-w-64 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
              <Button variant="danger" onClick={() => setStatus.mutate({ status: 'rejected', reason })} disabled={setStatus.isPending}>
                Reject
              </Button>
              <Button variant="secondary" onClick={() => setRejecting(false)}>
                Back
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setStatus.mutate({ status: 'active' })} disabled={setStatus.isPending}>
                <Check className="h-4 w-4" aria-hidden /> Approve
              </Button>
              <Button variant="secondary" onClick={() => setRejecting(true)}>
                <X className="h-4 w-4" aria-hidden /> Reject
              </Button>
              <Link to={`/test-cases/${testCaseId}`} className="text-sm text-sky-700 hover:underline">
                See the conversation and details
              </Link>
            </>
          )}
        </div>
      )}
    </Card>
  );
};

const BotMapCard = ({ generation }: { generation: Generation }) => {
  const map = generation.map!;
  return (
    <Card className="px-5 py-4">
      <details>
        <summary className="flex cursor-pointer items-center gap-2 font-semibold">
          <MapIcon className="h-4 w-4 text-slate-500" aria-hidden />
          What the explorer found ({map.nodes.length} menu paths{map.truncated ? ', stopped at the limit' : ''})
        </summary>
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {map.nodes.map((node) => (
            <li key={node.path.join('>')} className="py-2">
              <p className="font-medium">{['Hola', ...node.path].join(' → ')}</p>
              {node.error ? (
                <p className="text-amber-800">{node.error}</p>
              ) : (
                <p className="text-slate-600">
                  {node.replies
                    .filter((reply) => reply.from === 'bot')
                    .map((reply) => reply.text)
                    .join(' · ')
                    .slice(0, 240)}
                </p>
              )}
              {node.offered.length > 0 && (
                <p className="mt-1 text-xs text-slate-500">Offers: {node.offered.map((o) => `«${o}»`).join(', ')}</p>
              )}
              {node.skipped.map((skipped) => (
                <p key={skipped.option} className="text-xs text-slate-500">
                  Not tapped: «{skipped.option}», because it {skipped.reason}.
                </p>
              ))}
            </li>
          ))}
        </ul>
        {generation.form && (
          <p className="mt-3 text-xs text-slate-500">
            Also read the WhatsApp form "{generation.form.name}" from the chatbot code: {generation.form.screens.map((s) => s.title).join(', ')}.
          </p>
        )}
      </details>
    </Card>
  );
};
