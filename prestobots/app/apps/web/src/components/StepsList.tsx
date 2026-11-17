import { type Step, describeAction, describeCheck } from '@ctp/shared';
import { Sparkles } from 'lucide-react';

/** The steps of a test case in plain words: what the patient does, what must be true. */
export const StepsList = ({ steps }: { steps: Step[] }) => (
  <ol className="space-y-4">
    {steps.map((step, index) => (
      <li key={index} className="flex gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
          {index + 1}
        </span>
        <div>
          <p className="font-medium">{describeAction(step.action)}</p>
          <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
            {step.expect.map((check, checkIndex) => (
              <li key={checkIndex} className="flex items-start gap-1">
                {check.type === 'ai_judge' ? (
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600" aria-label="AI check" />
                ) : (
                  <span aria-hidden>✓</span>
                )}
                <span>{describeCheck(check)}</span>
              </li>
            ))}
          </ul>
        </div>
      </li>
    ))}
  </ol>
);
