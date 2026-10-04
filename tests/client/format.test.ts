import { describe, expect, it } from 'vitest';
import { compare, formatMetric, rate, timeAgo } from '../../src/lib/format';

describe('rate', () => {
  it('uses the Core Web Vitals thresholds, with the limit itself counting as good', () => {
    expect(rate('lcp', 2500)).toBe('good');
    expect(rate('lcp', 2501)).toBe('needs-improvement');
    expect(rate('lcp', 4001)).toBe('poor');
    expect(rate('cls', 0.1)).toBe('good');
    expect(rate('cls', 0.26)).toBe('poor');
    expect(rate('tbt', 200)).toBe('good');
    expect(rate('inp', 501)).toBe('poor');
  });

  it('rates the performance score the other way round', () => {
    expect(rate('performance', 90)).toBe('good');
    expect(rate('performance', 89)).toBe('needs-improvement');
    expect(rate('performance', 49)).toBe('poor');
  });

  it('has no rating for a missing value', () => {
    expect(rate('lcp', null)).toBe('none');
    expect(rate('lcp', undefined)).toBe('none');
  });
});

describe('formatMetric', () => {
  it('shows seconds for long timings and milliseconds for short ones', () => {
    expect(formatMetric('lcp', 2844)).toBe('2.8 s');
    expect(formatMetric('tbt', 188)).toBe('188 ms');
    expect(formatMetric('ttfb', 1200)).toBe('1.2 s');
  });
  it('shows layout shift to two decimals and the score as a whole number', () => {
    expect(formatMetric('cls', 0.042)).toBe('0.04');
    expect(formatMetric('performance', 87)).toBe('87');
  });
  it('shows a dash for a missing value instead of NaN', () => {
    expect(formatMetric('lcp', null)).toBe('–');
  });
});

describe('compare', () => {
  it('knows that a lower timing is better and a higher score is better', () => {
    expect(compare('lcp', 3000, 2500)).toEqual({ text: '−500 ms', verdict: 'better' });
    expect(compare('lcp', 2500, 3000)).toEqual({ text: '+500 ms', verdict: 'worse' });
    expect(compare('performance', 80, 92)).toEqual({ text: '+12', verdict: 'better' });
    expect(compare('cls', 0.05, 0.12)).toEqual({ text: '+0.07', verdict: 'worse' });
  });
  it('reports no change and missing values plainly', () => {
    expect(compare('tbt', 150, 150)).toEqual({ text: 'no change', verdict: 'same' });
    expect(compare('lcp', null, 2500)).toEqual({ text: '–', verdict: 'same' });
  });
});

describe('timeAgo', () => {
  const now = new Date('2026-10-04T12:00:00Z').getTime();
  it('describes recent times in words', () => {
    expect(timeAgo('2026-10-04T11:59:40Z', now)).toBe('just now');
    expect(timeAgo('2026-10-04T11:15:00Z', now)).toBe('45 min ago');
    expect(timeAgo('2026-10-04T07:00:00Z', now)).toBe('5 h ago');
    expect(timeAgo('2026-10-01T12:00:00Z', now)).toBe('3 days ago');
    expect(timeAgo('2026-10-03T11:00:00Z', now)).toBe('1 day ago');
  });
  it('says never when there is no date', () => {
    expect(timeAgo(null, now)).toBe('never');
  });
});
