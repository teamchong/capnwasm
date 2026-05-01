import { createClient } from "./client.mjs";

// Typed-method-proxy helper. Closes the API ergonomics gap with capnweb's
// `<MyApi>` proxy by giving you `proxy.someMethod(arg)` directly off a cap,
// instead of `cap.call(IFC, METHOD, paramsBytes).promise`.
//
// Two entry points:
//
// `typedClient(url, MyApi_INTERFACE, opts?)` — one-line, like capnweb:
//
//   import { typedClient } from "capnwasm/typed";
//   import { MyApi_INTERFACE } from "./my_api.gen.mjs";
//
//   const api = await typedClient("https://api.example.com/rpc", MyApi_INTERFACE);
//   const result = await api.someMethod({ arg: 1 });
//
// `typed(cap, MyApi_INTERFACE)` — wrap an already-bootstrapped cap (when you
// need the lower-level session for streams or shared sessions across
// multiple interfaces):
//
//   const { cap } = await createClient(url);
//   const echo  = typed(cap, Echo_INTERFACE);
//   const auth  = typed(cap, Auth_INTERFACE);   // share one session
//
// What the proxy does per call:
//   1. new Params(cpp).fromObject(args)  — uses the codegen-emitted builder
//   2. cap.call(meta.id, method.id, paramsBytes)
//   3. wrap the returned bytes in `new Results(cpp, bytes)` and return it
//
// The argument shape is whatever your `Params` schema expects. The result is
// a Reader instance (with property accessors that read directly from wasm
// memory). To turn it into a plain JS object call `result.toObject()`.

/**
 * Build a typed proxy over `cap` using the interface metadata that
 * `capnwasm gen` emits for `interface` declarations.
 *
 * @param {RpcCap} cap - the capability to proxy
 * @param {object} meta - <Interface>_INTERFACE from your .gen.mjs
 * @returns {object} - { methodName(args) -> Promise<Reader>, ... }
 */
export function typed(cap, meta) {
  if (!cap || typeof cap.call !== "function") {
    throw new Error("typed: first arg must be an RpcCap");
  }
  if (!meta || typeof meta.id !== "bigint" || !Array.isArray(meta.methods)) {
    throw new Error("typed: second arg must be a *_INTERFACE meta object emitted by capnwasm gen");
  }
  const cpp = cap._cpp ?? cap.cpp ?? cap._session?.cpp;
  if (!cpp) {
    throw new Error("typed: cannot find a CapnCpp instance on the cap (cap._cpp / cap.cpp / cap._session.cpp)");
  }

  const proxy = Object.create(null);
  for (const method of meta.methods) {
    const { id, name, Params, Results } = method;
    if (!Params || !Results) {
      throw new Error(`typed: method ${name} on ${meta.name} is missing Params or Results class`);
    }
    const openResults = method.openResults;
    if (typeof openResults !== "function") {
      throw new Error(`typed: method ${name} on ${meta.name} is missing openResults — regenerate with the latest capnwasm`);
    }
    proxy[name] = function (args) {
      const builder = new Params(cpp);
      if (args !== undefined && args !== null) {
        if (typeof builder.fromObject === "function") builder.fromObject(args);
        else throw new Error(`typed: ${Params.name} has no fromObject; pass raw paramsBytes via cap.call instead`);
      }
      const paramsBytes = builder.toBytes();
      const sent = cap.call(meta.id, id, paramsBytes);
      return sent.promise.then(({ bytes, caps }) => {
        // Materialize to a plain JS object eagerly. The Reader reads
        // straight out of wasm scratch memory, which gets clobbered by
        // the next call — so a Reader returned to the caller is only
        // valid until the next await. toObject() copies the field values
        // out, which is safe to hold across calls. Users who want
        // zero-copy can call cap.call directly with their own opener.
        const reader = openResults(cpp, bytes);
        const result = typeof reader.toObject === "function"
          ? reader.toObject()
          : reader;
        if (caps && caps.length) {
          Object.defineProperty(result, "_caps", { value: caps, enumerable: false });
        }
        return result;
      });
    };
  }
  // Allow direct access to the underlying cap for any escape-hatch needs.
  Object.defineProperty(proxy, "_cap", { value: cap, enumerable: false });
  Object.defineProperty(proxy, "_meta", { value: meta, enumerable: false });
  return proxy;
}

/**
 * One-call typed client: load wasm + connect transport + bootstrap + wrap.
 * URL scheme picks the transport: ws/wss → WebSocket, http/https → HTTP
 * batch (use `opts.transport: "stream"` for HTTP streaming).
 *
 *   import { typedClient } from "capnwasm/typed";
 *   import { Echo_INTERFACE } from "./echo.gen.mjs";
 *
 *   const api = await typedClient("https://api.example.com/rpc", Echo_INTERFACE);
 *   const result = await api.echo({ text: "hi" });
 *
 * The returned proxy exposes `_session` and `_cap` for escape-hatch use
 * (calling `_session.close()` to tear down, `_cap.callStream(...)` for
 * streaming methods, etc.).
 */
export async function typedClient(url, meta, opts = {}) {
  const { session, cap } = await createClient(url, opts);
  const proxy = typed(cap, meta);
  Object.defineProperty(proxy, "_session", { value: session, enumerable: false });
  return proxy;
}

/**
 * Build a registry handler shape from interface metadata + a JS object that
 * has methods named after the interface. The handler is callable via
 * `InterfaceRegistry.register` keyed by interface ID + method ID.
 *
 * Server-side counterpart to `typed`. Lets you write:
 *
 *   class EchoServer {
 *     echo({ text }) { return { text }; }
 *     ping() { return { count: this.calls++ }; }
 *   }
 *
 *   const registry = new InterfaceRegistry();
 *   bindHandlers(registry, Echo_INTERFACE, new EchoServer());
 *
 * Each method's `(args) => returnValue` shape is the same one as the typed
 * client, so server and client stay symmetric.
 */
export function bindHandlers(registry, meta, impl) {
  if (!registry || typeof registry.register !== "function") {
    throw new Error("bindHandlers: first arg must be an InterfaceRegistry");
  }
  if (!meta || typeof meta.id !== "bigint" || !Array.isArray(meta.methods)) {
    throw new Error("bindHandlers: second arg must be a *_INTERFACE meta object");
  }
  for (const method of meta.methods) {
    const { id, name, ParamsReader, Results } = method;
    const fn = impl[name];
    if (typeof fn !== "function") {
      // Skip methods the impl doesn't define; they'll surface as
      // "unknown method" exceptions when called.
      continue;
    }
    registry.register(meta.id, id, async (target, ctx) => {
      const reader = ctx.openParams(ParamsReader);
      const args = typeof reader.toObject === "function" ? reader.toObject() : reader;
      const result = await fn.call(impl, args, ctx);
      if (result === undefined || result === null) return null;
      // If the handler returned a Builder (e.g., already used ctx.beginResults),
      // do nothing; the bytes are already staged.
      if (result && typeof result.bytes === "object" && result.bytes instanceof Uint8Array && result._DATA_WORDS === undefined) {
        return null;
      }
      // Plain JS object → build the Results struct via fromObject.
      const builder = ctx.beginResults(Results);
      if (typeof builder.fromObject === "function") builder.fromObject(result);
      return null;
    });
  }
}
