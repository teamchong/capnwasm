// Generated from typed_schema.capnp by capnwasm-gen. Do not edit by hand.

import type { CapnCpp } from "capnwasm";

export declare class WideUserDataReader {
  constructor(cpp: CapnCpp);
  readonly field0: string;
  readonly field1: string;
  readonly field2: string;
  readonly field3: string;
  readonly field4: string;
  readonly field5: string;
  readonly field6: string;
  readonly field7: string;
  readonly field8: string;
  readonly field9: string;
  readonly field10: string;
  readonly field11: string;
  readonly field12: string;
  readonly field13: string;
  readonly field14: string;
  readonly field15: string;
  readonly field16: string;
  readonly field17: string;
  readonly field18: string;
  readonly field19: string;
  readonly field20: string;
  readonly field21: string;
  readonly field22: string;
  readonly field23: string;
  readonly field24: string;
  readonly field25: string;
  readonly field26: string;
  readonly field27: string;
  readonly field28: string;
  readonly field29: string;
  readonly field30: string;
  readonly field31: string;
  toObject(): {
    field0: string;
    field1: string;
    field2: string;
    field3: string;
    field4: string;
    field5: string;
    field6: string;
    field7: string;
    field8: string;
    field9: string;
    field10: string;
    field11: string;
    field12: string;
    field13: string;
    field14: string;
    field15: string;
    field16: string;
    field17: string;
    field18: string;
    field19: string;
    field20: string;
    field21: string;
    field22: string;
    field23: string;
    field24: string;
    field25: string;
    field26: string;
    field27: string;
    field28: string;
    field29: string;
    field30: string;
    field31: string;
  };
  pick<K extends "field0" | "field1" | "field2" | "field3" | "field4" | "field5" | "field6" | "field7" | "field8" | "field9" | "field10" | "field11" | "field12" | "field13" | "field14" | "field15" | "field16" | "field17" | "field18" | "field19" | "field20" | "field21" | "field22" | "field23" | "field24" | "field25" | "field26" | "field27" | "field28" | "field29" | "field30" | "field31">(names: K[]): { [P in K]: this[P] };
  readonly access: { readonly [P in "field0" | "field1" | "field2" | "field3" | "field4" | "field5" | "field6" | "field7" | "field8" | "field9" | "field10" | "field11" | "field12" | "field13" | "field14" | "field15" | "field16" | "field17" | "field18" | "field19" | "field20" | "field21" | "field22" | "field23" | "field24" | "field25" | "field26" | "field27" | "field28" | "field29" | "field30" | "field31"]: undefined };
  apply(): Partial<{ [P in "field0" | "field1" | "field2" | "field3" | "field4" | "field5" | "field6" | "field7" | "field8" | "field9" | "field10" | "field11" | "field12" | "field13" | "field14" | "field15" | "field16" | "field17" | "field18" | "field19" | "field20" | "field21" | "field22" | "field23" | "field24" | "field25" | "field26" | "field27" | "field28" | "field29" | "field30" | "field31"]: this[P] }>;
}

export declare function openWideUserData(cpp: CapnCpp, bytes: Uint8Array): WideUserDataReader;
