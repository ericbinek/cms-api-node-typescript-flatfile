import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, authedFetch, jsonOf } from './_helpers.ts';

const BASE = "/blog-postings";

// Reads and writes have independent per-IP windows. Each test starts a server
// with one bucket set low and the other effectively unlimited, then drives
// requests until the limiter trips. Exact counts are not asserted — server
// startup spends a request or two (health probe, admin login) — only that
// limiting eventually engages after at least one request is admitted, and that
// the rejection carries the 429 envelope and a sane Retry-After header.

test('writes over the limit are rejected with 429 and Retry-After', async () => {
  const server = await startServer({
    env: { RATE_LIMIT_WRITE_PER_MINUTE: '5', RATE_LIMIT_READ_PER_MINUTE: '1000000' },
  });
  try {
    let admitted = 0;
    let limited: Response | null = null;
    for (let i = 0; i < 40; i += 1) {
      const r = await authedFetch(`${server.baseUrl}${BASE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (r.status === 429) { limited = r; break; }
      admitted += 1;
    }
    assert.ok(admitted >= 1, 'at least one write should be admitted before limiting');
    assert.ok(limited, 'writes should eventually be rate limited');
    const retryAfter = Number(limited.headers.get('retry-after'));
    assert.ok(
      Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60,
      `Retry-After should be 1..60 seconds, got ${limited.headers.get('retry-after')}`,
    );
    const body = await jsonOf(limited);
    assert.equal(body.status, 429);
    assert.equal(body.error, 'TOO_MANY_REQUESTS');
  } finally {
    await server.stop();
  }
});

test('reads have their own window, independent of the write limit', async () => {
  const server = await startServer({
    env: { RATE_LIMIT_READ_PER_MINUTE: '120', RATE_LIMIT_WRITE_PER_MINUTE: '1000000' },
  });
  try {
    let admitted = 0;
    let limited: Response | null = null;
    for (let i = 0; i < 200; i += 1) {
      const r = await authedFetch(`${server.baseUrl}${BASE}`);
      if (r.status === 429) { limited = r; break; }
      admitted += 1;
    }
    assert.ok(admitted >= 1, 'at least one read should be admitted before limiting');
    assert.ok(limited, 'reads should eventually be rate limited');
    const retryAfter = Number(limited.headers.get('retry-after'));
    assert.ok(
      Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60,
      `Retry-After should be 1..60 seconds, got ${limited.headers.get('retry-after')}`,
    );
    const body = await jsonOf(limited);
    assert.equal(body.status, 429);
    assert.equal(body.error, 'TOO_MANY_REQUESTS');
  } finally {
    await server.stop();
  }
});
