// Example: TypeScript interface input for capnwasm.
//
// Run:  npx capnwasm gen example_user.ts -o example_user.gen.mjs
//
// JS-faithful type mapping by default (`number` -> Float64). Override with
// a `// @capnp Type` directive on the line above the field.

export interface User {
  // @capnp UInt64
  id: number;
  // @capnp UInt32
  age: number;
  active: boolean;
  name: string;
  email: string;
  bio: string;
}

export interface Greeting {
  message: string;
  // @capnp UInt64
  timestamp: number;
}
