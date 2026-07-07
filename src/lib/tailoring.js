import cockpit from 'cockpit';

const TAILORING_SUBDIR = 'SCAP/tailoring';

/* Parse an SDS file, extract a profile's rule tree and values.
 * Uses iterparse with early break to avoid loading the ~35MB OVAL section.
 * Args: sys.argv[1]=profileId  sys.argv[2]=sdsPath
 * Output: JSON {profile, groups, rules, values}
 * Ported verbatim from the old main branch (src/index.js:77-122) — pure
 * stdlib Python, framework-agnostic, needs no changes for the rewrite. */
export const PY_EXTRACT_PROFILE = [
    'import xml.etree.ElementTree as ET, json, sys',
    'NS = "http://checklists.nist.gov/xccdf/1.2"',
    'def tag(t): return "{" + NS + "}" + t',
    'def text(el): return (el.text or "").strip() if el is not None else ""',
    'pid, sds = sys.argv[1], sys.argv[2]',
    'bench = None',
    'for _, el in ET.iterparse(sds, events=("end",)):',
    '    if el.tag == tag("Benchmark"): bench = el; break',
    'if bench is None: print("{}"); sys.exit(1)',
    'sel_map, val_map, ptitle = {}, {}, pid',
    'for p in bench.findall(tag("Profile")):',
    '    if p.get("id") != pid: continue',
    '    t = p.find(tag("title")); ptitle = text(t)',
    '    for s in p.findall(tag("select")): sel_map[s.get("idref", "")] = s.get("selected", "true").lower() == "true"',
    '    for sv in p.findall(tag("set-value")): val_map[sv.get("idref", "")] = text(sv)',
    '    break',
    'def is_sel(rid, d): return sel_map.get(rid, d)',
    'def proc_rule(el):',
    '    rid = el.get("id", ""); t = el.find(tag("title"))',
    '    d = el.get("selected", "true").lower() == "true"',
    '    d_el = el.find(tag("description"))',
    '    desc = " ".join("".join(d_el.itertext()).split()) if d_el is not None else ""',
    '    return {"id": rid, "title": text(t), "severity": el.get("severity", "unknown"), "selected": is_sel(rid, d), "description": desc}',
    'def proc_group(el):',
    '    t = el.find(tag("title"))',
    '    r = {"id": el.get("id", ""), "title": text(t), "groups": [], "rules": []}',
    '    for c in el:',
    '        if c.tag == tag("Group"): r["groups"].append(proc_group(c))',
    '        elif c.tag == tag("Rule"): r["rules"].append(proc_rule(c))',
    '    return r',
    'gs, rs = [], []',
    'for c in bench:',
    '    if c.tag == tag("Group"): gs.append(proc_group(c))',
    '    elif c.tag == tag("Rule"): rs.append(proc_rule(c))',
    'vs = []',
    'for vel in bench.iter(tag("Value")):',
    '    vid = vel.get("id", ""); vt = vel.find(tag("title"))',
    '    dv = ""; opts = []',
    '    for v in vel.findall(tag("value")):',
    '        s = v.get("selector", ""); vv = text(v)',
    '        if s == "": dv = vv',
    '        else: opts.append({"selector": s, "value": vv})',
    '    vs.append({"id": vid, "title": text(vt), "type": vel.get("type", "string"), "current": val_map.get(vid, dv), "default": dv, "options": opts})',
    'print(json.dumps({"profile": {"id": pid, "title": ptitle}, "groups": gs, "rules": rs, "values": vs}))',
].join('\n');

export async function extractProfile(profileId, sdsPath) {
    const output = await cockpit.spawn(
        ['python3', '-c', PY_EXTRACT_PROFILE, profileId, sdsPath],
        { err: 'message' }
    );
    return JSON.parse(output);
}

/* Emit standard XCCDF <Tailoring>/<Profile extends="..."> with <select idref=.../>
 * and <set-value idref=...> entries for only the deltas. Plain string template,
 * no XML library — ported verbatim from old main's tailoring.js:913. */
export function generateTailoringXml(baseProfileId, newProfileId, newProfileTitle, ruleChanges, valueChanges) {
    const esc = s => String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    const ts = new Date().toISOString().slice(0, 19);
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Tailoring xmlns="http://checklists.nist.gov/xccdf/1.2" id="xccdf_cockpit-scap_tailoring_default">',
        '  <version time="' + ts + '">1</version>',
        '  <Profile id="' + esc(newProfileId) + '" extends="' + esc(baseProfileId) + '">',
        '    <title>' + esc(newProfileTitle) + '</title>',
        '    <description>Created with cockpit-scap</description>',
    ];
    Object.entries(ruleChanges).forEach(([id, sel]) => {
        lines.push('    <select idref="' + esc(id) + '" selected="' + sel + '"/>');
    });
    Object.entries(valueChanges).forEach(([id, val]) => {
        lines.push('    <set-value idref="' + esc(id) + '">' + esc(String(val)) + '</set-value>');
    });
    lines.push('  </Profile>', '</Tailoring>');
    return lines.join('\n');
}

export function parseTailoringXml(xmlContent) {
    const NS = 'http://checklists.nist.gov/xccdf/1.2';
    const doc = new DOMParser().parseFromString(xmlContent, 'application/xml');
    const ruleChanges = {};
    const valueChanges = {};

    Array.from(doc.getElementsByTagNameNS(NS, 'select')).forEach(el => {
        const idref = el.getAttribute('idref');
        if (idref) ruleChanges[idref] = el.getAttribute('selected') === 'true';
    });

    Array.from(doc.getElementsByTagNameNS(NS, 'set-value')).forEach(el => {
        const idref = el.getAttribute('idref');
        if (idref) valueChanges[idref] = el.textContent || '';
    });

    return { ruleChanges, valueChanges };
}

function makeTimestamp() {
    return new Date().toISOString()
            .replace(/\.\d{3}Z$/, '')
            .replace(/:/g, '-');
}

function safeSlug(title) {
    return title.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
}

let cachedUser = null;
async function getUser() {
    if (!cachedUser) cachedUser = await cockpit.user();
    return cachedUser;
}

export async function getTailoringDir() {
    const user = await getUser();
    return `${user.home}/${TAILORING_SUBDIR}`;
}

/* Root (Cockpit's superuser bridge) writes as root, then chown to the owning
 * user — per-user-private homedir data, tighter than old main's /var/lib
 * world-readable 644: chmod 700 on the directory, 600 on files. */
async function ensureTailoringDir(dir, username) {
    await cockpit.spawn(['mkdir', '-p', dir], { superuser: 'require', err: 'message' });
    await cockpit.spawn(['chown', `${username}:${username}`, dir], { superuser: 'require', err: 'message' });
    await cockpit.spawn(['chmod', '700', dir], { superuser: 'require', err: 'message' });
}

/* Write XML + JSON sidecar, chown/chmod, then read the XML back and compare
 * to what was written — catches a known hardened-system failure mode where
 * cockpit-bridge under sudo without a pty silently no-ops the write. */
async function writeTailoringFiles(xmlPath, jsonPath, xmlContent, sidecar, username) {
    await Promise.all([
        cockpit.file(xmlPath, { superuser: 'require' }).replace(xmlContent),
        cockpit.file(jsonPath, { superuser: 'require' }).replace(JSON.stringify(sidecar, null, 2)),
    ]);
    await cockpit.spawn(['chown', `${username}:${username}`, xmlPath, jsonPath], { superuser: 'require', err: 'message' });
    await cockpit.spawn(['chmod', '600', xmlPath, jsonPath], { superuser: 'require', err: 'message' });

    const written = await cockpit.file(xmlPath, { superuser: 'try' }).read();
    if (written !== xmlContent) {
        throw new Error(
            'Tailoring file was not written correctly. On hardened systems, add ' +
            "'Defaults!/usr/bin/cockpit-bridge !use_pty' to /etc/sudoers.d/cockpit-bridge and try again."
        );
    }
}

export async function listTailoringFiles() {
    const dir = await getTailoringDir();
    let output;
    try {
        output = await cockpit.spawn(['ls', dir], { superuser: 'try', err: 'ignore' });
    } catch {
        return [];
    }
    const files = output.trim().split('\n').filter(f => f && f.endsWith('.json'));
    const sidecars = await Promise.all(files.map(async f => {
        try {
            const content = await cockpit.file(`${dir}/${f}`, { superuser: 'try' }).read();
            return JSON.parse(content);
        } catch {
            return null;
        }
    }));
    return sidecars.filter(Boolean).sort((a, b) => (b.created || '').localeCompare(a.created || ''));
}

export async function readTailoringXml(path) {
    return cockpit.file(path, { superuser: 'try' }).read();
}

export async function saveNewTailoring({ baseProfileId, baseProfileTitle, newProfileTitle, sdsPath, ruleChanges, valueChanges }) {
    const user = await getUser();
    const dir = await getTailoringDir();
    const safeName = safeSlug(newProfileTitle);
    const newProfileId = 'xccdf_cockpit-scap_profile_' + safeName;
    const ts = makeTimestamp();
    const filename = safeName + '-' + ts;
    const xmlPath = `${dir}/${filename}.xml`;
    const jsonPath = `${dir}/${filename}.json`;

    const xml = generateTailoringXml(baseProfileId, newProfileId, newProfileTitle, ruleChanges, valueChanges);
    const sidecar = {
        name: newProfileTitle,
        base_profile_id: baseProfileId,
        base_profile_title: baseProfileTitle,
        profile_id: newProfileId,
        sds_path: sdsPath,
        path: xmlPath,
        created: ts,
        rules_modified: Object.keys(ruleChanges).length,
    };

    await ensureTailoringDir(dir, user.name);
    await writeTailoringFiles(xmlPath, jsonPath, xml, sidecar, user.name);
    return sidecar;
}

export async function updateTailoringFile(sidecar, { newProfileTitle, ruleChanges, valueChanges }) {
    const user = await getUser();
    const dir = await getTailoringDir();
    if (!sidecar.path.startsWith(dir + '/')) {
        throw new Error('Refusing to update a tailoring file outside ' + dir);
    }

    const title = newProfileTitle.trim() || sidecar.name;
    const xml = generateTailoringXml(sidecar.base_profile_id, sidecar.profile_id, title, ruleChanges, valueChanges);
    const jsonPath = sidecar.path.replace(/\.xml$/, '.json');
    const updatedSidecar = {
        ...sidecar,
        name: title,
        modified: makeTimestamp(),
        rules_modified: Object.keys(ruleChanges).length,
    };

    await writeTailoringFiles(sidecar.path, jsonPath, xml, updatedSidecar, user.name);
    return updatedSidecar;
}

export async function saveUploadedTailoring({ xmlContent, sdsPath, profileId, baseProfileId, baseProfileTitle, name }) {
    const user = await getUser();
    const dir = await getTailoringDir();
    const ts = makeTimestamp();
    const safeName = safeSlug(name);
    const filename = safeName + '-' + ts;
    const xmlPath = `${dir}/${filename}.xml`;
    const jsonPath = `${dir}/${filename}.json`;

    const { ruleChanges } = parseTailoringXml(xmlContent);
    const sidecar = {
        name,
        base_profile_id: baseProfileId,
        base_profile_title: baseProfileTitle,
        profile_id: profileId,
        sds_path: sdsPath,
        path: xmlPath,
        created: ts,
        rules_modified: Object.keys(ruleChanges).length,
    };

    await ensureTailoringDir(dir, user.name);
    await writeTailoringFiles(xmlPath, jsonPath, xmlContent, sidecar, user.name);
    return sidecar;
}

export async function deleteTailoringFile(sidecar) {
    const dir = await getTailoringDir();
    if (!sidecar.path.startsWith(dir + '/')) {
        throw new Error('Refusing to delete a tailoring file outside ' + dir);
    }
    const jsonPath = sidecar.path.replace(/\.xml$/, '.json');
    await cockpit.spawn(['rm', '-f', sidecar.path, jsonPath], { superuser: 'require', err: 'message' });
}
