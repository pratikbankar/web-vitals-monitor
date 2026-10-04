import type { Express } from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';
import { AppError } from '../../server/errors.js';
import type { AuditResult } from '../../server/lib/psi.js';
import { Run, Site } from '../../server/models.js';

const ADMIN = { 'x-admin-key': 'test-admin-key-test-admin-key' };
const result = (over: Partial<AuditResult> = {}): AuditResult => ({
  performance: 90,
  lab: { lcp: 2000, cls: 0.05, tbt: 150, fcp: 1200, si: 2500, ttfb: 200 },
  field: null,
  opportunities: [{ id: 'unused-javascript', title: 'Reduce unused JavaScript', savingsMs: 450 }],
  ...over,
});

let mongo: MongoMemoryServer;
let app: Express;
const runPsi = vi.fn(async () => result());

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  // Dropping the database drops the unique index too; the app relies on it.
  await Promise.all([Site.createIndexes(), Run.createIndexes()]);
  runPsi.mockReset();
  runPsi.mockImplementation(async () => result());
  app = createApp({ runPsi });
});

const addSite = async (url = 'https://example.com', name?: string) => (await request(app).post('/api/sites').send({ url, name })).body;
const audit = (id: string, strategy = 'mobile') => request(app).post(`/api/sites/${id}/audit`).send({ strategy });
/** Stores a finished run directly, bypassing the audit cooldown. */
const seedRun = (siteId: string, performance: number, minutesAgo: number, lcp = 2000) =>
  Run.create({
    siteId, strategy: 'mobile', performance, createdAt: new Date(Date.now() - minutesAgo * 60000),
    lab: { lcp, cls: 0.05, tbt: 150, fcp: 1200, si: 2500, ttfb: 200 }, field: null, opportunities: [], regressions: [],
    budget: { status: 'none', failures: [] },
  });

describe('sites', () => {
  it('adds a site and lists it', async () => {
    const res = await request(app).post('/api/sites').send({ url: 'Example.com', name: 'Example' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ url: 'https://example.com/', name: 'Example', pinned: false });
    const list = await request(app).get('/api/sites');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].latest).toEqual({ mobile: null, desktop: null });
  });

  it('names a site after its hostname when no name is given', async () => {
    expect((await addSite('https://www.example.com/pricing')).name).toBe('www.example.com');
  });

  it('returns the existing site when the same address is added again in another form', async () => {
    const first = await addSite('https://example.com');
    const again = await request(app).post('/api/sites').send({ url: 'HTTPS://EXAMPLE.COM/#top' });
    expect(again.status).toBe(200);
    expect(again.body._id).toBe(first._id);
    expect(await Site.countDocuments()).toBe(1);
  });

  it('rejects an address that cannot be audited', async () => {
    for (const url of ['', 'http://localhost:3000', 'javascript:alert(1)', 'http://192.168.0.1']) {
      const res = await request(app).post('/api/sites').send({ url });
      expect(res.status, url).toBe(400);
      expect(res.body.error.code).toBe('invalid_url');
    }
    expect((await request(app).post('/api/sites').send({ url: { $gt: '' } })).status).toBe(400);
  });

  it('returns one site, never an error, when the same address is added by several people at once', async () => {
    const variants = ['https://race.example.com', 'HTTPS://RACE.EXAMPLE.COM/', 'race.example.com/#x', 'https://race.example.com/'];
    const results = await Promise.all(variants.map((url) => request(app).post('/api/sites').send({ url })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body._id)).size).toBe(1);
    expect(await Site.countDocuments()).toBe(1);
  });

  it('makes room by dropping the oldest visitor-added site when the demo is full', async () => {
    for (let i = 0; i < 4; i++) await Site.create({ url: `https://pinned${i}.example.com/`, name: `p${i}`, pinned: true });
    const added: string[] = [];
    for (let i = 0; i < 8; i++) {
      const site = await Site.create({ url: `https://site${i}.example.com/`, name: `s${i}`, createdAt: new Date(Date.now() - (100 - i) * 60000) });
      added.push(String(site._id));
    }
    await seedRun(added[0], 80, 30);

    const res = await request(app).post('/api/sites').send({ url: 'https://one-more.example.com' });
    expect(res.status).toBe(201);
    expect(await Site.countDocuments()).toBe(12);
    expect(await Site.findById(added[0])).toBeNull();
    expect(await Run.countDocuments({ siteId: added[0] })).toBe(0);
    expect(await Site.countDocuments({ pinned: true })).toBe(4);
  });

  it('refuses a new site only when every slot is a pinned example', async () => {
    for (let i = 0; i < 12; i++) await Site.create({ url: `https://site${i}.example.com/`, name: `s${i}`, pinned: true });
    const res = await request(app).post('/api/sites').send({ url: 'https://one-more.example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('site_limit');
  });

  it('returns 404 for an unknown or malformed site id', async () => {
    expect((await request(app).get('/api/sites/64b7f0c2a1b2c3d4e5f60718')).status).toBe(404);
    expect((await request(app).get('/api/sites/nope')).status).toBe(404);
    expect((await audit('nope')).status).toBe(404);
  });

  it('deletes a site and its runs only with the admin key', async () => {
    const site = await addSite();
    await audit(site._id);
    expect((await request(app).delete(`/api/sites/${site._id}`)).status).toBe(401);
    expect((await request(app).delete(`/api/sites/${site._id}`).set('x-admin-key', 'wrong')).status).toBe(401);
    expect((await request(app).delete(`/api/sites/${site._id}`).set(ADMIN)).status).toBe(200);
    expect(await Site.countDocuments()).toBe(0);
    expect(await Run.countDocuments()).toBe(0);
  });
});

describe('audits', () => {
  it('stores a run and shows it as the latest', async () => {
    const site = await addSite();
    const res = await audit(site._id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ strategy: 'mobile', performance: 90, regressions: [], budget: { status: 'none' } });
    expect(runPsi).toHaveBeenCalledWith('https://example.com/', 'mobile');

    const list = (await request(app).get('/api/sites')).body;
    expect(list[0].latest.mobile.performance).toBe(90);
    expect(list[0].latest.desktop).toBeNull();
    const detail = (await request(app).get(`/api/sites/${site._id}`)).body;
    expect(detail.runs.mobile).toHaveLength(1);
    expect(detail.runs.mobile[0].opportunities).toHaveLength(1);
  });

  it('rejects an unknown strategy', async () => {
    const site = await addSite();
    expect((await audit(site._id, 'tablet')).status).toBe(400);
    expect(runPsi).not.toHaveBeenCalled();
  });

  it('makes a second audit of the same site and strategy wait five minutes', async () => {
    const site = await addSite();
    await audit(site._id);
    const again = await audit(site._id);
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe('cooldown');
    expect((await audit(site._id, 'desktop')).status).toBe(201);
    expect(runPsi).toHaveBeenCalledTimes(2);
  });

  it('stores nothing when the audit fails, and allows a retry after a minute', async () => {
    const site = await addSite();
    runPsi.mockRejectedValueOnce(new AppError(503, 'audit_quota', 'The audit service is busy right now.'));
    const failed = await audit(site._id);
    expect(failed.status).toBe(503);
    expect(failed.body.error.code).toBe('audit_quota');
    expect(await Run.countDocuments()).toBe(0);

    // A failing page must not be a way to call Google in a tight loop.
    const tooSoon = await audit(site._id);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error.message).toMatch(/1 minute/);
    expect(tooSoon.headers['retry-after']).toBeDefined();
    expect(runPsi).toHaveBeenCalledTimes(1);

    await Site.updateOne({ _id: site._id }, { $set: { 'lastAttempt.mobile': new Date(Date.now() - 5 * 60000 - 1000) } });
    expect((await audit(site._id)).status).toBe(201);
  });

  it('runs only one audit when several requests for the same site arrive together', async () => {
    const site = await addSite();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => audit(site._id)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 429, 429, 429, 429]);
    expect(runPsi).toHaveBeenCalledTimes(1);
    expect(await Run.countDocuments()).toBe(1);
  });

  it('reports an unexpected audit error without leaking details', async () => {
    const site = await addSite();
    runPsi.mockRejectedValueOnce(new Error('ECONNRESET secret-internal-detail'));
    const res = await audit(site._id);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret-internal-detail');
    expect(await Run.countDocuments()).toBe(0);
  });

  it('flags a regression against the earlier runs', async () => {
    const site = await addSite();
    for (const [i, p] of [90, 91, 89, 90].entries()) await seedRun(site._id, p, 600 - i * 60);
    runPsi.mockResolvedValueOnce(result({ performance: 62, lab: { lcp: 4100, cls: 0.05, tbt: 150, fcp: 1200, si: 2500, ttfb: 200 } }));
    const res = await audit(site._id);
    expect(res.body.regressions.map((r: { metric: string }) => r.metric)).toEqual(['performance', 'lcp']);
    const list = (await request(app).get('/api/sites')).body;
    expect(list[0].latest.mobile.regressions).toHaveLength(2);
  });

  it('does not flag anything on a site with little history', async () => {
    const site = await addSite();
    await seedRun(site._id, 95, 120);
    runPsi.mockResolvedValueOnce(result({ performance: 40 }));
    expect((await audit(site._id)).body.regressions).toEqual([]);
  });

  it('returns runs oldest first and keeps strategies apart', async () => {
    const site = await addSite();
    await seedRun(site._id, 70, 300);
    await seedRun(site._id, 80, 200);
    await audit(site._id);
    await audit(site._id, 'desktop');
    const { runs } = (await request(app).get(`/api/sites/${site._id}`)).body;
    expect(runs.mobile.map((r: { performance: number }) => r.performance)).toEqual([70, 80, 90]);
    expect(runs.desktop).toHaveLength(1);
  });
});

describe('budgets', () => {
  it('saves a budget and applies it to the next audit', async () => {
    const site = await addSite();
    const put = await request(app).put(`/api/sites/${site._id}/budget`).send({ performance: 95, lcp: 2500 });
    expect(put.status).toBe(200);
    expect(put.body.budget).toEqual({ performance: 95, lcp: 2500 });
    const res = await audit(site._id);
    expect(res.body.budget).toEqual({ status: 'fail', failures: ['performance'] });
  });

  it('clears a limit that is sent as null', async () => {
    const site = await addSite();
    await request(app).put(`/api/sites/${site._id}/budget`).send({ performance: 95, lcp: 2500 });
    const put = await request(app).put(`/api/sites/${site._id}/budget`).send({ performance: null, lcp: 2500 });
    expect(put.body.budget).toEqual({ lcp: 2500 });
  });

  it('rejects limits that make no sense', async () => {
    const site = await addSite();
    for (const body of [{ performance: 150 }, { lcp: -5 }, { cls: 'low' }, { other: 1 }]) {
      expect((await request(app).put(`/api/sites/${site._id}/budget`).send(body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('protects the budget of a pinned example site', async () => {
    const pinned = await Site.create({ url: 'https://pinned.example.com/', name: 'Pinned', pinned: true });
    expect((await request(app).put(`/api/sites/${pinned._id}/budget`).send({ lcp: 1 })).status).toBe(401);
    expect((await request(app).put(`/api/sites/${pinned._id}/budget`).set(ADMIN).send({ lcp: 2500 })).status).toBe(200);
  });
});

describe('badge', () => {
  it('shows the latest score and budget status', async () => {
    const site = await addSite();
    await request(app).put(`/api/sites/${site._id}/budget`).send({ performance: 80 });
    await audit(site._id);
    const res = await request(app).get(`/api/badge/${site._id}.svg`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.headers['cache-control']).toContain('max-age');
    expect(res.body.toString()).toContain('90 · budget met');
  });

  it('serves a "no data" badge for a site without runs, an unknown site and a malformed id', async () => {
    const site = await addSite();
    for (const id of [site._id, '64b7f0c2a1b2c3d4e5f60718', 'nope']) {
      const res = await request(app).get(`/api/badge/${id}.svg`);
      expect(res.status, id).toBe(200);
      expect(res.body.toString()).toContain('no data');
    }
  });
});

describe('daily re-audit', () => {
  it('requires the cron secret', async () => {
    expect((await request(app).get('/api/cron/daily')).status).toBe(401);
    expect((await request(app).get('/api/cron/daily').set('Authorization', 'Bearer wrong')).status).toBe(401);
  });

  it('audits every site on both strategies and carries on past a failure', async () => {
    await addSite('https://a.example.com');
    await addSite('https://b.example.com');
    runPsi.mockRejectedValueOnce(new AppError(503, 'audit_quota', 'busy'));
    const res = await request(app).get('/api/cron/daily').set('Authorization', 'Bearer test-cron-secret-1234');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ audited: 3, failed: 1 });
    expect(await Run.countDocuments()).toBe(3);
  });
});

describe('rate limits', () => {
  const limited = (req: request.Test) => req.set('x-test-ratelimit', '1').set('X-Forwarded-For', '203.0.113.9');

  it('allows six audits per visitor per hour', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push((await addSite(`https://s${i}.example.com`))._id);
    for (let i = 0; i < 6; i++) expect((await limited(audit(ids[i]))).status).toBe(201);
    const seventh = await limited(audit(ids[6]));
    expect(seventh.status).toBe(429);
    expect(seventh.body.error.code).toBe('rate_limited');
  });

  it('allows five new sites per visitor per hour', async () => {
    const add = (i: number) => limited(request(app).post('/api/sites').send({ url: `https://n${i}.example.com` }));
    for (let i = 0; i < 5; i++) expect((await add(i)).status).toBe(201);
    expect((await add(5)).status).toBe(429);
  });
});

describe('errors', () => {
  it('uses one error shape for unknown routes and bad JSON', async () => {
    const missing = await request(app).get('/api/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('not_found');
    const bad = await request(app).post('/api/sites').set('Content-Type', 'application/json').send('{bad');
    expect(bad.status).toBe(400);
  });
});
