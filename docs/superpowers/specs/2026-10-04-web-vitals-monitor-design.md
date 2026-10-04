# Web Vitals Monitor: Design

Date: 2026-10-04. Owner: Pratik Bankar. Approved in conversation.

## Goal

A public demo project for a GitHub profile: track the Core Web Vitals of any website over time,
detect regressions, enforce performance budgets, and expose an embeddable status badge.
Built with React and Node.js, hosted free.

## Architecture

One repository, one Vercel project:

- Client: React + TypeScript single-page app built with Vite (`src/`), Tailwind CSS, Recharts.
- Server: Express + TypeScript (`server/`), exposed as one Vercel function (`api/index.ts`).
- Database: MongoDB (Mongoose), database `vitals` on a free Atlas cluster.
- Audits: Google PageSpeed Insights API v5 (runs Lighthouse remotely). `PSI_API_KEY` is optional.
- Daily re-audit: Vercel Cron calling `/api/cron/daily`.

The server never fetches a user-supplied URL itself; it only passes the URL to Google.

## Data

- `Site`: url (normalized, unique), name, pinned, budget { performance, lcp, cls, tbt } (each optional), createdAt.
- `Run`: siteId, strategy (mobile | desktop), createdAt, performance (0 to 100),
  lab { lcp, cls, tbt, fcp, si, ttfb } (ms except cls), field { lcp, cls, inp, ttfb } or null,
  opportunities [{ id, title, savingsMs }], regressions [{ metric, baseline, value }],
  budget { status: pass | fail | none, failures [metric] }.

## Rules

- Regression: compared with the median of the previous 5 runs of the same strategy; needs at
  least 3 earlier runs. Flag when performance drops 10 points or more; when lcp, fcp or tbt is
  20 percent or more worse and worse by at least 300 ms (100 ms for tbt); when cls is worse by
  0.05 or more.
- Budget: performance is a minimum; lcp, cls, tbt are maximums. No budget set means status none.
- Web Vitals ratings: LCP good up to 2500 ms, poor over 4000; CLS 0.1 and 0.25; TBT 200 and 600;
  FCP 1800 and 3000; INP 200 and 500; TTFB 800 and 1800. Score good from 90, poor under 50.

## API

- `GET /api/sites`: sites with their latest run per strategy.
- `POST /api/sites { url, name? }`: add a site. Only http(s) public hostnames. At most 12 sites.
- `GET /api/sites/:id`: site and its last 60 runs per strategy.
- `POST /api/sites/:id/audit { strategy }`: run an audit now. One per site and strategy every 5 minutes.
- `PUT /api/sites/:id/budget`: set the budget. Pinned sites need the admin key.
- `DELETE /api/sites/:id`: admin key required (`x-admin-key`).
- `GET /api/badge/:id.svg?strategy=`: status badge image.
- `GET /api/cron/daily`: re-audit every site; requires `Authorization: Bearer CRON_SECRET`.
- Errors: `{ error: { code, message, details? } }`.

Rate limits per visitor: 6 audits per hour, 5 new sites per hour.

## Client

- Dashboard: site cards with mobile and desktop scores, budget and regression status, add-site form.
- Site page: strategy switch, run audit with progress, metric cards with ratings, trend chart with
  metric selector and regression markers, budget editor, run history with compare, improvement
  suggestions, badge embed snippet.
- Responsive, dark and light theme, accessible labels, clear empty, loading and error states.

## Testing

Vitest. Server: PSI response parsing (fixture), regression and budget rules, badge, URL validation,
and the API against an in-memory MongoDB with a stubbed PSI client. Client: formatting and rating helpers.

## Out of scope

User accounts, email alerts, multi-page crawling, running Chrome ourselves.
