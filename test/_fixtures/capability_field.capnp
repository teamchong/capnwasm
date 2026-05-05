@0xc0ffee99c0ffee99;

# Schema with a capability-typed struct field. Outside an RPC context
# the field is null; the codegen surface still has to compile and the
# builder has to accept null without throwing.

interface Greeter {
  hello @0 () -> (msg :Text);
}

struct Visit {
  who    @0 :Text;
  cap    @1 :Greeter;
}
