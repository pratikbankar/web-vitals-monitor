import { timingSafeEqual } from 'node:crypto';
import express, { type Express, type Request, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { z } from 'zod';
import { auditSite } from './audit.js';
import { AppError, ah, errorHandler, notFound } from './errors.js';
import { renderBadge } from './lib/badge.js';
import { runPsi as realRunPsi, type RunPsi, type Strategy } from './lib/psi.js';
import type { Budget } from './lib/rules.js';
import { normalizeUrl } from './lib/url.js';
import { Run, Site } from './models.js';

const MAX_SITES = 12;
const COOLDOWN_MS = 5 * 60 * 1000;
/** After a failed audit the visitor may retry sooner, but not in a tight loop. */
const RETRY_AFTER_FAILURE_MS = 60 * 1000;
/** The daily job stops starting new audits after this long, to finish inside the function limit. */
const CRON_BUDGET_MS = 230 * 1000;
const HISTORY_PER_STRATEGY = 60;
const HOUR = 60 * 60 * 1000;
const STRATEGIES: Strategy[] = ['mobile', 'desktop'];

const auditBody = z.object({ strategy: z.enum(['mobile', 'desktop']) });
const siteBody = z.object({ url: z.string(), name: z.string().trim().max(60).optional() });
const limit = (max: number) => z.number().min(0).max(max).nullable().optional();
const budgetBody = z.strictObject({ performance: limit(100), lcp: limit(60000), cls: limit(5), tbt: limit(60000) });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  const details = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  throw new AppError(400, details.some((d) => d.path === 'url') ? 'invalid_url' : 'validation_error', 'Some fields are invalid', details);
}

function secretMatches(given: unknown, expected: string | undefined): boolean {
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const isAdmin = (req: Request) => secretMatches(req.headers['x-admin-key'], process.env.ADMIN_KEY);
const requireAdmin: RequestHandler = (req, _res, next) =>
  next(isAdmin(req) ? undefined : new AppError(401, 'unauthorized', 'An admin key is required for this'));

const perVisitor = (max: number, message: string) =>
  rateLimit({
    windowMs: HOUR,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Tests opt in per request so unrelated tests are not throttled.
    skip: (req) => process.env.NODE_ENV === 'test' && !req.headers['x-test-ratelimit'],
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'rate_limited', message } });
    },
  });

async function findSite(id: string) {
  const site = mongoose.isValidObjectId(id) && /^[a-f0-9]{24}$/.test(id) ? await Site.findById(id) : null;
  if (!site) throw new AppError(404, 'not_found', 'Site not found');
  return site;
}

const latestRun = (siteId: mongoose.Types.ObjectId | string, strategy: Strategy) =>
  Run.findOne({ siteId, strategy }).sort({ createdAt: -1 }).select('-opportunities').lean();

/** `runPsi` is injectable so tests never call Google. */
export function createApp({ runPsi = realRunPsi }: { runPsi?: RunPsi } = {}): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(express.json({ limit: '20kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get(
    '/api/sites',
    ah(async (_req, res) => {
      const sites = await Site.find().sort({ pinned: -1, createdAt: 1 }).lean();
      const withLatest = await Promise.all(
        sites.map(async (site) => {
          const [mobile, desktop] = await Promise.all(STRATEGIES.map((s) => latestRun(site._id, s)));
          return { ...site, latest: { mobile, desktop } };
        }),
      );
      res.json(withLatest);
    }),
  );

  app.post(
    '/api/sites',
    perVisitor(5, 'You have added several sites already. Please try again later.'),
    ah(async (req, res) => {
      const body = parse(siteBody, req.body);
      const url = normalizeUrl(body.url);
      const existing = await Site.findOne({ url }).lean();
      if (existing) {
        res.json(existing);
        return;
      }
      if ((await Site.countDocuments()) >= MAX_SITES) {
        // Make room rather than leave the demo full for every later visitor.
        const oldest = await Site.findOne({ pinned: false }).sort({ createdAt: 1 });
        if (!oldest) throw new AppError(409, 'site_limit', 'This demo is full of example sites, so no more can be added.');
        await Promise.all([Run.deleteMany({ siteId: oldest._id }), oldest.deleteOne()]);
      }
      try {
        const site = await Site.create({ url, name: body.name || new URL(url).hostname });
        res.status(201).json(site.toObject());
      } catch (err) {
        // Someone else added the same address at the same moment: the unique index kept one copy.
        if ((err as { code?: number }).code !== 11000) throw err;
        res.json(await Site.findOne({ url }).lean());
      }
    }),
  );

  app.get(
    '/api/sites/:id',
    ah(async (req, res) => {
      const site = await findSite(req.params.id);
      const [mobile, desktop] = await Promise.all(
        STRATEGIES.map(async (strategy) =>
          (await Run.find({ siteId: site._id, strategy }).sort({ createdAt: -1 }).limit(HISTORY_PER_STRATEGY).lean()).reverse(),
        ),
      );
      res.json({ site: site.toObject(), runs: { mobile, desktop } });
    }),
  );

  app.post(
    '/api/sites/:id/audit',
    perVisitor(6, 'You have run several audits already. Please try again in an hour.'),
    ah(async (req, res) => {
      const site = await findSite(req.params.id);
      const { strategy } = parse(auditBody, req.body);
      // Claim the slot in one atomic step, before calling Google, so simultaneous requests
      // (and repeated failures) cannot each trigger an audit.
      const field = `lastAttempt.${strategy}`;
      const now = Date.now();
      const claimed = await Site.findOneAndUpdate(
        { _id: site._id, $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: { $lte: new Date(now - COOLDOWN_MS) } }] },
        { $set: { [field]: new Date(now) } },
      );
      if (!claimed) {
        const last = (await Site.findById(site._id).lean())?.lastAttempt?.[strategy];
        const wait = Math.max(1000, COOLDOWN_MS - (now - new Date(last ?? now).getTime()));
        const minutes = Math.ceil(wait / 60000);
        res.set('Retry-After', String(Math.ceil(wait / 1000)));
        throw new AppError(429, 'cooldown', `This site was audited moments ago. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
      }
      try {
        res.status(201).json(await auditSite(site, strategy, runPsi));
      } catch (err) {
        await Site.updateOne({ _id: site._id }, { $set: { [field]: new Date(now - COOLDOWN_MS + RETRY_AFTER_FAILURE_MS) } });
        throw err;
      }
    }),
  );

  app.put(
    '/api/sites/:id/budget',
    ah(async (req, res) => {
      const site = await findSite(req.params.id);
      if (site.pinned && !isAdmin(req)) throw new AppError(401, 'unauthorized', 'Example sites cannot be changed');
      const body = parse(budgetBody, req.body);
      // Null or missing clears a limit; only real numbers are stored.
      const budget: Budget = {};
      for (const key of ['performance', 'lcp', 'cls', 'tbt'] as const) {
        const value = body[key];
        if (typeof value === 'number') budget[key] = value;
      }
      site.set('budget', budget);
      await site.save();
      res.json(site.toObject());
    }),
  );

  app.delete(
    '/api/sites/:id',
    requireAdmin,
    ah(async (req, res) => {
      const site = await findSite(req.params.id);
      await Promise.all([Run.deleteMany({ siteId: site._id }), site.deleteOne()]);
      res.json({ ok: true });
    }),
  );

  app.get(
    '/api/badge/:file',
    ah(async (req, res) => {
      const id = req.params.file.replace(/\.svg$/, '');
      const strategy: Strategy = req.query.strategy === 'desktop' ? 'desktop' : 'mobile';
      const run = /^[a-f0-9]{24}$/.test(id) ? await latestRun(id, strategy) : null;
      // An embed should never show a broken image, so every case answers with a valid badge.
      const svg = renderBadge(run ? { performance: run.performance, budget: (run.budget?.status ?? 'none') as 'pass' | 'fail' | 'none' } : null);
      res.set({ 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=600, s-maxage=600' });
      res.send(Buffer.from(svg));
    }),
  );

  app.get(
    '/api/cron/daily',
    ah(async (req, res) => {
      const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (!secretMatches(bearer, process.env.CRON_SECRET)) throw new AppError(401, 'unauthorized', 'Invalid cron secret');

      const sites = await Site.find().lean();
      const jobs = sites.flatMap((site) => STRATEGIES.map((strategy) => ({ site, strategy })));
      const started = Date.now();
      let audited = 0;
      let failed = 0;
      let done = 0;
      // A few at a time: fast enough to finish within the function limit, gentle on the audit quota.
      for (let i = 0; i < jobs.length && Date.now() - started < CRON_BUDGET_MS; i += 6) {
        const batch = jobs.slice(i, i + 6);
        const results = await Promise.allSettled(batch.map((j) => auditSite(j.site, j.strategy, runPsi)));
        done += batch.length;
        results.forEach((r, n) => {
          if (r.status === 'fulfilled') audited += 1;
          else {
            failed += 1;
            if (process.env.NODE_ENV !== 'test') console.error('Daily audit failed:', batch[n].site.url, batch[n].strategy, String(r.reason));
          }
        });
      }
      const skipped = jobs.length - done;
      res.json({ audited, failed, ...(skipped ? { skipped } : {}) });
    }),
  );

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
