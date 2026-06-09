import { createHash } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const MAX_STRING_LENGTH = 100000;

export function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function isDangerousKey(k: string): boolean {
  return DANGEROUS_KEYS.has(k);
}

export function sanitizeString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(/\0/g, '').normalize('NFC');
}

export function deepSanitize(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) return value.map(deepSanitize);
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (isDangerousKey(k)) continue;
      out[k] = deepSanitize(v);
    }
    return out;
  }
  return value;
}

export function isValidUUID(s: unknown): boolean {
  return typeof s === 'string' && UUID_PATTERN.test(s);
}

export function normalizeUUID(s: unknown): unknown {
  return typeof s === 'string' ? s.toLowerCase() : s;
}

export function isText(v: unknown): boolean {
  return typeof v === 'string' && v.length <= MAX_STRING_LENGTH;
}
export function isInteger(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v);
}
export function isNumberValue(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}
export function isBoolean(v: unknown): boolean {
  return typeof v === 'boolean';
}
export function isDateTime(v: unknown): boolean {
  return typeof v === 'string' && ISO_DATETIME_PATTERN.test(v);
}
export function isHttpUrl(v: unknown): boolean {
  return typeof v === 'string' && HTTP_URL_PATTERN.test(v);
}

export function isEmbed(v: unknown, type: string): boolean {
  return isObject(v) && v['@type'] === type;
}

const SCALAR_CHECKS: Record<string, (v: unknown) => boolean> = {
  Text: isText,
  Integer: isInteger,
  Number: isNumberValue,
  Boolean: isBoolean,
  Date: isDateTime,
  DateTime: isDateTime,
  Time: isDateTime,
  URL: isHttpUrl,
};

export function checkScalar(type: string, value: unknown): boolean {
  const fn = SCALAR_CHECKS[type] || isText;
  return fn(value);
}

export function etagFor(item: unknown): string {
  const hash = createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 16);
  return `"${hash}"`;
}
