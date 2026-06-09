import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, buildPayload, postEntity, jsonOf } from './_helpers.ts';
import type { ServerHandle } from './_helpers.ts';

const ENTITY = "Comment";
const BASE = "/comments";

let server: ServerHandle;

test.before(async () => { server = await startServer(); });
test.after(async () => { await server.stop(); });

async function fresh(): Promise<any> {
  const payload = await buildPayload(server.baseUrl, ENTITY);
  const r = await postEntity(server.baseUrl, ENTITY, payload);
  if (r.status !== 201) {
    const text = await r.text();
    throw new Error(`POST ${BASE} expected 201, got ${r.status}: ${text}`);
  }
  return jsonOf(r);
}

test(`${ENTITY}: create returns 201 with @type and id`, async () => {
  const item = await fresh();
  assert.equal(item['@type'], ENTITY);
  assert.equal(item['@context'], 'https://schema.org');
  assert.ok(item.id);
});

test(`${ENTITY}: GET by id returns 200 with ETag`, async () => {
  const item = await fresh();
  const r = await fetch(`${server.baseUrl}${BASE}/${item.id}`);
  assert.equal(r.status, 200);
  assert.ok(r.headers.get('etag'));
});

test(`${ENTITY}: list returns { items, total } envelope`, async () => {
  await fresh();
  const r = await fetch(`${server.baseUrl}${BASE}`);
  assert.equal(r.status, 200);
  const body = await jsonOf(r);
  assert.ok(Array.isArray(body.items));
  assert.equal(typeof body.total, 'number');
});

test(`${ENTITY}: PUT partial update returns 200`, async () => {
  const item = await fresh();
  const partial = await buildPayload(server.baseUrl, ENTITY, { partial: true });
  const r = await fetch(`${server.baseUrl}${BASE}/${item.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  });
  if (r.status !== 200) {
    const text = await r.text();
    assert.fail(`PUT expected 200, got ${r.status}: ${text}`);
  }
});

test(`${ENTITY}: DELETE returns 204 and subsequent GET returns 404`, async () => {
  const item = await fresh();
  const del = await fetch(`${server.baseUrl}${BASE}/${item.id}`, { method: 'DELETE' });
  assert.equal(del.status, 204);
  const get = await fetch(`${server.baseUrl}${BASE}/${item.id}`);
  assert.equal(get.status, 404);
});

test(`${ENTITY}: invalid UUID returns 400 INVALID_ID`, async () => {
  const r = await fetch(`${server.baseUrl}${BASE}/not-a-uuid`);
  assert.equal(r.status, 400);
  assert.equal((await jsonOf(r)).error, 'INVALID_ID');
});

test(`${ENTITY}: unknown id returns 404 NOT_FOUND`, async () => {
  const r = await fetch(`${server.baseUrl}${BASE}/00000000-0000-0000-0000-000000000000`);
  assert.equal(r.status, 404);
  assert.equal((await jsonOf(r)).error, 'NOT_FOUND');
});

test(`${ENTITY}: pagination — limit + offset honour total`, async () => {
  await fresh();
  await fresh();
  await fresh();
  const r = await fetch(`${server.baseUrl}${BASE}?limit=2&offset=0`);
  const body = await jsonOf(r);
  assert.ok(body.total >= 3);
  assert.ok(body.items.length <= 2);
});

test(`${ENTITY}: sort by ${"text"} accepted`, async () => {
  const r = await fetch(`${server.baseUrl}${BASE}?sort=${"text"}&order=asc`);
  assert.equal(r.status, 200);
});

test(`${ENTITY}: unknown sort field rejected with 400`, async () => {
  const r = await fetch(`${server.baseUrl}${BASE}?sort=definitely-not-a-field`);
  assert.equal(r.status, 400);
});

test(`${ENTITY}: sort by numeric field "upvoteCount" orders numerically with missing last`, async () => {
  const ids: string[] = [];
  for (const v of [100, 0, 9, 99]) {
    const payload = await buildPayload(server.baseUrl, ENTITY);
    payload["upvoteCount"] = v;
    const r = await postEntity(server.baseUrl, ENTITY, payload);
    assert.equal(r.status, 201, `expected 201, got ${r.status}`);
    ids.push((await jsonOf(r)).id);
  }
  // One item that omits the numeric field entirely.
  const r0 = await postEntity(server.baseUrl, ENTITY, await buildPayload(server.baseUrl, ENTITY));
  assert.equal(r0.status, 201);
  const missingId = (await jsonOf(r0)).id;
  ids.push(missingId);

  const res = await fetch(`${server.baseUrl}${BASE}?sort=upvoteCount&order=asc&limit=100`);
  assert.equal(res.status, 200);
  const body = await jsonOf(res);
  const idSet = new Set(ids);
  const mine = body.items.filter((i: any) => idSet.has(i.id));
  const presentVals = mine
    .filter((i: any) => typeof i["upvoteCount"] === 'number')
    .map((i: any) => i["upvoteCount"]);
  assert.deepEqual(presentVals, [0, 9, 99, 100]);
  assert.equal(mine[mine.length - 1].id, missingId);
});


test(`${ENTITY}: filter on text field "text" returns matches`, async () => {
  const item = await fresh();
  const needle = String(item["text"] ?? '').slice(0, 4);
  if (!needle) return; // skip if field happens to be empty for this entity
  const r = await fetch(`${server.baseUrl}${BASE}?text=${encodeURIComponent(needle)}`);
  const body = await jsonOf(r);
  assert.ok(body.items.some((i: any) => i.id === item.id));
});


test(`${ENTITY}: stale If-Match on PUT returns 412`, async () => {
  const item = await fresh();
  const r = await fetch(`${server.baseUrl}${BASE}/${item.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': '"0000000000000000"' },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 412);
});

test(`${ENTITY}: CORS preflight returns 204 with allow headers`, async () => {
  const r = await fetch(`${server.baseUrl}${BASE}`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
});

test(`${ENTITY}: deeply nested JSON body rejected with 400 INVALID_JSON`, async () => {
  const depth = 2000;
  const deep = '['.repeat(depth) + ']'.repeat(depth);
  const r = await fetch(`${server.baseUrl}${BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: deep,
  });
  assert.equal(r.status, 400);
  assert.equal((await jsonOf(r)).error, 'INVALID_JSON');
});

test(`${ENTITY}: GET by id embeds "author" as an object; list stays flat`, async () => {
  const payload = await buildPayload(server.baseUrl, ENTITY, { partial: true });
  const created = await jsonOf(await postEntity(server.baseUrl, ENTITY, payload));

  // POST response keeps refs flat (UUID strings).
  const refId = created["author"];
  assert.equal(typeof refId, 'string');

  // Single-resource GET embeds the referenced entity one level deep.
  const got = await jsonOf(await fetch(`${server.baseUrl}${BASE}/${created.id}`));
  const embedded = got["author"];
  assert.equal(typeof embedded, 'object');
  assert.equal(embedded['@type'], "Person");
  assert.equal(embedded.id, refId);

  // List responses stay flat — refs remain UUID strings.
  const list = await jsonOf(await fetch(`${server.baseUrl}${BASE}?limit=100`));
  const inList = list.items.find((i: any) => i.id === created.id);
  assert.equal(typeof inList["author"], 'string');
});

test(`${ENTITY}: GET by id leaves an unresolvable "author" ref as its UUID`, async () => {
  const DANGLING = '00000000-0000-0000-0000-000000000000';
  const payload = await buildPayload(server.baseUrl, ENTITY, { partial: true });
  payload["author"] = DANGLING;
  const created = await jsonOf(await postEntity(server.baseUrl, ENTITY, payload));
  const got = await jsonOf(await fetch(`${server.baseUrl}${BASE}/${created.id}`));
  assert.equal(got["author"], DANGLING);
});
