// Generated from chat.capnp by capnwasm-gen. Do not edit by hand.

import type { CapnCpp } from "capnwasm";

export declare class PostParamsReader {
  constructor(cpp: CapnCpp);
  readonly author: string;
  readonly text: string;
  toObject(): {
    author: string;
    text: string;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class ChatMessageReader {
  constructor(cpp: CapnCpp);
  readonly id: number | bigint;
  readonly author: string;
  readonly text: string;
  readonly ts: number | bigint;
  readonly image: Uint8Array;
  toObject(): {
    id: number | bigint;
    author: string;
    text: string;
    ts: number | bigint;
    image: Uint8Array;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class GetSinceParamsReader {
  constructor(cpp: CapnCpp);
  readonly since: number | bigint;
  toObject(): {
    since: number | bigint;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class ChatMessageListReader {
  constructor(cpp: CapnCpp);
  readonly items: { readonly length: number; at(i: number): ChatMessageReader | undefined; [Symbol.iterator](): IterableIterator<ChatMessageReader> };
  toObject(): {
    items: { readonly length: number; at(i: number): ChatMessageReader | undefined; [Symbol.iterator](): IterableIterator<ChatMessageReader> };
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare function openPostParams(cpp: CapnCpp, bytes: Uint8Array): PostParamsReader;
export declare function openPostParamsUnsafe(cpp: CapnCpp, bytes: Uint8Array): PostParamsReader;
