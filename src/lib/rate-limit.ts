// Per-IP sliding-window rate limiter. Two independent one-minute windows per
// client: reads (GET/HEAD and any non-write method) and writes (POST/PUT/DELETE).
// State lives in process memory, matching the single-process model — counts are
// not shared across instances. An X-Forwarded-For header is never consulted; the
// peer address of the connection is the only trusted source.

const WINDOW_MS = 60000;
const WRITE_METHODS = new Set<string>(['POST', 'PUT', 'DELETE']);

function limitFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const READ_LIMIT = limitFromEnv('RATE_LIMIT_READ_PER_MINUTE', 600);
const WRITE_LIMIT = limitFromEnv('RATE_LIMIT_WRITE_PER_MINUTE', 60);

interface Windows {
  read: number[];
  write: number[];
}

// ip -> request timestamps still in window, per bucket.
const hits = new Map<string, Windows>();
let lastSweep = 0;

function prune(stamps: number[], cutoff: number): void {
  let i = 0;
  while (i < stamps.length && stamps[i] <= cutoff) i += 1;
  if (i > 0) stamps.splice(0, i);
}

// Drop aged-out timestamps across all clients and forget idle ones, so memory
// stays bounded by the clients active in the last window. Runs at most once per
// window, piggybacked on a request — no background timer.
function sweep(now: number, cutoff: number): void {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [ip, entry] of hits) {
    prune(entry.read, cutoff);
    prune(entry.write, cutoff);
    if (entry.read.length === 0 && entry.write.length === 0) hits.delete(ip);
  }
}

function bucketFor(method: string): 'read' | 'write' {
  return WRITE_METHODS.has(method) ? 'write' : 'read';
}

// Records a request from `ip` with the given method. Returns null when the
// request is within its bucket's limit, otherwise the whole seconds until the
// oldest in-window request expires (at least 1) — the Retry-After value.
export function rateLimit(ip: string, method: string): number | null {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  sweep(now, cutoff);

  const bucket = bucketFor(method);
  const limit = bucket === 'write' ? WRITE_LIMIT : READ_LIMIT;

  let entry = hits.get(ip);
  if (entry === undefined) {
    entry = { read: [], write: [] };
    hits.set(ip, entry);
  }
  const stamps = entry[bucket];
  prune(stamps, cutoff);

  if (stamps.length >= limit) {
    return Math.max(1, Math.ceil((stamps[0] + WINDOW_MS - now) / 1000));
  }
  stamps.push(now);
  return null;
}
