import { createHash } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const MAX_STRING_LENGTH = 100000;

// Control characters that get stripped from every string. The multiline variant
// keeps the regular whitespace Tab (U+0009), Newline (U+000A) and Carriage
// Return (U+000D) so long-form text can hold line breaks; the default variant
// removes those too, since a single-line field should never carry them. Null
// bytes (U+0000) and the C1 block fall in both ranges and are always removed.
const CONTROL_CHARS_KEEP_WS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const CONTROL_CHARS_ALL = /[\u0000-\u001F\u007F-\u009F]/g;

export function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function isDangerousKey(k: string): boolean {
  return DANGEROUS_KEYS.has(k);
}

// Normalize, strip control characters, then trim. Multiline fields keep their
// internal line breaks but still lose leading/trailing whitespace.
export function sanitizeString(value: unknown, { multiline = false }: { multiline?: boolean } = {}): unknown {
  if (typeof value !== 'string') return value;
  const cleaned = value
    .normalize('NFC')
    .replace(multiline ? CONTROL_CHARS_KEEP_WS : CONTROL_CHARS_ALL, '');
  return cleaned.trim();
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
