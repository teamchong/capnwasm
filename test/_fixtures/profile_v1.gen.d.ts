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
  draft<T>(fn: (draft: any) => T): T;
}

export declare function openProfile(cpp: CapnCpp, bytes: Uint8Array): ProfileReader;
export declare function openProfileUnsafe(cpp: CapnCpp, bytes: Uint8Array): ProfileReader;
