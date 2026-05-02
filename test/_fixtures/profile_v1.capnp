@0xa1b2c3d4e5f60001;

# Schema evolution fixture — v1.
# Two fields. v2 adds a third without changing field numbers.
struct Profile {
  id   @0 :UInt64;
  name @1 :Text;
}
