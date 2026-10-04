import { ArrowLeft, ExternalLink, LoaderCircle, Monitor, Play, Smartphone, TrendingDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { BadgeSnippet } from '../components/BadgeSnippet';
import { BudgetEditor } from '../components/BudgetEditor';
import { ScoreRing } from '../components/ScoreRing';
import { StatusChips } from '../components/StatusChips';
import { TREND_METRICS, TrendChart, type TrendMetric } from '../components/TrendChart';
import { api, ApiError, message, type Run, type SiteDetail, type Strategy } from '../lib/api';
import { compare, formatMetric, METRICS, type MetricKey, rate, timeAgo } from '../lib/format';

const LAB: MetricKey[] = ['lcp', 'cls', 'tbt', 'fcp', 'si', 'ttfb'];
const FIELD: Array<'lcp' | 'cls' | 'inp' | 'ttfb'> = ['lcp', 'inp', 'cls', 'ttfb'];
const COMPARE: MetricKey[] = ['performance', 'lcp', 'cls', 'tbt', 'fcp', 'si', 'ttfb'];
const RATING_WORD = { good: 'Good', 'needs-improvement': 'Needs work', poor: 'Poor', none: 'No data' } as const;
const STAGES = ['Asking Google to load the page', 'Running Lighthouse', 'Measuring the vitals', 'Almost done'];

const metricValue = (run: Run, m: MetricKey) => (m === 'performance' ? run.performance : m === 'inp' ? null : run.lab[m]);

function MetricCard({ metric, value, failed }: { metric: MetricKey; value: number | null | undefined; failed?: boolean }) {
  const rating = rate(metric, value);
  return (
    <div className="card p-4" title={METRICS[metric].hint}>
      <p className="eyebrow">{METRICS[metric].label}</p>
      <p className={`mt-1.5 font-mono text-2xl font-semibold rating-${rating}`}>{formatMetric(metric, value)}</p>
      <p className="mt-1 text-xs text-muted">
        {METRICS[metric].name}
        <span className={`ml-1 rating-${rating}`}>· {RATING_WORD[rating]}</span>
        {failed && <span className="ml-1 text-poor">· over budget</span>}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SitePage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [detail, setDetail] = useState<SiteDetail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [strategy, setStrategy] = useState<Strategy>('mobile');
  const [metric, setMetric] = useState<TrendMetric>('performance');
  const [auditing, setAuditing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [auditError, setAuditError] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const autoStarted = useRef(false);

  const load = useCallback(() => {
    setLoadError('');
    return api<SiteDetail>(`/sites/${id}`).then(setDetail).catch((err: unknown) => setLoadError(message(err)));
  }, [id]);

  useEffect(() => {
    let alive = true;
    api<SiteDetail>(`/sites/${id}`)
      .then((d) => alive && setDetail(d))
      .catch((err: unknown) => alive && setLoadError(message(err)));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (!auditing) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [auditing]);

  const runAudit = useCallback(
    async (which: Strategy) => {
      setAuditing(true);
      setSeconds(0);
      setAuditError('');
      try {
        const run = await api<Run>(`/sites/${id}/audit`, { method: 'POST', body: { strategy: which } });
        setDetail((d) => (d ? { ...d, runs: { ...d.runs, [which]: [...d.runs[which], run] } } : d));
      } catch (err) {
        // A gateway timeout has no JSON body; say what actually happened.
        setAuditError(err instanceof ApiError && err.status === 504 ? 'The audit took too long. Please try again.' : message(err));
      } finally {
        setAuditing(false);
      }
    },
    [id],
  );

  // Arriving from "Add and audit": start the first audit once, then drop the flag from the address.
  useEffect(() => {
    if (!detail || autoStarted.current || params.get('audit') !== '1') return;
    autoStarted.current = true;
    setParams({}, { replace: true });
    // Deferred a tick so the audit starts after this render, not in the middle of it.
    if (detail.runs.mobile.length === 0) setTimeout(() => void runAudit('mobile'), 0);
  }, [detail, params, setParams, runAudit]);

  if (loadError) {
    return (
      <div className="card p-8 text-center" role="alert">
        <p className="text-poor">{loadError}</p>
        <div className="mt-4 flex justify-center gap-3">
          <button type="button" className="btn btn-ghost" onClick={load}>Try again</button>
          <Link to="/" className="btn btn-ghost">Back to the dashboard</Link>
        </div>
      </div>
    );
  }
  if (!detail) return <p className="py-16 text-center text-muted" role="status">Loading</p>;

  const { site } = detail;
  const runs = detail.runs[strategy];
  const latest = runs.at(-1) ?? null;
  const budgetLimit = metric === 'fcp' ? null : site.budget?.[metric];
  const [a, b] = picked.map((pid) => runs.find((r) => r._id === pid)).filter((r): r is Run => Boolean(r))
    .sort((x, y) => x.createdAt.localeCompare(y.createdAt));

  const togglePick = (runId: string) =>
    setPicked((list) => (list.includes(runId) ? list.filter((p) => p !== runId) : [...list.slice(-1), runId]));

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-accent">
          <ArrowLeft className="size-4" aria-hidden /> All sites
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate font-display text-3xl font-bold tracking-tight">{site.name}</h1>
            <a href={site.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-sm text-muted hover:text-accent">
              <span className="truncate">{site.url}</span> <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Device" className="flex rounded-[10px] border border-line bg-surface p-1">
              {(['mobile', 'desktop'] as const).map((s) => (
                <button
                  key={s} type="button" aria-pressed={strategy === s}
                  onClick={() => { setStrategy(s); setPicked([]); }}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted aria-pressed:bg-raised aria-pressed:text-ink"
                >
                  {s === 'mobile' ? <Smartphone className="size-4" aria-hidden /> : <Monitor className="size-4" aria-hidden />}
                  {s === 'mobile' ? 'Mobile' : 'Desktop'}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-primary" onClick={() => runAudit(strategy)} disabled={auditing}>
              {auditing ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
              {auditing ? 'Auditing' : 'Run audit'}
            </button>
          </div>
        </div>
        <div role="status" aria-live="polite" className="mt-3 min-h-5 text-sm">
          {auditing && <span className="text-muted">{STAGES[Math.min(Math.floor(seconds / 8), STAGES.length - 1)]} ({seconds}s). An audit usually takes 15 to 40 seconds.</span>}
          {!auditing && auditError && <span className="text-poor">{auditError}</span>}
        </div>
      </div>

      {!latest ? (
        <div className="card p-10 text-center text-muted">
          {auditing ? 'The first audit is running. Results will appear here.' : `No ${strategy} audit yet. Press Run audit to measure this page.`}
        </div>
      ) : (
        <>
          <section aria-label="Latest audit" className="grid gap-4 lg:grid-cols-[auto_1fr]">
            <div className="card flex items-center gap-5 p-5 lg:flex-col lg:justify-center lg:px-8">
              <ScoreRing score={latest.performance} size={112} label="Performance score" />
              <div className="lg:text-center">
                <p className="text-sm font-medium">Performance</p>
                <p className="text-xs text-muted">Audited {timeAgo(latest.createdAt)}</p>
                <div className="mt-2"><StatusChips run={latest} /></div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {LAB.map((m) => <MetricCard key={m} metric={m} value={metricValue(latest, m)} failed={latest.budget.failures.includes(m)} />)}
            </div>
          </section>

          {latest.regressions.length > 0 && (
            <div className="card border-ok/50 p-5" role="alert">
              <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ok"><TrendingDown className="size-5" aria-hidden /> This audit is slower than usual</h2>
              <ul className="mt-3 space-y-1.5 text-sm">
                {latest.regressions.map((r) => (
                  <li key={r.metric}>
                    <strong>{METRICS[r.metric].name}</strong> went from a usual {formatMetric(r.metric, r.baseline)} to {formatMetric(r.metric, r.value)}{' '}
                    <span className="text-poor">({compare(r.metric, r.baseline, r.value).text})</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">Compared with the median of the previous five audits.</p>
            </div>
          )}

          <Section title="Trend">
            <div role="group" aria-label="Metric" className="mb-4 flex flex-wrap gap-1.5">
              {TREND_METRICS.map((m) => (
                <button
                  key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}
                  className="rounded-full border border-line px-3 py-1 text-sm text-muted aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-accent-ink"
                >
                  {METRICS[m].label}
                </button>
              ))}
            </div>
            <TrendChart runs={runs} metric={metric} limit={budgetLimit} />
            <p className="mt-2 text-xs text-muted">Red dots mark audits flagged as regressions. The dashed line is the budget.</p>
          </Section>

          {latest.field && (
            <Section title="Real visitors (last 28 days)">
              <p className="mb-4 text-sm text-muted">What people actually experienced on this page, from Chrome's public user data. The numbers above are a lab test.</p>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {FIELD.map((m) => <MetricCard key={m} metric={m} value={latest.field?.[m]} />)}
              </div>
            </Section>
          )}

          {(latest.opportunities?.length ?? 0) > 0 && (
            <Section title="Biggest improvements">
              <ul className="divide-y divide-line">
                {latest.opportunities!.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                    <span>{o.title}</span>
                    <span className="shrink-0 font-mono text-muted">save about {formatMetric('lcp', o.savingsMs)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Audit history">
            <p className="mb-3 text-sm text-muted">Tick two audits to compare them.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                    <th className="py-2 pr-2 font-medium"><span className="sr-only">Compare</span></th>
                    <th className="py-2 pr-4 font-medium">When</th>
                    <th className="py-2 pr-4 font-medium">Score</th>
                    <th className="py-2 pr-4 font-medium">LCP</th>
                    <th className="py-2 pr-4 font-medium">CLS</th>
                    <th className="py-2 pr-4 font-medium">TBT</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...runs].reverse().slice(0, 20).map((run) => (
                    <tr key={run._id} className="border-b border-line/60 last:border-0">
                      <td className="py-2 pr-2">
                        <input
                          type="checkbox" className="size-4 accent-[var(--accent)]" checked={picked.includes(run._id)} onChange={() => togglePick(run._id)}
                          aria-label={`Compare the audit from ${new Date(run.createdAt).toLocaleString()}`}
                        />
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4 text-muted">{new Date(run.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                      <td className={`py-2 pr-4 font-mono font-semibold rating-${rate('performance', run.performance)}`}>{run.performance}</td>
                      <td className="py-2 pr-4 font-mono">{formatMetric('lcp', run.lab.lcp)}</td>
                      <td className="py-2 pr-4 font-mono">{formatMetric('cls', run.lab.cls)}</td>
                      <td className="py-2 pr-4 font-mono">{formatMetric('tbt', run.lab.tbt)}</td>
                      <td className="py-2"><StatusChips run={run} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {a && b && (
              <div className="mt-5 rounded-xl border border-line bg-bg p-4">
                <h3 className="font-display font-semibold">
                  {new Date(a.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })} compared with {new Date(b.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                </h3>
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                  {COMPARE.map((m) => {
                    const change = compare(m, metricValue(a, m), metricValue(b, m));
                    return (
                      <div key={m}>
                        <dt className="eyebrow">{METRICS[m].label}</dt>
                        <dd className="mt-0.5 font-mono text-sm">
                          {formatMetric(m, metricValue(a, m))} → {formatMetric(m, metricValue(b, m))}
                          <span className={`ml-1.5 ${change.verdict === 'better' ? 'text-good' : change.verdict === 'worse' ? 'text-poor' : 'text-muted'}`}>
                            {change.text}{change.verdict === 'better' ? ' better' : change.verdict === 'worse' ? ' worse' : ''}
                          </span>
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            )}
          </Section>
        </>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Performance budget">
          <BudgetEditor key={site._id} site={site} onSaved={(next) => setDetail((d) => (d ? { ...d, site: next } : d))} />
        </Section>
        <Section title="Status badge">
          <BadgeSnippet site={site} strategy={strategy} version={latest?._id ?? 'none'} />
        </Section>
      </div>
    </div>
  );
}
