import * as database from './db.js';
import { DataError, ensure, object, uuid } from './data-validation.js';

async function permission(request, response, name) {
  let auth;
  try { auth = await import('./permissions.js'); }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
    return null;
  }
  ensure(typeof auth.requirePermission === 'function', 'Authentication integration unavailable.', 'AUTH_UNAVAILABLE', 503);
  return auth.requirePermission(request, response, name);
}
export function endpoint(methods, { authorize = permission, db = database } = {}) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const route = Object.hasOwn(methods, request.method) ? methods[request.method] : null;
      if (!route) {
        response.setHeader('Allow', Object.keys(methods).join(', '));
        throw new DataError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
      }
      const user = await authorize(request, response, route.permission);
      if (!user) {
        if (!response.headersSent) response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
        return;
      }
      uuid(user.id); // Actor is supplied only by the server-side authentication module.
      if (!['GET', 'HEAD'].includes(request.method)) {
        // Until Teammate 2 supplies token-based CSRF, require an exact same-origin
        // browser Origin on all mutations. Reject requests without Origin as well.
        const allowed = process.env.APP_ORIGIN;
        ensure(allowed && request.headers.origin === allowed, 'Request origin is not allowed.', 'ORIGIN_REJECTED', 403);
        ensure(/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? ''), 'Expected application/json.', 'UNSUPPORTED_MEDIA_TYPE', 415);
        ensure(typeof request.body !== 'undefined', 'A JSON body is required.');
        if (typeof request.body === 'string') {
          ensure(Buffer.byteLength(request.body) <= 1500000, 'Request is too large.', 'REQUEST_TOO_LARGE', 413);
          try { request.body = JSON.parse(request.body); } catch { throw new DataError('INVALID_JSON', 'Invalid JSON body.'); }
        }
        object(request.body);
        ensure(Buffer.byteLength(JSON.stringify(request.body)) <= 1500000, 'Request is too large.', 'REQUEST_TOO_LARGE', 413);
      }
      const data = await route.run({ request, user, db });
      response.status(route.status ?? 200).json({ data });
    } catch (error) {
      if (response.headersSent) return;
      const known = error instanceof DataError;
      let status = known ? error.status : 500;
      let code = known ? error.code : 'INTERNAL_ERROR';
      let message = known ? error.message : 'The request could not be completed.';
      if (['23505', '23503', '40001', '40P01'].includes(error.code)) {
        status = 409; code = 'DATA_CONFLICT'; message = 'Data changed or conflicts with an existing record. Review and retry.';
      }
      response.status(status).json({ error: { code, message } });
    }
  };
}
