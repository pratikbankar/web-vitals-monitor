import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import mongoose from 'mongoose';
import { detectRegressions, type RunMetrics } from './lib/rules.js';
import { Run, Site } from './models.js';

const EXAMPLES = [
  { url: 'https://pratik-bankar-portfolio.vercel.app/', name: 'Pratik Bankar Portfolio', budget: { performance: 90, lcp: 2500, cls: 0.1 } },
  { url: 'https://react.dev/', name: 'React', budget: { performance: 80, lcp: 2500 } },
  { url: 'https://nodejs.org/en', name: 'Node.js', budget: { performance: 80 } },
  { url: 'https://web.dev/', name: 'web.dev', budget: {} },
];

/**
 * Adds the pinned example sites if they are missing. `sampleHistory` also writes two weeks of
 * made-up runs (with one deliberate regression) so charts have something to show locally.
 */
export async function seed({ sampleHistory = false } = {}): Promise<void> {
  for (const example of EXAMPLES) {
    const site = await Site.findOneAndUpdate(
      { url: example.url },
      { $setOnInsert: { ...example, pinned: true } },
      { upsert: true, returnDocument: 'after' },
    );
    if (!sampleHistory || (await Run.exists({ siteId: site._id }))) continue;

    for (const strategy of ['mobile', 'desktop'] as const) {
      const previous: RunMetrics[] = [];
      for (let day = 14; day >= 1; day--) {
        const dip = day === 4 && strategy === 'mobile' ? 18 : 0;
        const base = strategy === 'mobile' ? 82 : 95;
        const current: RunMetrics = {
          performance: Math.round(base - dip + Math.sin(day) * 3),
          lab: {
            lcp: Math.round((strategy === 'mobile' ? 2300 : 1100) + dip * 90 + Math.cos(day) * 150), cls: 0.03,
            tbt: Math.round((strategy === 'mobile' ? 180 : 40) + dip * 12), fcp: strategy === 'mobile' ? 1400 : 700,
            si: strategy === 'mobile' ? 2900 : 1300, ttfb: 190,
          },
        };
        await Run.create({
          siteId: site._id, strategy, createdAt: new Date(Date.now() - day * 86400000), ...current, field: null,
          opportunities: [{ id: 'unused-javascript', title: 'Reduce unused JavaScript', savingsMs: 380 }],
          regressions: detectRegressions(previous, current), budget: { status: 'none', failures: [] },
        });
        previous.push(current);
      }
    }
  }
}

// Runs only when executed directly (npm run seed), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI first');
  await mongoose.connect(process.env.MONGODB_URI);
  await seed();
  console.log(`Example sites are in place (${await Site.countDocuments()} sites tracked).`);
  await mongoose.disconnect();
}
