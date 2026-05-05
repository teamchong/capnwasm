@0xc1f2e3d4a5b69788;

enum Color {
  red    @0;
  green  @1;
  blue   @2;
  yellow @3;
}

struct Tag {
  name   @0 :Text;
  weight @1 :UInt32;
}

struct AllTypes {
  # primitives
  boolField    @0  :Bool;
  int8Field    @1  :Int8;
  int16Field   @2  :Int16;
  int32Field   @3  :Int32;
  int64Field   @4  :Int64;
  uint8Field   @5  :UInt8;
  uint16Field  @6  :UInt16;
  uint32Field  @7  :UInt32;
  uint64Field  @8  :UInt64;
  float32Field @9  :Float32;
  float64Field @10 :Float64;
  textField    @11 :Text;
  dataField    @12 :Data;
  enumField    @13 :Color;

  # primitive lists
  boolList    @14 :List(Bool);
  int32List   @15 :List(Int32);
  uint64List  @16 :List(UInt64);
  float64List @17 :List(Float64);
  textList    @18 :List(Text);

  # nested + list-of-struct
  nested  @19 :Tag;
  tagList @20 :List(Tag);
}

struct InteropMessage {
  payload @0 :AllTypes;
  ordinal @1 :UInt32;
}
