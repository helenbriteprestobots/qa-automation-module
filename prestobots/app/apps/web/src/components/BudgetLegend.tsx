import type { AiStatus } from '@ctp/shared';
import { Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

import { formatUsd } from '../format';

/** Header legend: "Claude: US$ 1.20 of US$ 20 this month". Links to Settings. */
export const BudgetLegend = ({ ai }: { ai: AiStatus }) => {
  if (!ai.enabled) {
    return (
      <Link to="/settings" className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200">
        <Sparkles className="h-3.5 w-3.5" aria-hidden /> AI off
      </Link>
    );
  }
  const { spentUsd, limitUsd, level } = ai.budget;
  const style = {
    ok: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
    warning: 'bg-amber-100 text-amber-900 hover:bg-amber-200',
    exhausted: 'bg-red-100 text-red-800 hover:bg-red-200',
  }[level];
  return (
    <Link
      to="/settings"
      title={level === 'exhausted' ? 'Monthly AI budget reached: AI features are paused.' : 'AI spending this month (this platform only)'}
      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${style}`}
    >
      <Sparkles className="h-3.5 w-3.5" aria-hidden />
      Claude: {formatUsd(spentUsd)} of {formatUsd(limitUsd)} this month
    </Link>
  );
};
