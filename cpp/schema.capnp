@0xb34bf56f7bc56e5b;

# Schema mirroring our hand-written wire format so the original capnproto
# C++ runtime can serialize/deserialize the same messages.

struct Expression {
  union {
    nullVal @0 :Void;
    boolFalse @1 :Void;
    boolTrue @2 :Void;
    intVal @3 :Int64;
    floatVal @4 :Float64;
    text @5 :Text;
    data @6 :Data;
    array @7 :List(Expression);
    object @8 :List(KeyValue);
    importRef @9 :Int64;
    exportRef @10 :Int64;
    pipeline @11 :PipelineExpr;
    errorVal @12 :ErrorVal;
    date @13 :Float64;
    bigint @14 :Text;
    undefinedVal @15 :Void;
  }
}

struct KeyValue {
  key @0 :Text;
  value @1 :Expression;
}

struct PipelineExpr {
  source @0 :Expression;
  path @1 :List(Text);
  args @2 :Expression;
}

struct ErrorVal {
  type @0 :Text;
  message @1 :Text;
}

struct Message {
  union {
    push @0 :Expression;
    pull @1 :Int64;
    resolve @2 :ResolveReject;
    reject @3 :ResolveReject;
    release @4 :Release;
    stream @5 :Expression;
    abort @6 :Expression;
    pipe @7 :Void;
  }
}

struct ResolveReject {
  id @0 :Int64;
  expr @1 :Expression;
}

struct Release {
  id @0 :Int64;
  refcount @1 :UInt32;
}
