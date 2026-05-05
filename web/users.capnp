# Demo schema for the playground bench. Single-User shape because the
# playground bench fetches many records in parallel — that's closer to
# what a real list view does in practice (one /api/user/:id per row,
# rendered as soon as each arrives) than a single big LIST response.
#
# UserList wraps a List(User) for the render-bench page, which sends the
# whole list in one RPC response so the bench measures the realistic "one
# query → render N rows" path instead of N parallel small requests.
@0xb9d0a4e5d4f6e1c9;

struct User {
  id @0 :UInt64;
  name @1 :Text;
  email @2 :Text;
  joinedAtMs @3 :UInt64;
  active @4 :Bool;
  avatar @5 :Data;
}

struct UserList {
  users @0 :List(User);
}

# CountParams is the params shape for getUserList(count) / getBlob(size).
# A single UInt32 in a struct so the bench can use the codegen builder
# rather than hand-building a frame.
struct CountParams {
  n @0 :UInt32;
}

# Single-Data wrapper for the binary blob round-trip workload. The
# bench echoes a Uint8Array; this is what carries it.
struct BlobReply {
  data @0 :Data;
}

struct NumericProbe {
  f64s @0 :List(Float64);
}
