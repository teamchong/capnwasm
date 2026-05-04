@0xb1a2c3d4e5f60003;

# M3 fixture: deep-nesting and List<Struct> coverage. Used by
# test/m3_slot_pool.test.mjs to exercise the slot pool's stack semantics
# when readers at different depths are alive simultaneously.

struct Tag {
  name   @0 :Text;
  weight @1 :UInt32;
}

struct Comment {
  author  @0 :Text;
  body    @1 :Text;
  replies @2 :List(Comment);   # recursive
}

struct Post {
  title    @0 :Text;
  author   @1 :Text;
  tags     @2 :List(Tag);
  comments @3 :List(Comment);
  meta     @4 :PostMeta;
}

struct PostMeta {
  views    @0 :UInt32;
  category @1 :Text;
  parent   @2 :PostMetaParent;
}

struct PostMetaParent {
  parentId @0 :UInt64;
  label    @1 :Text;
}
