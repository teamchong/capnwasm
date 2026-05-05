@0xfeedfacefeedfaceaa;

# End-to-end RPC capability through a struct field. The Greeter cap is
# embedded inside the response struct; the client unwraps it and invokes
# .hello() on the embedded cap to verify the cap-table threading works.

interface Greeter {
  hello @0 () -> (msg :Text);
}

struct Greeting {
  who    @0 :Text;
  cap    @1 :Greeter;
}

interface Lobby {
  greet      @0 (who :Text) -> (greeting :Greeting);
  # Inbound capability through a struct param: client passes a Greeter
  # embedded inside Greeting.cap, server invokes hello() on it.
  useCap     @1 (greeting :Greeting) -> (echoed :Text);
}
