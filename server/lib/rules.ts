/** The numbers every rule works on. A lab metric is null when Lighthouse did not report it. */
export interface LabMetrics {
  /** Largest Contentful Paint, ms */
  lcp: number | null;
  /** Cumulative Layout Shift, unitless */
  cls: number | null;
  /** Total Blocking Time, ms */
  tbt: number | null;
  /** First Contentful Paint, ms */
  fcp: number | null;
  /** Speed Index, ms */
  si: number | null;
  /** Server response time, ms */
  ttfb: number | null;
}

export interface RunMetrics {
  /** Lighthouse performance score, 0 to 100 */
  performance: number;
  lab: LabMetrics;
}

export type RegressionMetric = 'performance' | 'lcp' | 'fcp' | 'tbt' | 'cls';

export interface Regression {
  metric: RegressionMetric;
  baseline: number;
  value: number;
}

const MIN_HISTORY = 3;
const BASELINE_RUNS = 5;
const SCORE_DROP = 10;
const RELATIVE_WORSE = 0.2;
/** A timing metric must also be worse by this many ms, so tiny pages do not flap. */
const ABSOLUTE_WORSE_MS: Record<'lcp' | 'fcp' | 'tbt', number> = { lcp: 300, fcp: 300, tbt: 100 };
const CLS_WORSE = 0.05;
/** Blocking time often sits at zero, so a rise that is still rated good (200 ms or less) is not news. */
const TBT_GOOD = 200;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Compares a run with the median of the runs before it (oldest first, same strategy).
 * The median, rather than the last run, keeps one unusually slow audit from hiding or
 * inventing a regression.
 */
export function detectRegressions(previous: RunMetrics[], current: RunMetrics): Regression[] {
  if (previous.length < MIN_HISTORY) return [];
  const recent = previous.slice(-BASELINE_RUNS);
  const found: Regression[] = [];

  const scoreBaseline = median(recent.map((r) => r.performance));
  if (scoreBaseline - current.performance >= SCORE_DROP) {
    found.push({ metric: 'performance', baseline: scoreBaseline, value: current.performance });
  }

  const baselineOf = (metric: keyof LabMetrics): number | null => {
    const values = recent.map((r) => r.lab[metric]).filter((v): v is number => v !== null);
    return values.length >= MIN_HISTORY ? median(values) : null;
  };

  for (const metric of ['lcp', 'fcp', 'tbt'] as const) {
    const baseline = baselineOf(metric);
    const value = current.lab[metric];
    if (baseline === null || value === null) continue;
    if (metric === 'tbt' && value <= TBT_GOOD) continue;
    const worseBy = value - baseline;
    if (worseBy >= ABSOLUTE_WORSE_MS[metric] && worseBy >= baseline * RELATIVE_WORSE) {
      found.push({ metric, baseline, value });
    }
  }

  const clsBaseline = baselineOf('cls');
  if (clsBaseline !== null && current.lab.cls !== null && round3(current.lab.cls - clsBaseline) >= CLS_WORSE) {
    found.push({ metric: 'cls', baseline: clsBaseline, value: current.lab.cls });
  }

  // Report in a fixed order: score first, then the vitals.
  const order: RegressionMetric[] = ['performance', 'lcp', 'fcp', 'tbt', 'cls'];
  return found.sort((a, b) => order.indexOf(a.metric) - order.indexOf(b.metric));
}

export interface Budget {
  /** Minimum performance score */
  performance?: number;
  /** Maximum LCP, ms */
  lcp?: number;
  /** Maximum CLS */
  cls?: number;
  /** Maximum TBT, ms */
  tbt?: number;
}

export type BudgetMetric = keyof Budget;
export interface BudgetResult {
  status: 'pass' | 'fail' | 'none';
  failures: BudgetMetric[];
}

export function evaluateBudget(budget: Budget | undefined | null, run: RunMetrics): BudgetResult {
  const limits = (['performance', 'lcp', 'cls', 'tbt'] as const).filter((k) => typeof budget?.[k] === 'number');
  if (limits.length === 0) return { status: 'none', failures: [] };

  const failures = limits.filter((metric) => {
    const limit = budget![metric]!;
    if (metric === 'performance') return run.performance < limit;
    const value = run.lab[metric];
    // A limit that cannot be checked is not a limit that was met.
    return value === null || value > limit;
  });
  return { status: failures.length ? 'fail' : 'pass', failures };
}
