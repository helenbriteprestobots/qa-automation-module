import { AREA_LABELS, type TestCaseDraft } from '@ctp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Play, Save, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { api } from '../api';
import { ResultCard } from '../components/ResultCard';
import { StepsList } from '../components/StepsList';
import { Button, Card, ErrorBox, Loading, PageTitle } from '../components/ui';
import { useLiveRun } from '../components/useLiveRun';

/** Write a new test case, or change an existing one, by describing it in your own words. */
export const TestCaseEditorPage = () => {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const status = useQuery({ queryKey: ['status'], queryFn: api.status });
  const existing = useQuery({ queryKey: ['test-case', id], queryFn: () => api.testCase(id!), enabled: editing });

  const [draft, setDraft] = useState<TestCaseDraft | null>(null);
  const [text, setText] = useState('');
  const [trialRunId, setTrialRunId] = useState<string>();
  const trial = useLiveRun(trialRunId);

  useEffect(() => {
    const saved = existing.data?.testCase;
    if (saved && !draft) {
      setDraft({ title: saved.title, area: saved.area, story: saved.story, steps: saved.steps, assumptions: [] });
    }
  }, [existing.data, draft]);

  const write = useMutation({
    mutationFn: () => api.draftTestCase(draft ? { request: text, draft } : { request: text }),
    onSuccess: (result) => {
      setDraft(result);
      setText('');
      setTrialRunId(undefined);
    },
  });

  const tryIt = useMutation({
    mutationFn: (value: TestCaseDraft) => api.tryDraft(value),
    onSuccess: (run) => {
      setTrialRunId(run.id);
      void queryClient.invalidateQueries({ queryKey: ['status'] });
    },
  });

  const save = useMutation({
    mutationFn: (saveAs: 'active' | 'proposed') =>
      editing ? api.updateTestCase(id!, draft!) : api.createTestCase(draft!, saveAs),
    onSuccess: (testCase) => {
      void queryClient.invalidateQueries({ queryKey: ['test-cases'] });
      void queryClient.invalidateQueries({ queryKey: ['test-case', testCase.id] });
      navigate(`/test-cases/${testCase.id}`);
    },
  });

  if (editing && existing.isLoading) return <Loading />;
  if (editing && !existing.data) return <ErrorBox error={existing.error ?? 'Not found'} />;

  const aiOn = status.data?.ai.enabled ?? true;
  const trialResult = trial.data?.results[0];

  return (
    <>
      <Link
        to={editing ? `/test-cases/${id}` : '/test-cases'}
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> {editing ? id : 'Test cases'}
      </Link>

      <PageTitle
        title={editing ? `Change ${id}` : 'New test case'}
        subtitle="Describe it in your own words. The AI writes the steps and checks; you review, try it and save."
      />

      {!aiOn && (
        <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          AI is off. Add ANTHROPIC_API_KEY to the .env file and restart the platform to write test cases with AI.
        </div>
      )}
      <ErrorBox error={write.error ?? tryIt.error ?? save.error} />

      <Card className="mb-6 p-5">
        <label htmlFor="request" className="font-semibold">
          {draft ? 'What should change?' : 'Describe the patient story'}
        </label>
        <textarea
          id="request"
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={
            draft
              ? 'Ej: agregá un paso donde el paciente elige el primer horario y el bot confirma el turno.'
              : 'Ej: un paciente pide turno con pediatría para el sábado y el bot le ofrece horarios.'
          }
          className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="mt-2 flex items-center gap-3">
          <Button onClick={() => write.mutate()} disabled={!text.trim() || write.isPending || !aiOn}>
            <Sparkles className="h-4 w-4" aria-hidden />
            {draft ? 'Apply change' : 'Write the test case'}
          </Button>
          {write.isPending && (
            <span className="flex items-center gap-1.5 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> The AI is writing… (usually under a minute)
            </span>
          )}
        </div>
      </Card>

      {draft && (
        <>
          <Card className="mb-6 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{draft.title}</h2>
                <p className="text-sm text-slate-500">{AREA_LABELS[draft.area]}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => tryIt.mutate(draft)} disabled={tryIt.isPending || trial.live}>
                  <Play className="h-4 w-4" aria-hidden /> Try it
                </Button>
                {editing ? (
                  <Button onClick={() => save.mutate('active')} disabled={save.isPending}>
                    <Save className="h-4 w-4" aria-hidden /> Save changes
                  </Button>
                ) : (
                  <>
                    <Button variant="secondary" onClick={() => save.mutate('proposed')} disabled={save.isPending}>
                      Save for review
                    </Button>
                    <Button onClick={() => save.mutate('active')} disabled={save.isPending}>
                      <Save className="h-4 w-4" aria-hidden /> Save as active
                    </Button>
                  </>
                )}
              </div>
            </div>
            <p className="mt-3">{draft.story}</p>

            {draft.assumptions.length > 0 && (
              <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
                <p className="font-medium">The AI assumed:</p>
                <ul className="mt-1 list-disc pl-5">
                  {draft.assumptions.map((assumption) => (
                    <li key={assumption}>{assumption}</li>
                  ))}
                </ul>
              </div>
            )}

            <h3 className="mt-5 mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Steps</h3>
            <StepsList steps={draft.steps} />
          </Card>

          {trialResult && (
            <div className="mb-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Try-out result</h2>
              <p className="mb-2 text-xs text-slate-500">Try-outs are not saved in the test case's history.</p>
              <ResultCard result={trialResult} trial />
            </div>
          )}
        </>
      )}
    </>
  );
};
