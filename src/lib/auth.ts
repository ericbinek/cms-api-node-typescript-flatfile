import type { IncomingMessage } from 'node:http';
import { resolveSession } from './sessions.ts';
import { findById as findAccountById } from '../models/account.ts';

export interface Principal {
  role: string;
  accountId: string | null;
  username: string | null;
}

// HTTP methods that mutate state. No role grants anonymous writes, so any of
// these without a session is a 401 before routing.
export const WRITE_METHODS: Set<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const ANONYMOUS: Principal = { role: 'anonymous', accountId: null, username: null };

// Thrown when a credential is presented but does not resolve. The server maps it
// to 401 UNAUTHORIZED. A missing credential is not an error — it is anonymous.
export class UnauthorizedError extends Error {
  constructor() {
    super('Authentication required.');
    this.name = 'UnauthorizedError';
  }
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers['authorization'];
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match ? match[1] : '';
}

// Resolves the request principal. No Authorization header -> anonymous. A Bearer
// token that does not resolve to a live session (or a malformed header) throws
// UnauthorizedError. Fails closed: a presented credential must be valid.
export async function resolvePrincipal(req: IncomingMessage): Promise<Principal> {
  const token = bearerToken(req);
  if (token === null) return ANONYMOUS;
  if (token === '') throw new UnauthorizedError();
  const session = await resolveSession(token);
  if (!session) throw new UnauthorizedError();
  const account = await findAccountById(session.accountId);
  if (!account) throw new UnauthorizedError();
  return { role: account.role, accountId: account.id, username: account.username };
}

// A write method by an unauthenticated principal needs a session: 401 (Guards
// for an authenticated-but-unauthorized principal are the router's 403).
export function requiresSession(method: string, principal: Principal): boolean {
  return WRITE_METHODS.has(method) && principal.role === 'anonymous';
}
