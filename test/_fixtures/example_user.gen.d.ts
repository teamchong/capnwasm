// Generated from example_user.capnp by capnwasm-gen. Do not edit by hand.

import type { CapnCpp } from "capnwasm";

export declare class UserReader {
  constructor(cpp: CapnCpp);
  readonly id: number | bigint;
  readonly age: number;
  readonly active: boolean;
  readonly name: string;
  readonly email: string;
  readonly bio: string;
  toObject(): {
    id: number | bigint;
    age: number;
    active: boolean;
    name: string;
    email: string;
    bio: string;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class GreetingReader {
  constructor(cpp: CapnCpp);
  readonly message: string;
  readonly timestamp: number | bigint;
  toObject(): {
    message: string;
    timestamp: number | bigint;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare function openUser(cpp: CapnCpp, bytes: Uint8Array): UserReader;
export declare function openUserUnsafe(cpp: CapnCpp, bytes: Uint8Array): UserReader;
