// Generated from example_user.capnp by capnwasm-gen — do not edit by hand.

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
  pick<K extends "id" | "age" | "active" | "name" | "email" | "bio">(names: K[]): { [P in K]: this[P] };
  readonly access: { readonly [P in "id" | "age" | "active" | "name" | "email" | "bio"]: undefined };
  apply(): Partial<{ [P in "id" | "age" | "active" | "name" | "email" | "bio"]: this[P] }>;
}

export declare class GreetingReader {
  constructor(cpp: CapnCpp);
  readonly message: string;
  readonly timestamp: number | bigint;
  toObject(): {
    message: string;
    timestamp: number | bigint;
  };
  pick<K extends "message" | "timestamp">(names: K[]): { [P in K]: this[P] };
  readonly access: { readonly [P in "message" | "timestamp"]: undefined };
  apply(): Partial<{ [P in "message" | "timestamp"]: this[P] }>;
}

export declare function openUser(cpp: CapnCpp, bytes: Uint8Array): UserReader;
