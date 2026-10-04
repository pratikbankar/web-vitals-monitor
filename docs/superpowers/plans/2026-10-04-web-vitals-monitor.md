# Web Vitals Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a web app that tracks Core Web Vitals over time with regression detection, budgets and a status badge.

**Architecture:** One package. A Vite React client in `src/`, an Express API in `server/` exposed through `api/index.ts` on Vercel, MongoDB for storage, Google PageSpeed Insights for audits.

**Tech Stack:** React, TypeScript, Vite, Tailwind CSS, Recharts, React Router; Express 4, Mongoose, Zod, express-rate-limit; Vitest, Supertest, mongodb-memory-server.

**Spec:** `docs/superpowers/specs/2026-10-04-web-vitals-monitor-design.md`

## Global Constraints

- Node 20 or newer, TypeScript strict, ES modules (`.js` import specifiers on the server).
- Error shape `{ error: { code, message, details? } }` everywhere.
- The server never fetches a user-supplied URL itself.
- Limits: 12 sites, audit cooldown 5 minutes per site and strategy, 6 audits and 5 new sites per visitor per hour.
- No secrets in the repository; `.env.example` lists every variable.
- No em-dashes in copy or docs. Commits authored as pratikbankar88@gmail.com.

## Review Focus

1. PageSpeed Insights fails, times out or is rate limited: the audit request returns a readable error, nothing half-written is stored, and the page can retry.
2. A URL Google cannot audit (private host, non-HTML, redirects to an error): rejected or reported clearly, never a 500.
3. A site with fewer than 3 runs, or runs missing a metric: no false regression, charts and cards still render.
4. Two visitors adding the same URL with different casing or trailing slash: one site, not two.
5. Badge requested for an unknown site or a site with no runs: a valid "no data" SVG, not a broken image.

---

### Task 1: Core rules (pure functions)
**Files:** `server/lib/{psi,rules,badge,url}.ts`, `tests/server/{psi,rules,badge,url}.test.ts`, `tests/fixtures/psi.json`, project scaffold.
**Produces:** `parsePsi(json): AuditResult`; `detectRegressions(previous: RunMetrics[], current): Regression[]`; `evaluateBudget(budget, run): BudgetResult`; `renderBadge(input): string`; `normalizeUrl(input): string` (throws `AppError` 400).
- [ ] Write failing tests for each rule in the spec, including Review Focus 3, 4 and 5. Run, see them fail.
- [ ] Implement. Run, see them pass. Commit.

### Task 2: API
**Files:** `server/{app,config,db,errors,models,routes,audit}.ts`, `api/index.ts`, `tests/server/api.test.ts`.
**Consumes:** Task 1 functions. **Produces:** the endpoints in the spec; `createApp({ runPsi })` so tests inject a stub.
- [ ] Write failing API tests: add site (validation, duplicate, cap), audit (stores run, cooldown, PSI failure stores nothing: Review Focus 1 and 2), detail, budget (pinned needs key), delete (key), badge, cron (secret), rate limits.
- [ ] Implement. Run, see them pass. Commit.

### Task 3: Client
**Files:** `src/**`, `index.html`, `tests/client/format.test.ts`.
**Consumes:** the API. **Produces:** dashboard and site pages per the spec.
- [ ] Write failing tests for rating and formatting helpers. Implement helpers.
- [ ] Build pages and components. Typecheck, lint and build pass. Check in a browser at phone and desktop widths. Commit.

### Task 4: Docs and deployment
**Files:** `README.md`, `vercel.json`, `.env.example`.
- [ ] README with screenshots section, setup, architecture and API. Vercel config with cron.
- [ ] Deploy, seed example sites, run first audits, verify live. Commit.
