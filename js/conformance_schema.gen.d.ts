// Generated from conformance_schema.capnp by capnwasm-gen — do not edit by hand.

import type { CapnCpp } from "capnwasm";

export declare class PrimitivesReader {
  constructor(cpp: CapnCpp);
  readonly u8: number;
  readonly u16: number;
  readonly u32: number;
  readonly u64: number | bigint;
  readonly i8: number;
  readonly i16: number;
  readonly i32: number;
  readonly i64: number | bigint;
  readonly f32: number;
  readonly f64: number;
  readonly flag0: boolean;
  readonly flag1: boolean;
  readonly flag2: boolean;
  readonly text: string;
  readonly data: Uint8Array;
  readonly emptyText: string;
  readonly emptyData: Uint8Array;
  toObject(): {
    u8: number;
    u16: number;
    u32: number;
    u64: number | bigint;
    i8: number;
    i16: number;
    i32: number;
    i64: number | bigint;
    f32: number;
    f64: number;
    flag0: boolean;
    flag1: boolean;
    flag2: boolean;
    text: string;
    data: Uint8Array;
    emptyText: string;
    emptyData: Uint8Array;
  };
}

export declare function openPrimitives(cpp: CapnCpp, bytes: Uint8Array): PrimitivesReader;
