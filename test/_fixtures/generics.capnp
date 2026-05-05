@0xc0d3a1b2c3d4e5f9;

struct Tag {
  name @0 :Text;
  weight @1 :UInt32;
}

struct Box(T) {
  value @0 :T;
}

struct UseBox {
  textBox @0 :Box(Text);
  tagBox  @1 :Box(Tag);
}
