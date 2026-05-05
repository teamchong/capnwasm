// Generated from generics.capnp by capnwasm-gen. Do not edit by hand.

import type { CapnCpp } from "capnwasm";

export declare class Box$TextReader {
  constructor(cpp: CapnCpp);
  readonly value: string;
  toObject(): {
    value: string;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class Box$TagReader {
  constructor(cpp: CapnCpp);
  readonly value: TagReader;
  toObject(): {
    value: TagReader;
  };
  draft<T>(fn: (draft: any) => T): T;
}

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
  readonly textBox: Box$TextReader;
  readonly tagBox: Box$TagReader;
  toObject(): {
    textBox: Box$TextReader;
    tagBox: Box$TagReader;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare function openBox$Text(cpp: CapnCpp, bytes: Uint8Array): Box$TextReader;
export declare function openBox$TextUnsafe(cpp: CapnCpp, bytes: Uint8Array): Box$TextReader;
