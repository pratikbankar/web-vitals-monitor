import { model, Schema, type InferSchemaType } from 'mongoose';

const num = { type: Number, default: null };

const siteSchema = new Schema(
  {
    /** Canonical address from normalizeUrl(); unique, so one site is never tracked twice. */
    url: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    /** Example sites that visitors cannot change. */
    pinned: { type: Boolean, default: false },
    budget: {
      performance: Number,
      lcp: Number,
      cls: Number,
      tbt: Number,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, minimize: false },
);

const runSchema = new Schema(
  {
    siteId: { type: Schema.Types.ObjectId, ref: 'Site', required: true },
    strategy: { type: String, enum: ['mobile', 'desktop'], required: true },
    createdAt: { type: Date, default: () => new Date() },
    performance: { type: Number, required: true },
    lab: { lcp: num, cls: num, tbt: num, fcp: num, si: num, ttfb: num },
    field: { type: { lcp: num, cls: num, inp: num, ttfb: num }, default: null, _id: false },
    opportunities: [{ _id: false, id: String, title: String, savingsMs: Number }],
    regressions: [{ _id: false, metric: String, baseline: Number, value: Number }],
    budget: { status: { type: String, default: 'none' }, failures: [String] },
  },
  { versionKey: false },
);
runSchema.index({ siteId: 1, strategy: 1, createdAt: -1 });

export const Site = model('Site', siteSchema);
export const Run = model('Run', runSchema);
export type SiteDoc = InferSchemaType<typeof siteSchema>;
