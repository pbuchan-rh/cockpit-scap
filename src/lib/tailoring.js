import cockpit from 'cockpit';

import { diskUsageBytes } from './format.js';
import { ensureUserDir, getUser, makeTimestamp, readUserFile, spawnUserRead } from './homedir.js';
import { REF_KEEP } from './results.js';

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
    // href substrings of the framework references kept for rule chips
    // (same list as lib/results.js REF_KEEP).
    'REF_KEEP = ' + JSON.stringify(REF_KEEP.map(([pat]) => pat)),
    'bench = None',
    'for _, el in ET.iterparse(sds, events=("end",)):',
    '    if el.tag == tag("Benchmark"): bench = el; break',
    'if bench is None: print("{}"); sys.exit(1)',
    'sel_map, val_map, ptitle, pdesc = {}, {}, pid, ""',
    // The profile's own select/refine-value/set-value apply on top of the
    // profiles it extends (parent first). refine-value names a selector of
    // the Value (SSG sets variables this way), set-value a literal; val_map
    // holds ("sel", selector) or ("lit", value).
    'profs = {p.get("id"): p for p in bench.findall(tag("Profile"))}',
    'chain, cur = [], profs.get(pid)',
    'while cur is not None and cur not in chain:',
    '    chain.insert(0, cur); cur = profs.get(cur.get("extends"))',
    'if chain:',
    '    p = chain[-1]; t = p.find(tag("title")); ptitle = text(t)',
    '    pd_el = p.find(tag("description"))',
    '    pdesc = " ".join("".join(pd_el.itertext()).split()) if pd_el is not None else ""',
    'for p in chain:',
    '    for c in p:',
    '        if c.tag == tag("select"): sel_map[c.get("idref", "")] = c.get("selected", "true").lower() == "true"',
    '        elif c.tag == tag("refine-value") and c.get("selector") is not None: val_map[c.get("idref", "")] = ("sel", c.get("selector"))',
    '        elif c.tag == tag("set-value"): val_map[c.get("idref", "")] = ("lit", text(c))',
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
    '    refs = [{"href": x.get("href", ""), "text": text(x)} for x in el.findall(tag("reference")) if any(k in x.get("href", "").lower() for k in REF_KEEP)]',
    '    return {"id": rid, "title": text(t), "severity": el.get("severity", "unknown"), "selected": is_sel(rid, d), "description": desc, "rationale": rat, "cce": cce, "hasFix": has_fix, "refs": refs}',
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
    // An unknown selector falls back to the default, as oscap does.
    '    kind, pv = val_map.get(vid, ("lit", dv))',
    '    cur = pv if kind == "lit" else next((o["value"] for o in opts if o["selector"] == pv), dv)',
    '    vs.append({"id": vid, "title": text(vt), "type": vel.get("type", "string"), "current": cur, "default": dv, "options": opts})',
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
 * no XML library — ported from old main's tailoring.js:913. `sdsPath` goes
 * into <benchmark href> (optional in XCCDF 1.2, written by SCAP Workbench
 * too), so an exported policy uploaded again matches its content without
 * asking (F2). */
export function generateTailoringXml(baseProfileId, newProfileId, newProfileTitle, ruleChanges, valueChanges, sdsPath) {
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
        ...(sdsPath ? ['  <benchmark href="' + esc(sdsPath) + '"/>'] : []),
        '  <version time="' + ts + '">1</version>',
        '  <Profile id="' + esc(newProfileId) + '"' + (baseProfileId ? ' extends="' + esc(baseProfileId) + '"' : '') + '>',
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

/* The content a tailoring file says it is for: its <benchmark href>,
 * "" when it names none. */
export function tailoringBenchmarkHref(doc) {
    const el = doc.getElementsByTagNameNS('http://checklists.nist.gov/xccdf/1.2', 'benchmark')[0];
    return (el?.getAttribute('href') || '').trim();
}

/* Detected/uploaded content (detectContent() shape) that `href` names:
 * the exact path, else every file with the same name (a policy exported
 * on another host names that host's path). */
export function matchBenchmarkContent(href, contentList) {
    if (!href) return [];
    const path = href.replace(/^file:\/\//, '');
    const exact = contentList.filter(c => c.path === path);
    if (exact.length) return exact;
    const base = path.split('/').pop();
    return contentList.filter(c => c.path.split('/').pop() === base);
}

const XCCDF_NS = 'http://checklists.nist.gov/xccdf/1.2';

/* The <Profile> with id `profileId` (the first one when no id is given or
 * none matches), or null. */
function findTailoringProfile(doc, profileId) {
    const profiles = Array.from(doc.getElementsByTagNameNS(XCCDF_NS, 'Profile'));
    return profiles.find(p => profileId && p.getAttribute('id') === profileId) || profiles[0] || null;
}

function childElements(parent, localName) {
    return Array.from(parent.children).filter(el => el.namespaceURI === XCCDF_NS && el.localName === localName);
}

/* The <select>/<set-value> entries of one profile (`profileId`), or of the
 * whole file when no id is given. */
export function parseTailoringXml(xmlContent, profileId) {
    const doc = new DOMParser().parseFromString(xmlContent, 'application/xml');
    const ruleChanges = {};
    const valueChanges = {};
    const profile = profileId ? findTailoringProfile(doc, profileId) : null;
    const all = localName => (profile
        ? childElements(profile, localName)
        : Array.from(doc.getElementsByTagNameNS(XCCDF_NS, localName)));

    all('select').forEach(el => {
        const idref = el.getAttribute('idref');
        if (idref) ruleChanges[idref] = el.getAttribute('selected') === 'true';
    });

    all('set-value').forEach(el => {
        const idref = el.getAttribute('idref');
        if (idref) valueChanges[idref] = el.textContent || '';
    });

    return { ruleChanges, valueChanges };
}

/* Applies the editor's state to an existing tailoring file in place: in the
 * profile `profileId`, sets the title and makes the <select>/<set-value>
 * entries match ruleChanges/valueChanges. Everything else in the file
 * (refine-rule, refine-value, other profiles, version, status, extends) is
 * kept as it was, so an uploaded policy survives being edited (F5). */
export function updateTailoringXml(xmlContent, profileId, title, ruleChanges, valueChanges) {
    const doc = new DOMParser().parseFromString(xmlContent, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length)
        throw new Error('The tailoring file is not valid XML.');
    const profile = findTailoringProfile(doc, profileId);
    if (!profile)
        throw new Error('The tailoring file has no Profile to update.');

    const prefix = profile.prefix ? profile.prefix + ':' : '';
    const isBlank = node => node?.nodeType === Node.TEXT_NODE && !node.data.trim();
    const indent = (isBlank(profile.previousSibling) && /\n([ \t]*)$/.exec(profile.previousSibling.data)?.[1]) || '  ';
    const childIndent = '\n' + indent + '  ';
    // Puts `el` on its own line before `node` (null: at the end of the
    // profile, before its closing tag's indentation).
    function insertBefore(el, node) {
        let anchor = node ?? (isBlank(profile.lastChild) ? profile.lastChild : null);
        if (node && isBlank(node.previousSibling)) anchor = node.previousSibling;
        profile.insertBefore(doc.createTextNode(childIndent), anchor);
        profile.insertBefore(el, anchor);
    }
    function insertAfter(el, node) {
        profile.insertBefore(el, node.nextSibling);
        profile.insertBefore(doc.createTextNode(childIndent), el);
    }
    function remove(el) {
        if (isBlank(el.previousSibling)) el.previousSibling.remove();
        el.remove();
    }

    const titleEl = childElements(profile, 'title')[0];
    if (titleEl) {
        titleEl.textContent = title;
    } else {
        // title follows status, dc-status and version
        const t = doc.createElementNS(XCCDF_NS, prefix + 'title');
        t.textContent = title;
        insertBefore(t, Array.from(profile.children).find(el => !['status', 'dc-status', 'version'].includes(el.localName)) || null);
    }

    function sync(localName, changes, apply) {
        const seen = new Set();
        childElements(profile, localName).forEach(el => {
            const idref = el.getAttribute('idref');
            if (!(idref in changes) || seen.has(idref)) {
                remove(el);
            } else {
                seen.add(idref);
                apply(el, changes[idref]);
            }
        });
        Object.entries(changes).forEach(([idref, val]) => {
            if (seen.has(idref)) return;
            const el = doc.createElementNS(XCCDF_NS, prefix + localName);
            el.setAttribute('idref', idref);
            apply(el, val);
            // After the last of its kind; a first select goes before the
            // set-values, a first set-value after the selects (the order
            // generateTailoringXml writes); else before <signature>, the
            // last element a Profile may hold, else at the end.
            const last = childElements(profile, localName).pop() ||
                (localName === 'set-value' ? childElements(profile, 'select').pop() : null);
            if (last)
                insertAfter(el, last);
            else
                insertBefore(el, (localName === 'select' && childElements(profile, 'set-value')[0]) ||
                                 childElements(profile, 'signature')[0] || null);
        });
    }
    sync('select', ruleChanges, (el, sel) => el.setAttribute('selected', String(sel)));
    sync('set-value', valueChanges, (el, val) => { el.textContent = String(val) });

    // Only the root element is serialized; the text around it (declaration,
    // comments, PIs, blank lines, line endings, final newline) is copied
    // from the file as it was, which XMLSerializer does not keep (P1).
    const [start, end] = rootElementSpan(xmlContent);
    return xmlContent.slice(0, start) +
        new XMLSerializer().serializeToString(doc.documentElement) +
        xmlContent.slice(end);
}

/* [offset of the root element's start tag, offset just past its end tag]
 * in well-formed XML source. Skips the declaration, comments, PIs, a
 * DOCTYPE and CDATA, and quoted attribute values (which may hold '>'). */
export function rootElementSpan(src) {
    const past = (s, from) => {
        const j = src.indexOf(s, from);
        if (j < 0) throw new Error('The tailoring file is not valid XML.');
        return j + s.length;
    };
    const tag = /<(\/?)[^\s/>]+(?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*(\/?)>/y;
    let i = 0;
    let depth = 0;
    let start = -1;
    for (;;) {
        const lt = src.indexOf('<', i);
        if (lt < 0) throw new Error('The tailoring file is not valid XML.');
        if (src.startsWith('<!--', lt)) {
            i = past('-->', lt + 4);
        } else if (src.startsWith('<![CDATA[', lt)) {
            i = past(']]>', lt + 9);
        } else if (src.startsWith('<?', lt)) {
            i = past('?>', lt + 2);
        } else if (src.startsWith('<!', lt)) {
            // DOCTYPE, maybe with an internal subset holding '>'
            let j = lt + 2;
            for (let open = 0; src[j] !== '>' || open; j++) {
                if (j >= src.length) throw new Error('The tailoring file is not valid XML.');
                if (src[j] === '"' || src[j] === "'") j = past(src[j], j + 1) - 1;
                else if (src.startsWith('<!--', j)) j = past('-->', j + 4) - 1;
                else if (src[j] === '[') open++;
                else if (src[j] === ']') open--;
            }
            i = j + 1;
        } else {
            tag.lastIndex = lt;
            const m = tag.exec(src);
            if (!m) throw new Error('The tailoring file is not valid XML.');
            if (start < 0) start = lt;
            depth += m[1] ? -1 : m[2] ? 0 : 1;
            i = tag.lastIndex;
            if (depth === 0) return [start, i];
        }
    }
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

/* Bytes used by ~/SCAP/tailoring (user-owned, no superuser); 0 before the
 * first policy is saved. */
export async function getTailoringDiskUsage() {
    return diskUsageBytes(await getTailoringDir());
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

    const written = await readUserFile(xmlPath);
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
        output = await spawnUserRead(['ls', dir]);
    } catch {
        return [];
    }
    const files = output.trim().split('\n')
            .filter(f => f && f.endsWith('.json'));
    const sidecars = await Promise.all(files.map(async f => {
        try {
            const content = await readUserFile(`${dir}/${f}`);
            return JSON.parse(content);
        } catch {
            return null;
        }
    }));
    return sidecars.filter(Boolean).sort((a, b) => (b.created || '').localeCompare(a.created || ''));
}

export async function readTailoringXml(path) {
    return readUserFile(path);
}

export async function saveNewTailoring({ baseProfileId, baseProfileTitle, newProfileTitle, sdsPath, ruleChanges, valueChanges }) {
    const dir = await getTailoringDir();
    const safeName = safeSlug(newProfileTitle);
    const newProfileId = 'xccdf_cockpit-scap_profile_' + safeName;
    const ts = makeTimestamp();
    const filename = safeName + '-' + ts;
    const xmlPath = `${dir}/${filename}.xml`;
    const jsonPath = `${dir}/${filename}.json`;

    const xml = generateTailoringXml(baseProfileId, newProfileId, newProfileTitle, ruleChanges, valueChanges, sdsPath);
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
    const xml = updateTailoringXml(await readTailoringXml(sidecar.path), sidecar.profile_id, title, ruleChanges, valueChanges);
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

    const { ruleChanges } = parseTailoringXml(xmlContent, profileId);
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
