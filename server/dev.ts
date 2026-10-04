// Local development server. With no MONGODB_URI it starts a throwaway in-memory database,
// and with no PSI_API_KEY it returns realistic made-up audits, so the app runs with zero setup.
import 'dotenv/config';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { runPsi, type RunPsi } from './lib/psi.js';
import { seed } from './seed.js';

process.env.ADMIN_KEY ??= 'local-admin-key';
process.env.CRON_SECRET ??= 'local-cron-secret';

if (!process.env.MONGODB_URI) {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  process.env.MONGODB_URI = (await MongoMemoryServer.create()).getUri('vitals');
  console.log('Using an in-memory database (data is lost on restart).');
}
await mongoose.connect(process.env.MONGODB_URI);

const jitter = (base: number, spread: number) => Math.round(base + (Math.random() - 0.5) * spread);
const fakePsi: RunPsi = async (_url, strategy) => {
  await new Promise((r) => setTimeout(r, 1500));
  const slow = strategy === 'mobile' ? 1.6 : 1;
  return {
    performance: Math.max(20, Math.min(100, jitter(strategy === 'mobile' ? 78 : 94, 14))),
    lab: {
      lcp: jitter(1700 * slow, 600), cls: Math.round(Math.random() * 80) / 1000, tbt: jitter(120 * slow, 120),
      fcp: jitter(1000 * slow, 300), si: jitter(1900 * slow, 500), ttfb: jitter(180, 80),
    },
    field: null,
    opportunities: [
      { id: 'unused-javascript', title: 'Reduce unused JavaScript', savingsMs: jitter(400, 200) },
      { id: 'render-blocking-resources', title: 'Eliminate render-blocking resources', savingsMs: jitter(250, 100) },
    ],
  };
};

const usingRealAudits = Boolean(process.env.PSI_API_KEY);
if (!usingRealAudits) console.log('No PSI_API_KEY set: audits return sample data.');
await seed({ sampleHistory: !usingRealAudits });

const port = Number(process.env.PORT ?? 4000);
createApp({ runPsi: usingRealAudits ? runPsi : fakePsi }).listen(port, () => console.log(`API on http://localhost:${port}`));
