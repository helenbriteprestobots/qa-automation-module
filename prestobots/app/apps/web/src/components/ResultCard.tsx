import { FAILURE_CATEGORY_LABELS, type JiraCard, type TestResult, describeAction, describeCheck } from '@ctp/shared';
import { CheckCircle2, ChevronDown, CircleSlash, ExternalLink, Lightbulb, MinusCircle, Ticket, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { formatDateTime, formatDuration } from '../format';
import { ChatTranscript } from './ChatTranscript';
import { StatusPill } from './StatusPill';
import { JiraCardDialog } from './JiraCardDialog';
import { Button, Card } from './ui';

/** One test case's result: conversation per step, checks, AI explanation, technical details. */
export const ResultCard = ({
  result,
  trial = false,
  jiraCards = [],
  jiraEnabled = false,
  runFinished = false,
}: {
  result: TestResult;
  trial?: boolean;
  /** Cards created or commented on from this result. */
  jiraCards?: JiraCard[];
  /** Jira is set up in .env. */
  jiraEnabled?: boolean;
  runFinished?: boolean;
}) => {
  const problem = result.status === 'failed' || result.status === 'error';
  const [jiraOpen, setJiraOpen] = useState(false);
  const [open, setOpen] = useState(problem || result.status === 'running' || trial);
  useEffect(() => {
    if (problem || result.status === 'running') setOpen(true);
  }, [problem, result.status]);

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <StatusPill status={result.status} />
        {trial ? (
          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800">Try-out</span>
        ) : (
          <Link
            to={`/test-cases/${result.testCaseId}`}
            onClick={(event) => event.stopPropagation()}
            className="font-mono text-xs text-sky-700 hover:underline"
          >
            {result.testCaseId}
          </Link>
        )}
        <span className="flex-1 font-medium">{result.testCaseTitle}</span>
        {jiraCards.map((card) => (
          <a
            key={card.id}
            href={card.url}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            title={card.kind === 'created' ? `Card created: ${card.title}` : `Comment added to ${card.issueKey}`}
            className="hidden items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-800 ring-1 ring-sky-200 hover:bg-sky-100 sm:inline-flex"
          >
            <Ticket className="h-3 w-3" aria-hidden />
            {card.issueKey}
            {card.kind === 'comment' && ' (comment)'}
          </a>
        ))}
        <span className="hidden text-xs text-slate-500 sm:inline">{formatDuration(result.startedAt, result.finishedAt)}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div className="space-y-5 border-t border-slate-100 px-4 py-4">
          {problem && !trial && runFinished && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setJiraOpen(true)}
                disabled={!jiraEnabled}
                title={jiraEnabled ? undefined : 'Jira is not set up yet. See Settings.'}
              >
                <Ticket className="h-4 w-4" aria-hidden /> {jiraCards.length > 0 ? 'Jira card again' : 'Create Jira card'}
              </Button>
              {!jiraEnabled && <span className="text-xs text-slate-500">Jira is not set up yet. See Settings.</span>}
              {jiraCards.map((card) => (
                <a key={card.id} href={card.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-sky-700 hover:underline">
                  {card.kind === 'created' ? `Card ${card.issueKey}` : `Comment on ${card.issueKey}`}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              ))}
            </div>
          )}
          {jiraOpen && (
            <JiraCardDialog resultId={result.id} testCaseId={result.testCaseId} runId={result.runId} onClose={() => setJiraOpen(false)} />
          )}
          {result.analysis && (
            <div className="rounded-lg bg-violet-50 px-4 py-3 text-sm ring-1 ring-violet-200">
              <p className="flex items-center gap-1.5 font-semibold text-violet-900">
                <Lightbulb className="h-4 w-4" aria-hidden />
                Likely cause: {FAILURE_CATEGORY_LABELS[result.analysis.category]}
              </p>
              <p className="mt-1 text-slate-800">{result.analysis.explanation}</p>
              <p className="mt-1 text-slate-600">
                <span className="font-medium">Next step:</span> {result.analysis.suggestion}
              </p>
            </div>
          )}

          {result.error && (
            <div className={`rounded-lg px-3 py-2 text-sm ${result.status === 'error' ? 'bg-amber-50 text-amber-900' : 'bg-red-50 text-red-800'}`}>
              {result.error}
            </div>
          )}

          {result.setup.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-600">Before the test (reset)</summary>
              <div className="mt-2">
                <ChatTranscript messages={result.setup} />
              </div>
            </details>
          )}

          {result.steps.map((step) => (
            <div key={step.index}>
              <h3 className="mb-2 text-sm font-semibold">
                Step {step.index + 1} · {describeAction(step.action)}
              </h3>
              <ChatTranscript messages={[...(step.sent ? [step.sent] : []), ...step.replies]} />
              {step.error && <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{step.error}</p>}
              {step.checks.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {step.checks.map((check, index) => (
                    <li key={index} className="flex gap-2 text-sm">
                      {check.skipped ? (
                        <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-label="skipped" />
                      ) : check.passed ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="passed" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-label="failed" />
                      )}
                      <span className={check.skipped ? 'text-slate-500' : ''}>
                        <span className="font-medium">{describeCheck(check.check)}</span>
                        <span className="text-slate-600"> — {check.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {result.status === 'pending' && (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <CircleSlash className="h-4 w-4" aria-hidden /> Waiting for its turn.
            </p>
          )}

          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">Technical details</summary>
            <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
              <dt>Result id</dt>
              <dd className="font-mono">{result.id}</dd>
              <dt>Conversation id</dt>
              <dd className="font-mono">{result.conversationId ?? '—'}</dd>
              <dt>Started</dt>
              <dd>{formatDateTime(result.startedAt)}</dd>
              <dt>Finished</dt>
              <dd>{formatDateTime(result.finishedAt)}</dd>
              {result.steps.map((step) => (
                <div key={step.index} className="contents">
                  <dt>Step {step.index + 1}</dt>
                  <dd>
                    {(step.durationMs / 1000).toFixed(1)} s
                    {step.sent && <span className="ml-2 font-mono">{step.sent.id}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
      )}
    </Card>
  );
};
