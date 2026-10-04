import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderBadge } from '../../server/lib/badge.js';
import { parsePsi, runPsi } from '../../server/lib/psi.js';
import { detectRegressions, evaluateBudget, type RunMetrics } from '../../server/lib/rules.js';
import { normalizeUrl } from '../../server/lib/url.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/psi.json', import.meta.url), 'utf8'));
const run = (over: { performance?: number; lab?: Partial<RunMetrics['lab']> } = {}): RunMetrics => ({
  performance: over.performance ?? 90,
  lab: { lcp: 2000, cls: 0.05, tbt: 150, fcp: 1200, si: 2500, ttfb: 200, ...(over.lab ?? {}) },
});

describe('parsePsi', () => {
  it('reads the score, lab metrics and field data', () => {
    const r = parsePsi(fixture);
    expect(r.performance).toBe(87);
    expect(r.lab).toEqual({ lcp: 2844, cls: 0.042, tbt: 188, fcp: 1512, si: 3121, ttfb: 212 });
    expect(r.field).toEqual({ lcp: 2100, cls: 0.07, inp: 180, ttfb: 640 });
  });

  it('lists only real improvement suggestions, largest saving first', () => {
    expect(parsePsi(fixture).opportunities).toEqual([
      { id: 'render-blocking-resources', title: 'Eliminate render-blocking resources', savingsMs: 780 },
      { id: 'unused-javascript', title: 'Reduce unused JavaScript', savingsMs: 450 },
      { id: 'uses-text-compression', title: 'Enable text compression', savingsMs: 120 },
    ]);
  });

  it('returns no field data when Google has none for the page', () => {
    expect(parsePsi({ ...fixture, loadingExperience: {} }).field).toBeNull();
    expect(parsePsi({ ...fixture, loadingExperience: undefined }).field).toBeNull();
  });

  it('keeps a metric as null when Lighthouse did not report it', () => {
    const audits = { ...fixture.lighthouseResult.audits, 'speed-index': undefined };
    const r = parsePsi({ ...fixture, lighthouseResult: { ...fixture.lighthouseResult, audits } });
    expect(r.lab.si).toBeNull();
    expect(r.lab.lcp).toBe(2844);
  });

  it('reads improvement suggestions from newer Lighthouse versions, which report savings per metric', () => {
    const audits = {
      ...fixture.lighthouseResult.audits,
      'unused-javascript': undefined, 'render-blocking-resources': undefined, 'uses-text-compression': undefined,
      'render-blocking-insight': { id: 'render-blocking-insight', title: 'Render blocking requests', score: 0, metricSavings: { FCP: 300, LCP: 650 }, details: { type: 'table' } },
      'image-delivery-insight': { id: 'image-delivery-insight', title: 'Improve image delivery', score: 0.5, metricSavings: { LCP: 200 }, details: { type: 'table' } },
      'font-display-insight': { id: 'font-display-insight', title: 'Font display', score: 1, metricSavings: { FCP: 900 }, details: { type: 'table' } },
      'cls-culprits-insight': { id: 'cls-culprits-insight', title: 'Layout shift culprits', score: 0, metricSavings: { CLS: 0.2 }, details: { type: 'table' } },
    };
    const r = parsePsi({ ...fixture, lighthouseResult: { ...fixture.lighthouseResult, audits } });
    expect(r.opportunities).toEqual([
      { id: 'render-blocking-insight', title: 'Render blocking requests', savingsMs: 650 },
      { id: 'image-delivery-insight', title: 'Improve image delivery', savingsMs: 200 },
    ]);
  });

  it('refuses a result where Lighthouse reported a runtime error or measured nothing', () => {
    const lh = fixture.lighthouseResult;
    const errored = { ...fixture, lighthouseResult: { ...lh, runtimeError: { code: 'NO_FCP', message: 'The page did not paint any content' }, categories: { performance: { score: 0 } } } };
    expect(() => parsePsi(errored)).toThrow(/did not paint/);
    const empty = { ...fixture, lighthouseResult: { ...lh, categories: { performance: { score: 0 } }, audits: {} } };
    expect(() => parsePsi(empty)).toThrow(/could not audit/i);
    const fine = { ...fixture, lighthouseResult: { ...lh, runtimeError: { code: 'NO_ERROR', message: '' } } };
    expect(parsePsi(fine).performance).toBe(87);
  });

  it('fails with a readable error when the page could not be audited', () => {
    const broken = { lighthouseResult: { runtimeError: { code: 'ERRORED_DOCUMENT_REQUEST', message: 'Status 404' }, categories: { performance: { score: null } }, audits: {} } };
    expect(() => parsePsi(broken)).toThrow(/could not audit/i);
    expect(() => parsePsi({})).toThrow(/could not audit/i);
    expect(() => parsePsi(null)).toThrow(/could not audit/i);
  });
});

describe('detectRegressions', () => {
  const steady = [run(), run(), run(), run()];

  it('needs at least three earlier runs', () => {
    expect(detectRegressions([run(), run()], run({ performance: 40 }))).toEqual([]);
    expect(detectRegressions([], run({ performance: 40 }))).toEqual([]);
  });

  it('does not flag a run that matches the baseline', () => {
    expect(detectRegressions(steady, run())).toEqual([]);
  });

  it('flags a performance drop of ten points or more', () => {
    expect(detectRegressions(steady, run({ performance: 81 }))).toEqual([]);
    expect(detectRegressions(steady, run({ performance: 80 }))).toEqual([{ metric: 'performance', baseline: 90, value: 80 }]);
  });

  it('flags a timing metric only when it is worse both relatively and absolutely', () => {
    // 20 percent worse but only 100 ms: fcp 500 -> 600 is noise, not a regression.
    const fast = [1, 2, 3].map(() => run({ lab: { fcp: 500 } }));
    expect(detectRegressions(fast, run({ lab: { fcp: 600 } }))).toEqual([]);
    expect(detectRegressions(steady, run({ lab: { lcp: 2500 } }))).toEqual([{ metric: 'lcp', baseline: 2000, value: 2500 }]);
    expect(detectRegressions(steady, run({ lab: { tbt: 260 } }))).toEqual([{ metric: 'tbt', baseline: 150, value: 260 }]);
  });

  it('does not call a blocking time that is still good a regression, even from a baseline of zero', () => {
    const idle = [1, 2, 3, 4].map(() => run({ lab: { tbt: 0 } }));
    expect(detectRegressions(idle, run({ lab: { tbt: 150 } }))).toEqual([]);
    expect(detectRegressions(idle, run({ lab: { tbt: 200 } }))).toEqual([]);
    expect(detectRegressions(idle, run({ lab: { tbt: 450 } }))).toEqual([{ metric: 'tbt', baseline: 0, value: 450 }]);
  });

  it('flags a layout shift that worsens by 0.05 or more', () => {
    expect(detectRegressions(steady, run({ lab: { cls: 0.09 } }))).toEqual([]);
    expect(detectRegressions(steady, run({ lab: { cls: 0.11 } }))).toEqual([{ metric: 'cls', baseline: 0.05, value: 0.11 }]);
  });

  it('uses the median of the last five runs, so one earlier bad run does not hide a regression', () => {
    const history = [run(), run(), run({ performance: 30 }), run(), run()];
    expect(detectRegressions(history, run({ performance: 75 }))).toEqual([{ metric: 'performance', baseline: 90, value: 75 }]);
  });

  it('ignores a metric that is missing from the current run or from the history', () => {
    const noLcp = [1, 2, 3].map(() => run({ lab: { lcp: null } }));
    expect(detectRegressions(noLcp, run({ lab: { lcp: 9000 } }))).toEqual([]);
    expect(detectRegressions(steady, run({ lab: { lcp: null } }))).toEqual([]);
  });

  it('does not flag an improvement', () => {
    expect(detectRegressions(steady, run({ performance: 100, lab: { lcp: 900, cls: 0, tbt: 0 } }))).toEqual([]);
  });
});

describe('evaluateBudget', () => {
  it('reports none when no budget is set', () => {
    expect(evaluateBudget({}, run())).toEqual({ status: 'none', failures: [] });
    expect(evaluateBudget(undefined, run())).toEqual({ status: 'none', failures: [] });
  });

  it('passes when every limit is met, including exactly on the limit', () => {
    expect(evaluateBudget({ performance: 90, lcp: 2000, cls: 0.05, tbt: 150 }, run())).toEqual({ status: 'pass', failures: [] });
  });

  it('lists every limit that is broken', () => {
    const r = evaluateBudget({ performance: 95, lcp: 1500, cls: 0.1 }, run());
    expect(r).toEqual({ status: 'fail', failures: ['performance', 'lcp'] });
  });

  it('treats a metric the run did not report as a failure of its limit', () => {
    expect(evaluateBudget({ lcp: 2500 }, run({ lab: { lcp: null } }))).toEqual({ status: 'fail', failures: ['lcp'] });
  });
});

describe('renderBadge', () => {
  it('shows the score and budget status', () => {
    const svg = renderBadge({ performance: 92, budget: 'pass' });
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('92 · budget met');
    expect(svg).toContain('#0cce6b');
  });

  it('colours by score band and marks a failed budget', () => {
    expect(renderBadge({ performance: 70, budget: 'none' })).toContain('#ffa400');
    expect(renderBadge({ performance: 30, budget: 'none' })).toContain('#ff4e42');
    const failed = renderBadge({ performance: 95, budget: 'fail' });
    expect(failed).toContain('95 · over budget');
    expect(failed).toContain('#ff4e42');
  });

  it('renders a valid "no data" badge when there is nothing to show', () => {
    const svg = renderBadge(null);
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('no data');
    expect(svg).toMatch(/<\/svg>$/);
  });
});

describe('normalizeUrl', () => {
  it('treats casing, trailing slashes and fragments as the same site', () => {
    const expected = 'https://example.com/';
    for (const input of ['https://example.com', 'HTTPS://Example.COM/', ' https://example.com/#top ', 'example.com']) {
      expect(normalizeUrl(input)).toBe(expected);
    }
    expect(normalizeUrl('https://example.com/blog/')).toBe('https://example.com/blog');
    expect(normalizeUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
  });

  it('rejects anything that is not a public web address', () => {
    const bad = [
      '', 'not a url', 'ftp://example.com', 'javascript:alert(1)', 'http://localhost:3000', 'http://127.0.0.1',
      'http://10.0.0.5', 'http://192.168.1.1', 'http://172.16.0.1', 'http://169.254.169.254/latest', 'http://[::1]/',
      'http://intranet', 'https://user:pass@example.com', 'http://0.0.0.0', 'https://example.com:8443/' + 'a'.repeat(600),
    ];
    for (const input of bad) expect(() => normalizeUrl(input), input).toThrow();
  });
});

describe('runPsi', () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })));
  const failure = async () => runPsi('https://example.com/', 'mobile').then(() => null, (e: { status: number; code: string; message: string }) => e);

  it('returns the parsed audit and passes the page and device to Google', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await runPsi('https://example.com/a?b=1', 'desktop')).performance).toBe(87);
    const called = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(called.hostname).toBe('www.googleapis.com');
    expect(called.searchParams.get('url')).toBe('https://example.com/a?b=1');
    expect(called.searchParams.get('strategy')).toBe('desktop');
  });

  it('reports a busy or misconfigured audit service as unavailable, not as a problem with the page', async () => {
    respond(429, { error: { message: 'Quota exceeded' } });
    expect(await failure()).toMatchObject({ status: 503, code: 'audit_quota' });
    for (const status of [401, 403]) {
      respond(status, { error: { message: 'API key not valid. Please pass a valid API key.' } });
      const err = await failure();
      expect(err).toMatchObject({ status: 503, code: 'audit_unavailable' });
      expect(err!.message).not.toMatch(/API key/);
    }
    respond(500, 'oops');
    expect(await failure()).toMatchObject({ status: 502, code: 'audit_unavailable' });
  });

  it('passes on Google\'s explanation when the page itself cannot be audited', async () => {
    respond(400, { error: { message: 'Lighthouse returned error: FAILED_DOCUMENT_REQUEST. Details: net::ERR_NAME_NOT_RESOLVED\nmore' } });
    const err = await failure();
    expect(err).toMatchObject({ status: 422, code: 'audit_failed' });
    expect(err!.message).toContain('FAILED_DOCUMENT_REQUEST');
    expect(err!.message).not.toContain('more');
  });

  it('tells a timeout apart from a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError'); }));
    expect(await failure()).toMatchObject({ status: 504, code: 'audit_timeout' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await failure()).toMatchObject({ status: 502, code: 'audit_unavailable' });
  });

  it('handles a success response that is not JSON', async () => {
    respond(200, '<html>');
    expect(await failure()).toMatchObject({ status: 422, code: 'audit_failed' });
  });
});
