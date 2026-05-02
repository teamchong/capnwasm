// Generated from profile_v2.capnp by capnwasm-gen — do not edit by hand.

import type { CapnCpp } from "capnwasm";

export declare class ProfileReader {
  constructor(cpp: CapnCpp);
  readonly id: number | bigint;
  readonly name: string;
  readonly email: string;
  toObject(): {
    id: number | bigint;
    name: string;
    email: string;
  };
  pick<K extends "id" | "name" | "email">(names: K[]): { [P in K]: this[P] };
  readonly access: { readonly [P in "id" | "name" | "email"]: undefined };
  apply(): Partial<{ [P in "id" | "name" | "email"]: this[P] }>;
}

export declare function openProfile(cpp: CapnCpp, bytes: Uint8Array): ProfileReader;
