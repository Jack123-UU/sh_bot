#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="${1:-.}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "[fix] Repo root: $(cd "$REPO_ROOT" && pwd)"
node "$SCRIPT_DIR/apply_all.js" "$REPO_ROOT"
