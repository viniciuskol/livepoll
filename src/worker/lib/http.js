// JSON response helpers + stable error codes (SPEC §6).

export const ERROR_STATUS = {
  ROOM_NOT_FOUND: 404,
  BAD_PASSWORD: 403,
  NICKNAME_TAKEN: 409,
  ROOM_FULL: 409,
  ALREADY_ANSWERED: 409,
  TIME_UP: 409,
  UNAUTHORIZED: 401,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  BAD_STATE: 409,
  // The room moved on between the click and the request (a double advance).
  // This one is 200, not 409, on purpose: it is not a failure, it is the
  // *expected* answer to the second of two clicks (or to two hosts both
  // pressing Space), and the stage handles it by re-polling. A 4xx makes the
  // browser log "Failed to load resource: 409" in the console no matter what
  // the JS does with the promise, and SPEC 12 asks for a console with nothing
  // in it. The error *body* is unchanged, so every client still sees
  // `{error:{code:'STALE_STATE'}}` and the code stays in the stable list.
  STALE_STATE: 200,
  // Joining a session that is already over.
  ROOM_ENDED: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_ATTEMPTS: 429,
  INTERNAL: 500,
};

// Request bodies are tiny by design (an answer, a nickname, a password).
// Only room creation carries a whole quiz.
export const MAX_BODY_BYTES = 32 * 1024;
export const MAX_QUIZ_BODY_BYTES = 1024 * 1024;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) },
  });
}

export class ApiError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  throw new ApiError(code, message, details);
}

export function errorResponse(e) {
  if (e instanceof ApiError) {
    const status = ERROR_STATUS[e.code] || 400;
    const body = { error: { code: e.code, message: e.message } };
    if (e.details !== undefined) body.error.details = e.details;
    return json(body, { status });
  }
  return json(
    { error: { code: 'INTERNAL', message: String((e && e.message) || e) } },
    { status: 500 }
  );
}

/**
 * Parses a JSON body, rejecting anything larger than `maxBytes` instead of
 * silently truncating oversized fields further down the stack.
 */
export async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    fail('PAYLOAD_TOO_LARGE', `Request body exceeds ${maxBytes} bytes`);
  }
  let bytes;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return fail('VALIDATION_ERROR', 'Could not read the request body');
  }
  if (bytes.byteLength > maxBytes) {
    fail('PAYLOAD_TOO_LARGE', `Request body exceeds ${maxBytes} bytes`);
  }
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object') throw new Error('not an object');
    return body;
  } catch {
    return fail('VALIDATION_ERROR', 'Invalid JSON body');
  }
}

/**
 * Same as readJson, but an empty body is not an error: the host action
 * endpoints accept an optional `{from, version}` guard and nothing else.
 */
export async function readJsonOptional(request, maxBytes = MAX_BODY_BYTES) {
  let bytes;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return {};
  }
  if (bytes.byteLength === 0) return {};
  if (bytes.byteLength > maxBytes) fail('PAYLOAD_TOO_LARGE', `Request body exceeds ${maxBytes} bytes`);
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

export function bearerToken(request) {
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
