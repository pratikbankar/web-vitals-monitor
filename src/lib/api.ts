export type Strategy = 'mobile' | 'desktop';

export interface Lab {
  lcp: number | null;
  cls: number | null;
  tbt: number | null;
  fcp: number | null;
  si: number | null;
  ttfb: number | null;
}

export interface Regression {
  metric: 'performance' | 'lcp' | 'fcp' | 'tbt' | 'cls';
  baseline: number;
  value: number;
}

export interface Run {
  _id: string;
  siteId: string;
  strategy: Strategy;
  createdAt: string;
  performance: number;
  lab: Lab;
  field: { lcp: number | null; cls: number | null; inp: number | null; ttfb: number | null } | null;
  opportunities?: Array<{ id: string; title: string; savingsMs: number }>;
  regressions: Regression[];
  budget: { status: 'pass' | 'fail' | 'none'; failures: string[] };
}

export interface Budget {
  performance?: number | null;
  lcp?: number | null;
  cls?: number | null;
  tbt?: number | null;
}

export interface Site {
  _id: string;
  url: string;
  name: string;
  pinned: boolean;
  budget?: Budget;
  createdAt: string;
}

export interface SiteSummary extends Site {
  latest: Record<Strategy, Run | null>;
}

export interface SiteDetail {
  site: Site;
  runs: Record<Strategy, Run[]>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (res.ok) return data as T;
  const error = data?.error as { code?: string; message?: string } | undefined;
  throw new ApiError(res.status, error?.code ?? 'error', error?.message ?? `Something went wrong (${res.status}). Please try again.`);
}

export const message = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');
