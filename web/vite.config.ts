import { defineConfig } from "vite";
import { resolve } from "node:path";
// @ts-ignore — JS module without a .d.ts file.
import { rpcDevServer } from "./vite-rpc-server.mjs";
// @ts-ignore — local plugin from the parent capnwasm package.
import { capnwasm } from "../js/vite-plugin.mjs";

// Multi-page Vite site: a landing page and the live perf playground.
// Pages are wired up in rollupOptions.input so the build emits both.
export default defineConfig(({ command }) => ({
  // For local dev / playwright tests we serve from "/". For a published
  // GitHub Pages deploy, set base to "/capnwasm/" via env or a CI flag.
  base: "/",
  plugins: [
    // Codegen plugin: regenerates web/users.capnp → web/src/playground/users.gen.mjs
    // on save in dev, and on build. Means we don't have to commit the
    // generated file or call `npx capnwasm gen` manually.
    capnwasm({
      schemas: ["users.capnp"],
      outDir: "src/playground",
      extension: ".gen.mjs",
    }),
    rpcDevServer(),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        playground: resolve(__dirname, "playground.html"),
        rpc: resolve(__dirname, "rpc.html"),
        chat: resolve(__dirname, "chat.html"),
        honest: resolve(__dirname, "honest.html"),
        inspect: resolve(__dirname, "inspect.html"),
        notes: resolve(__dirname, "notes.html"),
      },
    },
  },
  server: {
    port: 5173,
    fs: {
      // Allow Vite to serve files from the parent capnwasm dir so the
      // playground can `import "../../js/rpc.mjs"` directly during dev.
      // Production builds resolve everything through the bundler instead.
      allow: [resolve(__dirname, ".."), __dirname],
    },
  },
}));
