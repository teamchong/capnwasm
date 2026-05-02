@0xa1b2c3d4e5f60001;

# Schema evolution fixture — v2.
# Adds `email` at field number 2. id and name keep their numbers, so v1
# wire bytes parse cleanly with v2 (email defaults to ""), and v2 wire
# bytes parse cleanly with v1 (email is invisible — v1 just doesn't ask).
struct Profile {
  id    @0 :UInt64;
  name  @1 :Text;
  email @2 :Text;   # NEW in v2 — only field added, no renumbering
}
