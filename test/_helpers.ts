import { spawn } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { FieldSpec } from '../src/types.ts';

import * as BlogPosting from '../src/models/BlogPosting.ts';
import * as Person from '../src/models/Person.ts';
import * as Organization from '../src/models/Organization.ts';
import * as WebPage from '../src/models/WebPage.ts';
import * as ImageObject from '../src/models/ImageObject.ts';
import * as VideoObject from '../src/models/VideoObject.ts';
import * as AudioObject from '../src/models/AudioObject.ts';
import * as CategoryCode from '../src/models/CategoryCode.ts';
import * as CategoryCodeSet from '../src/models/CategoryCodeSet.ts';
import * as DefinedTerm from '../src/models/DefinedTerm.ts';
import * as DefinedTermSet from '../src/models/DefinedTermSet.ts';
import * as Comment from '../src/models/Comment.ts';
import * as WebSite from '../src/models/WebSite.ts';
import * as SiteNavigationElement from '../src/models/SiteNavigationElement.ts';
import { hashPassword } from '../src/models/account.ts';
import { READONLY_FIELDS } from '../src/lib/access.ts';

interface ModelModule {
  SCHEMA: {
    FIELDS: Record<string, FieldSpec>;
    REQUIRED_FIELDS: Set<string>;
    SEARCHABLE_FIELDS: Set<string>;
    SORTABLE_FIELDS: Set<string>;
    UNIQUE_KEY: readonly string[];
    TYPE_NAME: string;
    COLLECTION_FILE: string;
  };
}

const MODELS: Record<string, ModelModule> = {
  BlogPosting,
  Person,
  Organization,
  WebPage,
  ImageObject,
  VideoObject,
  AudioObject,
  CategoryCode,
  CategoryCodeSet,
  DefinedTerm,
  DefinedTermSet,
  Comment,
  WebSite,
  SiteNavigationElement,
};

interface AccountSpec {
  username: string;
  password: string;
  role: string;
}

interface AccountRecord {
  id: string;
  username: string;
  passwordHash: string;
  role: string;
}

export interface StartOptions {
  accounts?: AccountSpec[];
  env?: Record<string, string>;
}

export interface ServerHandle {
  baseUrl: string;
  dataDir: string;
  token: string | null;
  stop(): Promise<void>;
}

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');

function pluralKebab(name: string): string {
  return name.replace(/([A-Z])/g, '-$1').replace(/^-/, '').toLowerCase() + 's';
}

// Ask the OS for a free port instead of guessing one. Test files run in
// parallel; a guessed port from a fixed range collides under load (EADDRINUSE).
function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const probe = createServer();
    probe.once('error', rej);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => res(port));
    });
  });
}

// Auth is mandatory on writes. The entity suite drives the API as an admin (who
// sees and may do everything), so the CRUD contract is exercised unchanged. The
// active bearer token is module scoped so the request helpers can attach it
// without threading it through every call.
const DEFAULT_ADMIN: AccountSpec = { username: 'admin', password: 'bootstrap-admin-secret', role: 'admin' };
let authToken: string | null = null;

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}`, ...extra } : { ...extra };
}

// fetch with the active bearer token attached (caller headers win on conflict).
export function authedFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...opts, headers: authHeaders((opts.headers as Record<string, string>) || {}) });
}

export function setAuthToken(token: string | null): void {
  authToken = token;
}

function accountRecord({ username, password, role }: AccountSpec): AccountRecord {
  return { id: randomUUID(), username, passwordHash: hashPassword(password), role };
}

export async function login(baseUrl: string, username: string, password: string): Promise<string> {
  const r = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (r.status !== 200) throw new Error(`login(${username}) failed with ${r.status}`);
  return (await jsonOf(r)).token;
}

// Starts a fresh server against a temp data dir. By default the account store is
// seeded with one admin, and the returned server carries that admin's token.
// Pass { accounts: [...] } to seed a specific set, or { env: { ADMIN_USER, ... } }
// to exercise the env bootstrap (no store written).
export async function startServer({ accounts, env }: StartOptions = {}): Promise<ServerHandle> {
  const port = await freePort();
  const dataDir = await mkdtemp(join(tmpdir(), 'cms-test-'));

  let seed = accounts;
  if (seed === undefined && env === undefined) seed = [DEFAULT_ADMIN];
  if (seed !== undefined) {
    await writeFile(join(dataDir, 'accounts.json'), JSON.stringify(seed.map(accountRecord), null, 2));
  }

  const child = spawn(process.execPath, ['src/server.ts'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ...(env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr?.on('data', () => {});

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) {
        const admin = (seed || []).find((a) => a.role === 'admin');
        const token = admin ? await login(baseUrl, admin.username, admin.password) : null;
        authToken = token;
        return {
          baseUrl,
          dataDir,
          token,
          async stop(): Promise<void> {
            authToken = null;
            child.kill('SIGTERM');
            await new Promise<void>((res) => child.on('exit', () => res()));
            await rm(dataDir, { recursive: true, force: true });
          },
        };
      }
    } catch {/* retry */}
    await new Promise((res) => setTimeout(res, 50));
  }
  child.kill('SIGTERM');
  await rm(dataDir, { recursive: true, force: true });
  throw new Error('Server did not start within 5 seconds');
}

const SCALAR_SAMPLES: Record<string, unknown> = {
  Text: 'sample text',
  Integer: 42,
  Number: 3.14,
  Boolean: true,
  Date: '2026-05-19T00:00:00Z',
  DateTime: '2026-05-19T12:00:00Z',
  Time: '2026-05-19T12:00:00Z',
  URL: 'https://example.com/resource',
};

async function sampleValue(baseUrl: string, spec: FieldSpec): Promise<unknown> {
  if (spec.cardinality === 'many') {
    return [await sampleOne(baseUrl, spec)];
  }
  return sampleOne(baseUrl, spec);
}

async function sampleOne(baseUrl: string, spec: FieldSpec): Promise<unknown> {
  if (spec.kind === 'scalar') return SCALAR_SAMPLES[spec.type] ?? 'sample';
  if (spec.kind === 'enum') return spec.values[0];
  if (spec.kind === 'embed') return { '@type': spec.type, alternateName: 'en' };
  if (spec.kind === 'ref') return await makeDep(baseUrl, spec.targets[0]);
  throw new Error('unknown spec kind');
}

// Gives each build a distinct value for a unique-key string field. Without this
// every payload would carry the same sample value and the second create in any
// multi-record test would trip duplicate detection. Ref key components are
// already unique because each is freshly created per build.
function uniqueValue(type: string, base: string): string {
  return type === 'URL' ? `${base}/${randomUUID()}` : `${base}-${randomUUID()}`;
}

// Builds a request body. System and internal fields are never sent — they are
// not client writable and would be rejected with 400.
export async function buildPayload(
  baseUrl: string,
  entity: string,
  { partial = false }: { partial?: boolean } = {},
): Promise<Record<string, unknown>> {
  const Model = MODELS[entity];
  if (!Model) throw new Error(`unknown entity: ${entity}`);
  const key = new Set<string>(Model.SCHEMA.UNIQUE_KEY ?? []);
  const payload: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(Model.SCHEMA.FIELDS)) {
    if (READONLY_FIELDS.has(name)) continue;
    if (!partial && !Model.SCHEMA.REQUIRED_FIELDS.has(name)) continue;
    payload[name] = await sampleValue(baseUrl, spec);
    if (key.has(name) && spec.kind === 'scalar' && typeof payload[name] === 'string') {
      payload[name] = uniqueValue(spec.type, payload[name] as string);
    }
  }
  return payload;
}

export async function makeDep(baseUrl: string, entity: string): Promise<string> {
  const Model = MODELS[entity];
  if (!Model) throw new Error(`unknown entity: ${entity}`);
  const payload = await buildPayload(baseUrl, entity);
  const r = await fetch(`${baseUrl}/${pluralKebab(entity)}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  if (r.status !== 201) {
    const text = await r.text();
    throw new Error(`makeDep(${entity}) failed with ${r.status}: ${text}`);
  }
  return (await jsonOf(r)).id;
}

export async function postEntity(
  baseUrl: string,
  entity: string,
  payload: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}/${pluralKebab(entity)}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
}

// Single typed boundary for reading a response body. HTTP JSON is dynamic, so
// it is honestly typed as `any` here and asserted on in the conformance tests.
export async function jsonOf(r: Response): Promise<any> {
  return r.json();
}
