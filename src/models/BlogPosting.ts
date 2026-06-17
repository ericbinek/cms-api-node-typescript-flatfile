import { randomUUID } from 'node:crypto';
import {
  isObject,
  isDangerousKey,
  isValidUUID,
  normalizeUUID,
  checkScalar,
  isEmbed,
  deepSanitize,
  etagFor,
} from '../lib/validation.ts';
import { withLock, readCollection, writeCollection } from '../lib/storage.ts';
import type { FieldSpec, ListResult, LanguageValue } from '../types.ts';

export interface BlogPosting {
  '@context': 'https://schema.org';
  '@type': 'BlogPosting';
  id: string;
  dateCreated: string;
  dateModified: string;
  headline: string;
  alternativeHeadline?: string;
  description?: string;
  articleBody: string;
  author: string;
  publisher?: string;
  image?: string[];
  video?: string[];
  audio?: string[];
  keywords?: string[];
  about?: string[];
  datePublished?: string;
  url?: string;
  inLanguage?: LanguageValue;
  isAccessibleForFree?: boolean;
  wordCount?: number;
  creativeWorkStatus?: "Draft" | "Pending" | "Published" | "Archived";
}

const COLLECTION_FILE = "blog-postings.json";
const TYPE_NAME = 'BlogPosting';

const FIELDS: Record<string, FieldSpec> = {
  "headline": { kind: 'scalar', type: "Text", cardinality: "one" },
  "alternativeHeadline": { kind: 'scalar', type: "Text", cardinality: "one" },
  "description": { kind: 'scalar', type: "Text", cardinality: "one" },
  "articleBody": { kind: 'scalar', type: "Text", cardinality: "one" },
  "author": { kind: 'ref', targets: ["Person"], cardinality: "one" },
  "publisher": { kind: 'ref', targets: ["Organization"], cardinality: "one" },
  "image": { kind: 'ref', targets: ["ImageObject"], cardinality: "many" },
  "video": { kind: 'ref', targets: ["VideoObject"], cardinality: "many" },
  "audio": { kind: 'ref', targets: ["AudioObject"], cardinality: "many" },
  "keywords": { kind: 'ref', targets: ["DefinedTerm"], cardinality: "many" },
  "about": { kind: 'ref', targets: ["CategoryCode"], cardinality: "many" },
  "datePublished": { kind: 'scalar', type: "DateTime", cardinality: "one" },
  "dateModified": { kind: 'scalar', type: "DateTime", cardinality: "one" },
  "dateCreated": { kind: 'scalar', type: "DateTime", cardinality: "one" },
  "url": { kind: 'scalar', type: "URL", cardinality: "one" },
  "inLanguage": { kind: 'embed', type: "Language", cardinality: "one" },
  "isAccessibleForFree": { kind: 'scalar', type: "Boolean", cardinality: "one" },
  "wordCount": { kind: 'scalar', type: "Integer", cardinality: "one" },
  "creativeWorkStatus": { kind: 'enum', values: ["Draft","Pending","Published","Archived"], cardinality: "one" },
};
const FIELD_NAMES: Set<string> = new Set(Object.keys(FIELDS));
const REQUIRED_FIELDS: Set<string> = new Set(["headline","articleBody","author"]);
const SEARCHABLE_FIELDS: Set<string> = new Set(["headline","alternativeHeadline","description","articleBody"]);
const SORTABLE_FIELDS: Set<string> = new Set(["dateCreated", "dateModified", ...["headline","alternativeHeadline","description","articleBody","datePublished","dateModified","dateCreated","url","isAccessibleForFree","wordCount","creativeWorkStatus"]]);

const SYSTEM_FIELDS: Set<string> = new Set(['id', 'dateCreated', 'dateModified', '@context', '@type']);

const REF_COLLECTIONS: Record<string, string> = {"Person":"persons.json","Organization":"organizations.json","ImageObject":"image-objects.json","VideoObject":"video-objects.json","AudioObject":"audio-objects.json","DefinedTerm":"defined-terms.json","CategoryCode":"category-codes.json"};

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function checkOne(spec: FieldSpec, value: unknown, path: string): string[] {
  const errors: string[] = [];
  if (spec.kind === 'scalar') {
    if (!checkScalar(spec.type, value)) {
      errors.push(`Field "${path}" must be a ${spec.type}.`);
    }
  } else if (spec.kind === 'enum') {
    if (!spec.values.includes(value as string)) {
      errors.push(`Field "${path}" must be one of: ${spec.values.join(', ')}.`);
    }
  } else if (spec.kind === 'ref') {
    if (!isValidUUID(value)) {
      errors.push(`Field "${path}" must be a UUID.`);
    }
  } else if (spec.kind === 'embed') {
    if (!isEmbed(value, spec.type)) {
      errors.push(`Field "${path}" must be an inline ${spec.type} embed with @type set.`);
    }
  }
  return errors;
}

function checkField(spec: FieldSpec, value: unknown, name: string): string[] {
  if (spec.cardinality === 'many') {
    if (!Array.isArray(value)) {
      return [`Field "${name}" must be an array.`];
    }
    const errors: string[] = [];
    for (let i = 0; i < value.length; i++) {
      errors.push(...checkOne(spec, value[i], `${name}[${i}]`));
    }
    return errors;
  }
  return checkOne(spec, value, name);
}

export function validate(data: unknown, { partial = false }: { partial?: boolean } = {}): string[] {
  if (!isObject(data)) return ['Request body must be a JSON object.'];

  const errors: string[] = [];

  for (const key of Object.keys(data)) {
    if (isDangerousKey(key)) {
      errors.push(`Unknown field "${key}".`);
      continue;
    }
    if (!FIELD_NAMES.has(key) && !SYSTEM_FIELDS.has(key)) {
      errors.push(`Unknown field "${key}".`);
    }
  }

  if (!partial) {
    for (const field of REQUIRED_FIELDS) {
      if (isEmpty(data[field])) {
        errors.push(`Field "${field}" is required.`);
      }
    }
  } else {
    // A partial update may omit a required field, but must not blank one that
    // is present — that would leave the resource violating its own contract.
    for (const field of REQUIRED_FIELDS) {
      if (field in data && isEmpty(data[field])) {
        errors.push(`Field "${field}" must not be empty.`);
      }
    }
  }

  for (const [name, spec] of Object.entries(FIELDS)) {
    const value = data[name];
    if (value === undefined) continue;
    errors.push(...checkField(spec, value, name));
  }

  return errors;
}

function normalizeRefs(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const [name, spec] of Object.entries(FIELDS)) {
    if (spec.kind !== 'ref' || out[name] === undefined) continue;
    if (spec.cardinality === 'many' && Array.isArray(out[name])) {
      out[name] = (out[name] as unknown[]).map(normalizeUUID);
    } else if (typeof out[name] === 'string') {
      out[name] = normalizeUUID(out[name]);
    }
  }
  return out;
}

// Type-aware ordering: numbers compare numerically, booleans as booleans,
// everything else lexicographically by string form. Missing values (null or
// absent) always sort last, regardless of order — never coerced to ''.
function compareForSort(va: unknown, vb: unknown, direction: number): number {
  const aMissing = va === undefined || va === null;
  const bMissing = vb === undefined || vb === null;
  if (aMissing || bMissing) {
    if (aMissing && bMissing) return 0;
    return aMissing ? 1 : -1;
  }
  let cmp: number;
  if (typeof va === 'number' && typeof vb === 'number') {
    cmp = va < vb ? -1 : va > vb ? 1 : 0;
  } else if (typeof va === 'boolean' && typeof vb === 'boolean') {
    cmp = va === vb ? 0 : va ? 1 : -1;
  } else {
    const sa = String(va);
    const sb = String(vb);
    cmp = sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  return cmp * direction;
}

export interface FindAllOptions {
  filter?: Record<string, unknown>;
  sort?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export async function findAll(options: FindAllOptions = {}): Promise<ListResult<BlogPosting>> {
  const { filter = {}, sort = 'dateCreated', order = 'desc', limit = 20, offset = 0 } = options;
  let results = await readCollection(COLLECTION_FILE);

  for (const [field, value] of Object.entries(filter)) {
    if (!SEARCHABLE_FIELDS.has(field)) continue;
    const needle = String(value).toLowerCase();
    results = results.filter((item) =>
      typeof item[field] === 'string' && (item[field] as string).toLowerCase().includes(needle));
  }

  const sortField = SORTABLE_FIELDS.has(sort) ? sort : 'dateCreated';
  const direction = order === 'asc' ? 1 : -1;
  results.sort((a, b) => compareForSort(a[sortField], b[sortField], direction));

  const total = results.length;
  const items = results.slice(offset, offset + limit) as unknown as BlogPosting[];
  return { items, total };
}

export async function findById(id: string): Promise<BlogPosting | null> {
  if (!isValidUUID(id)) return null;
  const items = await readCollection<BlogPosting>(COLLECTION_FILE);
  const normalized = normalizeUUID(id);
  return items.find((item) => item.id === normalized) || null;
}

// Embeds referenced entities one level deep for single-resource GET (JSON-LD
// style): each ref UUID is replaced by the referenced object. List responses
// stay flat. Embedded objects keep their own refs as UUIDs; a ref that no
// longer resolves is left as the stored UUID string.
export async function embedRefs(item: BlogPosting): Promise<Record<string, unknown>> {
  const cache = new Map<string, Record<string, unknown>[]>();
  const load = async (file: string): Promise<Record<string, unknown>[]> => {
    if (!cache.has(file)) cache.set(file, await readCollection(file));
    return cache.get(file)!;
  };
  const resolveRef = async (id: unknown, targets: readonly string[]): Promise<unknown> => {
    if (typeof id !== 'string') return id;
    for (const target of targets) {
      const file = REF_COLLECTIONS[target];
      if (!file) continue;
      const found = (await load(file)).find((entry) => entry.id === id);
      if (found) return found;
    }
    return id;
  };
  const out: Record<string, unknown> = { ...item };
  for (const [name, spec] of Object.entries(FIELDS)) {
    if (spec.kind !== 'ref' || out[name] === undefined || out[name] === null) continue;
    if (spec.cardinality === 'many') {
      if (!Array.isArray(out[name])) continue;
      out[name] = await Promise.all((out[name] as unknown[]).map((id) => resolveRef(id, spec.targets)));
    } else {
      out[name] = await resolveRef(out[name], spec.targets);
    }
  }
  return out;
}

export function create(rawData: unknown): Promise<BlogPosting> {
  return withLock(async () => {
    const data = normalizeRefs(deepSanitize(rawData) as Record<string, unknown>);
    const items = await readCollection<BlogPosting>(COLLECTION_FILE);
    const now = new Date().toISOString();
    const item = {
      ...data,
      '@context': 'https://schema.org',
      '@type': TYPE_NAME,
      id: randomUUID(),
      dateCreated: now,
      dateModified: now,
    } as unknown as BlogPosting;
    items.push(item);
    await writeCollection(COLLECTION_FILE, items);
    return item;
  });
}

export function update(id: string, rawData: unknown): Promise<BlogPosting | null> {
  return withLock(async () => {
    const items = await readCollection<BlogPosting>(COLLECTION_FILE);
    const normalized = normalizeUUID(id);
    const index = items.findIndex((item) => item.id === normalized);
    if (index === -1) return null;

    const data = normalizeRefs(deepSanitize(rawData) as Record<string, unknown>);
    const current = items[index];
    const updated = {
      ...current,
      ...data,
      '@context': current['@context'],
      '@type': current['@type'],
      id: current.id,
      dateCreated: current.dateCreated,
      dateModified: new Date().toISOString(),
    } as unknown as BlogPosting;
    items[index] = updated;
    await writeCollection(COLLECTION_FILE, items);
    return updated;
  });
}

export function remove(id: string): Promise<boolean> {
  return withLock(async () => {
    const items = await readCollection<BlogPosting>(COLLECTION_FILE);
    const normalized = normalizeUUID(id);
    const filtered = items.filter((item) => item.id !== normalized);
    if (filtered.length === items.length) return false;
    await writeCollection(COLLECTION_FILE, filtered);
    return true;
  });
}

export function etagOf(item: BlogPosting): string {
  return etagFor(item);
}

export const SCHEMA = { FIELDS, REQUIRED_FIELDS, SEARCHABLE_FIELDS, SORTABLE_FIELDS, TYPE_NAME, COLLECTION_FILE };
