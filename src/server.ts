import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json, jsonError, CORS_HEADERS } from './http.ts';
import {
  routeNotFoundError,
  invalidJsonError,
  payloadTooLargeError,
  unsupportedMediaTypeError,
  unauthorizedError,
  internalError,
} from './errors.ts';
import { resolvePrincipal, requiresSession, UnauthorizedError } from './lib/auth.ts';
import { seedAdmin } from './models/account.ts';
import { handleAuthRoutes } from './routers/auth.router.ts';
import { handleRoutes as handleBlogPosting } from './routers/blog-posting.router.ts';
import { handleRoutes as handlePerson } from './routers/person.router.ts';
import { handleRoutes as handleWebPage } from './routers/web-page.router.ts';
import { handleRoutes as handleImageObject } from './routers/image-object.router.ts';
import { handleRoutes as handleCategoryCode } from './routers/category-code.router.ts';
import { handleRoutes as handleCategoryCodeSet } from './routers/category-code-set.router.ts';
import { handleRoutes as handleDefinedTerm } from './routers/defined-term.router.ts';
import { handleRoutes as handleDefinedTermSet } from './routers/defined-term-set.router.ts';
import { handleRoutes as handleComment } from './routers/comment.router.ts';
import { handleRoutes as handleWebSite } from './routers/web-site.router.ts';

const PORT = parseInt(process.env.PORT || '3008', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const start = Date.now();
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const { pathname } = url;
  const method = req.method ?? '';
  const requestPath = `${method} ${pathname}`;

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${requestPath} ${res.statusCode} ${duration}ms`);
  });

  try {
    if (method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (method === 'TRACE' || method === 'CONNECT') {
      return jsonError(req, res, routeNotFoundError(requestPath));
    }

    if (pathname === '/health' && method === 'GET') {
      return json(req, res, 200, { status: 'ok' });
    }

    // Auth middleware: resolve the principal before routing. A presented but
    // invalid credential is 401; no credential is the anonymous principal.
    const principal = await resolvePrincipal(req);

    if (pathname === '/auth' || pathname.startsWith('/auth/')) {
      const handled = await handleAuthRoutes(req, res, url, requestPath, principal);
      if (handled) return;
    }

    // Writes require a session — no role grants anonymous writes (401, not 403).
    if (requiresSession(method, principal)) {
      return jsonError(req, res, unauthorizedError(requestPath));
    }

    if (pathname === '/blog-postings' || pathname.startsWith('/blog-postings/')) {
      const handled = await handleBlogPosting(req, res, url, requestPath, principal);
      if (handled) return;
    }
    if (pathname === '/persons' || pathname.startsWith('/persons/')) {
      const handled = await handlePerson(req, res, url, requestPath, principal);
      if (handled) return;
    }
    if (pathname === '/web-pages' || pathname.startsWith('/web-pages/')) {
      const handled = await handleWebPage(req, res, url, requestPath, principal);
      if (handled) return;
    }
    if (pathname === '/image-objects' || pathname.startsWith('/image-objects/')) {
      const handled = await handleImageObject(req, res, url, requestPath, principal);
      if (handled) return;
    }
    if (pathname === '/category-codes' || pathname.startsWith('/category-codes/')) {
      const handled = await handleCategoryCode(req, res, url, requestPath, principal);
      if (handled) return;
    }
    if (pathname === '/category-code-sets' || pathname.startsWith('/category-code-sets/')) {
      const handled = await handleCategoryCodeSet(req, res, url, requestPath, principal);
      if (handled) return;
    }
    if (pathname === '/defined-terms' || pathname.startsWith('/defined-terms/')) {
      const handled = await handleDefinedTerm(req, res, url, requestPath, principal);
      if (handled) return;
    }
    if (pathname === '/defined-term-sets' || pathname.startsWith('/defined-term-sets/')) {
      const handled = await handleDefinedTermSet(req, res, url, requestPath, principal);
      if (handled) return;
    }
    if (pathname === '/comments' || pathname.startsWith('/comments/')) {
      const handled = await handleComment(req, res, url, requestPath, principal);
      if (handled) return;
    }
    if (pathname === '/web-sites' || pathname.startsWith('/web-sites/')) {
      const handled = await handleWebSite(req, res, url, requestPath, principal);
      if (handled) return;
    }

    jsonError(req, res, routeNotFoundError(requestPath));
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonError(req, res, unauthorizedError(requestPath));
    }
    if (error instanceof Error && error.name === 'JsonParseError') {
      return jsonError(req, res, invalidJsonError(requestPath));
    }
    if (error instanceof Error && error.name === 'UnsupportedMediaTypeError') {
      return jsonError(req, res, unsupportedMediaTypeError(requestPath));
    }
    if (error instanceof RangeError) {
      return jsonError(req, res, payloadTooLargeError(requestPath));
    }
    console.error(`[${requestPath}] ${error instanceof Error ? error.message : String(error)}`);
    jsonError(req, res, internalError(requestPath));
  }
}

// Bootstrap the first admin (if configured) before accepting requests.
await seedAdmin();

const server = createServer(handleRequest);

server.listen(PORT, HOST, () => {
  console.log(`CMS API running at http://${HOST}:${PORT}`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received. Shutting down...`);
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
