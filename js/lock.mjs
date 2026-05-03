// Lock file engine: pins capnp `@N` ordinals across schema edits.
//
// The problem (docs/unified-surfaces-design.md §3 + §4 + §6): capnp's
// wire format identifies fields by their `@N` ordinal, not by name. If
// an upstream team renames or reorders a field in their OpenAPI source,
// the naive emit-capnp would assign a new ordinal and silently break
// every consumer's wire compatibility.
//
// The lock file solves this without asking upstream teams to do
// anything: it remembers (per struct, per field name) which `@N` was
// assigned, and persists that assignment in a capnwasm-owned file
// (`capnwasm.lock`) that lives wherever the consumer wants it (their
// SDK repo, their pipeline repo). Operation ordinals (capnp method `@N`
// IDs) are pinned the same way.
//
// Lock file shape (JSON):
//
//   {
//     "lockfileVersion": 1,
//     "manifestSource": "cf-openapi.json",      // for readability only
//     "interfaces": {
//       "<InterfaceName>": {
//         "methods": { "<methodName>": <ordinal> }
//       }
//     },
//     "structs": {
//       "<StructName>": {
//         "fields": { "<fieldName>": <ordinal> },
//         "next":   <next-ordinal-to-assign>     // monotonic; never reused
//       }
//     },
//     "enums": {
//       "<EnumName>": {
//         "values": { "<value>": <ordinal> },
//         "next": <next-ordinal>
//       }
//     }
//   }
//
// Invariant: once an ordinal is assigned to (struct, field), it is
// never reused for a different field, even if the original field is
// removed. Removed fields stay in the lock as a tombstone so a future
// re-add doesn't accidentally collide.

const LOCK_VERSION = 1;

/**
 * Build a fresh lock from a structural inventory. Every member gets a
 * positional ordinal in the order emit-capnp emitted it.
 *
 * @param {object} inventory - { interfaces, structs, enums } shape
 *                             returned by buildCapnp() in `structures`.
 *                             Members may be plain strings (legacy) or
 *                             objects with `{name, type|signature}`.
 * @param {object} [opts]
 * @param {string} [opts.manifestSource]
 * @returns {object} lock file object (JSON-serializable)
 */
export function bootstrapLock(inventory, opts = {}) {
  const out = {
    lockfileVersion: LOCK_VERSION,
    manifestSource: opts.manifestSource ?? "anon",
    interfaces: {},
    structs: {},
    enums: {},
  };
  for (const [name, iface] of Object.entries(inventory.interfaces ?? {})) {
    const methods = {};
    const signatures = {};
    (iface.methods ?? []).forEach((m, idx) => {
      const memberName = memberOf(m);
      methods[memberName] = idx;
      const sig = signatureOf(m);
      if (sig) signatures[memberName] = sig;
    });
    out.interfaces[name] = { methods, signatures, next: (iface.methods ?? []).length };
  }
  for (const [name, s] of Object.entries(inventory.structs ?? {})) {
    const fields = {};
    const signatures = {};
    (s.fields ?? []).forEach((f, idx) => {
      const memberName = memberOf(f);
      fields[memberName] = idx;
      const sig = signatureOf(f);
      if (sig) signatures[memberName] = sig;
    });
    out.structs[name] = { fields, signatures, next: (s.fields ?? []).length };
  }
  for (const [name, e] of Object.entries(inventory.enums ?? {})) {
    const values = {};
    (e.values ?? []).forEach((v, idx) => { values[memberOf(v)] = idx; });
    out.enums[name] = { values, next: (e.values ?? []).length };
  }
  return out;
}

function memberOf(m) {
  return typeof m === "string" ? m : (m?.name ?? "");
}

function signatureOf(m) {
  if (typeof m === "string") return null;
  if (typeof m?.type === "string") return m.type;
  if (typeof m?.signature === "string") return m.signature;
  return null;
}

/**
 * Update an existing lock to cover everything in the new structural
 * inventory. Existing assignments are preserved verbatim. New members
 * get the next available ordinal in their scope. Removed members stay
 * as tombstones so their ordinals are never reused.
 *
 * When `opts.detectRenames` is true, the merger looks for unambiguous
 * rename pairs (one member removed + one new member with matching type
 * signature in the same scope) and transfers the ordinal across instead
 * of tombstone+new. The renames are surfaced in `diff.renames`.
 *
 * @param {object|null} prev - existing lock or null
 * @param {object} inventory - structural inventory from buildCapnp()
 * @param {object} [opts]
 * @param {string} [opts.manifestSource]
 * @param {boolean} [opts.detectRenames=false]
 * @returns {{ lock: object, diff: object }}
 */
export function updateLock(prev, inventory, opts = {}) {
  const next = prev
    ? clone(prev)
    : {
        lockfileVersion: LOCK_VERSION,
        manifestSource: opts.manifestSource ?? "anon",
        interfaces: {},
        structs: {},
        enums: {},
      };
  next.lockfileVersion = LOCK_VERSION;
  if (opts.manifestSource) next.manifestSource = opts.manifestSource;
  if (!next.interfaces) next.interfaces = {};
  if (!next.structs) next.structs = {};
  if (!next.enums) next.enums = {};

  const diff = { added: [], removed: [], renamed: [], unchanged: 0 };

  const merge = (scope, key, members, kind) => {
    if (!next[scope][key]) next[scope][key] = { [kind]: {}, signatures: {}, next: 0 };
    const slot = next[scope][key];
    if (!slot[kind]) slot[kind] = {};
    if (!slot.signatures) slot.signatures = {};
    if (typeof slot.next !== "number") {
      slot.next = Object.values(slot[kind]).reduce((m, n) => Math.max(m, n + 1), 0);
    }

    // Bucket the new inventory's members. `present` maps memberName →
    // signature (used by the rename detector below).
    const present = new Map();
    for (const m of members) {
      present.set(memberOf(m), signatureOf(m));
    }

    // Heuristic rename pass: any (removed, added) pair with matching
    // type signature where both sides have a unique counterpart in the
    // pool gets transferred. Multi-match pairs fall through to
    // tombstone+new (the diff report flags them so a human can decide).
    const renames = new Map();   // newName → oldName
    if (opts.detectRenames) {
      const removedNames = Object.keys(slot[kind]).filter((n) => !present.has(n));
      const addedNames = [...present.keys()].filter((n) => !(n in slot[kind]));

      // Group both sides by signature.
      const removedBySig = bucket(removedNames, (n) => slot.signatures?.[n] ?? null);
      const addedBySig   = bucket(addedNames,   (n) => present.get(n) ?? null);

      for (const [sig, removedList] of removedBySig) {
        if (sig === null) continue;       // can't match without a signature
        const addedList = addedBySig.get(sig) ?? [];
        if (removedList.length === 1 && addedList.length === 1) {
          renames.set(addedList[0], removedList[0]);
        }
      }
    }

    // Apply renames first: move the ordinal + signature from the old
    // name to the new one. The old name disappears entirely (rather
    // than becoming a tombstone) since we're confident it's the same
    // logical member.
    for (const [newName, oldName] of renames) {
      const ord = slot[kind][oldName];
      delete slot[kind][oldName];
      const sig = slot.signatures?.[oldName];
      if (sig !== undefined) delete slot.signatures[oldName];
      slot[kind][newName] = ord;
      const newSig = present.get(newName);
      if (newSig) slot.signatures[newName] = newSig;
      diff.renamed.push(`${scope}.${key}.${kind}.${oldName}→${newName}@${ord}`);
    }

    // Existing-or-new merge.
    for (const [member, sig] of present) {
      if (renames.has(member)) continue;     // handled above
      if (member in slot[kind]) {
        diff.unchanged++;
      } else {
        slot[kind][member] = slot.next++;
        diff.added.push(`${scope}.${key}.${kind}.${member}@${slot[kind][member]}`);
      }
      if (sig) slot.signatures[member] = sig;
    }

    // Tombstone anything that's still in the lock but not in the
    // current inventory and didn't get matched as a rename.
    for (const oldMember of Object.keys(slot[kind])) {
      if (!present.has(oldMember) && !renames.has(oldMember)) {
        // The rename map is keyed by NEW name, so we don't accidentally
        // tombstone an old name that just got remapped. (The rename
        // pass already deleted those entries above.)
        diff.removed.push(`${scope}.${key}.${kind}.${oldMember}@${slot[kind][oldMember]}`);
      }
    }
  };

  for (const [name, iface] of Object.entries(inventory.interfaces ?? {})) {
    merge("interfaces", name, iface.methods ?? [], "methods");
  }
  for (const [name, s] of Object.entries(inventory.structs ?? {})) {
    merge("structs", name, s.fields ?? [], "fields");
  }
  for (const [name, e] of Object.entries(inventory.enums ?? {})) {
    merge("enums", name, e.values ?? [], "values");
  }

  return { lock: next, diff };
}

function bucket(items, keyFn) {
  const out = new Map();
  for (const item of items) {
    const k = keyFn(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}

/**
 * Resolve the ordinal pinned for (scope, name, kind, member). Returns
 * undefined if the lock doesn't pin this entry.
 */
export function lookup(lock, scope, name, kind, member) {
  return lock?.[scope]?.[name]?.[kind]?.[member];
}

// --- IO ---------------------------------------------------------------

export function lockToJson(lock) {
  return JSON.stringify(lock, null, 2) + "\n";
}

function clone(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clone);
  const out = {};
  for (const k of Object.keys(value)) out[k] = clone(value[k]);
  return out;
}
