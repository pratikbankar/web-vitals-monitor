import mongoose from 'mongoose';
import { Run, Site } from './models.js';

let ready: Promise<unknown> | null = null;

/** Connects once and reuses the connection (one per warm function instance on Vercel). */
export function connect(): Promise<unknown> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return Promise.reject(new Error('MONGODB_URI is not set'));
  ready ??= mongoose
    .connect(uri, { serverSelectionTimeoutMS: 15000 })
    // The unique index on the site address is what prevents duplicates; make sure it exists first.
    .then(() => Promise.all([Site.init(), Run.init()]))
    .catch((err) => {
    ready = null; // let the next request try again
    throw err;
  });
  return ready;
}
