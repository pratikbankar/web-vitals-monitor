import { isIP } from 'node:net';
import { AppError } from '../errors.js';

const invalid = (message: string) => new AppError(400, 'invalid_url', message);

function isPrivateIPv4(host: string): boolean {
  const [a, b] = host.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Validates a site address and returns one canonical form, so "Example.com" and
 * "https://example.com/#top" are the same tracked site. Only public http(s) pages are
 * accepted: Google cannot reach anything else, and private addresses have no business here.
 */
export function normalizeUrl(input: unknown): string {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) throw invalid('Enter a website address');
  if (raw.length > 500) throw invalid('That address is too long');

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw invalid('That does not look like a website address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid('Only http and https addresses can be audited');
  if (url.username || url.password) throw invalid('Addresses with a username or password are not supported');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const ipVersion = isIP(host);
  if (ipVersion === 6 || (ipVersion === 4 && isPrivateIPv4(host))) throw invalid('Only public websites can be audited');
  if (!ipVersion && (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.'))) {
    throw invalid('Only public websites can be audited');
  }

  url.hash = '';
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}
