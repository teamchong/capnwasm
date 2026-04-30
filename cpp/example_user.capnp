@0xc7a4d2e3f5067891;

# Example schema demonstrating richer types — used to verify capnwasm-gen
# emits valid bindings for primitive integers + Text fields together.

struct User {
  id        @0  :UInt64;
  age       @1  :UInt32;
  active    @2  :Bool;
  name      @3  :Text;
  email     @4  :Text;
  bio       @5  :Text;
}

struct Greeting {
  message   @0  :Text;
  timestamp @1  :UInt64;
}
