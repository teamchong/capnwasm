// capnwasm: re-exports of the inlined wasm bundle so that
// `import { load } from "capnwasm"` works.
//
// All paths now resolve through dist/inlined.mjs (see package.json exports).

export { load, CapnCpp } from "../dist/inlined.mjs";
export { TapeWriter, TapeReader } from "./tape_codec.mjs";
export { openFromStream } from "./stream.mjs";
export {
  RpcSession,
  RpcCap,
  InterfaceRegistry,
  createMemoryTransportPair,
  wsTransport,
  connectWebSocket,
  newBatchedRpcSession,
} from "./rpc.mjs";
