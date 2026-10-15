import cockpit from 'cockpit';

import { listUploadedContent } from './content.js';
import { readTailoringXml } from './tailoring.js';

const SSG_CONTENT_DIR = '/usr/share/xml/scap/ssg/content';

async function detectSystemContent() {
    try {
        const output = await cockpit.spawn(
            ['find', SSG_CONTENT_DIR, '-name', '*-ds.xml', '-type', 'f'],
            { err: 'ignore' }
        );
        return output.trim().split('\n')
                .filter(Boolean)
                .sort();
    } catch {
        return [];
    }
}

/* Merges auto-detected SSG system content with the user's uploaded content
 * (~/SCAP/content/, see lib/content.js), tagged by source so every picker
 * (ScanSetup.jsx, TailoringEditor.jsx, TailoringList.jsx) can render both
 * without reimplementing detection. Breaking return-shape change from bare
 * path strings to {path, source} objects — see PLAN_V4.3_CONTENT_UPLOAD.md
 * Decision 6. */
export async function detectContent() {
    const [system, uploaded] = await Promise.all([detectSystemContent(), listUploadedContent()]);
    return [
        ...system.map(path => ({ path, source: 'system' })),
        ...uploaded.map(c => ({ path: c.path, source: 'uploaded' })),
    ];
}

/* Consolidates three previously copy-pasted sdsDisplayName() implementations
 * (ScanSetup.jsx, TailoringEditor.jsx, TailoringList.jsx). SSG's
 * ssg-<id>-ds.xml stripping only makes sense for system content; uploaded
 * files just lose their .xml extension. `source` is optional — call sites
 * that only have a bare path (e.g. a saved tailoring sidecar's sds_path,
 * with no {path,source} object available) fall back to detecting system
 * content by its fixed install-path prefix. */
export function sdsDisplayName(path, source) {
    if (!path) return '—';
    const name = path.split('/').pop() ?? path;
    const src = source ?? (path.startsWith(SSG_CONTENT_DIR + '/') ? 'system' : 'uploaded');
    if (src === 'system') {
        return name.replace(/^ssg-/, '').replace(/-ds\.xml$/, '')
                .replace(/-/g, ' ');
    }
    return name.replace(/\.xml$/, '');
}

/* Default content for this host: the SSG datastream matching the OS major
 * version, else any datastream for the OS id, else the first one found.
 * Shared by ScanSetup.jsx and TailoringEditor.jsx. */
export function autoSelectContent(contentList, id, versionId) {
    const major = versionId?.split('.')[0] ?? '';
    for (const c of contentList) {
        const base = c.path.split('/').pop();
        if (major && (base.includes(`${id}${major}`) || base.includes(`${id}-${major}`))) return c.path;
    }
    for (const c of contentList) {
        if (c.path.split('/').pop()
                .includes(id)) return c.path;
    }
    return contentList[0]?.path ?? '';
}

export async function getOsRelease() {
    try {
        const output = await cockpit.spawn(['cat', '/etc/os-release'], { err: 'ignore' });
        const field = name => (output.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1] ?? '').replace(/"/g, '');
        return {
            id: field('ID').toLowerCase(),
            versionId: field('VERSION_ID').toLowerCase(),
            cpe: field('CPE_NAME').toLowerCase(),
            prettyName: field('PRETTY_NAME'),
        };
    } catch {
        return { id: '', versionId: '', cpe: '', prettyName: '' };
    }
}

/* First OS CPE named in a datastream (its CPE dictionary / Benchmark
 * <platform>), e.g. "cpe:/o:redhat:enterprise_linux:9". grep -m1 stops at
 * the first hit, so this costs a few ms even on a 30 MB SSG file. Resolves
 * null when the content names no OS CPE (nothing to compare against). */
export async function getContentPlatform(sdsPath) {
    try {
        const out = await cockpit.spawn(
            ['grep', '-m1', '-oE', 'cpe:/o:[a-z0-9_.-]+:[a-z0-9_.-]+:[0-9]+', sdsPath],
            { err: 'ignore' }
        );
        return out.trim().split('\n')[0] || null;
    } catch {
        return null;
    }
}

/* True when the content's OS CPE names a different vendor:product or major
 * version than the host's CPE_NAME (cpe:/o:redhat:enterprise_linux:10.2).
 * Unknown on either side is not a mismatch. */
export function isPlatformMismatch(contentCpe, hostCpe) {
    if (!contentCpe || !hostCpe) return false;
    const parse = cpe => {
        const [, , vendor, product, version] = cpe.toLowerCase().split(':');
        return { vp: `${vendor}:${product}`, major: (version || '').split('.')[0] };
    };
    const c = parse(contentCpe);
    const h = parse(hostCpe);
    return c.vp !== h.vp || (!!c.major && !!h.major && c.major !== h.major);
}

/* "Red Hat Enterprise Linux 9" from cpe:/o:redhat:enterprise_linux:9 —
 * only used to word the mismatch warning. */
export function cpeDisplayName(cpe) {
    if (!cpe) return '';
    const [, , vendor, product, version] = cpe.split(':');
    const known = { 'redhat:enterprise_linux': 'Red Hat Enterprise Linux', 'fedoraproject:fedora': 'Fedora', 'centos:centos': 'CentOS Stream' };
    const name = known[`${vendor}:${product}`] ?? (product || '').replace(/_/g, ' ');
    return version ? `${name} ${version}` : name;
}

export async function getProfiles(sdsPath) {
    const output = await cockpit.spawn(['oscap', 'info', sdsPath], { err: 'message' });
    const profiles = [];
    let currentTitle = null;
    for (const line of output.split('\n')) {
        const s = line.trim();
        if (s.startsWith('Title:')) {
            currentTitle = s.slice(6).trim();
        } else if (s.startsWith('Id:') && currentTitle) {
            profiles.push({ id: s.slice(3).trim(), title: currentTitle });
            currentTitle = null;
        }
    }
    return profiles;
}

export async function makeTmpdir() {
    const output = await cockpit.spawn(
        ['mktemp', '-d', '/tmp/cockpit-scap-XXXXXX'],
        { superuser: 'require', err: 'message' }
    );
    return output.trim();
}

export function startScan(config, tmpdir, onOutput) {
    const args = ['oscap', 'xccdf', 'eval'];
    if (config.tailoring) args.push('--tailoring-file', config.tailoring);
    args.push('--profile', config.profile);
    args.push('--results', `${tmpdir}/results.xml`);
    args.push('--results-arf', `${tmpdir}/arf.xml`);
    args.push('--report', `${tmpdir}/report.html`);
    args.push(config.content);

    const proc = cockpit.spawn(args, { superuser: 'require', err: 'out' });
    let buf = '';
    proc.stream(chunk => {
        buf += chunk;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) onOutput(line);
    });
    return proc;
}

export async function readResults(tmpdir) {
    const [reportHtml, resultsXmlGz, arfXmlGz, resultsXml] = await Promise.all([
        cockpit.spawn(['cat', `${tmpdir}/report.html`], { binary: true, superuser: 'require', err: 'message' }),
        cockpit.spawn(['gzip', '-c', `${tmpdir}/results.xml`], { binary: true, superuser: 'require', err: 'message' }),
        cockpit.spawn(['gzip', '-c', `${tmpdir}/arf.xml`], { binary: true, superuser: 'require', err: 'message' }),
        cockpit.spawn(['cat', `${tmpdir}/results.xml`], { superuser: 'require', err: 'message' }),
    ]);
    return { reportHtml, resultsXmlGz, arfXmlGz, resultsXml };
}

export async function cleanupTmpdir(tmpdir) {
    try {
        await cockpit.spawn(['rm', '-rf', tmpdir], { superuser: 'require', err: 'ignore' });
    } catch {
        // best-effort
    }
}

// Both of these run directly against static, world-readable SCAP content
// (no results.xml, no scan, no tmpdir) — no superuser needed. When
// tailoringPath is set, profileId must be the TAILORED profile id (the
// tailoring's own <Profile id>), not its base: with the base id oscap
// silently evaluates the untailored base profile and the tailoring is
// ignored (C§1c-2: 509 fixes instead of 505 for a tailoring that deselects
// 4 rules). generateGuide is used by ScanSetup.jsx (pre-scan); generateProfileFix here
// is the *whole-profile* fix, also only used by ScanSetup.jsx. Rule-scoped
// Fix generation (ScanResults.jsx, live or saved scan) uses generateScopedFix
// below instead — see its comment for why.
export async function generateGuide(sdsPath, profileId, tailoringPath) {
    const args = ['oscap', 'xccdf', 'generate', 'guide', '--profile', profileId];
    if (tailoringPath) args.push('--tailoring-file', tailoringPath);
    args.push(sdsPath);
    return cockpit.spawn(args, { err: 'message' });
}

export async function generateProfileFix(sdsPath, profileId, tailoringPath, fixType) {
    const args = ['oscap', 'xccdf', 'generate', 'fix', '--fix-type', fixType, '--profile', profileId];
    if (tailoringPath) args.push('--tailoring-file', tailoringPath);
    args.push(sdsPath);
    return cockpit.spawn(args, { err: 'message' });
}

const XCCDF_NS = 'http://checklists.nist.gov/xccdf/1.2';
const SCOPE_PROFILE_ID = 'xccdf_cockpit-scap_profile_fixscope';

/* Fix for just `ruleIds`, with the variable values of the profile that was
 * actually scanned.
 *
 * oscap's `xccdf generate fix` has no per-rule option (`--rule` is silently
 * ignored and the whole profile comes out), so scoping goes through an
 * ephemeral tailoring Profile. That Profile EXTENDS the scanned profile
 * (`profileId`: the tailored profile id when the scan used a tailoring,
 * whose XML is then copied into the ephemeral file so the id resolves) and
 * explicitly deselects every other rule in the benchmark (`allRuleIds`, all
 * rule-result idrefs of the scan's results.xml). Extending keeps the
 * profile's refine-value / set-value choices; a standalone Profile with no
 * `extends` falls back to the benchmark defaults (C§1c-1: CIS L1 minlen 15
 * instead of 14, faillock deny 3 instead of 5, ...). Verified with oscap
 * 1.4.4 that every variable matches `generate fix --profile <same>` for the
 * same rules (tests/v46-phase1-scoped-fix-values.spec.js). */
export async function generateScopedFix({ sdsPath, profileId, profileTitle, tailoringPath, allRuleIds }, ruleIds, fixType) {
    if (!profileId) throw new Error(_scopeError('the scanned profile is unknown'));
    if (!allRuleIds?.length) throw new Error(_scopeError('the scan results list no rules'));

    let doc;
    if (tailoringPath) {
        doc = new DOMParser().parseFromString(await readTailoringXml(tailoringPath), 'application/xml');
        if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'Tailoring')
            throw new Error(_scopeError(`${tailoringPath} is not an XCCDF tailoring file`));
    } else {
        doc = new DOMParser().parseFromString(
            `<Tailoring xmlns="${XCCDF_NS}" id="xccdf_cockpit-scap_tailoring_fixscope">` +
            `<version time="${new Date().toISOString()
                    .slice(0, 19)}">1</version></Tailoring>`,
            'application/xml');
    }
    const root = doc.documentElement;
    const ns = root.namespaceURI || XCCDF_NS;
    const prefix = root.prefix ? root.prefix + ':' : '';
    const el = (name, attrs = {}, text = null) => {
        const e = doc.createElementNS(ns, prefix + name);
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
        if (text !== null) e.textContent = text;
        return e;
    };
    const profile = el('Profile', { id: SCOPE_PROFILE_ID, extends: profileId });
    // oscap appends a non-override title/description to the parent's
    // ("RHEL10_CIS2_DMZ_WEBcockpit-scap rule-scoped fix"); override both
    // so the script header reads cleanly.
    profile.appendChild(el('title', { override: 'true' }, `${profileTitle || profileId} (selected rules)`));
    profile.appendChild(el('description', { override: 'true' },
                           `${ruleIds.length} rule(s) selected in cockpit-scap from ${profileTitle || profileId}, with that profile's values.`));
    const wanted = new Set(ruleIds);
    for (const id of new Set([...allRuleIds, ...ruleIds]))
        profile.appendChild(el('select', { idref: id, selected: wanted.has(id) ? 'true' : 'false' }));
    root.appendChild(profile);
    // Some engines (Chromium) keep the parsed source's XML declaration on
    // serialization, others drop it: normalise to exactly one.
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        new XMLSerializer().serializeToString(doc)
                .replace(/^<\?xml[^>]*\?>\s*/, '');

    const tmpPath = (await cockpit.spawn(
        ['mktemp', '/tmp/cockpit-scap-fixscope-XXXXXX.xml'], { err: 'message' }
    )).trim();
    try {
        await cockpit.file(tmpPath).replace(xml);
        return await cockpit.spawn([
            'oscap', 'xccdf', 'generate', 'fix', '--fix-type', fixType,
            '--profile', SCOPE_PROFILE_ID,
            '--tailoring-file', tmpPath, sdsPath,
        ], { err: 'message' });
    } finally {
        cockpit.spawn(['rm', '-f', tmpPath], { err: 'ignore' }).catch(() => {});
    }
}

function _scopeError(why) {
    return `Cannot generate a rule-scoped fix: ${why}.`;
}

/* oscap happily emits a script with no remediation in it when none of the
 * requested rules has a fix of that type (e.g. grub2_password has no Ansible
 * task): a bash header with no "# BEGIN fix" block, or a playbook whose
 * `tasks:` list is empty. Callers warn instead of downloading that. */
export function isEmptyFix(script, fixType) {
    if (fixType === 'bash') {
        // A rule without a bash fix still gets a "# BEGIN fix" block whose
        // only content is an echo "FIX FOR THIS RULE '...' IS MISSING!".
        const blocks = (script.match(/^# BEGIN fix/gm) || []).length;
        const missing = (script.match(/FIX FOR THIS RULE '[^']*' IS MISSING!/g) || []).length;
        return blocks - missing <= 0;
    }
    if (fixType === 'ansible') return !/^\s*- name:/m.test(script.split(/^\s*tasks:\s*$/m)[1] ?? '');
    if (fixType === 'puppet') return !/\S/.test(script.replace(/^#.*$/gm, ''));
    return false;
}
