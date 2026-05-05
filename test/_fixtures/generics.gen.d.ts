// Generated from generics.capnp by capnwasm-gen. Do not edit by hand.

import type { CapnCpp } from "capnwasm";

export declare class TagReader {
  constructor(cpp: CapnCpp);
  readonly name: string;
  readonly weight: number;
  toObject(): {
    name: string;
    weight: number;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class BoxReader {
  constructor(cpp: CapnCpp);
  readonly value: unknown;
  toObject(): {
    value: unknown;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class UseBoxReader {
  constructor(cpp: CapnCpp);
  readonly textBox: BoxReader;
  readonly tagBox: BoxReader;
  toObject(): {
    textBox: BoxReader;
    tagBox: BoxReader;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare function openTag(cpp: CapnCpp, bytes: Uint8Array): TagReader;
export declare function openTagUnsafe(cpp: CapnCpp, bytes: Uint8Array): TagReader;
