import { isIP } from 'node:net';
import { fail, header } from './retention-http.js';

function address(value) {
  if (typeof value !== 'string' || value !== value.trim() || !isIP(value)) return null;
  if (value.toLowerCase().startsWith('::ffff:') && isIP(value.slice(7)) === 4) return value.slice(7);
  if (isIP(value) === 4) return value;
  try { return new URL(`http://[${value}]/`).hostname.slice(1,-1); } catch { return null; }
}
export function clientIdentity(req, { vercel = process.env.VERCEL === '1' } = {}) {
  // Trust this header only inside the Vercel runtime, which overwrites it at ingress.
  // Never infer the platform from a client-supplied header or accept arbitrary XFF chains.
  const ip=address(vercel ? header(req,'x-vercel-forwarded-for') : req.socket?.remoteAddress);
  if (!ip) fail(503,'CLIENT_IDENTITY_UNAVAILABLE','A trusted client address is unavailable. Sign-in is temporarily unavailable.');
  return ip;
}
