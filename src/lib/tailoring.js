import cockpit from 'cockpit';

import { ensureUserDir, getUser, makeTimestamp } from './homedir.js';

const TAILORING_SUBDIR = 'SCAP/tailoring';

/* Parse an SDS file, extract a profile's rule tree and values.
 * Uses iterparse with early break to avoid loading the ~35MB OVAL section.
 * Args: sys.argv[1]=profileId  sys.argv[2]=sdsPath
 * Output: JSON {profile, groups, rules, values}
 * Based on the old main branch (src/index.js:77-122) — pure stdlib Python,
 * framework-agnostic. Rules also carry cce/hasFix (ident/fix extraction
 * ported from old main's PY_EXTRACT_FAILING_RULES, src/index.js:127-181)
 * so ScanResults can render the CCE tag and Automated/Manual badge. */
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
    'sel_map, val_map, ptitle, pdesc = {}, {}, pid, ""',
    'for p in bench.findall(tag("Profile")):',
    '    if p.get("id") != pid: continue',
    '    t = p.find(tag("title")); ptitle = text(t)',
    '    pd_el = p.find(tag("description"))',
    '    pdesc = " ".join("".join(pd_el.itertext()).split()) if pd_el is not None else ""',
    '    for s in p.findall(tag("select")): sel_map[s.get("idref", "")] = s.get("selected", "true").lower() == "true"',
    '    for sv in p.findall(tag("set-value")): val_map[sv.get("idref", "")] = text(sv)',
    '    break',
    'def is_sel(rid, d): return sel_map.get(rid, d)',
    'def proc_rule(el):',
    '    rid = el.get("id", ""); t = el.find(tag("title"))',
    '    d = el.get("selected", "true").lower() == "true"',
    '    d_el = el.find(tag("description"))',
    '    desc = " ".join("".join(d_el.itertext()).split()) if d_el is not None else ""',
    '    r_el = el.find(tag("rationale"))',
    '    rat = " ".join("".join(r_el.itertext()).split()) if r_el is not None else ""',
    '    ci = next((i for i in el.findall(tag("ident")) if "cce" in (i.get("system","")).lower()), None)',
    '    cce = ci.text.strip() if ci is not None and ci.text else ""',
    '    has_fix = el.find(tag("fix")) is not None',
    '    return {"id": rid, "title": text(t), "severity": el.get("severity", "unknown"), "selected": is_sel(rid, d), "description": desc, "rationale": rat, "cce": cce, "hasFix": has_fix}',
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
    'print(json.dumps({"profile": {"id": pid, "title": ptitle, "description": pdesc}, "groups": gs, "rules": rs, "values": vs}))',
].join('\n');

export async function extractProfile(profileId, sdsPath) {
    const output = await cockpit.spawn(
        ['python3', '-c', PY_EXTRACT_PROFILE, profileId, sdsPath],
        { err: 'message' }
    );
    return JSON.parse(output);
}

/* Flatten extractProfile()'s arbitrarily-nested group/rule tree into a flat
 * rule list, e.g. for building an id -> rule lookup map. */
export function flattenProfileRules(data) {
    const out = [];
    function walk(groups, rules) {
        (rules || []).forEach(r => out.push(r));
        (groups || []).forEach(g => walk(g.groups, g.rules));
    }
    if (data) walk(data.groups, data.rules);
    return out;
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
    const ts = new Date().toISOString()
            .slice(0, 19);
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

function safeSlug(title) {
    return title.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
}

export async function getTailoringDir() {
    const user = await getUser();
    return `${user.home}/${TAILORING_SUBDIR}`;
}

/* ~/SCAP/tailoring is already user-owned (see homedir.js's ensureUserDir),
 * so no superuser is needed here. Falls back to '0' both when the directory
 * doesn't exist yet (fresh install, no tailoring policies saved) and on any
 * other `du` failure — either way there's nothing to report. */
export async function getTailoringDiskUsage() {
    const dir = await getTailoringDir();
    try {
        const output = await cockpit.spawn(['du', '-sh', dir], { err: 'message' });
        return output.split(/\s+/)[0];
    } catch {
        return '0';
    }
}

/* Write XML + JSON sidecar, chmod, then read the XML back and compare
 * to what was written — catches a known hardened-system failure mode where
 * cockpit-bridge under sudo without a pty silently no-ops the write. */
async function writeTailoringFiles(xmlPath, jsonPath, xmlContent, sidecar) {
    await Promise.all([
        cockpit.file(xmlPath).replace(xmlContent),
        cockpit.file(jsonPath).replace(JSON.stringify(sidecar, null, 2)),
    ]);
    await cockpit.spawn(['chmod', '600', xmlPath, jsonPath], { err: 'message' });

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
    const files = output.trim().split('\n')
            .filter(f => f && f.endsWith('.json'));
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

    await ensureUserDir(dir);
    await writeTailoringFiles(xmlPath, jsonPath, xml, sidecar);
    return sidecar;
}

export async function updateTailoringFile(sidecar, { newProfileTitle, ruleChanges, valueChanges }) {
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

    await writeTailoringFiles(sidecar.path, jsonPath, xml, updatedSidecar);
    return updatedSidecar;
}

export async function saveUploadedTailoring({ xmlContent, sdsPath, profileId, baseProfileId, baseProfileTitle, name }) {
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

    await ensureUserDir(dir);
    await writeTailoringFiles(xmlPath, jsonPath, xmlContent, sidecar);
    return sidecar;
}

export async function deleteTailoringFile(sidecar) {
    const dir = await getTailoringDir();
    if (!sidecar.path.startsWith(dir + '/')) {
        throw new Error('Refusing to delete a tailoring file outside ' + dir);
    }
    const jsonPath = sidecar.path.replace(/\.xml$/, '.json');
    await cockpit.spawn(['rm', '-f', sidecar.path, jsonPath], { err: 'message' });
}
