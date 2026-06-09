import {
  findAll,
  findById,
  embedRefs,
  create,
  update,
  remove,
  validate,
  etagOf,
  SCHEMA,
} from '../models/ImageObject.ts';
import type { FindAllOptions } from '../models/ImageObject.ts';
import { json, jsonError, parseBody, isValidUUID, CORS_HEADERS } from '../http.ts';
import {
  validationError,
  notFoundError,
  invalidIdError,
  methodNotAllowedError,
  preconditionFailedError,
} from '../errors.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';

const BASE = '/image-objects';
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

const SYSTEM_FILTER_KEYS: Set<string> = new Set(['limit', 'offset', 'sort', 'order']);

interface ListOptions extends FindAllOptions {
  limit: number;
  offset: number;
  sort: string;
  order: 'asc' | 'desc';
  filter: Record<string, string>;
  errors: string[];
}

function parseListOptions(url: URL): ListOptions {
  const errors: string[] = [];
  const sp = url.searchParams;

  let limit = DEFAULT_LIMIT;
  const limitRaw = sp.get('limit');
  if (limitRaw !== null) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
      errors.push(`Query "limit" must be an integer between 1 and ${MAX_LIMIT}.`);
    } else {
      limit = n;
    }
  }

  let offset = 0;
  const offsetRaw = sp.get('offset');
  if (offsetRaw !== null) {
    const n = Number(offsetRaw);
    if (!Number.isInteger(n) || n < 0) {
      errors.push('Query "offset" must be a non-negative integer.');
    } else {
      offset = n;
    }
  }

  let sort = 'dateCreated';
  const sortRaw = sp.get('sort');
  if (sortRaw !== null) {
    if (!SCHEMA.SORTABLE_FIELDS.has(sortRaw)) {
      errors.push(`Query "sort" must be one of: ${[...SCHEMA.SORTABLE_FIELDS].sort().join(', ')}.`);
    } else {
      sort = sortRaw;
    }
  }

  let order: 'asc' | 'desc' = 'desc';
  const orderRaw = sp.get('order');
  if (orderRaw !== null) {
    if (orderRaw !== 'asc' && orderRaw !== 'desc') {
      errors.push('Query "order" must be "asc" or "desc".');
    } else {
      order = orderRaw;
    }
  }

  const filter: Record<string, string> = {};
  for (const [key, value] of sp.entries()) {
    if (SYSTEM_FILTER_KEYS.has(key)) continue;
    if (!SCHEMA.SEARCHABLE_FIELDS.has(key)) {
      errors.push(`Unknown filter field "${key}".`);
      continue;
    }
    filter[key] = value;
  }

  return { limit, offset, sort, order, filter, errors };
}

function noContent(res: ServerResponse): void {
  res.writeHead(204, CORS_HEADERS);
  res.end();
}

export async function handleRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  requestPath: string,
): Promise<boolean> {
  const { pathname } = url;
  const method = req.method;

  if (pathname === BASE) {
    if (method === 'GET') {
      const opts = parseListOptions(url);
      if (opts.errors.length) {
        jsonError(req, res, validationError(opts.errors, requestPath));
        return true;
      }
      const result = await findAll(opts);
      json(req, res, 200, result);
      return true;
    }
    if (method === 'POST') {
      const body = await parseBody(req);
      const errors = validate(body);
      if (errors.length) {
        jsonError(req, res, validationError(errors, requestPath));
        return true;
      }
      const created = await create(body);
      res.setHeader('Location', `${BASE}/${created.id}`);
      json(req, res, 201, created);
      return true;
    }
    jsonError(req, res, methodNotAllowedError(['GET', 'POST'], requestPath));
    return true;
  }

  if (pathname.startsWith(`${BASE}/`)) {
    const rest = pathname.slice(BASE.length + 1);
    if (rest.includes('/')) {
      // No nested routes in V1.
      return false;
    }
    const id = rest;
    if (!isValidUUID(id)) {
      jsonError(req, res, invalidIdError(requestPath));
      return true;
    }

    if (method === 'GET') {
      const item = await findById(id);
      if (!item) {
        jsonError(req, res, notFoundError(SCHEMA.TYPE_NAME, requestPath));
        return true;
      }
      json(req, res, 200, await embedRefs(item));
      return true;
    }

    if (method === 'PUT') {
      const body = await parseBody(req);
      const errors = validate(body, { partial: true });
      if (errors.length) {
        jsonError(req, res, validationError(errors, requestPath));
        return true;
      }
      const current = await findById(id);
      if (!current) {
        jsonError(req, res, notFoundError(SCHEMA.TYPE_NAME, requestPath));
        return true;
      }
      const ifMatch = req.headers['if-match'];
      if (ifMatch && ifMatch !== '*' && ifMatch !== etagOf(current)) {
        jsonError(req, res, preconditionFailedError(requestPath));
        return true;
      }
      const updated = await update(id, body);
      json(req, res, 200, updated);
      return true;
    }

    if (method === 'DELETE') {
      const current = await findById(id);
      if (!current) {
        jsonError(req, res, notFoundError(SCHEMA.TYPE_NAME, requestPath));
        return true;
      }
      const ifMatch = req.headers['if-match'];
      if (ifMatch && ifMatch !== '*' && ifMatch !== etagOf(current)) {
        jsonError(req, res, preconditionFailedError(requestPath));
        return true;
      }
      await remove(id);
      noContent(res);
      return true;
    }

    jsonError(req, res, methodNotAllowedError(['GET', 'PUT', 'DELETE'], requestPath));
    return true;
  }

  return false;
}
