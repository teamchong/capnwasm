// Generated from capability_field.capnp by capnwasm-gen. Do not edit by hand.

import type { CapnCpp } from "capnwasm";

export declare class hello$ParamsReader {
  constructor(cpp: CapnCpp);
  toObject(): {
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class hello$ResultsReader {
  constructor(cpp: CapnCpp);
  readonly msg: string;
  toObject(): {
    msg: string;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class VisitReader {
  constructor(cpp: CapnCpp);
  readonly who: string;
  readonly cap: null;
  toObject(): {
    who: string;
    cap: null;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare function openhello$Params(cpp: CapnCpp, bytes: Uint8Array): hello$ParamsReader;
export declare function openhello$ParamsUnsafe(cpp: CapnCpp, bytes: Uint8Array): hello$ParamsReader;


// --- Interface metadata + typed clients ---

export interface CapnInterfaceMeta {
  name: string;
  id: bigint;
  methods: ReadonlyArray<CapnMethodMeta>;
}
export interface CapnMethodMeta {
  id: number;
  name: string;
  Params: any;
  ParamsReader: any;
  openParams: (cpp: any, bytes: Uint8Array) => any;
  Results: any;
  ResultsReader: any;
  openResults: (cpp: any, bytes: Uint8Array) => any;
}

/** Typed client for the Greeter interface. Pass into typed/typedClient. */
export interface GreeterClient {
  hello(): Promise<{ msg: string }>;
}

export declare const Greeter_INTERFACE: CapnInterfaceMeta;
