// Generated from cap_in_struct.capnp by capnwasm-gen. Do not edit by hand.

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

export declare class GreetingReader {
  constructor(cpp: CapnCpp);
  readonly who: string;
  readonly cap: null;
  toObject(): {
    who: string;
    cap: null;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class greet$ParamsReader {
  constructor(cpp: CapnCpp);
  readonly who: string;
  toObject(): {
    who: string;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class greet$ResultsReader {
  constructor(cpp: CapnCpp);
  readonly greeting: GreetingReader;
  toObject(): {
    greeting: GreetingReader;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class useCap$ParamsReader {
  constructor(cpp: CapnCpp);
  readonly greeting: GreetingReader;
  toObject(): {
    greeting: GreetingReader;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class useCap$ResultsReader {
  constructor(cpp: CapnCpp);
  readonly echoed: string;
  toObject(): {
    echoed: string;
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

/** Typed client for the Lobby interface. Pass into typed/typedClient. */
export interface LobbyClient {
  greet(args: { who: string }): Promise<{ greeting: GreetingReader }>;
  useCap(args: { greeting: GreetingReader }): Promise<{ echoed: string }>;
}

export declare const Lobby_INTERFACE: CapnInterfaceMeta;
