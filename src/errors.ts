import type { ErrorResponse } from './types.ts';

function createError(
  status: number,
  error: string,
  message: string,
  details: string[] = [],
  path = '',
): ErrorResponse {
  return { status, error, message, details, path };
}

export function validationError(details: string[], path: string): ErrorResponse {
  return createError(400, 'VALIDATION_ERROR', 'Invalid request data.', details, path);
}

export function invalidJsonError(path: string): ErrorResponse {
  return createError(400, 'INVALID_JSON', 'Request body is not valid JSON.', [], path);
}

export function invalidIdError(path: string): ErrorResponse {
  return createError(400, 'INVALID_ID', 'ID must be a valid UUID.', [], path);
}

export function unauthorizedError(path: string): ErrorResponse {
  return createError(401, 'UNAUTHORIZED', 'Authentication is required, or the session is invalid or expired.', [], path);
}

export function forbiddenError(message: string, path: string): ErrorResponse {
  return createError(403, 'FORBIDDEN', message || 'You do not have permission to perform this operation.', [], path);
}

export function notFoundError(resource: string, path: string): ErrorResponse {
  return createError(404, 'NOT_FOUND', `${resource} not found.`, [], path);
}

export function routeNotFoundError(path: string): ErrorResponse {
  return createError(404, 'ROUTE_NOT_FOUND', 'No route matches this request.', [], path);
}

export function methodNotAllowedError(allowed: string[], path: string): ErrorResponse {
  return createError(405, 'METHOD_NOT_ALLOWED', `Method not allowed. Allowed: ${allowed.join(', ')}.`, [], path);
}

export function tooManyRequestsError(path: string): ErrorResponse {
  return createError(429, 'TOO_MANY_REQUESTS', 'Rate limit exceeded. Try again later.', [], path);
}

export function preconditionRequiredError(path: string): ErrorResponse {
  return createError(428, 'PRECONDITION_REQUIRED', 'If-Match header required for this operation.', [], path);
}

export function preconditionFailedError(path: string): ErrorResponse {
  return createError(412, 'PRECONDITION_FAILED', 'ETag does not match current resource state.', [], path);
}

export function referentialError(details: string[], path: string): ErrorResponse {
  return createError(422, 'REFERENTIAL_ERROR', 'Referenced resource does not exist.', details, path);
}

export function payloadTooLargeError(path: string): ErrorResponse {
  return createError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large.', [], path);
}

export function unsupportedMediaTypeError(path: string): ErrorResponse {
  return createError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request body must be application/json.', [], path);
}

export function internalError(path: string): ErrorResponse {
  return createError(500, 'INTERNAL_ERROR', 'Internal server error.', [], path);
}
