// Generated from interop.capnp by capnwasm-gen. Do not edit by hand.

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

export declare class AllTypesReader {
  constructor(cpp: CapnCpp);
  readonly boolField: boolean;
  readonly int8Field: number;
  readonly int16Field: number;
  readonly int32Field: number;
  readonly int64Field: number | bigint;
  readonly uint8Field: number;
  readonly uint16Field: number;
  readonly uint32Field: number;
  readonly uint64Field: number | bigint;
  readonly float32Field: number;
  readonly float64Field: number;
  readonly textField: string;
  readonly dataField: Uint8Array;
  readonly enumField: number;
  readonly boolList: { readonly length: number; at(i: number): boolean | undefined; [Symbol.iterator](): IterableIterator<boolean> };
  readonly int32List: { readonly length: number; at(i: number): number | undefined; view(): Int32Array; [Symbol.iterator](): IterableIterator<number> };
  readonly uint64List: { readonly length: number; at(i: number): number | bigint | undefined; view(): BigUint64Array; [Symbol.iterator](): IterableIterator<number | bigint> };
  readonly float64List: { readonly length: number; at(i: number): number | undefined; view(): Float64Array; [Symbol.iterator](): IterableIterator<number> };
  readonly textList: { readonly length: number; at(i: number): string | undefined; [Symbol.iterator](): IterableIterator<string> };
  readonly nested: TagReader;
  readonly tagList: { readonly length: number; at(i: number): TagReader | undefined; [Symbol.iterator](): IterableIterator<TagReader> };
  toObject(): {
    boolField: boolean;
    int8Field: number;
    int16Field: number;
    int32Field: number;
    int64Field: number | bigint;
    uint8Field: number;
    uint16Field: number;
    uint32Field: number;
    uint64Field: number | bigint;
    float32Field: number;
    float64Field: number;
    textField: string;
    dataField: Uint8Array;
    enumField: number;
    boolList: { readonly length: number; at(i: number): boolean | undefined; [Symbol.iterator](): IterableIterator<boolean> };
    int32List: { readonly length: number; at(i: number): number | undefined; view(): Int32Array; [Symbol.iterator](): IterableIterator<number> };
    uint64List: { readonly length: number; at(i: number): number | bigint | undefined; view(): BigUint64Array; [Symbol.iterator](): IterableIterator<number | bigint> };
    float64List: { readonly length: number; at(i: number): number | undefined; view(): Float64Array; [Symbol.iterator](): IterableIterator<number> };
    textList: { readonly length: number; at(i: number): string | undefined; [Symbol.iterator](): IterableIterator<string> };
    nested: TagReader;
    tagList: { readonly length: number; at(i: number): TagReader | undefined; [Symbol.iterator](): IterableIterator<TagReader> };
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class InteropMessageReader {
  constructor(cpp: CapnCpp);
  readonly payload: AllTypesReader;
  readonly ordinal: number;
  toObject(): {
    payload: AllTypesReader;
    ordinal: number;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare function openTag(cpp: CapnCpp, bytes: Uint8Array): TagReader;
export declare function openTagUnsafe(cpp: CapnCpp, bytes: Uint8Array): TagReader;
