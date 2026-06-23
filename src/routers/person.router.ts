import {
  findAll,
  findById,
  embedRefs,
  create,
  update,
  remove,
  sanitize,
  validate,
  etagOf,
  SCHEMA,
} from '../models/Person.ts';
import type { FindAllOptions } from '../models/Person.ts';
import { json, jsonError, parseBody, isValidUUID, CORS_HEADERS } from '../http.ts';
import {
  validationError,
  notFoundError,
  invalidIdError,
  methodNotAllowedError,
  preconditionFailedError,
  forbiddenError,
} from '../errors.ts';
import {
  can,
  ownershipField,
  statusProperty,
  transitionAllowed,
  readonlyViolations,
  stripFields,
  isVisible,
  applyCreateDefaults,
} from '../lib/access.ts';
import type { Principal } from '../lib/auth.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';

const ENTITY = 'Person';
const BASE = '/persons';
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
  principal: Principal,
): Promise<boolean> {
  const { pathname } = url;
  const method = req.method;
  const role = principal.role;

  if (pathname === BASE) {
    if (method === 'GET') {
      if (!can(role, ENTITY, 'read')) {
        jsonError(req, res, forbiddenError(`Role "${role}" may not read ${ENTITY}.`, requestPath));
        return true;
      }
      const opts = parseListOptions(url);
      if (opts.errors.length) {
        jsonError(req, res, validationError(opts.errors, requestPath));
        return true;
      }
      // Apply read visibility on the full filtered set, then paginate, so total
      // counts only the records this principal may see. Internal fields stripped.
      const all = await findAll({ filter: opts.filter, sort: opts.sort, order: opts.order, limit: Number.MAX_SAFE_INTEGER, offset: 0 });
      const visible = all.items.filter((item) => isVisible(role, ENTITY, item as unknown as Record<string, unknown>));
      const items = visible
        .slice(opts.offset, opts.offset + opts.limit)
        .map((item) => stripFields(role, item));
      json(req, res, 200, { items, total: visible.length });
      return true;
    }
    if (method === 'POST') {
      if (!can(role, ENTITY, 'create')) {
        jsonError(req, res, forbiddenError(`Role "${role}" may not create ${ENTITY}.`, requestPath));
        return true;
      }
      const body = sanitize(await parseBody(req));
      const readonly = readonlyViolations(role, body);
      if (readonly.length) {
        jsonError(req, res, validationError([`Fields are not writable: ${readonly.join(', ')}.`], requestPath));
        return true;
      }
      const errors = validate(body);
      if (errors.length) {
        jsonError(req, res, validationError(errors, requestPath));
        return true;
      }
      const created = await create(applyCreateDefaults(ENTITY, body as Record<string, unknown>, principal.accountId));
      res.setHeader('Location', `${BASE}/${created.id}`);
      json(req, res, 201, stripFields(role, created));
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
      if (!can(role, ENTITY, 'read')) {
        jsonError(req, res, forbiddenError(`Role "${role}" may not read ${ENTITY}.`, requestPath));
        return true;
      }
      const item = await findById(id);
      // A record the principal may not see is indistinguishable from a missing
      // one (404, never 403) so its existence is not disclosed.
      if (!item || !isVisible(role, ENTITY, item as unknown as Record<string, unknown>)) {
        jsonError(req, res, notFoundError(SCHEMA.TYPE_NAME, requestPath));
        return true;
      }
      json(req, res, 200, stripFields(role, await embedRefs(item)));
      return true;
    }

    if (method === 'PUT') {
      if (!can(role, ENTITY, 'update')) {
        jsonError(req, res, forbiddenError(`Role "${role}" may not update ${ENTITY}.`, requestPath));
        return true;
      }
      const body = sanitize(await parseBody(req));
      const readonly = readonlyViolations(role, body);
      if (readonly.length) {
        jsonError(req, res, validationError([`Fields are not writable: ${readonly.join(', ')}.`], requestPath));
        return true;
      }
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
      const record = current as unknown as Record<string, unknown>;
      const writeBody = body as Record<string, unknown>;
      const ownerField = ownershipField(role, 'update');
      if (ownerField && record[ownerField] !== principal.accountId) {
        jsonError(req, res, forbiddenError('You may only modify your own records.', requestPath));
        return true;
      }
      const ifMatch = req.headers['if-match'];
      if (ifMatch && ifMatch !== '*' && ifMatch !== etagOf(current)) {
        jsonError(req, res, preconditionFailedError(requestPath));
        return true;
      }
      const status = statusProperty(ENTITY);
      if (status && writeBody[status] !== undefined && writeBody[status] !== record[status]) {
        if (!transitionAllowed(ENTITY, record[status], writeBody[status], role)) {
          jsonError(req, res, forbiddenError(`Status transition ${record[status]} -> ${writeBody[status]} is not allowed for role "${role}".`, requestPath));
          return true;
        }
      }
      const updated = await update(id, body);
      json(req, res, 200, stripFields(role, updated));
      return true;
    }

    if (method === 'DELETE') {
      if (!can(role, ENTITY, 'delete')) {
        jsonError(req, res, forbiddenError(`Role "${role}" may not delete ${ENTITY}.`, requestPath));
        return true;
      }
      const current = await findById(id);
      if (!current) {
        jsonError(req, res, notFoundError(SCHEMA.TYPE_NAME, requestPath));
        return true;
      }
      const record = current as unknown as Record<string, unknown>;
      const ownerField = ownershipField(role, 'delete');
      if (ownerField && record[ownerField] !== principal.accountId) {
        jsonError(req, res, forbiddenError('You may only delete your own records.', requestPath));
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
