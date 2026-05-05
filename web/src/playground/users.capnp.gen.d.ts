// Generated from users.capnp by capnwasm-gen. Do not edit by hand.

import type { CapnCpp } from "capnwasm";

export declare class UserReader {
  constructor(cpp: CapnCpp);
  readonly id: number | bigint;
  readonly name: string;
  readonly email: string;
  readonly joinedAtMs: number | bigint;
  readonly active: boolean;
  readonly avatar: Uint8Array;
  toObject(): {
    id: number | bigint;
    name: string;
    email: string;
    joinedAtMs: number | bigint;
    active: boolean;
    avatar: Uint8Array;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class UserListReader {
  constructor(cpp: CapnCpp);
  readonly users: { readonly length: number; at(i: number): UserReader | undefined; [Symbol.iterator](): IterableIterator<UserReader> };
  toObject(): {
    users: { readonly length: number; at(i: number): UserReader | undefined; [Symbol.iterator](): IterableIterator<UserReader> };
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class CountParamsReader {
  constructor(cpp: CapnCpp);
  readonly n: number;
  toObject(): {
    n: number;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class BlobReplyReader {
  constructor(cpp: CapnCpp);
  readonly data: Uint8Array;
  toObject(): {
    data: Uint8Array;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class NumericProbeReader {
  constructor(cpp: CapnCpp);
  readonly f64s: { readonly length: number; at(i: number): number | undefined; view(): Float64Array; [Symbol.iterator](): IterableIterator<number> };
  toObject(): {
    f64s: { readonly length: number; at(i: number): number | undefined; view(): Float64Array; [Symbol.iterator](): IterableIterator<number> };
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare function openUser(cpp: CapnCpp, bytes: Uint8Array): UserReader;
export declare function openUserUnsafe(cpp: CapnCpp, bytes: Uint8Array): UserReader;
