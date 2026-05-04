// capnwasm: re-exports of the inlined wasm bundle so that
// `import { load } from "capnwasm"` works.
//
// All paths now resolve through dist/inlined.mjs (see package.json exports).

export {
  load,
  CapnCpp,
  MultiSegmentMessageError,
  ReaderSlotExhaustedError,
  validateSingleSegment,
} from "../dist/inlined.mjs";
export {
  StaleDynamicReaderError,
  DisposedDynamicReaderError,
  withReader,
} from "./dynamic.mjs";
export {
  RpcSession,
  RpcCap,
  InterfaceRegistry,
  createMemoryTransportPair,
  wsTransport,
  connectWebSocket,
} from "./rpc.mjs";
