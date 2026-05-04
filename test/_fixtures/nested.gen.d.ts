// Generated from nested.capnp by capnwasm-gen. Do not edit by hand.

import type { CapnCpp } from "capnwasm";

export declare class TagReader {
  constructor(cpp: CapnCpp);
  readonly name: string;
  readonly weight: number;
  toObject(): {
    name: string;
    weight: number;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class CommentReader {
  constructor(cpp: CapnCpp);
  readonly author: string;
  readonly body: string;
  readonly replies: { readonly length: number; at(i: number): CommentReader | undefined; [Symbol.iterator](): IterableIterator<CommentReader> };
  toObject(): {
    author: string;
    body: string;
    replies: { readonly length: number; at(i: number): CommentReader | undefined; [Symbol.iterator](): IterableIterator<CommentReader> };
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class PostMetaReader {
  constructor(cpp: CapnCpp);
  readonly views: number;
  readonly category: string;
  readonly parent: PostMetaParentReader;
  toObject(): {
    views: number;
    category: string;
    parent: PostMetaParentReader;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class PostReader {
  constructor(cpp: CapnCpp);
  readonly title: string;
  readonly author: string;
  readonly tags: { readonly length: number; at(i: number): TagReader | undefined; [Symbol.iterator](): IterableIterator<TagReader> };
  readonly comments: { readonly length: number; at(i: number): CommentReader | undefined; [Symbol.iterator](): IterableIterator<CommentReader> };
  readonly meta: PostMetaReader;
  toObject(): {
    title: string;
    author: string;
    tags: { readonly length: number; at(i: number): TagReader | undefined; [Symbol.iterator](): IterableIterator<TagReader> };
    comments: { readonly length: number; at(i: number): CommentReader | undefined; [Symbol.iterator](): IterableIterator<CommentReader> };
    meta: PostMetaReader;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare class PostMetaParentReader {
  constructor(cpp: CapnCpp);
  readonly parentId: number | bigint;
  readonly label: string;
  toObject(): {
    parentId: number | bigint;
    label: string;
  };
  draft<T>(fn: (draft: any) => T): T;
}

export declare function openTag(cpp: CapnCpp, bytes: Uint8Array): TagReader;
export declare function openTagUnsafe(cpp: CapnCpp, bytes: Uint8Array): TagReader;
