// Generated from profile_v1.capnp by capnwasm-gen. Do not edit by hand.

import type { CapnCpp } from "capnwasm";

export declare class ProfileReader {
  constructor(cpp: CapnCpp);
  readonly id: number | bigint;
  readonly name: string;
  toObject(): {
    id: number | bigint;
    name: string;
  };
  pick<K extends "id" | "name">(names: K[]): { [P in K]: this[P] };
  readonly access: { readonly [P in "id" | "name"]: undefined };
  apply(): Partial<{ [P in "id" | "name"]: this[P] }>;
}

export declare function openProfile(cpp: CapnCpp, bytes: Uint8Array): ProfileReader;
