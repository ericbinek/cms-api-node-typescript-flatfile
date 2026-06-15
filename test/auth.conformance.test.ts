import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, buildPayload, postEntity, setAuthToken, jsonOf } from './_helpers.ts';
import type { ServerHandle } from './_helpers.ts';

// Five accounts cover the matrix, ownership and the workflow roles.
const ACCOUNTS = [
  { username: 'admin',   password: 'pw-admin',   role: 'admin' },
  { username: 'editor',  password: 'pw-editor',  role: 'editor' },
  { username: 'author',  password: 'pw-author',  role: 'author' },
  { username: 'author2', password: 'pw-author2', role: 'author' },
  { username: 'viewer',  password: 'pw-viewer',  role: 'viewer' },
];

let server: ServerHandle;
const token: Record<string, string> = {};

test.before(async () => {
  server = await startServer({ accounts: ACCOUNTS });
  for (const a of ACCOUNTS) token[a.username] = await login(server.baseUrl, a.username, a.password);
});
test.after(async () => { await server.stop(); });

function req(bearer: string | null, method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const opts: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(`${server.baseUrl}${path}`, opts);
}

// Create through the public API as a given role, returning the created record.
async function createAs(bearer: string, entity: string, base: string, overrides: Record<string, unknown> = {}): Promise<Response> {
  // Dependencies (refs) are built as admin via the module token.
  setAuthToken(token.admin);
  const payload = { ...(await buildPayload(server.baseUrl, entity)), ...overrides };
  const r = await req(bearer, 'POST', base, payload);
  return r;
}

// --- Authentication -------------------------------------------------------

test('login with valid credentials returns token, account and expiresAt', async () => {
  const r = await req(null, 'POST', '/auth/login', { username: 'admin', password: 'pw-admin' });
  assert.equal(r.status, 200);
  const body = await jsonOf(r);
  assert.equal(typeof body.token, 'string');
  assert.equal(body.account.username, 'admin');
  assert.equal(body.account.role, 'admin');
  assert.ok(body.account.id);
  assert.ok(body.expiresAt);
  assert.equal(body.account.passwordHash, undefined);
});

test('login with wrong password returns 401 UNAUTHORIZED', async () => {
  const r = await req(null, 'POST', '/auth/login', { username: 'admin', password: 'wrong' });
  assert.equal(r.status, 401);
  assert.equal((await jsonOf(r)).error, 'UNAUTHORIZED');
});

test('login with unknown user returns the same 401 (no enumeration)', async () => {
  const r = await req(null, 'POST', '/auth/login', { username: 'ghost', password: 'whatever' });
  assert.equal(r.status, 401);
  assert.equal((await jsonOf(r)).error, 'UNAUTHORIZED');
});

test('login with missing fields returns 400 VALIDATION_ERROR', async () => {
  const r = await req(null, 'POST', '/auth/login', { username: 'admin' });
  assert.equal(r.status, 400);
  assert.equal((await jsonOf(r)).error, 'VALIDATION_ERROR');
});

test('GET /auth/me with a valid token returns the account, never internals', async () => {
  const r = await req(token.author, 'GET', '/auth/me');
  assert.equal(r.status, 200);
  const body = await jsonOf(r);
  assert.equal(body.account.username, 'author');
  assert.equal(body.account.role, 'author');
  assert.equal(body.account.passwordHash, undefined);
});

test('GET /auth/me without a token returns 401', async () => {
  const r = await req(null, 'GET', '/auth/me');
  assert.equal(r.status, 401);
});

test('GET /auth/me with an invalid token returns 401', async () => {
  const r = await req('not-a-real-token', 'GET', '/auth/me');
  assert.equal(r.status, 401);
});

test('logout invalidates the session immediately; reuse and re-logout are 401', async () => {
  const fresh = await login(server.baseUrl, 'viewer', 'pw-viewer');
  const out = await req(fresh, 'POST', '/auth/logout');
  assert.equal(out.status, 204);
  const reuse = await req(fresh, 'GET', '/auth/me');
  assert.equal(reuse.status, 401);
  const again = await req(fresh, 'POST', '/auth/logout');
  assert.equal(again.status, 401);
});

test('logout without a token returns 401', async () => {
  const r = await req(null, 'POST', '/auth/logout');
  assert.equal(r.status, 401);
});

// --- Authorization (type-level) -------------------------------------------

test('write without a session returns 401 (middleware), not 403', async () => {
  setAuthToken(token.admin);
  const payload = await buildPayload(server.baseUrl, "BlogPosting");
  const r = await req(null, 'POST', "/blog-postings", payload);
  assert.equal(r.status, 401);
});

test('viewer may read but not create, update or delete', async () => {
  const created = await createAs(token.admin, "BlogPosting", "/blog-postings");
  const item = await jsonOf(created);
  assert.equal((await req(token.viewer, 'GET', `${"/blog-postings"}/${item.id}`)).status, 200);
  const c = await createAs(token.viewer, "BlogPosting", "/blog-postings");
  assert.equal(c.status, 403);
  assert.equal((await req(token.viewer, 'PUT', `${"/blog-postings"}/${item.id}`, {})).status, 403);
  assert.equal((await req(token.viewer, 'DELETE', `${"/blog-postings"}/${item.id}`)).status, 403);
});

test('author may read and create; editor and admin have full CRUD', async () => {
  assert.equal((await createAs(token.author, "BlogPosting", "/blog-postings")).status, 201);
  assert.equal((await createAs(token.editor, "BlogPosting", "/blog-postings")).status, 201);
  assert.equal((await createAs(token.admin, "BlogPosting", "/blog-postings")).status, 201);
});

// --- Ownership ------------------------------------------------------------

test('createdBy is set to the creator and an author may modify only own records', async () => {
  const mine = await jsonOf(await createAs(token.author, "BlogPosting", "/blog-postings"));
  const theirs = await jsonOf(await createAs(token.author2, "BlogPosting", "/blog-postings"));

  // Own update succeeds; foreign update and delete are 403.
  const ownUpdate = await req(token.author, 'PUT', `${"/blog-postings"}/${mine.id}`, {});
  assert.equal(ownUpdate.status, 200);
  assert.equal((await req(token.author, 'PUT', `${"/blog-postings"}/${theirs.id}`, {})).status, 403);
  assert.equal((await req(token.author, 'DELETE', `${"/blog-postings"}/${theirs.id}`)).status, 403);

  // Editor and admin modify any record regardless of ownership.
  assert.equal((await req(token.editor, 'PUT', `${"/blog-postings"}/${theirs.id}`, {})).status, 200);
  assert.equal((await req(token.admin, 'DELETE', `${"/blog-postings"}/${mine.id}`)).status, 204);
});

// --- Field-level ----------------------------------------------------------

test('createdBy never appears in any entity response', async () => {
  const created = await jsonOf(await createAs(token.admin, "BlogPosting", "/blog-postings"));
  assert.equal('createdBy' in created, false);
  const got = await jsonOf(await req(token.admin, 'GET', `${"/blog-postings"}/${created.id}`));
  assert.equal('createdBy' in got, false);
  const list = await jsonOf(await req(token.admin, 'GET', `${"/blog-postings"}?limit=100`));
  for (const item of list.items) assert.equal('createdBy' in item, false);
});

test('system and internal fields are rejected in a write body with 400', async () => {
  setAuthToken(token.admin);
  for (const field of ['id', 'dateCreated', 'dateModified', 'createdBy']) {
    const payload: Record<string, unknown> = { ...(await buildPayload(server.baseUrl, "BlogPosting")), [field]: field === 'id' ? '00000000-0000-0000-0000-000000000000' : 'x' };
    const r = await req(token.admin, 'POST', "/blog-postings", payload);
    assert.equal(r.status, 400, `expected 400 for field ${field}, got ${r.status}`);
    assert.equal((await jsonOf(r)).error, 'VALIDATION_ERROR');
  }
});

test('server-managed fields appear in output but are server set', async () => {
  const created = await jsonOf(await createAs(token.admin, "BlogPosting", "/blog-postings"));
  assert.ok(created.id);
  assert.ok(created.dateCreated);
  assert.ok(created.dateModified);
});

// --- Publication workflow -------------------------------------------------

test('a freshly created BlogPosting has the initial status', async () => {
  const created = await jsonOf(await createAs(token.author, "BlogPosting", "/blog-postings"));
  assert.equal(created["creativeWorkStatus"], "Draft");
});

test('author may run the initial transition but not the editor-only one', async () => {
  const item = await jsonOf(await createAs(token.author, "BlogPosting", "/blog-postings"));
  // author: initial -> authorTo allowed
  const a = await req(token.author, 'PUT', `${"/blog-postings"}/${item.id}`, { ["creativeWorkStatus"]: "Pending" });
  assert.equal(a.status, 200);
  assert.equal((await jsonOf(a))["creativeWorkStatus"], "Pending");
  // author: authorTo -> editorTo forbidden
  const b = await req(token.author, 'PUT', `${"/blog-postings"}/${item.id}`, { ["creativeWorkStatus"]: "Published" });
  assert.equal(b.status, 403);
  // editor: authorTo -> editorTo allowed
  const c = await req(token.editor, 'PUT', `${"/blog-postings"}/${item.id}`, { ["creativeWorkStatus"]: "Published" });
  assert.equal(c.status, 200);
});

test('an unmodelled transition is forbidden', async () => {
  const item = await jsonOf(await createAs(token.editor, "BlogPosting", "/blog-postings"));
  // initial -> editorTo (skipping authorTo) is not modelled
  const r = await req(token.editor, 'PUT', `${"/blog-postings"}/${item.id}`, { ["creativeWorkStatus"]: "Published" });
  assert.equal(r.status, 403);
});

// --- Anonymous visibility (public) ----------------------------------------

test('anonymous reads see only public records; non-public detail is 404', async () => {
  const item = await jsonOf(await createAs(token.admin, "BlogPosting", "/blog-postings"));

  // Not yet public: hidden from anonymous list and detail (404, not 403).
  const hiddenList = await jsonOf(await req(null, 'GET', `${"/blog-postings"}?limit=100`));
  assert.equal(hiddenList.items.some((i: any) => i.id === item.id), false);
  assert.equal((await req(null, 'GET', `${"/blog-postings"}/${item.id}`)).status, 404);

  // Drive it to the public status (admin), reaching datePublished where required.
  await req(token.admin, 'PUT', `${"/blog-postings"}/${item.id}`, { ["creativeWorkStatus"]: "Pending" });
  const publish: Record<string, unknown> = { ["creativeWorkStatus"]: "Published" };
  publish.datePublished = '2020-01-01T00:00:00Z';
  const pub = await req(token.admin, 'PUT', `${"/blog-postings"}/${item.id}`, publish);
  assert.equal(pub.status, 200);

  // Now visible anonymously, still without internal fields.
  const shownList = await jsonOf(await req(null, 'GET', `${"/blog-postings"}?limit=100`));
  assert.equal(shownList.items.some((i: any) => i.id === item.id), true);
  const detail = await req(null, 'GET', `${"/blog-postings"}/${item.id}`);
  assert.equal(detail.status, 200);
  assert.equal('createdBy' in (await jsonOf(detail)), false);
});

test('an entity without a status enum is anonymously readable and unrestricted by workflow', async () => {
  const created = await jsonOf(await createAs(token.admin, "Person", "/persons"));
  // Anonymous detail is visible (no status gating).
  const anon = await req(null, 'GET', `${"/persons"}/${created.id}`);
  assert.equal(anon.status, 200);
  // A plain update carries no workflow check.
  const upd = await req(token.editor, 'PUT', `${"/persons"}/${created.id}`, {});
  assert.equal(upd.status, 200);
});

// --- Bootstrap ------------------------------------------------------------

test('empty store plus ADMIN env seeds one admin that can log in', async () => {
  const s = await startServer({ env: { ADMIN_USER: 'root', ADMIN_PASSWORD: 'root-pw' } });
  try {
    const t = await login(s.baseUrl, 'root', 'root-pw');
    assert.equal(typeof t, 'string');
  } finally {
    await s.stop();
  }
});

test('a non-empty store makes the env seed a no-op', async () => {
  const s = await startServer({ accounts: ACCOUNTS, env: { ADMIN_USER: 'ghost', ADMIN_PASSWORD: 'ghost-pw' } });
  try {
    // The ghost admin from the env was never created — the store was not empty.
    const direct = await fetch(`${s.baseUrl}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ghost', password: 'ghost-pw' }),
    });
    assert.equal(direct.status, 401);
  } finally {
    await s.stop();
  }
});

test('empty store without env grants no one: protected writes are 401', async () => {
  const s = await startServer({ accounts: [] });
  try {
    setAuthToken(token.admin);
    const payload = await buildPayload(server.baseUrl, "BlogPosting");
    const r = await fetch(`${s.baseUrl}${"/blog-postings"}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(r.status, 401);
  } finally {
    await s.stop();
  }
});
