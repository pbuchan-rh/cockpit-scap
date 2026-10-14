#!/bin/bash
# Deploy dist/ as the two V4.6 checkpoint dev copies (PLAN_V4.6_V3_FLOW.md,
# CHECKPOINT) next to the installed RPM, for the user's own Cockpit:
#
#   ~/.local/share/cockpit/scap-dev/        label "SCAP Security (dev)"            PF default text weight
#   ~/.local/share/cockpit/scap-dev-heavy/  label "SCAP Security (dev, v3 weight)"  v3's heavier text
#
# Both get byte-identical index.js/index.css/etc. The manifests differ only
# in the label; the heavy copy's index.html additionally carries the one
# weight class (ct-weight-v3 on <html>, styles in src/app.scss). Never
# writes ~/.local/share/cockpit/scap/ (that name would shadow the RPM).
#
# Usage: npm run build && tools/deploy-dev-copies.sh [user@host]
set -euo pipefail

TARGET="${1:-pbuchan@scap-test10.beastmode.localdomain}"
cd "$(dirname "$0")/.."
[ -f dist/index.js ] && [ -f dist/manifest.json ] || { echo "dist/ is not built; run npm run build" >&2; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

stage_copy() {
    local name="$1" label="$2" heavy="$3"
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
    if [ "$heavy" = yes ]; then
        sed -i 's/^<html lang="en">/<html lang="en" class="ct-weight-v3">/' "$STAGE/$name/index.html"
        grep -q 'class="ct-weight-v3"' "$STAGE/$name/index.html" || { echo "weight class not applied" >&2; exit 1; }
    fi
}

stage_copy scap-dev "SCAP Security (dev)" no
stage_copy scap-dev-heavy "SCAP Security (dev, v3 weight)" yes

ssh "$TARGET" 'mkdir -p ~/.local/share/cockpit'
for name in scap-dev scap-dev-heavy; do
    rsync -a --delete "$STAGE/$name/" "$TARGET:.local/share/cockpit/$name/"
done
ssh "$TARGET" 'cd ~/.local/share/cockpit && md5sum scap-dev/index.js scap-dev-heavy/index.js && grep -h "\"label\"" scap-dev/manifest.json scap-dev-heavy/manifest.json'
