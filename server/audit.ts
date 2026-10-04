import type { Types } from 'mongoose';
import type { RunPsi, Strategy } from './lib/psi.js';
import { type Budget, detectRegressions, evaluateBudget, type RunMetrics } from './lib/rules.js';
import { Run } from './models.js';

interface SiteLike {
  _id: Types.ObjectId;
  url: string;
  /** Limits as stored; unset limits may be missing or null. */
  budget?: { [K in keyof Budget]?: number | null } | null;
}

/** Runs one audit and stores it. Nothing is written unless the audit succeeds. */
export async function auditSite(site: SiteLike, strategy: Strategy, runPsi: RunPsi) {
  const result = await runPsi(site.url, strategy);

  const history = await Run.find({ siteId: site._id, strategy }).sort({ createdAt: -1 }).limit(5).lean();
  const previous = history.reverse() as unknown as RunMetrics[];
  const current: RunMetrics = { performance: result.performance, lab: result.lab };

  const run = await Run.create({
    siteId: site._id,
    strategy,
    ...result,
    regressions: detectRegressions(previous, current),
    budget: evaluateBudget(site.budget as Budget | null | undefined, current),
  });
  return run.toObject();
}
