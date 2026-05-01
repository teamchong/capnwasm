// Type declarations for capnwasm/typed. The runtime is in typed.mjs;
// these declarations let TS users write `typed<EchoClient>(cap, meta)`
// or `typedClient<EchoClient>(url, meta)` and get full IDE completion.

import type { RpcCap, RpcSession, InterfaceRegistry } from "./rpc.mjs";

export interface CapnInterfaceMeta {
  name: string;
  id: bigint;
  methods: ReadonlyArray<{
    id: number;
    name: string;
    Params: any;
    ParamsReader: any;
    openParams: (cpp: any, bytes: Uint8Array) => any;
    Results: any;
    ResultsReader: any;
    openResults: (cpp: any, bytes: Uint8Array) => any;
  }>;
}

/** Wrap a cap with a typed-method proxy. The shape of T is supplied by
 *  the codegen-emitted `<Name>Client` interface from a .gen.d.ts file. */
export function typed<T = unknown>(cap: RpcCap, meta: CapnInterfaceMeta): T & {
  readonly _cap: RpcCap;
  readonly _meta: CapnInterfaceMeta;
};

/** One-call typed client: load wasm + open transport + bootstrap + wrap. */
export function typedClient<T = unknown>(
  url: string,
  meta: CapnInterfaceMeta,
  opts?: {
    transport?: "auto" | "ws" | "batch" | "stream";
    registry?: InterfaceRegistry;
    bootstrap?: object;
    WebSocket?: typeof WebSocket;
    fetch?: typeof fetch;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
): Promise<T & {
  readonly _cap: RpcCap;
  readonly _meta: CapnInterfaceMeta;
  readonly _session: RpcSession;
}>;

/** Bind handlers from a JS object's methods to the registry, keyed by
 *  the interface metadata. Server-side counterpart of `typed`. */
export function bindHandlers(
  registry: InterfaceRegistry,
  meta: CapnInterfaceMeta,
  impl: Record<string, (args: any, ctx?: any) => any>,
): void;
