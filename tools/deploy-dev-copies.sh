#!/bin/bash
# Deploy dist/ as the V4.6 dev copy next to the installed RPM, for the
# user's own Cockpit:
#
#   ~/.local/share/cockpit/scap-dev/  label "SCAP Security (dev)"
#
# Only the manifest label differs from dist/. Never writes
# ~/.local/share/cockpit/scap/ (that name would shadow the RPM).
#
# Usage: npm run build && tools/deploy-dev-copies.sh [user@host]
set -euo pipefail

TARGET="${1:-pbuchan@scap-test10.beastmode.localdomain}"
cd "$(dirname "$0")/.."
[ -f dist/index.js ] && [ -f dist/manifest.json ] || { echo "dist/ is not built; run npm run build" >&2; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

stage_copy() {
    local name="$1" label="$2"
    [ "$name" != "scap" ] || { echo "refusing to deploy as 'scap' (shadows the RPM)" >&2; exit 1; }
    mkdir -p "$STAGE/$name"
    cp -a dist/. "$STAGE/$name/"
    python3 -I - "$STAGE/$name/manifest.json" "$label" <<'PY'
import json, sys
path, label = sys.argv[1], sys.argv[2]
with open(path) as f:
    m = json.load(f)
m["tools"]["index"]["label"] = label
with open(path, "w") as f:
    json.dump(m, f, indent=4)
    f.write("\n")
PY
}

stage_copy scap-dev "SCAP Security (dev)"

ssh "$TARGET" 'mkdir -p ~/.local/share/cockpit'
rsync -a --delete "$STAGE/scap-dev/" "$TARGET:.local/share/cockpit/scap-dev/"
ssh "$TARGET" 'cd ~/.local/share/cockpit && md5sum scap-dev/index.js && grep -h "\"label\"" scap-dev/manifest.json'
