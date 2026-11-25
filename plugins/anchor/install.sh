#!/usr/bin/env bash
# Vendor anchor into a repo: install.sh /path/to/repo [--board N] [--owner O]
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:?usage: install.sh /path/to/repo [--board N] [--owner O]}"; shift || true
[ -d "$TARGET/.git" ] || { echo "install: $TARGET is not a git repo" >&2; exit 1; }
mkdir -p "$TARGET/.anchor/bin"
cp "$SRC/bin/anchor" "$TARGET/.anchor/bin/anchor"
chmod +x "$TARGET/.anchor/bin/anchor"
cd "$TARGET"
./.anchor/bin/anchor init "$@"
./.anchor/bin/anchor doctor
cat <<'TXT'

Vendored to .anchor/bin/anchor — commit it so every clone and every cloud
session has it:

    git add .anchor .anchor.json && git commit -m "chore: vendor anchor state tool"

Optional, so you can type `anchor` instead of `./.anchor/bin/anchor`:

    ln -sf "$PWD/.anchor/bin/anchor" ~/bin/anchor     # if ~/bin is on PATH
TXT
