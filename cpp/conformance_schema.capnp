@0xd2e8f7a4c1b50369;

# Conformance fixture: every primitive Cap'n Proto type. Each field's value
# is checked from JS against a known-good encoding produced by either our
# own builder or upstream `capnp encode`.

struct Primitives {
  # Integers — boundary values matter.
  u8     @0  :UInt8;
  u16    @1  :UInt16;
  u32    @2  :UInt32;
  u64    @3  :UInt64;
  i8     @4  :Int8;
  i16    @5  :Int16;
  i32    @6  :Int32;
  i64    @7  :Int64;

  # Floats — special cases (NaN, ±Inf, -0, denormals).
  f32    @8  :Float32;
  f64    @9  :Float64;

  # Bool — bit-level packing edge case.
  flag0  @10 :Bool;
  flag1  @11 :Bool;
  flag2  @12 :Bool;

  # Pointer types.
  text       @13 :Text;
  data       @14 :Data;
  emptyText  @15 :Text;
  emptyData  @16 :Data;
}
