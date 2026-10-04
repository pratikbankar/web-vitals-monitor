import { CircleCheck, CircleX, TrendingDown } from 'lucide-react';
import type { Run } from '../lib/api';
import { METRICS } from '../lib/format';

const chip = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium';

/** Budget and regression status for one run. Uses an icon and words, never colour alone. */
export function StatusChips({ run }: { run: Run | null }) {
  if (!run) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {run.budget.status === 'pass' && (
        <span className={`${chip} border-good/40 text-good`}><CircleCheck className="size-3.5" aria-hidden /> Budget met</span>
      )}
      {run.budget.status === 'fail' && (
        <span className={`${chip} border-poor/40 text-poor`} title={`Over budget: ${run.budget.failures.join(', ')}`}>
          <CircleX className="size-3.5" aria-hidden /> Over budget
        </span>
      )}
      {run.regressions.length > 0 && (
        <span className={`${chip} border-ok/40 text-ok`} title={run.regressions.map((r) => METRICS[r.metric].label).join(', ')}>
          <TrendingDown className="size-3.5" aria-hidden /> Regression
        </span>
      )}
    </span>
  );
}
