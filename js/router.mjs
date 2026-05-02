// Federation router. Drop-in replacement for InterfaceRegistry on a gateway
// session. Maps inbound interface IDs to a backend RpcCap, forwards each call
// verbatim. The gateway holds outbound sessions to each backend service; the
// router decides which backend gets the inbound traffic.
//
//   import { RouterRegistry } from "capnwasm/router";
//
//   const router = new RouterRegistry()
//     .route(USER_IFC, userServiceCap)
//     .route(ORDER_IFC, orderServiceCap)
//     .routeStream(EVENTS_IFC, eventServiceCap)
//     .routeFallback(catchallCap);
//   const session = new RpcSession(cpp, transport, router, { bootstrap: ... });
//
// Stream methods need `routeStream()` explicitly. `route()` only forwards
// regular calls. Methods returning capabilities throw. Translating cap
// exports across two RPC sessions needs a hand-written handler.

function u64(x) { return BigInt.asUintN(64, BigInt(x)); }

export class RouterRegistry {
  #routes = new Map();
  #streamRoutes = new Map();
  #fallback = null;
  #streamFallback = null;

  route(interfaceId, cap) {
    if (!cap) throw new Error("RouterRegistry.route: cap is required");
    this.#routes.set(u64(interfaceId), cap);
    return this;
  }

  routeStream(interfaceId, cap) {
    if (!cap) throw new Error("RouterRegistry.routeStream: cap is required");
    this.#streamRoutes.set(u64(interfaceId), cap);
    return this;
  }

  routeFallback(cap) {
    if (!cap) throw new Error("RouterRegistry.routeFallback: cap is required");
    this.#fallback = cap;
    return this;
  }

  routeStreamFallback(cap) {
    if (!cap) throw new Error("RouterRegistry.routeStreamFallback: cap is required");
    this.#streamFallback = cap;
    return this;
  }

  dispatch(targetObject, interfaceId, methodId) {
    const cap = this.#routes.get(u64(interfaceId)) ?? this.#fallback;
    if (!cap) return null;
    return async (_target, ctx) => {
      const params = ctx.paramsBytes();
      const { bytes, caps } = await cap.call(interfaceId, methodId, params, []).promise;
      if (caps && caps.length > 0) {
        throw new Error("RouterRegistry: routed methods returning capabilities not supported");
      }
      return bytes;
    };
  }

  dispatchStream(targetObject, interfaceId, methodId) {
    const cap = this.#streamRoutes.get(u64(interfaceId)) ?? this.#streamFallback;
    if (!cap) return null;
    return async function* (ctx) {
      const params = ctx.paramsBytes();
      const r = cap.callStream(interfaceId, methodId, params, {});
      for await (const chunk of r.chunks) yield chunk;
    };
  }
}
