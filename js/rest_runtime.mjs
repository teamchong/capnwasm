// Runtime support for capnwasm-generated REST clients.
//
// The `gen` command emits a small per-method dispatch shim; this module is
// the engine those shims call into. Everything is opt-in and configurable
//. The generated client passes a `cfg` snapshot built from the user's
// constructor options. No global state.
//
// Supports:
//   • All HTTP methods (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS)
//   • Path-template substitution with proper component encoding
//   • Query parameters (scalars, arrays, omitted-on-undefined)
//   • Headers (per-client default + per-call override)
//   • Bodies: JSON, FormData (multipart), URLSearchParams (form-encoded), raw
//   • Auth: bearer, apiKey (header or query), basic, custom hook
//   • Retries with configurable backoff (exponential default), Retry-After honoring
//   • Cancellation via AbortSignal (composes with timeout)
//   • Per-call timeout
//   • Request/response/error interceptor hooks
//   • AsyncIterable pagination (cursor- or page-based)
//   • Typed error class with status, body, request context
//   • Response decoding by Content-Type (json | text | blob | arrayBuffer | stream)

const SLEEP = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason ?? new Error("aborted")); }, { once: true });
});

/** Thrown for any non-2xx HTTP response. Includes the parsed body when possible. */
export class RestError extends Error {
  constructor({ status, statusText, url, method, body, headers }) {
    super(`HTTP ${status} ${statusText} ${method} ${url}`);
    this.name = "RestError";
    this.status = status;
    this.statusText = statusText;
    this.url = url;
    this.method = method;
    this.body = body;       // parsed response body (string or object)
    this.headers = headers; // response Headers
  }
}

/** Composes an AbortSignal with a timeout. Returns the composite signal + a cleanup function. */
function withTimeout(signal, timeoutMs) {
  if (!timeoutMs && !signal) return { signal: undefined, cleanup: () => {} };
  const ctrl = new AbortController();
  const handlers = [];
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else {
      const h = () => ctrl.abort(signal.reason);
      signal.addEventListener("abort", h, { once: true });
      handlers.push(() => signal.removeEventListener("abort", h));
    }
  }
  let timer;
  if (timeoutMs) {
    timer = setTimeout(() => ctrl.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    handlers.push(() => clearTimeout(timer));
  }
  return { signal: ctrl.signal, cleanup: () => handlers.forEach(h => h()) };
}

/** URL-encode a path-segment value. Reserved chars get escaped; / is escaped too (segments don't contain /). */
function encodeSeg(v) {
  return encodeURIComponent(String(v));
}

/** Substitute {name} slots in a path template using the supplied object map. */
function buildPath(template, params) {
  return template.replace(/{([^}]+)}/g, (_, name) => {
    if (!(name in params) || params[name] == null) {
      throw new Error(`REST: missing path parameter "${name}" for template "${template}"`);
    }
    return encodeSeg(params[name]);
  });
}

/** Append query parameters to a URL. Skips undefined/null. Arrays repeat the key. */
function appendQuery(url, query) {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) u.searchParams.append(k, String(item));
    } else if (v instanceof Date) {
      u.searchParams.set(k, v.toISOString());
    } else if (typeof v === "object") {
      u.searchParams.set(k, JSON.stringify(v));
    } else {
      u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

/** Apply the configured auth strategy, mutating headers (and optionally query). */
function applyAuth(cfg, headers, queryAdditions) {
  if (!cfg.auth) return;
  const a = cfg.auth;
  switch (a.type) {
    case "bearer": {
      const token = typeof a.token === "function" ? a.token() : a.token;
      if (token) headers["authorization"] = `Bearer ${token}`;
      break;
    }
    case "apiKey": {
      const key = typeof a.key === "function" ? a.key() : a.key;
      if (!key) break;
      if (a.in === "query") queryAdditions[a.name ?? "apiKey"] = key;
      else headers[(a.name ?? "x-api-key").toLowerCase()] = key;
      break;
    }
    case "basic": {
      const u = typeof a.username === "function" ? a.username() : a.username;
      const p = typeof a.password === "function" ? a.password() : a.password;
      if (u != null && p != null) {
        const enc = (typeof Buffer !== "undefined")
          ? Buffer.from(`${u}:${p}`, "utf8").toString("base64")
          : btoa(`${u}:${p}`);
        headers["authorization"] = `Basic ${enc}`;
      }
      break;
    }
    case "custom": {
      // Runs the user's apply(headers, query) hook.
      a.apply?.(headers, queryAdditions);
      break;
    }
    default:
      throw new Error(`REST: unknown auth type "${a.type}"`);
  }
}

/** Detect whether `b` is something fetch can send as a body without us serializing. */
function isPassthroughBody(b) {
  if (b == null) return true;
  if (typeof b === "string") return true;
  if (b instanceof ArrayBuffer) return true;
  if (b instanceof Uint8Array) return true;
  if (typeof Blob !== "undefined" && b instanceof Blob) return true;
  if (typeof FormData !== "undefined" && b instanceof FormData) return true;
  if (typeof URLSearchParams !== "undefined" && b instanceof URLSearchParams) return true;
  if (typeof ReadableStream !== "undefined" && b instanceof ReadableStream) return true;
  return false;
}

/** Encode a body per the requested encoding. Returns { body, contentType }. */
function encodeBody(body, encoding) {
  if (body === undefined || body === null) return { body: null, contentType: null };
  if (encoding === "raw" || isPassthroughBody(body)) {
    // Native body type. Fetch handles content-type for FormData/URLSearchParams.
    return { body, contentType: null };
  }
  if (encoding === "form") {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) for (const item of v) u.append(k, String(item));
      else u.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    return { body: u, contentType: null };  // URLSearchParams sets its own content-type
  }
  if (encoding === "multipart") {
    const fd = new FormData();
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) for (const item of v) fd.append(k, item);
      else fd.append(k, v);
    }
    return { body: fd, contentType: null };  // FormData sets its own boundary
  }
  // Default: JSON
  return { body: JSON.stringify(body), contentType: "application/json" };
}

/** Decode a fetch Response per the configured strategy. */
async function decodeResponse(res, decode) {
  if (decode === "stream") return res.body;
  if (decode === "blob") return await res.blob();
  if (decode === "arrayBuffer") return await res.arrayBuffer();
  if (decode === "text") return await res.text();
  if (decode === "json") return await res.json();
  // auto: pick by content-type
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) return await res.json();
  if (ct.startsWith("text/")) return await res.text();
  if (ct.startsWith("application/octet-stream") || ct.startsWith("image/") || ct.startsWith("video/")) {
    return await res.arrayBuffer();
  }
  return await res.text();
}

/** Try to parse an error response body. JSON if possible, else text. */
async function readErrorBody(res) {
  try {
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("json")) return await res.json();
    return await res.text();
  } catch {
    return null;
  }
}

/** Compute the next backoff delay for retry attempt `n` (0-indexed). */
function nextBackoff(retries, attempt, retryAfterHeader) {
  // Honor Retry-After if the server told us how long to wait.
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, retries.maxDelay ?? 30_000);
    // Could be an HTTP-date; ignore and fall through to backoff.
  }
  const base = retries.baseDelay ?? 200;
  const max  = retries.maxDelay ?? 30_000;
  if (retries.backoff === "linear") return Math.min(base * (attempt + 1), max);
  // Default: exponential with full jitter.
  const expCap = Math.min(max, base * Math.pow(2, attempt));
  return Math.floor(Math.random() * expCap);
}

/** Decide whether a given attempt should be retried. */
function shouldRetry(retries, err, response, attempt) {
  if (attempt >= (retries.count ?? 0)) return false;
  if (err) {
    // Network / abort errors: retry only if not user-cancelled.
    if (err.name === "AbortError") return false;
    return true;
  }
  if (!response) return false;
  const status = response.status;
  // Default: retry 408, 429, and 5xx (except 501 Not Implemented).
  if (retries.retryOn) return retries.retryOn(status, response);
  return status === 408 || status === 429 || (status >= 500 && status !== 501);
}

/**
 * Issue one HTTP call with the full pipeline: auth, headers, body encoding,
 * timeout, retries, interceptors, response decoding. Internal. Generated
 * code calls this with a `cfg` (frozen client opts) and `req` (per-method
 * descriptor). End users should only see typed methods on the client.
 */
export async function _restCall(cfg, req, callOpts = {}) {
  const path  = req.pathParams ? buildPath(req.path, req.pathParams) : req.path;
  const headers = {
    ...cfg.headers,
    ...req.headers,
    ...callOpts.headers,
  };
  const queryAdditions = {};
  applyAuth(cfg, headers, queryAdditions);

  // Merge query: per-call overrides directive-defined overrides default.
  const mergedQuery = { ...req.query, ...callOpts.query, ...queryAdditions };

  const finalUrl = appendQuery(joinUrl(cfg.baseUrl, path), mergedQuery);

  const { body, contentType } = encodeBody(
    callOpts.body !== undefined ? callOpts.body : req.body,
    callOpts.bodyEncoding ?? req.bodyEncoding ?? "json",
  );
  if (contentType && !headers["content-type"]) headers["content-type"] = contentType;

  const decode = callOpts.decode ?? req.decode ?? "auto";
  const timeoutMs = callOpts.timeout ?? cfg.timeout;
  const userSignal = callOpts.signal;
  const retries = { ...(cfg.retries ?? {}), ...(callOpts.retries ?? {}) };
  if (typeof retries.count !== "number") retries.count = 0;

  let attempt = 0;
  let lastErr = null;
  while (true) {
    const { signal, cleanup } = withTimeout(userSignal, timeoutMs);
    const init = {
      method: req.method,
      headers,
      body,
      signal,
    };
    let response = null;
    let preparedReq = { url: finalUrl, init };
    try {
      cfg.onRequest?.(preparedReq);
      response = await cfg.fetch(preparedReq.url, preparedReq.init);
    } catch (err) {
      cleanup();
      lastErr = err;
      cfg.onError?.(err, preparedReq);
      if (shouldRetry(retries, err, null, attempt)) {
        await SLEEP(nextBackoff(retries, attempt), userSignal);
        attempt++;
        continue;
      }
      throw err;
    }
    cleanup();
    cfg.onResponse?.(response, preparedReq);

    if (response.ok) {
      return await decodeResponse(response, decode);
    }

    if (shouldRetry(retries, null, response, attempt)) {
      const retryAfter = response.headers.get("retry-after");
      // Drain the response body so the connection is reusable, but ignore.
      try { await response.arrayBuffer(); } catch {}
      await SLEEP(nextBackoff(retries, attempt, retryAfter), userSignal);
      attempt++;
      continue;
    }

    const errBody = await readErrorBody(response);
    const restErr = new RestError({
      status: response.status,
      statusText: response.statusText,
      url: finalUrl,
      method: req.method,
      body: errBody,
      headers: response.headers,
    });
    cfg.onError?.(restErr, preparedReq);
    throw restErr;
  }
}

/** join a base URL and a path that may or may not start with /. */
function joinUrl(base, path) {
  if (!base) return path;
  if (!path) return base;
  if (/^[a-z][a-z0-9+\-.]*:/i.test(path)) return path;  // already absolute
  if (base.endsWith("/") && path.startsWith("/")) return base + path.slice(1);
  if (!base.endsWith("/") && !path.startsWith("/")) return base + "/" + path;
  return base + path;
}

/**
 * AsyncIterable wrapper over a paginated endpoint. The generated client's
 * paginated methods return one of these directly. Two strategies:
 *
 *   cursor: opts.cursorRequestParam is the query param the server expects
 *           (e.g. "starting_after"); opts.cursorResponseField is the field
 *           on each response page that holds the next cursor (e.g.
 *           "next_cursor"); opts.itemsField names the array field.
 *
 *   page:   opts.pageRequestParam ("page"), opts.itemsField ("items"),
 *           opts.totalField ("total"). Increments page until items is empty
 *           or page > total.
 *
 * For full control, callers can drop down to `_restCall` directly.
 */
export async function* _restPaginate(cfg, req, callOpts = {}, page = {}) {
  const itemsField = page.itemsField ?? "data";
  if (page.style === "page") {
    const param = page.pageRequestParam ?? "page";
    const startPage = page.startPage ?? 1;
    let p = startPage;
    while (true) {
      const result = await _restCall(cfg, {
        ...req,
        query: { ...req.query, [param]: p },
      }, callOpts);
      const items = result?.[itemsField] ?? [];
      for (const item of items) yield item;
      if (items.length === 0) return;
      if (page.totalField && result?.[page.totalField] != null) {
        if (p * (items.length || 1) >= result[page.totalField]) return;
      }
      p++;
    }
  } else {
    // Default: cursor pagination
    const reqParam = page.cursorRequestParam ?? "cursor";
    const respField = page.cursorResponseField ?? "next_cursor";
    let cursor = page.startCursor;
    while (true) {
      const q = { ...req.query };
      if (cursor != null) q[reqParam] = cursor;
      const result = await _restCall(cfg, { ...req, query: q }, callOpts);
      const items = result?.[itemsField] ?? [];
      for (const item of items) yield item;
      const next = result?.[respField];
      if (next == null || next === "" || next === false) return;
      if (items.length === 0) return;
      cursor = next;
    }
  }
}

/** Pre-bake auth helper objects so users don't have to remember the shape. */
export const auth = {
  bearer: (token) => ({ type: "bearer", token }),
  apiKey: (key, opts = {}) => ({
    type: "apiKey", key,
    in: opts.in ?? "header",
    name: opts.name ?? (opts.in === "query" ? "apiKey" : "x-api-key"),
  }),
  basic: (username, password) => ({ type: "basic", username, password }),
  custom: (apply) => ({ type: "custom", apply }),
};

/** Build the cfg snapshot the generated `create*Client(opts)` shim hands to _restCall. */
export function _buildRestCfg(defaults, opts = {}) {
  return {
    baseUrl: opts.baseUrl ?? defaults.baseUrl ?? "",
    auth: opts.auth ?? defaults.auth ?? null,
    headers: { ...defaults.headers, ...opts.headers },
    fetch: opts.fetch ?? globalThis.fetch?.bind(globalThis),
    retries: { ...defaults.retries, ...opts.retries },
    timeout: opts.timeout ?? defaults.timeout,
    onRequest: opts.onRequest,
    onResponse: opts.onResponse,
    onError: opts.onError,
  };
}
