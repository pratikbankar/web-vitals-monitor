export type MetricKey = 'performance' | 'lcp' | 'cls' | 'tbt' | 'fcp' | 'si' | 'ttfb' | 'inp';
export type Rating = 'good' | 'needs-improvement' | 'poor' | 'none';

interface MetricInfo {
  label: string;
  name: string;
  unit: 'ms' | 'score' | 'unitless';
  /** [good up to, poor above]. For the score: [good from, poor below]. */
  thresholds: [number, number];
  hint: string;
}

export const METRICS: Record<MetricKey, MetricInfo> = {
  performance: { label: 'Score', name: 'Performance score', unit: 'score', thresholds: [90, 50], hint: 'Lighthouse performance score, 0 to 100.' },
  lcp: { label: 'LCP', name: 'Largest Contentful Paint', unit: 'ms', thresholds: [2500, 4000], hint: 'When the main content has loaded.' },
  cls: { label: 'CLS', name: 'Cumulative Layout Shift', unit: 'unitless', thresholds: [0.1, 0.25], hint: 'How much the page jumps around while loading.' },
  tbt: { label: 'TBT', name: 'Total Blocking Time', unit: 'ms', thresholds: [200, 600], hint: 'How long the page is too busy to respond.' },
  fcp: { label: 'FCP', name: 'First Contentful Paint', unit: 'ms', thresholds: [1800, 3000], hint: 'When the first content appears.' },
  si: { label: 'Speed Index', name: 'Speed Index', unit: 'ms', thresholds: [3400, 5800], hint: 'How quickly the page visibly fills in.' },
  ttfb: { label: 'TTFB', name: 'Time to First Byte', unit: 'ms', thresholds: [800, 1800], hint: 'How fast the server starts answering.' },
  inp: { label: 'INP', name: 'Interaction to Next Paint', unit: 'ms', thresholds: [200, 500], hint: 'How quickly the page reacts to real users.' },
};

export function rate(metric: MetricKey, value: number | null | undefined): Rating {
  if (value === null || value === undefined) return 'none';
  const [good, poor] = METRICS[metric].thresholds;
  if (metric === 'performance') return value >= good ? 'good' : value >= poor ? 'needs-improvement' : 'poor';
  return value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor';
}

const MISSING = '–';

function formatAmount(metric: MetricKey, value: number): string {
  const { unit } = METRICS[metric];
  if (unit === 'score') return String(Math.round(value));
  if (unit === 'unitless') return value.toFixed(2);
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

export function formatMetric(metric: MetricKey, value: number | null | undefined): string {
  return value === null || value === undefined ? MISSING : formatAmount(metric, value);
}

export interface Comparison {
  text: string;
  verdict: 'better' | 'worse' | 'same';
}

/** Describes the change from `before` to `after`, knowing which direction is an improvement. */
export function compare(metric: MetricKey, before: number | null | undefined, after: number | null | undefined): Comparison {
  if (before === null || before === undefined || after === null || after === undefined) return { text: MISSING, verdict: 'same' };
  const delta = METRICS[metric].unit === 'unitless' ? Math.round((after - before) * 1000) / 1000 : after - before;
  if (delta === 0) return { text: 'no change', verdict: 'same' };
  const higherIsBetter = metric === 'performance';
  const sign = delta > 0 ? '+' : '−';
  return {
    text: `${sign}${formatAmount(metric, Math.abs(delta))}`,
    verdict: delta > 0 === higherIsBetter ? 'better' : 'worse',
  };
}

export function timeAgo(date: string | null | undefined, now = Date.now()): string {
  if (!date) return 'never';
  const minutes = Math.floor((now - new Date(date).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
