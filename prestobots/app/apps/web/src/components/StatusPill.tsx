import type { GenerationStatus, ResultStatus, RunStatus, TestCaseStatus, TrialOutcome } from '@ctp/shared';

type AnyStatus = ResultStatus | RunStatus | TestCaseStatus | GenerationStatus;

const STYLES: Record<AnyStatus, { label: string; className: string }> = {
  // results
  pending: { label: 'Waiting', className: 'bg-slate-100 text-slate-600' },
  running: { label: 'Running', className: 'bg-sky-100 text-sky-800 animate-pulse' },
  passed: { label: 'Passed', className: 'bg-emerald-100 text-emerald-800' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-800' },
  error: { label: "Couldn't run", className: 'bg-amber-100 text-amber-900' },
  skipped: { label: 'Skipped', className: 'bg-slate-100 text-slate-500' },
  // runs
  queued: { label: 'Queued', className: 'bg-slate-100 text-slate-600' },
  finished: { label: 'Finished', className: 'bg-slate-800 text-white' },
  interrupted: { label: 'Interrupted', className: 'bg-amber-100 text-amber-900' },
  cancelled: { label: 'Cancelled', className: 'bg-slate-200 text-slate-700' },
  // test cases
  proposed: { label: 'To review', className: 'bg-violet-100 text-violet-800' },
  active: { label: 'Active', className: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  archived: { label: 'Archived', className: 'bg-slate-100 text-slate-500' },
  rejected: { label: 'Rejected', className: 'bg-slate-100 text-slate-500 line-through' },
  // "Generate test cases"
  exploring: { label: 'Exploring the bot', className: 'bg-sky-100 text-sky-800 animate-pulse' },
  awaiting_confirmation: { label: 'Waiting for your OK', className: 'bg-amber-100 text-amber-900' },
  writing: { label: 'AI writing', className: 'bg-violet-100 text-violet-800 animate-pulse' },
  trying: { label: 'Trying proposals', className: 'bg-sky-100 text-sky-800 animate-pulse' },
};

export const StatusPill = ({ status }: { status: AnyStatus }) => {
  const style = STYLES[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${style.className}`}>
      {style.label}
    </span>
  );
};

const TRIAL: Record<TrialOutcome, { label: string; className: string; hint: string }> = {
  passed: { label: 'Passed its trial', className: 'bg-emerald-100 text-emerald-800', hint: 'Passed both times it was tried.' },
  failed: {
    label: 'Failed its trial',
    className: 'bg-red-100 text-red-800',
    hint: 'Failed both times: either the bot has a problem, or the test expects something the bot does not do.',
  },
  error: { label: "Couldn't try it", className: 'bg-amber-100 text-amber-900', hint: 'The test could not be completed when tried.' },
  inconsistent: {
    label: 'Inconsistent',
    className: 'bg-amber-100 text-amber-900',
    hint: 'Gave different results when tried twice. Unreliable as it is: change it or reject it.',
  },
};

export const trialHint = (outcome: TrialOutcome): string => TRIAL[outcome].hint;

export const TrialBadge = ({ outcome }: { outcome: TrialOutcome }) => (
  <span
    title={TRIAL[outcome].hint}
    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TRIAL[outcome].className}`}
  >
    {TRIAL[outcome].label}
  </span>
);
