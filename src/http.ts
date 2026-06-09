import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ErrorResponse } from './types.ts';

const MAX_BODY_SIZE = 1024 * 1024;
const MAX_JSON_DEPTH = 512;

// Iterative depth check — never recurses, so a deeply nested payload is rejected
// as invalid JSON (400) rather than risking unbounded work or a stack blow-up.
function exceedsMaxDepth(value: unknown, max: number): boolean {
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length > 0) {
    const [v, d] = stack.pop()!;
    if (d > max) return true;
    if (Array.isArray(v)) {
      for (const e of v) stack.push([e, d + 1]);
    } else if (v !== null && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      for (const k of Object.keys(obj)) stack.push([obj[k], d + 1]);
    }
  }
  return false;
}

class JsonParseError extends Error {
  constructor() {
    super('Invalid JSON in request body.');
    this.name = 'JsonParseError';
  }
}

class UnsupportedMediaTypeError extends Error {
  constructor() {
    super('Request body must be application/json.');
    this.name = 'UnsupportedMediaTypeError';
  }
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  const mediaType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let oversized = false;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        oversized = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (oversized) {
        reject(new RangeError('Request body too large.'));
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) {
        resolve({});
        return;
      }
      // A non-empty body must be declared as JSON.
      if (mediaType !== 'application/json') {
        reject(new UnsupportedMediaTypeError());
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        reject(new JsonParseError());
        return;
      }
      if (exceedsMaxDepth(parsed, MAX_JSON_DEPTH)) {
        reject(new JsonParseError());
        return;
      }
      resolve(parsed);
    });
    req.on('error', reject);
  });
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, If-Match, If-None-Match',
  'Access-Control-Expose-Headers': 'ETag',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

function generateETag(body: string): string {
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);
  return `"${hash}"`;
}

function json(req: IncomingMessage, res: ServerResponse, statusCode: number, data: unknown): void {
  if (statusCode === 204) {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  const body = JSON.stringify(data);
  const etag = generateETag(body);
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === '*')) {
    res.writeHead(304, CORS_HEADERS);
    res.end();
    return;
  }
  res.writeHead(statusCode, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'ETag': etag,
  });
  res.end(body);
}

function jsonError(req: IncomingMessage, res: ServerResponse, error: ErrorResponse): void {
  json(req, res, error.status, error);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(id: string): boolean {
  return UUID_PATTERN.test(id);
}

export {
  parseBody,
  JsonParseError,
  UnsupportedMediaTypeError,
  json,
  jsonError,
  generateETag,
  isValidUUID,
  CORS_HEADERS,
  MAX_BODY_SIZE,
};
