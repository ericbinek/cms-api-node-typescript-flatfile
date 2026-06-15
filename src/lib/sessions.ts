import { randomBytes, createHash } from 'node:crypto';
import { withLock, readCollection, writeCollection } from './storage.ts';

interface Session {
  tokenHash: string;
  accountId: string;
  createdAt: string;
  expiresAt: string;
  idleExpiresAt: string;
}

export interface ResolvedSession {
  accountId: string;
  expiresAt: string;
}

const COLLECTION_FILE = 'sessions.json';

const IDLE_TTL_MS = 30 * 60 * 1000;          // sliding inactivity window
const ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000;  // hard cap measured from login
const EXTEND_THRESHOLD_MS = 60 * 1000;       // only persist a slide worth writing

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Issues a session. The raw token is returned exactly once; the store keeps only
// its SHA-256 hash, the account, the absolute expiry and the sliding idle expiry.
export function createSession(accountId: string): Promise<{ token: string; expiresAt: string }> {
  return withLock(async () => {
    const token = randomBytes(32).toString('hex');
    const sessions = await readCollection<Session>(COLLECTION_FILE);
    const now = Date.now();
    const session: Session = {
      tokenHash: hashToken(token),
      accountId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ABSOLUTE_TTL_MS).toISOString(),
      idleExpiresAt: new Date(now + IDLE_TTL_MS).toISOString(),
    };
    sessions.push(session);
    await writeCollection(COLLECTION_FILE, sessions);
    return { token, expiresAt: session.expiresAt };
  });
}

// Resolves a raw token to its live session, or null if unknown or expired. An
// expired session is dropped. On success the idle window slides forward (capped
// at the absolute expiry) and is persisted only when the move is large enough,
// so authenticated reads do not write on every request.
export function resolveSession(token: string): Promise<ResolvedSession | null> {
  return withLock(async () => {
    const tokenHash = hashToken(token);
    const sessions = await readCollection<Session>(COLLECTION_FILE);
    const now = Date.now();
    const index = sessions.findIndex((s) => s.tokenHash === tokenHash);
    if (index === -1) return null;

    const session = sessions[index];
    const absolute = Date.parse(session.expiresAt);
    const idle = Date.parse(session.idleExpiresAt);
    if (now >= absolute || now >= idle) {
      sessions.splice(index, 1);
      await writeCollection(COLLECTION_FILE, sessions);
      return null;
    }

    const nextIdle = Math.min(now + IDLE_TTL_MS, absolute);
    if (nextIdle - idle > EXTEND_THRESHOLD_MS) {
      session.idleExpiresAt = new Date(nextIdle).toISOString();
      await writeCollection(COLLECTION_FILE, sessions);
    }
    return { accountId: session.accountId, expiresAt: session.expiresAt };
  });
}

// Logout / revocation: deletes the session and takes effect immediately.
export function deleteSession(token: string): Promise<boolean> {
  return withLock(async () => {
    const tokenHash = hashToken(token);
    const sessions = await readCollection<Session>(COLLECTION_FILE);
    const remaining = sessions.filter((s) => s.tokenHash !== tokenHash);
    const removed = remaining.length !== sessions.length;
    if (removed) await writeCollection(COLLECTION_FILE, remaining);
    return removed;
  });
}
