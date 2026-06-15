import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, jsonError, parseBody } from '../http.ts';
import { validationError, unauthorizedError, methodNotAllowedError } from '../errors.ts';
import { authenticate } from '../models/account.ts';
import { createSession, deleteSession } from '../lib/sessions.ts';
import type { Principal } from '../lib/auth.ts';

const BASE = '/auth';

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers['authorization'];
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match ? match[1] : null;
}

// The principal is attached by the server middleware before routing. login is
// reachable anonymously; logout and me require a live session.
export async function handleAuthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestPath: string,
  principal: Principal,
): Promise<boolean> {
  const { pathname } = url;
  const method = req.method;

  if (pathname === `${BASE}/login`) {
    if (method !== 'POST') {
      jsonError(req, res, methodNotAllowedError(['POST'], requestPath));
      return true;
    }
    const body = await parseBody(req) as Record<string, unknown>;
    if (typeof body.username !== 'string' || typeof body.password !== 'string') {
      jsonError(req, res, validationError(['Fields "username" and "password" are required.'], requestPath));
      return true;
    }
    // Same 401 for unknown user and wrong password — no user enumeration.
    const account = await authenticate(body.username, body.password);
    if (!account) {
      jsonError(req, res, unauthorizedError(requestPath));
      return true;
    }
    const { token, expiresAt } = await createSession(account.id);
    json(req, res, 200, {
      token,
      account: { id: account.id, username: account.username, role: account.role },
      expiresAt,
    });
    return true;
  }

  if (pathname === `${BASE}/logout`) {
    if (method !== 'POST') {
      jsonError(req, res, methodNotAllowedError(['POST'], requestPath));
      return true;
    }
    // Idempotent by token: a missing or already-deleted token is 401.
    const token = bearerToken(req);
    const removed = token ? await deleteSession(token) : false;
    if (!removed) {
      jsonError(req, res, unauthorizedError(requestPath));
      return true;
    }
    json(req, res, 204, null);
    return true;
  }

  if (pathname === `${BASE}/me`) {
    if (method !== 'GET') {
      jsonError(req, res, methodNotAllowedError(['GET'], requestPath));
      return true;
    }
    if (principal.role === 'anonymous') {
      jsonError(req, res, unauthorizedError(requestPath));
      return true;
    }
    json(req, res, 200, {
      account: { id: principal.accountId, username: principal.username, role: principal.role },
    });
    return true;
  }

  return false;
}
