// Two-pane chat orchestrator. One input box + one send button at the
// top; pressing send fires post() on capnwasm AND capnweb in parallel
// via Promise.all. The transport toggle (WebSocket / REST) applies to
// both panes; switching tears down both panes and rebuilds them in the
// new mode so a single click reconnects both libraries simultaneously.
//
// The chat room state (one DurableObject) is shared across all four
// endpoints, so a post on either library appears in both panes
// regardless of the transport mode either pane is using.

import { setupCapnwasmPane, type ChatPaneHandle, type ChatTransport } from "./capnwasm-pane.ts";
import { setupCapnwebPane } from "./capnweb-pane.ts";

const $ = (id: string) => document.getElementById(id)!;

const inputAuthor = $("author") as HTMLInputElement;
inputAuthor.value = localStorage.getItem("chat-author") || `guest-${Math.floor(Math.random() * 1000)}`;
inputAuthor.addEventListener("change", () => localStorage.setItem("chat-author", inputAuthor.value));
const getAuthor = () => inputAuthor.value.trim() || "anon";

const inputText = $("text") as HTMLInputElement;
const sendButton = $("send") as HTMLButtonElement;
const form = $("form") as HTMLFormElement;
const transportRadios = document.querySelectorAll<HTMLInputElement>('input[name="transport"]');

let mode: ChatTransport = "ws";

let panes: { capnwasm: ChatPaneHandle | null; capnweb: ChatPaneHandle | null } = {
  capnwasm: null,
  capnweb: null,
};

async function rebuildPanes() {
  const oldCapnwasm = panes.capnwasm;
  const oldCapnweb = panes.capnweb;
  panes = { capnwasm: null, capnweb: null };
  if (oldCapnwasm) oldCapnwasm.destroy();
  if (oldCapnweb)  oldCapnweb.destroy();

  const [capnwasm, capnweb] = await Promise.all([
    setupCapnwasmPane({
      logEl:    $("log-capnwasm"),
      statusEl: $("status-capnwasm"),
      mode,
    }).catch((err) => {
      const status = $("status-capnwasm");
      status.textContent = "Failed: " + (err instanceof Error ? err.message : String(err));
      status.classList.add("error");
      return null;
    }),
    setupCapnwebPane({
      logEl:    $("log-capnweb"),
      statusEl: $("status-capnweb"),
      mode,
    }).catch((err) => {
      const status = $("status-capnweb");
      status.textContent = "Failed: " + (err instanceof Error ? err.message : String(err));
      status.classList.add("error");
      return null;
    }),
  ]);

  panes.capnwasm = capnwasm;
  panes.capnweb = capnweb;
}

for (const r of transportRadios) {
  r.addEventListener("change", async () => {
    if (!r.checked) return;
    mode = r.value === "rest" ? "rest" : "ws";
    sendButton.disabled = true;
    await rebuildPanes();
    sendButton.disabled = false;
    inputText.focus();
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const author = getAuthor();
  const text = inputText.value.trim();
  if (!text) return;
  inputText.value = "";

  // Send via both libraries in parallel — the demo's whole point.
  // Each post hits its own server-side handler (capnwasm RPC vs
  // capnweb RPC), the DO appends two distinct messages, and both
  // panes' subscribe streams (or polls) replay both copies. Two rows
  // per click is intentional: it shows both libraries actually
  // transmitting.
  const errors: string[] = [];
  await Promise.all([
    panes.capnwasm?.post(author, text).catch((err) => {
      errors.push("capnwasm: " + (err instanceof Error ? err.message : String(err)));
    }),
    panes.capnweb?.post(author, text).catch((err) => {
      errors.push("capnweb: " + (err instanceof Error ? err.message : String(err)));
    }),
  ]);

  if (errors.length > 0) {
    const status = $("send-status");
    status.textContent = errors.join(" · ");
    status.classList.add("error");
    setTimeout(() => { status.textContent = ""; status.classList.remove("error"); }, 4000);
  } else {
    const status = $("send-status");
    status.textContent = "server replied: capnwasm + capnweb";
    status.classList.remove("error");
    setTimeout(() => { status.textContent = ""; }, 2000);
  }
});

await rebuildPanes();
sendButton.disabled = false;
inputText.focus();
