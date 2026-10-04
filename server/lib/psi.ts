import { AppError } from '../errors.js';
import type { LabMetrics } from './rules.js';

export type Strategy = 'mobile' | 'desktop';

export interface FieldMetrics {
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  ttfb: number | null;
}

export interface Opportunity {
  id: string;
  title: string;
  savingsMs: number;
}

export interface AuditResult {
  performance: number;
  lab: LabMetrics;
  /** Real-user data from the Chrome UX Report. Null when Google has none for this page. */
  field: FieldMetrics | null;
  opportunities: Opportunity[];
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const cannotAudit = (reason?: string) =>
  new AppError(422, 'audit_failed', `Google could not audit this page${reason ? `: ${reason}` : ''}`);

/** Turns a PageSpeed Insights v5 response into the numbers this app stores. */
export function parsePsi(json: unknown): AuditResult {
  const lh = (json as Json | null)?.lighthouseResult as Json | undefined;
  const score = lh?.categories?.performance?.score;
  const runtimeError = lh?.runtimeError as { code?: string; message?: string } | undefined;
  const errored = Boolean(runtimeError?.code) && runtimeError?.code !== 'NO_ERROR';
  if (!lh || typeof score !== 'number' || errored) {
    throw cannotAudit(runtimeError?.message);
  }

  const audits = (lh.audits ?? {}) as Json;
  const ms = (id: string): number | null => {
    const v = audits[id]?.numericValue;
    return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
  };
  const cls = audits['cumulative-layout-shift']?.numericValue;

  const fieldRaw = ((json as Json).loadingExperience?.metrics ?? {}) as Json;
  const pct = (key: string): number | null => {
    const v = fieldRaw[key]?.percentile;
    return typeof v === 'number' ? v : null;
  };
  const fieldCls = pct('CUMULATIVE_LAYOUT_SHIFT_SCORE');
  const field: FieldMetrics = {
    lcp: pct('LARGEST_CONTENTFUL_PAINT_MS'),
    // The API reports CLS multiplied by 100.
    cls: fieldCls === null ? null : fieldCls / 100,
    inp: pct('INTERACTION_TO_NEXT_PAINT'),
    ttfb: pct('EXPERIMENTAL_TIME_TO_FIRST_BYTE'),
  };

  // Older Lighthouse versions report one overall saving per "opportunity"; newer ones report
  // savings per metric on "insight" audits. Both are read, as the time saved on FCP or LCP.
  const savingOf = (a: Json): number => {
    if (a?.details?.type === 'opportunity') return Number(a.details.overallSavingsMs) || 0;
    if (typeof a?.score === 'number' && a.score < 1 && a.metricSavings) {
      return Math.max(0, Number(a.metricSavings.LCP) || 0, Number(a.metricSavings.FCP) || 0);
    }
    return 0;
  };
  const opportunities: Opportunity[] = Object.values(audits)
    .filter(Boolean)
    .map((a: Json) => ({ id: String(a.id), title: String(a.title), savingsMs: Math.round(savingOf(a)) }))
    .filter((o) => o.savingsMs > 0)
    .sort((a, b) => b.savingsMs - a.savingsMs)
    .slice(0, 6);

  const lab = {
    lcp: ms('largest-contentful-paint'),
    cls: typeof cls === 'number' ? Math.round(cls * 1000) / 1000 : null,
    tbt: ms('total-blocking-time'),
    fcp: ms('first-contentful-paint'),
    si: ms('speed-index'),
    ttfb: ms('server-response-time'),
  };
  // A score with no measurements behind it is a failed run, not a slow page.
  if (Object.values(lab).every((v) => v === null)) throw cannotAudit();

  return {
    performance: Math.round(score * 100),
    lab,
    field: Object.values(field).some((v) => v !== null) ? field : null,
    opportunities,
  };
}

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

export type RunPsi = (url: string, strategy: Strategy) => Promise<AuditResult>;

/** Asks Google to run Lighthouse on the page. The page is fetched by Google, never by this server. */
export const runPsi: RunPsi = async (url, strategy) => {
  const params = new URLSearchParams({ url, strategy, category: 'performance' });
  if (process.env.PSI_API_KEY) params.set('key', process.env.PSI_API_KEY);

  const unavailable = () => new AppError(502, 'audit_unavailable', 'The audit service is unavailable. Please try again.');

  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(55000) });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw timedOut ? new AppError(504, 'audit_timeout', 'The audit took too long. Please try again.') : unavailable();
  }
  const body = (await res.json().catch(() => null)) as Json | null;
  if (res.status === 429) {
    throw new AppError(503, 'audit_quota', 'The audit service is busy right now. Please try again in a few minutes.');
  }
  if (res.status === 401 || res.status === 403) {
    // A missing key, a disabled API or a spent daily quota: our problem, not the visitor's page.
    console.error('PageSpeed Insights rejected the request:', res.status, body?.error?.message);
    throw new AppError(503, 'audit_unavailable', 'Audits are temporarily unavailable. Please try again later.');
  }
  if (res.status >= 500) throw unavailable();
  if (!res.ok) {
    // Google explains unreachable or invalid pages in error.message; it is safe to show.
    const reason = String(body?.error?.message ?? '').split('\n')[0].slice(0, 200);
    throw cannotAudit(reason || undefined);
  }
  return parsePsi(body);
};
