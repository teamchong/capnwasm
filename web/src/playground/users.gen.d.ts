// Generated from users.capnp by capnwasm-gen — do not edit by hand.

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
  pick<K extends "id" | "name" | "email" | "joinedAtMs" | "active" | "avatar">(names: K[]): { [P in K]: this[P] };
  readonly access: { readonly [P in "id" | "name" | "email" | "joinedAtMs" | "active" | "avatar"]: undefined };
  apply(): Partial<{ [P in "id" | "name" | "email" | "joinedAtMs" | "active" | "avatar"]: this[P] }>;
}

export declare function openUser(cpp: CapnCpp, bytes: Uint8Array): UserReader;
