# V4.3 Scope: Uploaded Content Restoration

Status: **planning only — no code written yet.** This document defines scope and
architecture for the next build session. Do not start implementation until this
plan has been reviewed and approved.

## Why

Content library (upload/manage extra SDS files beyond auto-detected SSG) was
one of six feature cuts tracked and accepted when the v4.0 rewrite shipped,
then explicitly deferred a second time in `PLAN_V4.1_TAILORING.md` ("prove the
homedir-state mechanism on tailoring alone, ship it, get real usage, then
decide"). V4.1 and V4.2 both shipped and got real usage.

The motivating problem isn't "bring back the old Content tab" — it's that
`lib/oscap.js`'s `detectContent()` is the **only** source of content for every
picker in the app (`find /usr/share/xml/scap/ssg/content -name '*-ds.xml'`,
a fixed system directory), so the Policy Tailoring editor can only tailor
whatever SSG content the system already has installed. There is currently no
way to bring a vendor-supplied or custom-built datastream into the tailoring
picker at all. Restoring just enough upload capability to unblock that is
V4.3's scope.

## Scope boundary

**IN — the only thing V4.3 builds:**
- Upload a `.xml` SCAP datastream to a per-user store, validated with
  `oscap ds sds-validate` at upload time.
- `detectContent()` extended to list both SSG system content and the user's
  uploaded content, tagged by source, so all three existing pickers
  (`ScanSetup.jsx`, `TailoringEditor.jsx`, `TailoringList.jsx`) see uploaded
  content without reimplementing detection.
- A minimal list of the user's uploaded content with a Delete action
  (confirmation modal, matching this repo's established delete convention).
- Filename collision handling (confirm-replace), matching old `main`'s flow.

**OUT permanently:**
- Activity-log integration (`appendActivityLog()` calls throughout old
  `main`'s content code) — activity log itself is permanently cut, not being
  resurrected for this.
- `.xml.gz` upload support — see "Deviations from old `main`" below; dropped
  outright rather than carried forward broken.
- The full old Content Library surface: browsable combined system+user list
  with disk-usage meter, per-file "Validate" re-check button for files
  already saved, `SDS_DISPLAY_NAMES` hardcoded friendly-name map. V4.3 builds
  only enough to unblock tailoring (upload + list-for-picker + delete +
  validate-on-upload), not a management console. If the minimal delete-list
  card below turns out to need more than that to be usable, that's flagged as
  an open question, not silently expanded.

**Not reconsidered here, carried over as-is from V4.1/V4.2:** per-user-private
storage (no cross-user sharing, no `flock`), no retention/pruning policy.

## State model

Follows the pattern proven and shipped in V4.1 (`lib/tailoring.js`) and V4.2
(`lib/scanHistory.js`) — reuse directly, do not invent a new one:

- `~/SCAP/content/` — sibling to `~/SCAP/tailoring/` and `~/SCAP/scans/`.
  Visible homedir path, not a dotfile.
- Per-user private, same reasoning as tailoring/scans: `chmod 700` on the
  directory, `chmod 600` on files. This **tightens** vs. old `main`'s
  `chmod 644` (`/var/lib/cockpit-scap/content/` was a shared system path;
  homedir-private data has no reason to be world-readable — same argument
  already made twice in this repo's prior two plans).
- SELinux: already confirmed for this exact pattern (live `sesearch`/`seinfo`
  on `cockpit-bootc-test`, referenced in both V4.1 and V4.2) —
  `cockpit_session_t` has full CRUD on `user_home_type` with correct default
  type-transition labeling. This is the same directory tree tailoring and
  scans already write to; **no new SELinux investigation needed**, just
  confirming the existing finding covers it.
- **No JSON sidecar.** Unlike tailoring (which must persist rule/value deltas
  that aren't derivable from the XCCDF alone) and scans (which persist a
  parsed score/pass-fail summary), an uploaded SDS is self-describing —
  `oscap info <path>` (already used by `getProfiles()`) and `oscap ds
  sds-validate` work directly against the raw file with nothing extra to
  track. The list view's Created/size columns come from `stat` at list time,
  not a manifest. This is a deliberate simplification relative to the
  tailoring/scan-history precedent, not an oversight.
- **Filename is the original (sanitized) name, not a timestamp-prefixed
  one.** Tailoring and scan-history both timestamp every save because each
  save is a new, distinct entity. A content upload is different: re-uploading
  `acme-datastream.xml` is logically "replace this same file," so the
  filename must stay stable for the collision-detection flow (below) to mean
  anything. This matches old `main`'s `CONTENT_BASE + file.name` exactly.

## Reference implementation (old `main`)

Old `main`'s content code (`src/settings.js` — `uploadContent()` ~line 208,
`doWriteContent()` ~line 250, `validateContent()` ~line 511, `deleteUserContent()`
~line 195) is a working reference for mechanics, with two real problems worth
fixing rather than porting forward:

- **Filename safety (keep as-is):** reject names containing `/` or `..`.
  Extension allowlist — **narrowed** to `.xml` only, see below.
- **Collision handling (keep the shape):** before writing, `stat` the
  destination path; if it exists, show a confirm modal ("`file.name` already
  exists (`X` MB, `date`). Replace with new file (`Y` MB)?") before
  overwriting. Port this shape onto the homedir path and this repo's PF6
  `Modal` component (not old `main`'s hand-rolled `showConfirmModal`).
- **Validation (keep the tool, change the timing):** `oscap ds sds-validate
  <path>` is the right check — already proven, already used elsewhere in this
  codebase. Old `main` ran it **post-hoc**, as an on-demand "✓ Valid / ✗
  Invalid" button next to files already sitting in the library. V4.3 changes
  this to a **pre-save gate** — see Decision 3 below.

**Two problems in old `main`'s upload path that must not be carried
forward:**

1. **`doWriteContent()` always used `reader.readAsText(file)`**, even though
   the extension allowlist permitted `.xml.gz` (a gzip binary). Reading
   binary data as text mangles it via encoding conversion — this path was
   very likely never actually exercised with a real `.xml.gz` upload, or it
   would have produced a corrupt file every time. `detectContent()`'s own
   `find ... -name '*-ds.xml'` filter doesn't match `.gz` either, so
   `.xml.gz` was already inconsistent with what auto-detection could ever
   find. **V4.3 drops `.xml.gz` from the upload allowlist entirely** —
   SSG ships plain `.xml`, and there's no evidence this path ever worked.
2. **No binary-safe write path existed for large files.** `cockpit.file(path,
   {superuser:'require'}).replace(text)` is fine for a `readAsText()` string,
   but this rewrite already solved binary-safe writes properly in
   `lib/scanHistory.js`'s `writeBinaryFile()` (`dd` + `proc.input()`, not the
   `{ input: data }` spawn option, which mangles a `Uint8Array` through JSON
   and never signals stdin EOF — see that file's comment for the full
   explanation). V4.3 should read the upload via `FileReader.readAsArrayBuffer()`
   → `Uint8Array` and reuse that exact `writeBinaryFile()` pattern, not
   `cockpit.file().replace()`. Binary-safe end-to-end, and consistent even
   though the payload happens to be text (defends against encoding surprises
   in vendor-supplied files with unusual encodings/BOMs).

## Decisions

### 1. Storage and write-verification for large files

Confirmed locally: the real installed SSG datastream is
`/usr/share/xml/scap/ssg/content/ssg-rhel10-ds.xml`, **22 MB**. Vendor/custom
datastreams should be assumed similar or somewhat larger, not KB-scale like
tailoring XML or scan manifests.

`lib/tailoring.js` and `lib/scanHistory.js` both write-verify by **reading the
whole file back and comparing** — correct and cheap for XML deltas and JSON
manifests (tens of KB). For a 22 MB+ binary write, a full readback doubles the
data crossing the cockpit-bridge channel on every single upload, for a check
that's only trying to catch one specific known failure mode (root writing
under `sudo` without a pty silently no-oping).

**Recommendation: verify with a checksum instead of a full readback.**
Compute `SHA-256` over the `ArrayBuffer` client-side with `crypto.subtle.digest`
(standard Web Crypto, available in any secure context — Cockpit is served
over HTTPS, so this should hold, but is an unverified assumption worth a
five-minute spike before relying on it) before the write, then after
`writeBinaryFile()` run `sha256sum <path>` server-side and compare the first
field. This is a **deviation from the established small-file write-verify
pattern**, justified purely by file size — flagging explicitly rather than
silently diverging, since Peter has cared about this convention being
consistent across `tailoring.js`/`scanHistory.js` twice already.

### 2. Upload UI and mechanics

No new cockpit.js API is needed. `TailoringList.jsx` already has a working,
no-superuser browser-side upload today (`fileInputRef` + hidden `<input
type="file">` + `FileReader`) — it just uses `readAsText()` because tailoring
XML is always small text. Content upload reuses the same UI mechanic
(hidden file input triggered by a visible button) but reads via
`readAsArrayBuffer()` and writes via `writeBinaryFile()` per Decision 1.

**Placement — no separate Content tab exists in this app** (unlike old
`main`, which had one under Settings; this rewrite has exactly two tabs, Host
Scan and Policy Tailoring). Three things need a home:

- **Upload control:** recommend inline in the two pickers where content
  selection actually drives a workflow — `ScanSetup.jsx`'s "Content file"
  `FormGroup` and `TailoringEditor.jsx`'s "Content file" `FormGroup` — mirroring
  the existing "Upload Tailoring File" button already sitting in
  `TailoringList.jsx`'s `CardHeader`. `TailoringList.jsx`'s own content
  `FormSelect` (used only to tag which content an *uploaded tailoring file*
  targets) doesn't need its own upload button — it's a secondary picker, not
  a primary workflow entry point.
- **Grouped rendering** ("Detected" / "Uploaded" `optgroup`-style labels, per
  old `main`'s "Uploaded Content" group-label precedent) is needed in **three**
  places now that `detectContent()` returns tagged entries (Decision 6):
  `ScanSetup.jsx`, `TailoringEditor.jsx`, and `TailoringList.jsx`'s upload-target
  picker. Recommend factoring this into one small shared presentational
  component, `components/ContentSelect.jsx` (`FormSelect` + grouping, no
  business logic), rather than tripling the same rendering logic. This is
  the one new shared component this plan proposes.
- **Delete / management surface:** needs to exist somewhere since deleting a
  bare dropdown entry has no natural home. Recommend a small **"Uploaded
  Content" list card** (Name, Size, Uploaded date, Actions: Delete only — no
  validate-on-demand button, no disk-usage meter) placed on the **Policy
  Tailoring tab**, below `TailoringList.jsx`'s existing "Saved Tailoring
  Policies" table, since tailoring is the motivating use case. **Tradeoff
  named explicitly:** this is one more card on an already multi-card tab,
  vs. the alternative of an inline "Remove" affordance next to the picker
  itself (rejected — inline delete-in-a-dropdown is easy to miss, and breaks
  this repo's established convention that every destructive action gets a
  confirmation `Modal`, not a bare inline control).

### 3. Validation — block, don't warn-and-save

Old `main` validated **post-hoc**: a file already sitting in the shared
library got a pass/fail badge, checkable on demand, with a record in the
activity log either way. V4.3 has neither a shared library (content is
private per-user) nor an activity log to fall back on as a record of "this
file failed validation but is still here."

**Recommendation: reject invalid uploads outright — do not save the file.**
Run `oscap ds sds-validate` against the uploaded bytes (write to a scratch
path first, or validate a temp copy, then move/rename into place only on
success — avoid ever exposing a known-broken file to the pickers). Rationale:
an invalid SDS is useless to both consumers (`getProfiles()`/`extractProfile()`
will simply fail later when the user tries to actually use it) — saving a
broken file with a warning just relocates the failure to a more confusing
later moment, with no activity log to explain why. This also matches this
repo's own stated principle (`CLAUDE.md`: validate at system boundaries) —
upload *is* the boundary.

### 4. Naming / collision handling

- Filename sanitization, ported verbatim from old `main`: reject names
  containing `/` or `..`.
- Extension allowlist: **`.xml` only** (narrowed from old `main`'s
  `.xml`/`.xml.gz` — see "two problems" above).
- Collision: `stat` the destination path before writing; if present, show a
  PatternFly `Modal` confirm ("`file.name` already exists (`X` MB, uploaded
  `date`). Replace with new file (`Y` MB)?") before overwriting — same shape
  as old `main`'s flow, same `Modal` component this repo already uses for
  delete confirmations.

### 5. Delete

Per this repo's established convention (both `TailoringList.jsx` and
`ScanHistory.jsx`'s delete actions use a confirmation `Modal` with "this
cannot be undone" wording, never a bare click-to-delete) — the new Uploaded
Content list's Delete action must follow the exact same pattern. State this
explicitly so it isn't skipped as "just a content file, lower stakes":
uploaded content may be a customer's proprietary vendor datastream, deleting
it is exactly as irreversible as deleting a tailoring policy.

### 6. Merging into `detectContent()`

`lib/oscap.js`'s `detectContent()` becomes source-aware:

```js
export async function detectContent() {
    const [system, uploaded] = await Promise.all([
        detectSystemContent(),   // existing find, unchanged, unexported
        listUploadedContentPaths(),  // new: ls ~/SCAP/content/*.xml
    ]);
    return [
        ...system.map(path => ({ path, source: 'system' })),
        ...uploaded.map(path => ({ path, source: 'uploaded' })),
    ];
}
```

This is a **breaking return-shape change** (bare path strings → `{path,
source}` objects) that touches all three current callers:

- `ScanSetup.jsx`: `autoSelectContent()` and the `contentList[0] ?? ''`
  fallback both currently assume bare strings — need `.path` access added.
- `TailoringEditor.jsx`: same, plus its own `contentList.map(path => ...)`
  render loop.
- `TailoringList.jsx`: same, for its upload-target picker.

`lib/oscap.js` also gains a new dependency on `lib/homedir.js`'s `getUser()`
(for `~/SCAP/content/`) — it currently has none; worth noting as a structural
change, not just a data change.

**Also needed, found while reading all three callers:** each of
`ScanSetup.jsx`, `TailoringEditor.jsx`, and `TailoringList.jsx` has its own
**copy-pasted** `sdsDisplayName()` (strip `ssg-` prefix / `-ds.xml` suffix,
replace dashes with spaces) that assumes SSG's naming convention. An
uploaded file with an arbitrary name (e.g. `vendor_custom_profile.xml`) would
render through this unchanged and could look wrong (e.g. stray underscores
kept, nothing stripped since it doesn't match `ssg-...-ds.xml`, which is
actually *fine* by accident — but it's fragile to rely on that being
harmless). Recommend: consolidate the three copies into one function,
source-aware, in `lib/oscap.js` (next to `detectContent()`) or the new
`ContentSelect.jsx` — apply the SSG-specific stripping only when
`source === 'system'`, and just strip the `.xml` extension for
`source === 'uploaded'`. Small, mechanical, but real — flagging so it isn't
missed as "just reuse the existing helper" during the build session.

### 7. Size limits

Old `main` imposed none. Recommend a **client-side cap checked against
`file.size` before `FileReader` even starts reading** — a bad multi-hundred-MB
selection would otherwise hold the full file in memory at least twice
(as a `Blob`/`File` and again as an `ArrayBuffer`) purely in the browser tab,
before any network/spawn activity even begins, which is a real way to make a
browser tab visibly stall or crash on a large accidental selection (e.g. a
`.iso` picked by mistake). Recommend **200 MB** as a starting number — roughly
10x the one confirmed real-world datastream size (22 MB), generous headroom
for larger vendor content, but the exact number is a judgment call flagged
as an open question below rather than decided unilaterally.

### 8. SELinux

Already covered under State model — the existing `cockpit_session_t` /
`user_home_type` finding (verified via `sesearch`/`seinfo`, referenced in
V4.1 and V4.2) applies unchanged to `~/SCAP/content/`, since it's the same
homedir-subtree pattern with no new path structure. No new SELinux
investigation is needed for this plan.

## Component architecture in the rewrite (React + PF6)

Proposed additions:
- `lib/content.js` — new file, mirrors `lib/tailoring.js`/`lib/scanHistory.js`'s
  shape: `getContentDir()` (`~/SCAP/content`, via `homedir.js`'s `getUser()`),
  `listUploadedContent()` (`stat`-based, returns `{path, name, size, mtime}[]`,
  no sidecar), `uploadContent(file)` (sanitize → validate via scratch-path
  `oscap ds sds-validate` → collision-check → `writeBinaryFile()` +
  checksum-verify per Decision 1 → `chmod 600`), `deleteUploadedContent(path)`
  (`rm -f`, with the same path-prefix safety check `deleteTailoringFile()`/
  `deleteScan()` already use).
- `lib/oscap.js`: `detectContent()` extended per Decision 6; `writeBinaryFile()`
  moved here or into `lib/homedir.js` as a shared helper, since it will now
  exist in `scanHistory.js` *and* `content.js` — same duplication-avoidance
  argument V4.2 already made once for `ensureUserDir()`.
- `components/ContentSelect.jsx` — new shared presentational component:
  grouped `FormSelect` ("Detected" / "Uploaded" optgroup labels) +
  source-aware display-name helper (Decision 6). Used by `ScanSetup.jsx`,
  `TailoringEditor.jsx`, and `TailoringList.jsx`'s upload-target picker,
  replacing each file's own `contentList.map(...)` render loop.
- `components/ContentUploadCard.jsx` (name tentative) — new component: the
  "Uploaded Content" list (Name, Size, Uploaded date, Delete) plus the
  Upload button + hidden file input, placed on the Policy Tailoring tab
  below `TailoringList.jsx` (Decision 2). `ScanSetup.jsx` and
  `TailoringEditor.jsx` each get just an inline "Upload…" button next to
  their `ContentSelect` that calls into the same `lib/content.js` functions
  this card uses, so upload works from either entry point without
  duplicating upload logic — only the list/delete surface lives in one
  place.
- `app.jsx`: no new tab. A `contentRefreshKey` (mirroring the existing
  `tailoringRefreshKey` pattern) so uploading from `ScanSetup.jsx` or
  `TailoringEditor.jsx` refreshes the Policy-Tailoring-tab list card, and
  vice versa.

## Open questions for Peter (not decided here, deliberately)

1. **Uploaded-content list card placement, confirm or override:** this plan
   recommends the Policy Tailoring tab (below `TailoringList.jsx`) since
   tailoring is the motivating use case, but content is also consumed by
   `ScanSetup.jsx` on the Host Scan tab. Is Tailoring-tab-only discoverable
   enough, or should the list card (or at least a link to it) also surface
   on Host Scan?
2. **Size cap number:** 200 MB recommended (10x the one confirmed real
   datastream size), but arbitrary — confirm, or pick a different number.
3. **Web Crypto assumption:** `crypto.subtle` requires a secure context.
   Cockpit is served over HTTPS in every deployment this project targets, so
   this should hold, but hasn't been spiked yet. If it turns out not to hold
   in some Cockpit deployment mode, the fallback is a full-file readback
   (Decision 1's rejected default) — worth a five-minute check before the
   build session commits to the checksum approach.
4. **Validate-before-save mechanics:** validating "the uploaded bytes before
   they're the real file" needs either a scratch/temp path inside
   `~/SCAP/content/` (rename into place on success) or validating an
   in-memory/pipe stream directly. Old `main` validated files already in
   place (post-hoc), so there's no existing pre-save-validation reference
   implementation to port — this needs to be designed fresh during the build
   session; flagging now so it isn't assumed to be a copy-paste of
   `validateContent()`.

## Next step

Get this plan reviewed and approved. Once approved, open a separate build
session (scaffolding + component code) — per established practice, planning
sessions produce docs only, implementation is a distinct, separately-approved
step.
