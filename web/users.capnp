# Demo schema for the playground bench. Single-User shape because the
# playground bench fetches many records in parallel — that's closer to
# what a real list view does in practice (one /api/user/:id per row,
# rendered as soon as each arrives) than a single big LIST response.
@0xb9d0a4e5d4f6e1c9;

struct User {
  id @0 :UInt64;
  name @1 :Text;
  email @2 :Text;
  joinedAtMs @3 :UInt64;
  active @4 :Bool;
  avatar @5 :Data;
}
