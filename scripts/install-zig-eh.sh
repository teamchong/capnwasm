#!/bin/bash
# Install zig 0.17.0-dev for capnwasm wasm rebuilds.
#
# Why we ship a custom installer: capnwasm's schema-compiler wasm-EH support
# (cpp/build_capnpc.sh -> cpp/build_eh_runtime.sh) needs zig 0.17+ for
# wasm-ld to resolve the `__cpp_exception` wasm tag. zig 0.16 can't link
# real wasm-EH.
# zig 0.17 isn't a stable release yet, so mise's zig plugin doesn't
# track it and `mise install zig@0.17` doesn't work. Until 0.17 ships
# stable + mise picks it up, this script handles the installation
# explicitly.
#
# What it does:
#   1. Downloads the zig 0.17.0-dev nightly tarball for your platform.
#   2. Verifies the SHA-256 against the value baked into this script.
#   3. Extracts to ~/.local/share/capnwasm-zig/<version>/.
#   4. Drops a symlink at .capnwasm-zig pointing at the install dir.
#      cpp/build.sh + cpp/build_capnpc.sh look there before falling
#      back to whichever zig is on PATH, so no env-var management.
#   5. Re-runs the four wasm builds (slim, capnpc, inlined, codegen).
#
# Re-running the script is safe: existing installs are reused.
#
# Usage:
#   bash scripts/install-zig-eh.sh           # install + build everything
#   bash scripts/install-zig-eh.sh --no-build # just install, don't rebuild
#   bash scripts/install-zig-eh.sh --upgrade # force re-download

set -e
cd "$(dirname "$0")/.."

ZIG_VERSION="0.17.0-dev.251+0db721ec2"

# Per-platform tarball + sha256. From https://ziglang.org/download/index.json.
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64)
    ZIG_PLATFORM="aarch64-macos"
    ZIG_SHA="d7b965b5b5479f4759247aef56132919543eccc97a2be60002a4c684f33cbc98"
    ;;
  Darwin/x86_64)
    ZIG_PLATFORM="x86_64-macos"
    ZIG_SHA="860c1a7485c114de3e140c5ca0e9276872b60a5218d797a01cf2a2ba2438684b"
    ;;
  Linux/aarch64)
    ZIG_PLATFORM="aarch64-linux"
    ZIG_SHA="3708dd43449acc05cc558a36339600b85303161e305ae5bee37812463db19e2f"
    ;;
  Linux/x86_64)
    ZIG_PLATFORM="x86_64-linux"
    ZIG_SHA="6199ec7483d0a628cb3ebe4ff28ac0ac6cbc6d732a2b93a365312c4899cc526a"
    ;;
  *)
    echo "[install-zig-eh.sh] error: unsupported platform $(uname -s)/$(uname -m)" >&2
    echo "[install-zig-eh.sh]   (zig 0.17 nightly only ships aarch64/x86_64 macos+linux)" >&2
    exit 1
    ;;
esac

ZIG_DIRNAME="zig-${ZIG_PLATFORM}-${ZIG_VERSION}"
ZIG_TARBALL="${ZIG_DIRNAME}.tar.xz"
ZIG_URL="https://ziglang.org/builds/${ZIG_TARBALL}"

INSTALL_ROOT="${HOME}/.local/share/capnwasm-zig"
INSTALL_DIR="${INSTALL_ROOT}/${ZIG_DIRNAME}"
LOCAL_LINK=".capnwasm-zig"

UPGRADE=0
NO_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --upgrade) UPGRADE=1 ;;
    --no-build) NO_BUILD=1 ;;
    *) echo "[install-zig-eh.sh] unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [ "$UPGRADE" = "1" ] && [ -d "$INSTALL_DIR" ]; then
  echo "[install-zig-eh.sh] --upgrade: removing $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
fi

if [ ! -x "$INSTALL_DIR/zig" ]; then
  mkdir -p "$INSTALL_ROOT"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  echo "[install-zig-eh.sh] downloading $ZIG_URL"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$ZIG_URL" -o "$TMP/$ZIG_TARBALL"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$ZIG_URL" -O "$TMP/$ZIG_TARBALL"
  else
    echo "[install-zig-eh.sh] error: need curl or wget on PATH" >&2
    exit 1
  fi

  echo "[install-zig-eh.sh] verifying sha256"
  ACTUAL_SHA="$(shasum -a 256 "$TMP/$ZIG_TARBALL" | awk '{print $1}')"
  if [ "$ACTUAL_SHA" != "$ZIG_SHA" ]; then
    echo "[install-zig-eh.sh] error: sha256 mismatch" >&2
    echo "  expected: $ZIG_SHA" >&2
    echo "  got:      $ACTUAL_SHA" >&2
    exit 1
  fi

  echo "[install-zig-eh.sh] extracting to $INSTALL_ROOT"
  tar -xf "$TMP/$ZIG_TARBALL" -C "$INSTALL_ROOT"
fi

# Verify install
if [ ! -x "$INSTALL_DIR/zig" ]; then
  echo "[install-zig-eh.sh] error: $INSTALL_DIR/zig not found after install" >&2
  exit 1
fi

INSTALLED_VERSION="$("$INSTALL_DIR/zig" version)"
echo "[install-zig-eh.sh] zig $INSTALLED_VERSION ready at $INSTALL_DIR"
echo "[install-zig-eh.sh]   bundled clang: $("$INSTALL_DIR/zig" c++ --version | head -1)"

# Drop a per-repo symlink so cpp/build*.sh can find it without
# depending on the user's PATH or env vars.
ln -sfn "$INSTALL_DIR" "$LOCAL_LINK"
# Ignore the symlink in git
if ! grep -q '^\.capnwasm-zig$' .gitignore 2>/dev/null; then
  echo ".capnwasm-zig" >> .gitignore
fi

if [ "$NO_BUILD" = "1" ]; then
  echo "[install-zig-eh.sh] --no-build: skipping wasm rebuilds"
  echo "[install-zig-eh.sh] to rebuild manually:"
  echo "  ZIG_BIN=$INSTALL_DIR/zig bash cpp/build.sh"
  echo "  ZIG_BIN=$INSTALL_DIR/zig bash cpp/build_capnpc.sh"
  exit 0
fi

# Run the four wasm builds end-to-end.
export ZIG_BIN="$INSTALL_DIR/zig"
echo
echo "[install-zig-eh.sh] === building cpp/build_eh_runtime.sh ==="
bash cpp/build_eh_runtime.sh
echo
echo "[install-zig-eh.sh] === building cpp/build.sh (slim runtime) ==="
bash cpp/build.sh
echo
echo "[install-zig-eh.sh] === building cpp/build_capnpc.sh (compiler) ==="
bash cpp/build_capnpc.sh
echo
echo "[install-zig-eh.sh] === inlining JS bundles ==="
node js/build_inlined.mjs
node js/build_codegen_inlined.mjs
echo
echo "[install-zig-eh.sh] done. dist/ is up to date with the local source tree."
