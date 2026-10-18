import cockpit from 'cockpit';

import { ensureUserDir, getUser, writeBinaryFile } from './homedir.js';

const _ = cockpit.gettext;

const CONTENT_SUBDIR = 'SCAP/content';

// Peter confirmed the largest real SDS he's aware of is ~45 MB; 100 MB is
// generous headroom without being an arbitrary round number.
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export async function getContentDir() {
    const user = await getUser();
    return `${user.home}/${CONTENT_SUBDIR}`;
}

/* Reject path separators and traversal (ported verbatim from old main),
 * narrowed to .xml only — see PLAN_V4.3_CONTENT_UPLOAD.md's "two problems"
 * section for why .xml.gz is dropped rather than carried forward broken. */
export function sanitizeFilename(name) {
    if (!name || name.includes('/') || name.includes('..')) {
        throw new Error(_("Invalid file name."));
    }
    if (!name.toLowerCase().endsWith('.xml')) {
        throw new Error(_("Only .xml files are supported."));
    }
    return name;
}

export function checkUploadSize(bytes) {
    if (bytes > MAX_UPLOAD_BYTES) {
        throw new Error(_("File is too large. Maximum upload size is 100 MB."));
    }
}

function toHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0'))
            .join('');
}

async function sha256Remote(path) {
    const output = await cockpit.spawn(['sha256sum', path], { err: 'message' });
    return output.trim().split(/\s+/)[0];
}

async function validateSds(path) {
    try {
        await cockpit.spawn(['oscap', 'ds', 'sds-validate', path], { err: 'message' });
    } catch (ex) {
        throw new Error(_("This file is not a valid SCAP datastream: ") + (ex.message || String(ex)));
    }
}

/* stat the destination before writing, so the UI can show a confirm-replace
 * modal (name/size/date) before overwriting — mirrors old main's collision
 * flow, ported onto this repo's PF6 Modal. Returns null if no file exists yet. */
export async function statExistingContent(name) {
    const safeName = sanitizeFilename(name);
    const dir = await getContentDir();
    const path = `${dir}/${safeName}`;
    try {
        const output = await cockpit.spawn(['stat', '-c', '%s|%Y', path], { err: 'ignore' });
        const [size, mtimeEpoch] = output.trim().split('|');
        return { path, size: Number(size), mtime: new Date(Number(mtimeEpoch) * 1000).toISOString() };
    } catch {
        return null;
    }
}

/* List uploaded content for the "Uploaded Content" management card and for
 * detectContent()'s merge into the pickers. No JSON sidecar — unlike
 * tailoring/scan-history, an uploaded SDS is self-describing, so Name/Size/
 * Uploaded-date come from `find -printf` at list time, not a manifest. The
 * *.xml name filter also naturally excludes in-flight .tmp scratch files
 * left by uploadContent() below (e.g. from an interrupted upload) — they
 * never surface in the picker or the list. */
export async function listUploadedContent() {
    const dir = await getContentDir();
    try {
        const output = await cockpit.spawn(
            ['find', dir, '-maxdepth', '1', '-name', '*.xml', '-type', 'f', '-printf', '%f|%s|%T@\n'],
            { err: 'ignore' }
        );
        return output.trim().split('\n')
                .filter(Boolean)
                .map(line => {
                    const [name, size, mtimeEpoch] = line.split('|');
                    return {
                        path: `${dir}/${name}`,
                        name,
                        size: Number(size),
                        mtime: new Date(Number(mtimeEpoch) * 1000).toISOString(),
                    };
                })
                .sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''));
    } catch {
        return [];
    }
}

// Installed SCAP content lives anywhere under here, not only in
// scap-security-guide's ssg/content directory.
export const INSTALLED_CONTENT_ROOT = '/usr/share/xml/scap';
const SSG_CONTENT_DIR = `${INSTALLED_CONTENT_ROOT}/ssg/content`;

/* Every datastream (*-ds.xml) under INSTALLED_CONTENT_ROOT, at any depth
 * ("Installed" in the pickers and the SCAP Content card), same
 * {path, name, size, mtime} shape as listUploadedContent(). A file reached
 * twice (a symlink to another one, a symlinked directory) is listed once,
 * preferring scap-security-guide's own path. Sorted by name. */
export async function listInstalledContent() {
    let output;
    try {
        output = await cockpit.spawn(['sh', '-c',
            'find "$1" \\( -type f -o -type l \\) -name "*-ds.xml" 2>/dev/null | while IFS= read -r f; do ' +
            '[ -f "$f" ] && r=$(realpath -e -- "$f") || continue; printf "%s|%s|%s\\n" "$f" "$r" "$(stat -L -c "%s|%Y" -- "$f")"; done',
            'sh', INSTALLED_CONTENT_ROOT], { err: 'ignore' });
    } catch {
        return [];
    }
    const byReal = new Map();
    for (const line of output.split('\n').filter(Boolean)) {
        const [path, real, size, mtimeEpoch] = line.split('|');
        const prev = byReal.get(real);
        if (prev && (prev.path.startsWith(SSG_CONTENT_DIR + '/') || !path.startsWith(SSG_CONTENT_DIR + '/'))) continue;
        byReal.set(real, {
            path,
            name: path.split('/').pop(),
            size: Number(size),
            mtime: new Date(Number(mtimeEpoch) * 1000).toISOString(),
        });
    }
    return [...byReal.values()].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

/* Upload pipeline: sanitize -> hash client-side bytes -> write to a scratch
 * path -> verify the write via checksum (Decision 1: cheaper than a full
 * readback for 20MB+ SDS files) -> validate via `oscap ds sds-validate`
 * against the scratch copy (Decision 3: reject outright, never expose a
 * known-broken file to the pickers) -> rename into place only on success.
 * Collision handling (confirm-replace) is the caller's job via
 * statExistingContent() above — by the time this is called the caller has
 * already decided to write/overwrite. */
export async function uploadContent(name, data) {
    const safeName = sanitizeFilename(name);
    checkUploadSize(data.byteLength);

    const dir = await getContentDir();
    await ensureUserDir(dir);

    const finalPath = `${dir}/${safeName}`;
    const randomSuffix = Math.random().toString(36)
            .slice(2, 8);
    const scratchPath = `${dir}/.upload-${Date.now()}-${randomSuffix}.tmp`;

    const expectedSha256 = toHex(await crypto.subtle.digest('SHA-256', data));

    try {
        await writeBinaryFile(scratchPath, data);

        const actualSha256 = await sha256Remote(scratchPath);
        if (actualSha256 !== expectedSha256) {
            throw new Error(_("Upload failed write-verification (checksum mismatch). Try again."));
        }

        await validateSds(scratchPath);

        await cockpit.spawn(['mv', '-f', scratchPath, finalPath], { err: 'message' });
        await cockpit.spawn(['chmod', '600', finalPath], { err: 'message' });
    } catch (ex) {
        await cockpit.spawn(['rm', '-f', scratchPath], { err: 'ignore' }).catch(() => {});
        throw ex;
    }

    return { path: finalPath, name: safeName };
}

export async function deleteUploadedContent(path) {
    const dir = await getContentDir();
    if (!path.startsWith(dir + '/')) {
        throw new Error('Refusing to delete content outside ' + dir);
    }
    await cockpit.spawn(['rm', '-f', path], { err: 'message' });
}
