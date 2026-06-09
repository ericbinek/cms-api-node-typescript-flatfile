import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FieldSpec } from '../src/types.ts';

import * as BlogPosting from '../src/models/BlogPosting.ts';
import * as Person from '../src/models/Person.ts';
import * as WebPage from '../src/models/WebPage.ts';
import * as ImageObject from '../src/models/ImageObject.ts';
import * as CategoryCode from '../src/models/CategoryCode.ts';
import * as CategoryCodeSet from '../src/models/CategoryCodeSet.ts';
import * as DefinedTerm from '../src/models/DefinedTerm.ts';
import * as DefinedTermSet from '../src/models/DefinedTermSet.ts';
import * as Comment from '../src/models/Comment.ts';
import * as WebSite from '../src/models/WebSite.ts';

interface ModelModule {
  SCHEMA: {
    FIELDS: Record<string, FieldSpec>;
    REQUIRED_FIELDS: Set<string>;
    SEARCHABLE_FIELDS: Set<string>;
    SORTABLE_FIELDS: Set<string>;
    TYPE_NAME: string;
    COLLECTION_FILE: string;
  };
}

const MODELS: Record<string, ModelModule> = {
  BlogPosting,
  Person,
  WebPage,
  ImageObject,
  CategoryCode,
  CategoryCodeSet,
  DefinedTerm,
  DefinedTermSet,
  Comment,
  WebSite,
};

export interface ServerHandle {
  baseUrl: string;
  stop(): Promise<void>;
}

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');

function pluralKebab(name: string): string {
  return name.replace(/([A-Z])/g, '-$1').replace(/^-/, '').toLowerCase() + 's';
}

let portCounter = 14000 + Math.floor(Math.random() * 1000);

export async function startServer(): Promise<ServerHandle> {
  const port = portCounter++;
  const dataDir = await mkdtemp(join(tmpdir(), 'cms-test-'));
  const child = spawn(process.execPath, ['src/server.ts'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr?.on('data', () => {});

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) {
        return {
          baseUrl,
          async stop(): Promise<void> {
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

export async function buildPayload(
  baseUrl: string,
  entity: string,
  { partial = false }: { partial?: boolean } = {},
): Promise<Record<string, unknown>> {
  const Model = MODELS[entity];
  if (!Model) throw new Error(`unknown entity: ${entity}`);
  const payload: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(Model.SCHEMA.FIELDS)) {
    if (!partial && !Model.SCHEMA.REQUIRED_FIELDS.has(name)) continue;
    payload[name] = await sampleValue(baseUrl, spec);
  }
  return payload;
}

export async function makeDep(baseUrl: string, entity: string): Promise<string> {
  const Model = MODELS[entity];
  if (!Model) throw new Error(`unknown entity: ${entity}`);
  const payload = await buildPayload(baseUrl, entity);
  const r = await fetch(`${baseUrl}/${pluralKebab(entity)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// Single typed boundary for reading a response body. HTTP JSON is dynamic, so
// it is honestly typed as `any` here and asserted on in the conformance tests.
export async function jsonOf(r: Response): Promise<any> {
  return r.json();
}
