'use strict';

const MODULE_VERSION = 'v3.10.1';
const SSG_CONTENT_DIR = '/usr/share/xml/scap/ssg/content/';
const RESULTS_BASE    = '/var/lib/cockpit-scap/results/';
const TAILORING_BASE  = '/var/lib/cockpit-scap/tailoring/';
const CONTENT_BASE    = '/var/lib/cockpit-scap/content/';
const REMEDIATION_LOG_BASE = '/var/lib/cockpit-scap/remediation-logs/';

const SDS_DISPLAY_NAMES = {
    'ssg-rhel10-ds.xml':     'Red Hat Enterprise Linux 10',
    'ssg-rhel9-ds.xml':      'Red Hat Enterprise Linux 9',
    'ssg-rhel8-ds.xml':      'Red Hat Enterprise Linux 8',
    'ssg-rhel7-ds.xml':      'Red Hat Enterprise Linux 7',
    'ssg-rhel6-ds.xml':      'Red Hat Enterprise Linux 6',
    'ssg-fedora-ds.xml':     'Fedora',
    'ssg-ol8-ds.xml':        'Oracle Linux 8',
    'ssg-ol9-ds.xml':        'Oracle Linux 9',
    'ssg-ubuntu2204-ds.xml': 'Ubuntu 22.04',
    'ssg-ubuntu2404-ds.xml': 'Ubuntu 24.04',
};

const SETTINGS_PATH      = '/var/lib/cockpit-scap/settings.json';
const RETENTION_DEFAULT  = 5;
const RETENTION_MIN      = 1;
const RETENTION_MAX      = 50;
let   hostRetention        = RETENTION_DEFAULT;
let   containerRetention   = RETENTION_DEFAULT;
let   containerScanEnabled  = false;
let   tailoringEnabled      = true;
let   hostScanTabEnabled    = true;
let   inPlaceRemEnabled     = true;

const PERSISTENCE_CACHE_PATH = '/var/lib/cockpit-scap/persistence-cache.json';
const ACTIVITY_LOG   = '/var/lib/cockpit-scap/activity.log';
const ACTIVITY_MAX   = 1000;
const ACTIVITY_TRIM  = 500;

/* Python script: parse results.xml server-side — avoids sending the
 * full file (15–18 MB) over WebSocket which exceeds Cockpit's limit. */
const PY_PARSE_RESULTS = [
    'import xml.etree.ElementTree as ET, json, sys',
    'path = sys.argv[1]',
    'result_id = ""; score = 0.0',
    'counts = {"pass":0,"fail":0,"error":0,"notchecked":0,"notapplicable":0,"notselected":0}',
    'sev = {"high":0,"medium":0,"low":0}',
    'def t(tag): return tag.split("}")[-1] if "}" in tag else tag',
    'for _, el in ET.iterparse(path, events=("end",)):',
    '    tag = t(el.tag)',
    '    if tag == "TestResult": result_id = el.get("id", "")',
    '    elif tag == "score":',
    '        try: score = float(el.text or "0")',
    '        except: pass',
    '    elif tag == "rule-result":',
    '        severity = el.get("severity", "")',
    '        for ch in el:',
    '            if t(ch.tag) == "result":',
    '                v = (ch.text or "").strip()',
    '                if v in counts: counts[v] += 1',
    '                if v == "fail" and severity in sev: sev[severity] += 1',
    '        el.clear()',
    'print(json.dumps({"result_id": result_id, "score": score, "counts": counts, "sev": sev}))',
].join('\n');

/* Python script: parse an SDS file, extract a profile's rule tree and values.
 * Uses iterparse with early break to avoid loading the ~35MB OVAL section.
 * Args: sys.argv[1]=profileId  sys.argv[2]=sdsPath
 * Output: JSON {profile, groups, rules, values} */
const PY_EXTRACT_PROFILE = [
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

/* Python script: extract failing rules from results.xml.
 * Args: sys.argv[1]=resultsXmlPath
 * Output: JSON [{id, title, severity}] sorted high→medium→low */
const PY_EXTRACT_FAILING_RULES = [
    'import sys, json, re, xml.etree.ElementTree as ET',
    'from collections import defaultdict',
    'NS = "http://checklists.nist.gov/xccdf/1.2"',
    'REF_KEEP = [("800-53","NIST 800-53"),("800-171","NIST 800-171"),("cswp","NIST CSF"),("pcisecuritystandards.org","PCI-DSS"),("docs-prv.pci","PCI-DSS"),("cyber.mil/stigs","DISA"),("iase.disa.mil","DISA"),("cisecurity.org/benchmark","CIS Benchmark"),("cisecurity.org/controls","CIS Controls")]',
    'tree = ET.parse(sys.argv[1])',
    'root = tree.getroot()',
    'rinfo = {}',
    'for rule in root.iter("{%s}Rule" % NS):',
    '    rid = rule.get("id", "")',
    '    t = rule.find("{%s}title" % NS)',
    '    ci = next((i for i in rule.findall("{%s}ident" % NS) if "cce" in (i.get("system","")).lower()), None)',
    '    cce = ci.text.strip() if ci is not None else ""',
    '    d_el = rule.find("{%s}description" % NS)',
    '    desc = " ".join("".join(d_el.itertext()).split()) if d_el is not None else ""',
    '    r_el = rule.find("{%s}rationale" % NS)',
    '    rat  = " ".join("".join(r_el.itertext()).split()) if r_el is not None else ""',
    '    fx_el = next((f for f in rule.findall("{%s}fix" % NS) if "sh" in (f.get("system","") or "")), None)',
    '    fix  = "".join(fx_el.itertext()).strip() if fx_el is not None else ""',
    '    rb = defaultdict(list); rh = {}',
    '    for ref in rule.findall("{%s}reference" % NS):',
    '        href = ref.get("href",""); text = (ref.text or "").strip()',
    '        if not text: continue',
    '        hl = href.lower()',
    '        for pat, lbl in REF_KEEP:',
    '            if pat in hl:',
    '                if lbl not in rh: rh[lbl] = href',
    '                rb[lbl].append(text); break',
    '    refs = [{"label":lbl,"href":rh[lbl],"values":rb[lbl]} for lbl in rb]',
    '    rinfo[rid] = (t.text.strip() if t is not None else rid, rule.get("severity","unknown"), cce, desc, rat, float(rule.get("weight","1.0")), fix, refs)',
    'has_rem = False; auto_rules = set()',
    'if len(sys.argv) > 2:',
    '    try:',
    '        auto_rules = set(re.findall(r"# BEGIN fix \\([^)]+\\) for \'([^\']+)\'", open(sys.argv[2]).read()))',
    '        has_rem = True',
    '    except: pass',
    'fails = []; errors = []; notchecked = []; notapplicable = []; seen = set(); total_w = 0.0',
    'for rr in root.iter("{%s}rule-result" % NS):',
    '    r = rr.find("{%s}result" % NS)',
    '    if r is None: continue',
    '    res = r.text; rid = rr.get("idref","")',
    '    if rid in seen: continue',
    '    seen.add(rid)',
    '    msg_el = rr.find("{%s}message" % NS)',
    '    msg = (msg_el.text or "").strip() if msg_el is not None else ""',
    '    t, s, cce, desc, rat, w, fix, refs = rinfo.get(rid, (rid, rr.get("severity","unknown"), "", "", "", 1.0, "", []))',
    '    if res not in ("notapplicable", "notselected"): total_w += w',
    '    if res == "fail":',
    '        rule_obj = {"id":rid,"title":t,"severity":s,"cce":cce,"desc":desc,"rat":rat,"weight":w,"fix":fix,"refs":refs}',
    '        if has_rem: rule_obj["automated"] = rid in auto_rules',
    '        fails.append(rule_obj)',
    '    elif res == "error":',
    '        errors.append({"id":rid,"title":t,"severity":s,"cce":cce,"message":msg})',
    '    elif res == "notchecked":',
    '        notchecked.append({"id":rid,"title":t,"severity":s,"cce":cce,"message":msg})',
    '    elif res == "notapplicable":',
    '        notapplicable.append({"id":rid,"title":t,"severity":s,"cce":cce,"desc":desc})',
    'order = {"high":0,"medium":1,"low":2}',
    'fails.sort(key=lambda x:(order.get(x["severity"],3),x["title"].lower()))',
    'print(json.dumps({"fails":fails,"errors":errors,"notchecked":notchecked,"notapplicable":notapplicable,"total_weight":total_w}))',
].join('\n');

/* Python script: diff two results.xml files.
 * Args: sys.argv[1]=newer results.xml  sys.argv[2]=older results.xml
 * Output: JSON {fixed:[...], regressed:[...], new_failures:[...]} */
/* Python script: compute persistent failures across N results.xml files.
 * Args: sys.argv[1..N] = results.xml paths, newest first.
 * Output: JSON array of rules failing in most recent scan, with consecutive_scans count. */
const PY_BUILD_PERSISTENCE = [
    'import sys, json, xml.etree.ElementTree as ET',
    'NS = "http://checklists.nist.gov/xccdf/1.2"',
    'paths = sys.argv[1:]',
    'scan_fails = []',
    'rule_info = {}',
    'for i, path in enumerate(paths):',
    '    try:',
    '        tree = ET.parse(path)',
    '        root = tree.getroot()',
    '        if i == 0:',
    '            for rule in root.iter("{%s}Rule" % NS):',
    '                rid = rule.get("id", "")',
    '                t = rule.find("{%s}title" % NS)',
    '                ci = next((x for x in rule.findall("{%s}ident" % NS) if "cce" in (x.get("system","")).lower()), None)',
    '                rule_info[rid] = {"title": t.text.strip() if t is not None else rid, "severity": rule.get("severity","unknown"), "cce": ci.text.strip() if ci is not None else ""}',
    '        fails = set()',
    '        for rr in root.iter("{%s}rule-result" % NS):',
    '            r = rr.find("{%s}result" % NS)',
    '            if r is not None and r.text == "fail": fails.add(rr.get("idref",""))',
    '        scan_fails.append(fails)',
    '    except: scan_fails.append(set())',
    'if not scan_fails: print(json.dumps([])); sys.exit(0)',
    'results = []',
    'for rid in scan_fails[0]:',
    '    consecutive = 0',
    '    for s in scan_fails:',
    '        if rid in s: consecutive += 1',
    '        else: break',
    '    info = rule_info.get(rid, {"title": rid, "severity": "unknown", "cce": ""})',
    '    results.append({"id": rid, "title": info["title"], "severity": info["severity"], "cce": info["cce"], "consecutive_scans": consecutive})',
    'order = {"high":0,"critical":0,"medium":1,"low":2}',
    'results.sort(key=lambda x: (-x["consecutive_scans"], order.get(x["severity"],3), x["title"].lower()))',
    'print(json.dumps(results))',
].join('\n');

/* Python script: extract XCCDF benchmark version + file size from an SDS file.
 * Uses iterparse with early break — stops reading as soon as xccdf:version found.
 * Output: "<bytes> <version_string>"  e.g.  "35123456 0.1.73" */
const PY_SDS_VERSION = [
    'import xml.etree.ElementTree as ET, os, sys',
    'path = sys.argv[1]',
    'size = os.path.getsize(path)',
    'version = "?"',
    'for _, el in ET.iterparse(path, events=("end",)):',
    '    tag = el.tag.split("}")[-1] if "}" in el.tag else el.tag',
    '    ns  = el.tag.split("}")[0][1:] if "}" in el.tag else ""',
    '    if tag == "version" and "xccdf" in ns:',
    '        version = (el.text or "?").strip()',
    '        break',
    '    el.clear()',
    'print(str(size) + " " + version)',
].join('\n');

const PY_SCAN_DIFF = [
    'import sys, json, xml.etree.ElementTree as ET',
    'NS = "http://checklists.nist.gov/xccdf/1.2"',
    'def parse(path):',
    '    root = ET.parse(path).getroot()',
    '    ri = {}',
    '    for rule in root.iter("{%s}Rule" % NS):',
    '        rid = rule.get("id","")',
    '        t = rule.find("{%s}title" % NS)',
    '        ci = next((i for i in rule.findall("{%s}ident" % NS) if "cce" in (i.get("system","")).lower()), None)',
    '        ri[rid] = (t.text.strip() if t is not None else rid, rule.get("severity","unknown"), ci.text.strip() if ci is not None else "")',
    '    res = {}; seen = set()',
    '    for rr in root.iter("{%s}rule-result" % NS):',
    '        rid = rr.get("idref","");',
    '        if rid in seen: continue',
    '        seen.add(rid)',
    '        r = rr.find("{%s}result" % NS)',
    '        res[rid] = r.text if r is not None else "unknown"',
    '    return ri, res',
    'new_info, new_res = parse(sys.argv[1])',
    '_, old_res = parse(sys.argv[2])',
    'fixed=[]; regressed=[]; new_fail=[]',
    'order={"high":0,"medium":1,"low":2}',
    'for rid in set(new_res)|set(old_res):',
    '    o=old_res.get(rid); n=new_res.get(rid)',
    '    t,s,cce=new_info.get(rid,(rid,"unknown",""))',
    '    item={"id":rid,"title":t,"severity":s,"cce":cce}',
    '    if o=="fail" and n=="pass": fixed.append(item)',
    '    elif o=="pass" and n=="fail": regressed.append(item)',
    '    elif o is None and n=="fail": new_fail.append(item)',
    'srt=lambda x:(order.get(x["severity"],3),x["title"].lower())',
    'print(json.dumps({"fixed":sorted(fixed,key=srt),"regressed":sorted(regressed,key=srt),"new_failures":sorted(new_fail,key=srt)}))',
].join('\n');

/* Python script: filter an existing remediation file to selected rule IDs.
 * Args: sys.argv[1]=remFilePath  sys.argv[2]=fixType('bash'|'ansible')
 *       sys.argv[3]=JSON array of selected full rule IDs
 * Output: filtered script content on stdout */
const PY_FILTER_FIX = [
    'import sys, json, re',
    'rem_path, fix_type, selected_json = sys.argv[1], sys.argv[2], sys.argv[3]',
    'selected = set(json.loads(selected_json))',
    'with open(rem_path) as f: script = f.read()',
    'if fix_type == "bash":',
    '    lines = script.split("\\n")',
    '    header = []; in_block = False; cur_rule = None; block = []; pre = []; out = []',
    '    for line in lines:',
    '        if not in_block:',
    '            if re.match(r"^#{20,}$", line.strip()):',
    '                pre.append(line)',
    '            elif "# BEGIN fix" in line:',
    '                m = re.search(r"for \'([^\']+)\'", line)',
    '                if m: cur_rule = m.group(1); block = pre + [line]; pre = []; in_block = True',
    '                else: header.extend(pre); header.append(line); pre = []',
    '            else: header.extend(pre); header.append(line); pre = []',
    '        else:',
    '            block.append(line)',
    '            if "# END fix for" in line:',
    '                if cur_rule in selected: out.append("\\n".join(block))',
    '                in_block = False; cur_rule = None; block = []',
    '    sys.stdout.write("\\n".join(header) + "\\n\\n" + "\\n\\n".join(out))',
    'else:',
    '    short_sel = set()',
    '    for rid in selected:',
    '        short_sel.add(rid.split("_rule_")[-1] if "_rule_" in rid else rid)',
    '    lines = script.split("\\n")',
    '    ti = next((i for i, l in enumerate(lines) if re.match(r"^  tasks:\\s*$", l)), -1)',
    '    if ti == -1: sys.stdout.write(script); sys.exit(0)',
    '    header = "\\n".join(lines[:ti + 1])',
    '    task_lines = lines[ti + 1:]',
    '    blocks = []; cur = []',
    '    for line in task_lines:',
    '        if re.match(r"    - ", line) and cur: blocks.append(cur); cur = [line]',
    '        else: cur.append(line)',
    '    if cur: blocks.append(cur)',
    '    kept = []',
    '    for blk in blocks:',
    '        tags = set(re.findall(r"^      - (\\S+)", "\\n".join(blk), re.M))',
    '        if tags & short_sel: kept.append("\\n".join(blk))',
    '    sys.stdout.write(header + "\\n" + "\\n".join(kept))',
].join('\n');

/* Module state — scan */
let currentSdsPath        = null;
let currentSdsVersion     = null;
let currentScanProc       = null;
let currentTimestamp      = null;
let currentResultsDir     = null;
let currentRemBashPath      = null;
let currentRemAnsiblePath   = null;
let currentManifest         = null;
let scanCancelledByUser     = false;
let remediationGenerating   = false;

/* Module state — selective remediation */
let remediationDir   = null;   /* full path to scan results dir, trailing slash */
let remediationRules = [];     /* [{id, title, severity}] from last load */
let eagerRemRules    = null;   /* pre-loaded rules for Action Board / panel reuse */
let quickFixMode     = 'high'; /* 'high' or 'medium' — set when eagerRemRules loads */
let pendingQuickFix        = false;  /* when true, renderRemediationRules pre-selects recommended only */
let pendingPersistentRuleIds = null; /* when set, renderRemediationRules pre-selects these rule IDs */

/* Module state — tailoring */
let tailorSdsPath         = null;
let tailorData            = null;
let tailorRuleChanges     = {};
let tailorValueChanges    = {};
let tailorEditingSidecar  = null;
let tailorFilterStatus    = 'all';
let tailorFilterSev       = 'all';
let tailoringFilesMap   = {};
let tailoringFilesGen   = 0;
let allTailoringSidecars = [];

/* Module state — content */
let hostOsVersion     = null;   /* cached from /etc/os-release at startup */
let hostOsId          = null;   /* cached from /etc/os-release at startup */
let hostName          = 'Local host';
let currentHostHistory = [];    /* last rendered host scan manifests */

/* Module state — confirm modal */
let confirmCallback  = null;
let adminPermission  = null;
let currentUser      = null;

/* Module state — scan timer */
let hostScanTimer    = null;
let hostScanStart    = null;

/* Module state — apply now */
let pendingApplyScript = '';

document.addEventListener('DOMContentLoaded', () => {
    const verEl = document.getElementById('ct-module-version');
    if (verEl) verEl.textContent = MODULE_VERSION;

    cockpit.file('/etc/os-release').read()
        .then(content => {
            const mv = content && content.match(/^VERSION_ID="?(\d+)/m);
            hostOsVersion = mv ? parseInt(mv[1], 10) : null;
            const mi = content && content.match(/^ID="?([^"\n]+)"?/m);
            hostOsId = mi ? mi[1].trim() : null;
        })
        .catch(() => {});

    cockpit.spawn(['hostname', '--short']).then(h => { hostName = h.trim() || 'Local host'; }).catch(() => {});

    cockpit.user().then(u => { currentUser = u.name || u.full || '?'; }).catch(() => {});

    loadSettings();
    initTabs();
    detectContent();
    loadHistory();
    detectTailoringFiles();
    renderContentTab();
    initContainerScan();
    initSettings();

    /* Scan tab */
    document.getElementById('ct-content-select')
        .addEventListener('change', onContentChange);
    document.getElementById('ct-profile-select')
        .addEventListener('change', onProfileChange);
    document.getElementById('ct-tailor-file-select')
        .addEventListener('change', onTailorFileSelectChange);
    document.getElementById('ct-scan-btn')
        .addEventListener('click', onScanClick);
    document.getElementById('ct-cancel-btn')
        .addEventListener('click', onCancelClick);
    document.getElementById('ct-view-report-btn')
        .addEventListener('click', viewReport);
    document.getElementById('ct-download-report-btn')
        .addEventListener('click', e => {
            const btn = e.currentTarget;
            const orig = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Generating…';
            generateReport(currentResultsDir + 'results.xml')
                .then(html => {
                    const blob = new Blob([html], { type: 'text/html' });
                    const url  = URL.createObjectURL(blob);
                    const a    = document.createElement('a');
                    a.href = url; a.download = 'scap-report-' + currentTimestamp + '.html';
                    document.body.appendChild(a); a.click();
                    document.body.removeChild(a); URL.revokeObjectURL(url);
                    btn.textContent = '✓ Downloaded';
                    setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 2000);
                })
                .catch(() => { btn.disabled = false; btn.textContent = orig; });
        });
    document.getElementById('ct-download-xml-btn')
        .addEventListener('click', e => downloadArtifact(
            currentResultsDir + 'results.xml',
            'scap-results-' + currentTimestamp + '.xml',
            'application/xml',
            e.currentTarget
        ));
    document.getElementById('ct-download-arf-btn')
        .addEventListener('click', e => {
            const btn    = e.currentTarget;
            const orig   = btn.textContent;
            const gzPath = currentResultsDir + 'results.arf.gz';
            btn.disabled = true;
            btn.textContent = 'Downloading…';
            /* cockpit.file() is text-only; binary gzip requires cockpit.spawn cat with binary:true */
            cockpit.spawn(['cat', gzPath], { binary: true, superuser: 'try', err: 'message' })
                .then(content => {
                    const blob = new Blob([content], { type: 'application/gzip' });
                    const url  = URL.createObjectURL(blob);
                    const a    = document.createElement('a');
                    a.href = url; a.download = 'scap-results-arf-' + currentTimestamp + '.xml.gz';
                    document.body.appendChild(a); a.click();
                    document.body.removeChild(a); URL.revokeObjectURL(url);
                    btn.textContent = '✓ Downloaded';
                    setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 2000);
                })
                .catch(() => {
                    /* Fall back to uncompressed ARF for pre-v3.9 scans */
                    cockpit.file(currentResultsDir + 'results.arf', { max_read_size: -1, superuser: 'try' }).read()
                        .then(content => {
                            if (!content) throw new Error('not found');
                            const blob = new Blob([content], { type: 'application/xml' });
                            const url  = URL.createObjectURL(blob);
                            const a    = document.createElement('a');
                            a.href = url; a.download = 'scap-results-arf-' + currentTimestamp + '.xml';
                            document.body.appendChild(a); a.click();
                            document.body.removeChild(a); URL.revokeObjectURL(url);
                            btn.textContent = '✓ Downloaded';
                            setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 2000);
                        })
                        .catch(() => { btn.disabled = false; btn.textContent = orig; });
                });
        });
    document.getElementById('ct-export-report-default')
        .addEventListener('click', e => {
            const btn = e.currentTarget;
            const orig = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Generating…';
            generateReport(currentResultsDir + 'results.xml')
                .then(html => {
                    const blob = new Blob([html], { type: 'text/html' });
                    const url  = URL.createObjectURL(blob);
                    const a    = document.createElement('a');
                    a.href = url; a.download = 'scap-report-' + currentTimestamp + '.html';
                    document.body.appendChild(a); a.click();
                    document.body.removeChild(a); URL.revokeObjectURL(url);
                    btn.textContent = '✓ Downloaded';
                    setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 2000);
                })
                .catch(() => { btn.disabled = false; btn.textContent = orig; });
        });
    document.getElementById('ct-export-toggle')
        .addEventListener('click', e => {
            e.stopPropagation();
            const menu = document.getElementById('ct-export-menu');
            const toggle = e.currentTarget;
            const open = menu.classList.toggle('hidden') === false;
            toggle.setAttribute('aria-expanded', String(open));
        });
    document.getElementById('ct-export-menu')
        .addEventListener('click', () => {
            document.getElementById('ct-export-menu').classList.add('hidden');
            document.getElementById('ct-export-toggle').setAttribute('aria-expanded', 'false');
        });
    document.addEventListener('click', e => {
        [
            ['ct-export-toggle',          'ct-export-menu'],
            ['ct-profile-rem-toggle',     'ct-profile-rem-menu'],
            ['ct-tailor-profile-rem-toggle', 'ct-tailor-profile-rem-menu'],
        ].forEach(([toggleId, menuId]) => {
            const menu = document.getElementById(menuId);
            if (menu && !menu.classList.contains('hidden') &&
                !e.target.closest('#' + toggleId) && !e.target.closest('#' + menuId)) {
                menu.classList.add('hidden');
                document.getElementById(toggleId).setAttribute('aria-expanded', 'false');
            }
        });
    });
    document.getElementById('ct-new-scan-btn')
        .addEventListener('click', () => {
            if (currentManifest) rerunHostScan(currentManifest);
            else showScanSetup();
        });
    document.getElementById('ct-results-close-btn')
        .addEventListener('click', () => {
            if (currentScanProc) {
                document.getElementById('ct-results').classList.add('hidden');
                syncHostHistoryHighlight();
            } else {
                currentTimestamp = null;
                showScanSetup();
            }
        });
    document.getElementById('ct-scan-error-close')
        .addEventListener('click', hideScanError);
    document.getElementById('ct-profile-rem-toggle')
        .addEventListener('click', e => {
            e.stopPropagation();
            const menu = document.getElementById('ct-profile-rem-menu');
            const open = menu.classList.toggle('hidden') === false;
            e.currentTarget.setAttribute('aria-expanded', String(open));
        });
    document.getElementById('ct-profile-rem-menu')
        .addEventListener('click', e => {
            const item = e.target.closest('[data-fix-type]');
            if (!item) return;
            const toggle = document.getElementById('ct-profile-rem-toggle');
            document.getElementById('ct-profile-rem-menu').classList.add('hidden');
            toggle.setAttribute('aria-expanded', 'false');
            downloadProfileRemediation(item.dataset.fixType, toggle);
        });
    document.getElementById('ct-scan-cmd-copy')
        .addEventListener('click', () => {
            const cmd = document.getElementById('ct-scan-cmd').textContent;
            navigator.clipboard.writeText(cmd).then(() => {
                const btn = document.getElementById('ct-scan-cmd-copy');
                const orig = btn.textContent;
                btn.textContent = '✓ Copied';
                setTimeout(() => { btn.textContent = orig; }, 2000);
            }).catch(() => {});
        });
    document.getElementById('ct-quick-fix-btn')
        .addEventListener('click', onQuickFixClick);
    document.getElementById('ct-review-all-btn')
        .addEventListener('click', () => openRemediationPanel(currentResultsDir));
    document.getElementById('ct-rem-apply-btn')
        .addEventListener('click', onApplyNowClick);
    document.getElementById('ct-apply-gate1-proceed')
        .addEventListener('click', onApplyGate1Proceed);
    document.getElementById('ct-apply-gate1-cancel')
        .addEventListener('click', () => document.getElementById('ct-apply-gate1').classList.add('hidden'));
    document.getElementById('ct-apply-gate2-apply')
        .addEventListener('click', onApplyGate2Execute);
    document.getElementById('ct-apply-gate2-cancel')
        .addEventListener('click', () => document.getElementById('ct-apply-gate2').classList.add('hidden'));
    document.getElementById('ct-rem-bash-btn')
        .addEventListener('click', () => generateSelectiveFix('bash'));
    document.getElementById('ct-rem-ansible-btn')
        .addEventListener('click', () => generateSelectiveFix('ansible'));
    document.getElementById('ct-rem-search')
        .addEventListener('input', onRemediationSearch);
    document.getElementById('ct-failing-search')
        .addEventListener('input', () => onFailingSummarySearch('ct-failing-summary-groups', 'ct-failing-search'));
    document.getElementById('ct-expand-all')
        .addEventListener('click', () =>
            document.querySelectorAll('#ct-failing-summary-groups details.ct-failing-group')
                .forEach(d => { d.open = true; }));
    document.getElementById('ct-collapse-all')
        .addEventListener('click', () =>
            document.querySelectorAll('#ct-failing-summary-groups details.ct-failing-group')
                .forEach(d => { d.open = false; }));
    document.getElementById('ct-rem-select-all-btn')
        .addEventListener('click', () => {
            document.querySelectorAll('#ct-remediation-rules .ct-rem-rule-item:not([style*="none"]) .ct-rem-checkbox')
                .forEach(c => { c.checked = true; });
            updateRemediationCount();
        });
    document.getElementById('ct-rem-deselect-all-btn')
        .addEventListener('click', () => {
            document.querySelectorAll('#ct-remediation-rules .ct-rem-rule-item:not([style*="none"]) .ct-rem-checkbox')
                .forEach(c => { c.checked = false; });
            updateRemediationCount();
        });
    document.getElementById('ct-rem-close-btn')
        .addEventListener('click', closeRemDrawer);
    document.getElementById('ct-rdd-close-btn')
        .addEventListener('click', closeRuleDetailDrawer);
    document.getElementById('ct-drawer-backdrop')
        .addEventListener('click', () => { closeRemDrawer(); closeCsRemDrawer(); closeRuleDetailDrawer(); });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            closeRemDrawer(); closeCsRemDrawer(); closeRuleDetailDrawer();
            return;
        }
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' ||
            e.target.isContentEditable || e.ctrlKey || e.altKey || e.metaKey) return;

        if (e.key === '/') {
            const candidates = [
                document.getElementById('ct-failing-search'),
                document.getElementById('cs-failing-search'),
                document.getElementById('ct-rem-search'),
            ];
            const active = candidates.find(el => el && !el.classList.contains('hidden') && el.offsetParent !== null);
            if (active) { e.preventDefault(); active.focus(); active.select(); }
            return;
        }

        if (e.key === 'q' || e.key === 'Q') {
            const pairs = [
                [document.getElementById('ct-action-board'), document.getElementById('ct-quick-fix-btn')],
                [document.getElementById('cs-action-board'), document.getElementById('cs-quick-fix-btn')],
            ];
            for (const [board, btn] of pairs) {
                if (board && !board.classList.contains('hidden') && btn && !btn.disabled) {
                    btn.click(); break;
                }
            }
        }
    });

    /* Tailoring tab */
    document.getElementById('ct-tailor-content-select')
        .addEventListener('change', onTailorContentChange);
    document.getElementById('ct-tailor-profile-select')
        .addEventListener('change', onTailorProfileChange);
    document.getElementById('ct-tailor-name-input')
        .addEventListener('input', updateTailorLoadBtn);
    document.getElementById('ct-tailor-load-btn')
        .addEventListener('click', onTailorLoadClick);

    document.getElementById('ct-tailor-update-btn')
        .addEventListener('click', doUpdateTailoringFile);
    document.getElementById('ct-tailor-save-btn')
        .addEventListener('click', onTailorSaveClick);
    document.getElementById('ct-tailor-cancel-btn')
        .addEventListener('click', resetTailorForm);
    document.getElementById('ct-tailor-export-btn')
        .addEventListener('click', exportTailorSummary);
    document.getElementById('ct-tailor-filter-bar')
        .addEventListener('click', e => {
            const btn = e.target.closest('.ct-tailor-filter-btn');
            if (!btn) return;
            if (btn.dataset.filterStatus) {
                tailorFilterStatus = btn.dataset.filterStatus;
                btn.closest('.ct-tailor-filter-group')
                    .querySelectorAll('.ct-tailor-filter-btn')
                    .forEach(b => b.classList.toggle('active', b === btn));
            } else if (btn.dataset.filterSev) {
                tailorFilterSev = btn.dataset.filterSev;
                btn.closest('.ct-tailor-filter-group')
                    .querySelectorAll('.ct-tailor-filter-btn')
                    .forEach(b => b.classList.toggle('active', b === btn));
            }
            applyTailorFilter();
        });
    document.getElementById('ct-tailor-expand-all')
        .addEventListener('click', expandAllGroups);
    document.getElementById('ct-tailor-collapse-all')
        .addEventListener('click', collapseAllGroups);
    document.getElementById('ct-tailor-search')
        .addEventListener('input', onTailorSearch);
    document.getElementById('ct-tailor-values-search')
        .addEventListener('input', function () {
            const term = this.value.toLowerCase();
            document.querySelectorAll('#ct-tailor-values-grid .ct-tailor-value-row').forEach(row => {
                const label = row.querySelector('.ct-tailor-value-label');
                const text  = label ? label.textContent.toLowerCase() : '';
                row.classList.toggle('hidden', term.length > 0 && !text.includes(term));
            });
        });
    document.getElementById('ct-tailor-rules-header')
        .addEventListener('click', function () {
            const body = document.getElementById('ct-tailor-rules-body');
            const isCollapsed = body.classList.toggle('hidden');
            document.getElementById('ct-tailor-rules-collapse').textContent =
                isCollapsed ? 'Expand' : 'Collapse';
        });
    document.getElementById('ct-tailor-values-header')
        .addEventListener('click', function () {
            const grid   = document.getElementById('ct-tailor-values-grid');
            const search = document.getElementById('ct-tailor-values-search')
                               .closest('.ct-tailor-search-wrap');
            const isCollapsed = grid.classList.toggle('hidden');
            search.classList.toggle('hidden', isCollapsed);
            document.getElementById('ct-tailor-values-collapse').textContent =
                isCollapsed ? 'Expand' : 'Collapse';
        });
    document.getElementById('ct-tailor-upload-btn')
        .addEventListener('click', () => document.getElementById('ct-tailor-upload-input').click());
    document.getElementById('ct-tailor-upload-input')
        .addEventListener('change', e => {
            const file = e.target.files[0];
            if (file) handleTailoringUpload(file);
            e.target.value = '';
        });

    /* History empty state — scroll to scan config */
    document.getElementById('ct-history-empty-scan-btn')
        .addEventListener('click', () => {
            document.getElementById('ct-content-select').scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.getElementById('ct-content-select').focus();
        });

    /* History empty state — navigate to tailoring tab */
    document.getElementById('ct-history-empty-policy-btn')
        .addEventListener('click', () => {
            document.getElementById('tab-btn-tailoring').click();
        });

    /* Tailoring list empty state — scroll to tailoring editor */
    document.getElementById('ct-tailor-list-empty-btn')
        .addEventListener('click', () => {
            document.getElementById('ct-tailor-content-select').scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.getElementById('ct-tailor-content-select').focus();
        });

    /* Content tab */
    document.getElementById('ct-content-refresh-btn')
        .addEventListener('click', () => { renderContentTab(); detectContent(); });

    /* Admin permission gate — disables upload/delete controls for non-admins.
     * cockpit.permission is not available in all Cockpit versions; guard defensively. */
    if (typeof cockpit.permission === 'function') {
        adminPermission = cockpit.permission({ admin: true });
        adminPermission.addEventListener('changed', updateAdminControls);
        updateAdminControls();
    }

    document.getElementById('ct-content-upload-btn')
        .addEventListener('click', () => document.getElementById('ct-content-upload-input').click());

    document.getElementById('ct-content-upload-input')
        .addEventListener('change', e => {
            const file = e.target.files[0];
            if (file) uploadContent(file);
            e.target.value = '';
        });

    /* Confirm modal */
    document.getElementById('ct-confirm-ok')
        .addEventListener('click', () => {
            if (confirmCallback) confirmCallback();
            hideConfirmModal();
        });
    document.getElementById('ct-confirm-cancel')
        .addEventListener('click', hideConfirmModal);

    /* Info modal */
    document.getElementById('ct-info-ok')
        .addEventListener('click', () => document.getElementById('ct-info-backdrop').classList.add('hidden'));

    /* Guide buttons */
    document.getElementById('ct-guide-btn')
        .addEventListener('click', onViewGuideClick);
    document.getElementById('ct-tailor-guide-btn')
        .addEventListener('click', onTailorViewGuideClick);
    document.getElementById('ct-tailor-profile-rem-toggle')
        .addEventListener('click', e => {
            e.stopPropagation();
            const menu = document.getElementById('ct-tailor-profile-rem-menu');
            const open = menu.classList.toggle('hidden') === false;
            e.currentTarget.setAttribute('aria-expanded', String(open));
        });
    document.getElementById('ct-tailor-profile-rem-menu')
        .addEventListener('click', e => {
            const item = e.target.closest('[data-fix-type]');
            if (!item) return;
            const toggle = document.getElementById('ct-tailor-profile-rem-toggle');
            document.getElementById('ct-tailor-profile-rem-menu').classList.add('hidden');
            toggle.setAttribute('aria-expanded', 'false');
            downloadTailorProfileRemediation(item.dataset.fixType, toggle);
        });

    /* CSV export */
    document.getElementById('ct-export-csv-btn')
        .addEventListener('click', exportHostHistoryCSV);

    /* Activity tab */
    document.getElementById('ct-activity-export-btn')
        .addEventListener('click', exportActivityCSV);
    document.getElementById('ct-activity-limit')
        .addEventListener('change', loadActivityLog);
    document.getElementById('ct-activity-clear-btn')
        .addEventListener('click', () => {
            showConfirmModal(
                'Clear Activity Log',
                'All activity log entries will be permanently deleted. This cannot be undone.',
                clearActivityLog,
                'Clear Log'
            );
        });
    document.querySelectorAll('.ct-activity-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.ct-activity-chip').forEach(c => c.classList.remove('pf-m-active'));
            chip.classList.add('pf-m-active');
            loadActivityLog();
        });
    });

    document.getElementById('ct-activity-tbody').addEventListener('click', e => {
        const viewBtn = e.target.closest('.ct-activity-view-log');
        const dlBtn   = e.target.closest('.ct-activity-download-log');
        const btn     = viewBtn || dlBtn;
        if (!btn) return;
        const logPath = btn.dataset.logPath;
        if (!logPath) return;
        if (!normalizePath(logPath).startsWith(REMEDIATION_LOG_BASE)) return;
        cockpit.file(logPath, { superuser: 'require' }).read()
            .then(content => {
                if (dlBtn) {
                    const blob = new Blob([content || ''], { type: 'text/plain' });
                    const url  = URL.createObjectURL(blob);
                    const a    = document.createElement('a');
                    a.href     = url;
                    a.download = logPath.split('/').pop();
                    a.click();
                    URL.revokeObjectURL(url);
                    return;
                }
                document.getElementById('ct-log-modal-path').textContent = logPath;
                document.getElementById('ct-log-modal-content').textContent = content || '(empty)';
                document.getElementById('ct-log-modal').classList.remove('hidden');
            })
            .catch(err => {
                document.getElementById('ct-log-modal-path').textContent = logPath;
                document.getElementById('ct-log-modal-content').textContent =
                    'Log file not found — it may have been removed when scan data was cleared.\n\n' +
                    (err.message || String(err));
                document.getElementById('ct-log-modal').classList.remove('hidden');
            });
    });

    document.getElementById('ct-log-modal-close')
        .addEventListener('click', () => document.getElementById('ct-log-modal').classList.add('hidden'));

    document.getElementById('ct-apply-goto-activity')
        .addEventListener('click', () => { closeRemDrawer(); document.getElementById('tab-btn-activity').click(); });

    document.getElementById('ct-apply-download-log')
        .addEventListener('click', function() {
            const logPath = this.dataset.logPath;
            if (!logPath) return;
            cockpit.file(logPath, { superuser: 'require' }).read()
                .then(content => {
                    const a = document.createElement('a');
                    a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content || '');
                    a.download = logPath.split('/').pop();
                    a.click();
                }).catch(() => {});
        });
});

/* ---- Tab wiring -------------------------------------------- */

function initTabs() {
    const tabButtons = document.querySelectorAll('.pf-v6-c-tabs__link');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.panel;

            tabButtons.forEach(b => {
                b.closest('.pf-v6-c-tabs__item').classList.remove('pf-m-current');
                b.setAttribute('aria-selected', 'false');
            });

            document.querySelectorAll('.ct-tab-panel').forEach(p => {
                p.classList.add('hidden');
            });

            btn.closest('.pf-v6-c-tabs__item').classList.add('pf-m-current');
            btn.setAttribute('aria-selected', 'true');
            document.getElementById(targetId).classList.remove('hidden');

            if (targetId === 'panel-activity') {
                startActivityPoll();
            } else {
                stopActivityPoll();
            }
        });
    });
}

/* ---- Confirmation modal ------------------------------------ */

function showConfirmModal(title, body, onConfirm, confirmLabel = 'Delete') {
    document.getElementById('ct-confirm-title').textContent = title;
    document.getElementById('ct-confirm-body').textContent  = body;
    document.getElementById('ct-confirm-ok').textContent    = confirmLabel;
    confirmCallback = onConfirm;
    document.getElementById('ct-confirm-backdrop').classList.remove('hidden');
}

function hideConfirmModal() {
    document.getElementById('ct-confirm-backdrop').classList.add('hidden');
    confirmCallback = null;
}

/* ---- Content (SDS) detection ------------------------------- */

function hostSdsFilename() {
    if (!hostOsId) return null;
    const major = String(hostOsVersion || '');
    const nodot = major.replace('.', '');
    const map = {
        rhel:      `ssg-rhel${major}-ds.xml`,
        ol:        `ssg-ol${major}-ds.xml`,
        almalinux: `ssg-almalinux${major}-ds.xml`,
        centos:    `ssg-cs${major}-ds.xml`,
        fedora:    'ssg-fedora-ds.xml',
        ubuntu:    `ssg-ubuntu${nodot}-ds.xml`,
        debian:    `ssg-debian${major}-ds.xml`,
    };
    return map[hostOsId] || null;
}

function detectContent() {
    const scanSelect   = document.getElementById('ct-content-select');
    const tailorSelect = document.getElementById('ct-tailor-content-select');

    return Promise.all([listSystemContent(), listUserContent()])
        .then(([sysFiles, userFiles]) => {
            tailorSelect.innerHTML = '';
            scanSelect.innerHTML   = '';

            const scanSys  = sysFiles.filter(f => {
                const v = detectSdsVersion(f.path);
                return v === null || v === hostOsVersion;
            });
            const scanUser = userFiles.filter(f => {
                const v = detectSdsVersion(f.path);
                return v === null || v === hostOsVersion;
            });

            const tailorTotal = sysFiles.length + userFiles.length;
            const scanTotal   = scanSys.length  + scanUser.length;

            if (tailorTotal === 0) {
                showNoContentAlert();
                appendOption(scanSelect,   '', 'No content found');
                appendOption(tailorSelect, '', 'No content found');
                return;
            }

            hideNoContentAlert();

            // Tailor select always shows all content
            if (tailorTotal === 1) {
                const item = sysFiles.length ? sysFiles[0] : userFiles[0];
                appendOption(tailorSelect, item.path, item.name);
                tailorSelect.value = item.path;
                tailorSdsPath      = item.path;
                loadProfiles(item.path, 'ct-tailor-profile-select');
            } else {
                appendOption(tailorSelect, '', 'Select content…');
                populateContentOptGroups(tailorSelect, sysFiles, userFiles);
            }

            // Scan select shows only host-compatible content
            if (scanTotal === 0) {
                appendOption(scanSelect, '', 'No compatible content found');
                return;
            }

            if (scanTotal === 1) {
                const item = scanSys.length ? scanSys[0] : scanUser[0];
                appendOption(scanSelect, item.path, item.name);
                scanSelect.value = item.path;
                currentSdsPath   = item.path;
                loadProfiles(item.path);
                detectTailoringFiles();
                return;
            }

            appendOption(scanSelect, '', 'Select content…');
            populateContentOptGroups(scanSelect, scanSys, scanUser);
            const preferred = hostSdsFilename();
            const allScan = [...scanSys, ...scanUser];
            const match = preferred && allScan.find(f => f.filename === preferred);
            if (match) {
                scanSelect.value = match.path;
                currentSdsPath   = match.path;
                loadProfiles(match.path);
                detectTailoringFiles();
            }
        });
}

function populateContentOptGroups(sel, sysFiles, userFiles) {
    if (sysFiles.length > 0) {
        const grp = document.createElement('optgroup');
        grp.label = 'System Content';
        sysFiles.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.path;
            opt.textContent = f.name;
            grp.appendChild(opt);
        });
        sel.appendChild(grp);
    }
    if (userFiles.length > 0) {
        const grp = document.createElement('optgroup');
        grp.label = 'Uploaded Content';
        userFiles.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f.path;
            opt.textContent = f.name;
            grp.appendChild(opt);
        });
        sel.appendChild(grp);
    }
}

function listSystemContent() {
    return cockpit.spawn(['ls', SSG_CONTENT_DIR], { err: 'message' })
        .then(output => output.trim().split('\n')
            .filter(f => f.endsWith('-ds.xml'))
            .map(f => ({ path: SSG_CONTENT_DIR + f, name: sdsDisplayName(f), filename: f }))
        )
        .catch(() => []);
}

function listUserContent() {
    return cockpit.spawn(['ls', CONTENT_BASE], { err: 'message' })
        .then(output => output.trim().split('\n')
            .filter(f => f.endsWith('.xml'))
            .map(f => ({ path: CONTENT_BASE + f, name: sdsDisplayName(f), filename: f }))
        )
        .catch(() => []);
}

function onContentChange() {
    const sdsPath = document.getElementById('ct-content-select').value;

    resetProfileSelect();
    hideProfileDescription();
    setScanButtonEnabled(false);
    updateGuideButton();
    currentSdsPath = null;

    if (!sdsPath) {
        detectTailoringFiles();
        return;
    }

    currentSdsPath = sdsPath;
    loadProfiles(sdsPath);
    detectTailoringFiles();
}

/* ---- SDS version detection --------------------------------- */

function detectSdsVersion(sdsPath) {
    const m = sdsPath.match(/ssg-rhel(\d+)-ds\.xml$/);
    return m ? parseInt(m[1], 10) : null;
}

/* ---- Profile loading --------------------------------------- */

function loadProfiles(sdsPath, selectId) {
    const select = document.getElementById(selectId || 'ct-profile-select');

    select.innerHTML = '';
    appendOption(select, '', 'Loading profiles…');
    select.disabled = true;

    return cockpit.spawn(['oscap', 'info', sdsPath], { err: 'out' })
        .then(output => {
            const profiles = parseProfiles(output);

            select.innerHTML = '';

            if (profiles.length === 0) {
                appendOption(select, '', 'No profiles found');
                select.disabled = true;
                return output;
            }

            appendOption(select, '', 'Select a profile…');
            profiles.forEach(p => {
                appendOption(select, p.id, p.title);
            });

            select.disabled = false;
            return output;
        })
        .catch(err => {
            select.innerHTML = '';
            appendOption(select, '', 'Failed to load profiles');
            select.disabled = true;
            console.error('oscap info failed:', err.message || err);
        });
}

/*
 * Parse `oscap info <sds>` output.
 * Structure (each indent = one tab):
 *   \t\tProfiles:
 *   \t\t\tTitle: <title>
 *   \t\t\t\tId: <id>
 * Returns array of {id, title} objects.
 */
function parseProfiles(output) {
    const profiles = [];
    const lines = output.split('\n');
    let inProfiles = false;
    let pendingTitle = null;

    for (const line of lines) {
        if (!inProfiles) {
            if (/\tProfiles:/.test(line)) inProfiles = true;
            continue;
        }

        /* Exit when indentation drops back to 2 tabs or fewer (sibling section) */
        if (line.trim() !== '' && !/^\t{3}/.test(line)) {
            inProfiles = false;
            pendingTitle = null;
            continue;
        }

        const titleMatch = line.match(/^\t+Title:\s+(.+)$/);
        if (titleMatch) {
            pendingTitle = titleMatch[1].trim();
            continue;
        }

        const idMatch = line.match(/^\t+Id:\s+(.+)$/);
        if (idMatch && pendingTitle !== null) {
            profiles.push({ id: idMatch[1].trim(), title: pendingTitle });
            pendingTitle = null;
        }
    }

    return profiles;
}

/* ---- Profile selection & description ----------------------- */

function onProfileChange() {
    const profileId = document.getElementById('ct-profile-select').value;

    hideProfileDescription();
    setScanButtonEnabled(false);
    updateGuideButton();

    if (!profileId || !currentSdsPath) return;

    setScanButtonEnabled(true);
    updateGuideButton();
    loadProfileDescription(currentSdsPath, profileId);
}

function loadProfileDescription(sdsPath, profileId) {
    const select = document.getElementById('ct-profile-select');
    const profileTitle = select.options[select.selectedIndex].text;

    cockpit.spawn(['oscap', 'info', '--profile', profileId, sdsPath], { err: 'out' })
        .then(output => {
            const description = parseProfileDescription(output);
            if (description) {
                showProfileDescription(profileTitle, description);
            }
        })
        .catch(err => {
            console.error('oscap info --profile failed:', err.message || err);
        });
}

/*
 * Parse `oscap info --profile <id> <sds>` output.
 * Description follows "Description:" on the same line only.
 */
function parseProfileDescription(output) {
    for (const line of output.split('\n')) {
        const match = line.match(/^\s+Description:\s+(.+)$/);
        if (match) return match[1].trim();
    }
    return null;
}

/* ---- Scan execution ---------------------------------------- */

function makeTimestamp() {
    return new Date().toISOString()
        .replace(/\.\d{3}Z$/, '')
        .replace(/:/g, '-');
}

function formatDuration(seconds) {
    if (seconds < 60) return seconds + 's';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
}

function downloadArtifact(filePath, filename, mimeType, btn) {
    if (!filePath) return;
    cockpit.file(filePath, { max_read_size: -1, superuser: 'try' }).read()
        .then(content => {
            const blob = new Blob([content], { type: mimeType });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (btn) {
                const orig = btn.textContent;
                btn.textContent = '✓ Downloaded';
                setTimeout(() => { btn.textContent = orig; }, 2000);
            }
        })
        .catch(err => {
            console.error('Failed to download:', err);
            showInfoModal('Download Failed', err.message || String(err));
        });
}


function appendOption(select, value, text) {
    const opt       = document.createElement('option');
    opt.value       = value;
    opt.textContent = text;
    select.appendChild(opt);
}

function sdsDisplayName(filename) {
    return SDS_DISPLAY_NAMES[filename] ||
        filename.replace(/^ssg-/, '').replace(/-ds\.xml$/, '').replace(/-/g, ' ');
}

/* Remediation panel → remediation.js */
/* Host Scan tab + history → host-scan.js */
/* Settings tab + content management → settings.js */

function appendActivityLog(entry) {
    const line = JSON.stringify({ ts: new Date().toISOString(), user: currentUser || '?', ...entry });
    const f    = cockpit.file(ACTIVITY_LOG, { superuser: 'require' });
    f.read()
        .then(content => {
            const lines   = (content || '').split('\n').filter(l => l.trim());
            lines.push(line);
            const trimmed = lines.length > ACTIVITY_MAX ? lines.slice(-ACTIVITY_TRIM) : lines;
            return f.replace(trimmed.join('\n') + '\n');
        })
        .catch(() => { /* fire-and-forget — never surface log errors to user */ })
        .finally(() => f.close());

    const journalMsg = buildJournalMessage(entry);
    if (journalMsg) {
        cockpit.spawn(['logger', '-t', 'cockpit-scap',
            'user: ' + (currentUser || '?') + ' — ' + journalMsg
        ], { superuser: 'require' }).catch(() => {});
    }
}

function buildJournalMessage(e) {
    switch (e.type) {
        case 'scan_start':
            return 'Scan started — ' + (e.tab === 'container' ? 'container ' + (e.image || '') + ' ' : '') +
                   'profile: ' + (e.profile || '?') + ', content: ' + (e.content || '?');
        case 'scan_complete':
            return 'Scan completed — ' + (e.tab === 'container' ? 'container ' + (e.image || '') + ' ' : '') +
                   'profile: ' + (e.profile || '?') + ', score: ' + (e.score || '?') + '%, pass: ' + (e.pass || 0) + ', fail: ' + (e.fail || 0);
        case 'scan_cancel':
            return 'Scan cancelled — profile: ' + (e.profile || '?');
        case 'scan_error':
            return 'Scan failed — profile: ' + (e.profile || '?') + ', error: ' + (e.message || '?');
        case 'scan_delete':
            return 'Scan record deleted — ' + (e.timestamp || '?');
        case 'remediate_apply': {
            const ids = (e.rule_ids && e.rule_ids.length) ? ' [' + e.rule_ids.join(', ') + ']' : '';
            return 'Remediation applied — rules: ' + (e.rules_applied || 0) + ids + ', exit: ' + e.exit_code;
        }
        case 'content_upload':
            return 'SDS content uploaded — ' + (e.file || '?');
        case 'content_delete':
            return 'SDS content deleted — ' + (e.file || '?');
        case 'tailor_upload':
            return 'Tailoring policy uploaded — ' + (e.file || '?') + ', profile: ' + (e.profile || '?');
        case 'tailor_save':
            return 'Tailoring policy saved — ' + (e.file || e.profile || '?');
        case 'tailor_delete':
            return 'Tailoring policy deleted — ' + (e.file || '?');
        case 'settings_change':
            return 'Settings updated — ' + (e.detail || '?');
        case 'activity_clear':
            return 'Activity log cleared';
        case 'data_clear':
            return 'All scan data cleared';
        case 'policy_clear':
            return 'All policy data cleared';
        default:
            return null;
    }
}

/* ---- Activity tab ------------------------------------------ */

let activityPollInterval = null;

const ACTIVITY_TYPE_LABELS = {
    scan_start:          'Scan Started',
    scan_complete:       'Scan Completed',
    scan_cancel:         'Scan Cancelled',
    scan_error:          'Scan Failed',
    scan_delete:         'Scan Deleted',
    validate:            'Content Validated',
    content_upload:      'Content Uploaded',
    content_delete:      'Content Deleted',
    tailor_upload:       'Tailoring Uploaded',
    tailor_save:         'Tailoring Saved',
    tailor_delete:       'Tailoring Deleted',
    settings_change:     'Settings Updated',
    remediate_apply:     'Remediation Applied',
    data_clear:          'All Scan Data Cleared',
    policy_clear:        'Policy Data Cleared',
};


const ACTIVITY_FILTER_MAP = {
    scan:        ['scan_complete', 'scan_cancel', 'scan_error', 'scan_delete'],
    remediation: ['remediate_apply'],
    content:     ['validate', 'content_delete', 'content_upload'],
    tailoring:   ['tailor_upload', 'tailor_save', 'tailor_delete'],
};

function startActivityPoll() {
    loadActivityLog();
    if (!activityPollInterval) {
        activityPollInterval = setInterval(loadActivityLog, 3000);
    }
}

function stopActivityPoll() {
    if (activityPollInterval) {
        clearInterval(activityPollInterval);
        activityPollInterval = null;
    }
}

function loadActivityLog() {
    const limit      = parseInt(document.getElementById('ct-activity-limit').value, 10) || 100;
    const activeChip = document.querySelector('.ct-activity-chip.pf-m-active');
    const filter     = activeChip ? activeChip.dataset.filter : 'all';

    cockpit.file(ACTIVITY_LOG, { superuser: 'require' }).read()
        .then(content => {
            let entries = (content || '').split('\n')
                .filter(l => l.trim())
                .map(l => { try { return JSON.parse(l); } catch { return null; } })
                .filter(Boolean)
                .reverse(); // newest first

            if (filter !== 'all' && ACTIVITY_FILTER_MAP[filter]) {
                entries = entries.filter(e => ACTIVITY_FILTER_MAP[filter].includes(e.type));
            }

            renderActivityTable(entries.slice(0, limit), filter);
        })
        .catch(() => renderActivityTable([], filter));
}

const ACTIVITY_EMPTY_MSG = {
    all:       'No activity recorded yet. Run a scan to see entries here.',
    scan:      'No scan activity found.',
    guide:     'No compliance guides generated yet.',
    validate:  'No content validation activity found.',
    tailoring: 'No tailoring activity found.',
};

function renderActivityTable(entries, filter) {
    const table     = document.getElementById('ct-activity-table');
    const empty     = document.getElementById('ct-activity-empty');
    const tbody     = document.getElementById('ct-activity-tbody');
    const exportBtn = document.getElementById('ct-activity-export-btn');
    const clearBtn  = document.getElementById('ct-activity-clear-btn');

    const hasEntries = entries.length > 0;
    const isAdmin    = adminPermission && adminPermission.allowed === true;
    exportBtn.disabled = !hasEntries;
    clearBtn.disabled  = !hasEntries || !isAdmin;

    if (!hasEntries) {
        document.getElementById('ct-activity-empty-msg').textContent = !isAdmin
            ? 'Administrative access required. Click "Limited access" in the page header to elevate privileges before viewing activity.'
            : (ACTIVITY_EMPTY_MSG[filter] || ACTIVITY_EMPTY_MSG.all);
        table.classList.add('hidden');
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    table.classList.remove('hidden');

    tbody.innerHTML = '';
    entries.forEach(e => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escHtmlRem(formatActivityTime(e.ts))}</td>
            <td class="ct-activity-user">${escHtmlRem(e.user || '—')}</td>
            <td>${escHtmlRem(activityTabLabel(e.tab))}</td>
            <td>${escHtmlRem(ACTIVITY_TYPE_LABELS[e.type] || e.type)}</td>
            <td class="ct-activity-details">${activityDetails(e)}</td>
            <td>${activityResult(e)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function formatActivityTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function activityTabLabel(tab) {
    const labels = { host: 'Host', container: 'Container', tailoring: 'Tailoring', content: 'Content', settings: 'Settings' };
    return labels[tab] || (tab || '—');
}

function activityDetails(e) {
    const esc = s => escHtmlRem(s);
    if (e.type === 'scan_start' || e.type === 'scan_complete') {
        const parts = [esc(e.content), esc(e.profile)];
        if (e.image) parts.unshift(esc(e.image));
        if (e.tailoring) parts.push('tailoring: ' + esc(e.tailoring));
        return parts.filter(Boolean).join(' · ');
    }
    if (e.type === 'guide')         return esc(e.profile);
    if (e.type === 'validate')      return esc(e.file);
    if (e.type === 'tailor_save' || e.type === 'tailor_load' || e.type === 'tailor_delete' || e.type === 'tailor_upload')
        return esc(e.profile || e.file);
    if (e.type === 'content_upload' || e.type === 'content_delete')
        return esc(e.file);
    if (e.type === 'scan_delete') {
        const parts = [esc(e.content), esc(e.profile)];
        if (e.image) parts.unshift(esc(e.image));
        return parts.filter(Boolean).join(' · ');
    }
    if (e.type === 'scan_error')      return esc(e.message);
    if (e.type === 'settings_change')  return esc(e.detail || '');
    if (e.type === 'remediate_apply') {
        const rulesText = esc(e.rules_applied + ' rule' + (e.rules_applied !== 1 ? 's' : '') + ' applied');
        if (e.log_path) {
            return rulesText +
                ' &nbsp;<button class="pf-v6-c-button pf-m-link pf-m-inline ct-activity-view-log" type="button" data-log-path="' + escapeAttr(e.log_path) + '">View Log</button>' +
                ' <button class="pf-v6-c-button pf-m-link pf-m-inline ct-activity-download-log" type="button" data-log-path="' + escapeAttr(e.log_path) + '">Download Log</button>';
        }
        return rulesText;
    }
    return '';
}

function activityResult(e) {
    if (e.type === 'scan_complete') return `${escHtmlRem(e.score)}% &nbsp;<span class="ct-pass-count">${escHtmlRem(e.pass)} pass</span> <span class="ct-fail-count">${escHtmlRem(e.fail)} fail</span>`;
    if (e.type === 'validate')      return e.result === 'pass' ? '<span class="ct-validate-ok">✓ Valid</span>' : '<span class="ct-validate-fail">✗ Invalid</span>';
    if (e.type === 'scan_error')    return '<span class="ct-validate-fail">Error</span>';
    if (e.type === 'scan_cancel')    return '<span class="ct-activity-scan-cancel">Cancelled</span>';
    if (e.type === 'remediate_apply') return e.exit_code === 0
        ? '<span class="ct-validate-ok">&#10003; Exit 0</span>'
        : '<span class="ct-validate-fail">Exit ' + escHtmlRem(String(e.exit_code)) + '</span>';
    return '—';
}

function clearActivityLog() {
    const tombstone = JSON.stringify({
        ts: new Date().toISOString(), user: currentUser || '?',
        type: 'activity_clear', tab: 'activity'
    }) + '\n';
    cockpit.file(ACTIVITY_LOG, { superuser: 'require' }).replace(tombstone)
        .then(() => {
            cockpit.spawn(['logger', '-t', 'cockpit-scap',
                'user: ' + (currentUser || '?') + ' — Activity log cleared'
            ], { superuser: 'require' }).catch(() => {});
            loadActivityLog();
        })
        .catch(err => console.error('Failed to clear activity log:', err.message || err));
}

function exportActivityCSV() {
    cockpit.file(ACTIVITY_LOG, { superuser: 'require' }).read()
        .then(content => {
            const entries = (content || '').split('\n')
                .filter(l => l.trim())
                .map(l => { try { return JSON.parse(l); } catch { return null; } })
                .filter(Boolean)
                .reverse();

            const headers = [
                'Timestamp', 'User', 'Tab', 'Action', 'Content', 'Profile',
                'Policy', 'Image', 'Score %', 'Pass', 'Fail', 'Detail',
            ];
            const rows = entries.map(e => [
                e.ts || '',
                e.user || '—',
                activityTabLabel(e.tab),
                ACTIVITY_TYPE_LABELS[e.type] || e.type,
                e.content  || '',
                e.profile  || '',
                e.tailoring || '',
                e.image    || '',
                e.score    || '',
                e.pass     != null ? e.pass : '',
                e.fail     != null ? e.fail : '',
                e.message  || e.file || e.result || '',
            ]);
            downloadCSV('cockpit-scap-activity.csv', [headers, ...rows]);
        })
        .catch(err => console.error('Failed to export activity log:', err.message || err));
}

function csvEscape(val) {
    if (val === null || val === undefined) return '';
    const s = String(val);
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
}

function downloadCSV(filename, rows) {
    const csv  = rows.map(r => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}


/* validateContent + showInfoModal → settings.js */
