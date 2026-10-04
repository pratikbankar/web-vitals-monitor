import mongoose from 'mongoose';

let ready: Promise<unknown> | null = null;

/** Connects once and reuses the connection (one per warm function instance on Vercel). */
export function connect(): Promise<unknown> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return Promise.reject(new Error('MONGODB_URI is not set'));
  ready ??= mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 }).catch((err) => {
    ready = null; // let the next request try again
    throw err;
  });
  return ready;
}
