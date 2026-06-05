'use strict';

const MODULE_VERSION = 'v3.8';
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
const RETENTION_DEFAULT  = 10;
const RETENTION_MIN      = 1;
const RETENTION_MAX      = 50;
let   hostRetention        = RETENTION_DEFAULT;
let   containerRetention   = RETENTION_DEFAULT;
let   containerScanEnabled  = false;
let   dashboardEnabled      = false;
let   tailoringEnabled      = true;

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
    'fails = []; errors = []; notchecked = []; notapplicable = []; seen = set()',
    'for rr in root.iter("{%s}rule-result" % NS):',
    '    r = rr.find("{%s}result" % NS)',
    '    if r is None: continue',
    '    res = r.text; rid = rr.get("idref","")',
    '    if rid in seen: continue',
    '    seen.add(rid)',
    '    msg_el = rr.find("{%s}message" % NS)',
    '    msg = (msg_el.text or "").strip() if msg_el is not None else ""',
    '    t, s, cce, desc, rat, w, fix, refs = rinfo.get(rid, (rid, rr.get("severity","unknown"), "", "", "", 1.0, "", []))',
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
    'print(json.dumps({"fails":fails,"errors":errors,"notchecked":notchecked,"notapplicable":notapplicable}))',
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

/* Module state — content */
let hostOsVersion     = null;   /* cached from /etc/os-release at startup */
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
    cockpit.file('/etc/os-release').read()
        .then(content => {
            const m = content && content.match(/^VERSION_ID="?(\d+)/m);
            hostOsVersion = m ? parseInt(m[1], 10) : null;
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
    initDashboard();
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
            const btn   = e.currentTarget;
            const gzPath = currentResultsDir + 'results.arf.gz';
            cockpit.spawn(['test', '-f', gzPath])
                .then(() => downloadArtifact(gzPath, 'scap-results-arf-' + currentTimestamp + '.xml.gz', 'application/gzip', btn))
                .catch(() => downloadArtifact(currentResultsDir + 'results.arf', 'scap-results-arf-' + currentTimestamp + '.xml', 'application/xml', btn));
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
            } else {
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
    document.getElementById('ct-tailor-values-collapse')
        .addEventListener('click', function () {
            const grid   = document.getElementById('ct-tailor-values-grid');
            const search = document.getElementById('ct-tailor-values-search')
                               .closest('.ct-tailor-search-wrap');
            const isCollapsed = grid.classList.toggle('hidden');
            search.classList.toggle('hidden', isCollapsed);
            this.textContent = isCollapsed ? 'Expand' : 'Collapse';
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
        const btn = e.target.closest('.ct-activity-view-log');
        if (!btn) return;
        const logPath = btn.dataset.logPath;
        if (!logPath) return;
        if (!normalizePath(logPath).startsWith(REMEDIATION_LOG_BASE)) return;
        cockpit.file(logPath, { superuser: 'require' }).read()
            .then(content => {
                document.getElementById('ct-log-modal-path').textContent = logPath;
                document.getElementById('ct-log-modal-content').textContent = content || '(empty)';
                document.getElementById('ct-log-modal').classList.remove('hidden');
            })
            .catch(err => {
                document.getElementById('ct-log-modal-path').textContent = logPath;
                document.getElementById('ct-log-modal-content').textContent = 'Could not read log file:\n' + (err.message || String(err));
                document.getElementById('ct-log-modal').classList.remove('hidden');
            });
    });

    document.getElementById('ct-log-modal-close')
        .addEventListener('click', () => document.getElementById('ct-log-modal').classList.add('hidden'));

    document.getElementById('ct-apply-goto-activity')
        .addEventListener('click', () => { closeRemDrawer(); document.getElementById('tab-btn-activity').click(); });
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
            .map(f => ({ path: SSG_CONTENT_DIR + f, name: sdsDisplayName(f) }))
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

function onScanClick() {
    if (currentScanProc) return;
    const profileSelect  = document.getElementById('ct-profile-select');
    const tailorSelect   = document.getElementById('ct-tailor-file-select');
    const tailoringPath  = tailorSelect.value;

    let profileId, profileTitle;
    if (tailoringPath && tailoringFilesMap[tailoringPath]) {
        const sc     = tailoringFilesMap[tailoringPath];
        profileId    = sc.profile_id;
        profileTitle = sc.name;
    } else {
        profileId    = profileSelect.value;
        profileTitle = profileSelect.options[profileSelect.selectedIndex].text;
    }

    currentTimestamp      = makeTimestamp();
    currentResultsDir     = RESULTS_BASE + currentTimestamp + '/';
    currentRemBashPath    = currentResultsDir + 'remediation.sh';
    currentRemAnsiblePath = currentResultsDir + 'remediation.yml';
    const resultsXmlPath  = currentResultsDir + 'results.xml';

    hideScanError();
    showScanProgress();
    appendActivityLog({ type: 'scan_start', tab: 'host',
        content: currentSdsPath.split('/').pop(), profile: profileTitle,
        tailoring: tailoringPath ? tailoringPath.split('/').pop() : null });

    cockpit.spawn(['mkdir', '-p', currentResultsDir], { superuser: 'require' })
        .then(() => runOscap(profileId, profileTitle, resultsXmlPath, tailoringPath))
        .catch(err => onScanError('Failed to create results directory: ' + (err.message || String(err))));
}

function runOscap(profileId, profileTitle, resultsXmlPath, tailoringPath) {
    const args = ['oscap', 'xccdf', 'eval'];
    if (tailoringPath) {
        args.push('--tailoring-file', tailoringPath);
    }
    args.push(
        '--progress',
        '--profile',      profileId,
        '--results',      resultsXmlPath,
        '--results-arf',  currentResultsDir + 'results.arf',
        currentSdsPath
    );

    let scanOutput = '';
    let _ruleBuf = '';
    let _ruleChecked = 0;
    let _ruleFailed = 0;
    const _recent = [];
    const feedEl  = document.getElementById('ct-rule-feed');
    const tallyEl = document.getElementById('ct-rule-tally');
    const listEl  = document.getElementById('ct-rule-feed-list');
    const RULE_RE = /^(xccdf_\S+):(pass|fail|error|notchecked|notapplicable|informational|fixed)$/;

    currentScanProc = cockpit.spawn(args, { superuser: 'require', err: 'out' });
    currentScanProc.stream(data => {
        scanOutput += data;
        _ruleBuf += data;
        const lines = _ruleBuf.split('\n');
        _ruleBuf = lines.pop();
        for (const line of lines) {
            const m = line.trim().match(RULE_RE);
            if (!m) continue;
            const [, ruleId, result] = m;
            _ruleChecked++;
            if (result === 'fail' || result === 'error') _ruleFailed++;
            const name = ruleId.replace(/^.*content_rule_/, '').replace(/_/g, ' ');
            _recent.unshift({ name, result });
            if (_recent.length > 5) _recent.pop();
            feedEl.classList.remove('hidden');
            tallyEl.innerHTML = _ruleChecked + ' checked' +
                (_ruleFailed ? ' &middot; <span class="ct-tally-fail">' + _ruleFailed + ' failing</span>' : '');
            listEl.innerHTML = _recent.map(r =>
                '<div class="ct-rule-feed-item">' +
                '<span class="ct-rule-feed-dot ' + r.result + '"></span>' +
                '<span class="ct-rule-feed-name">' + r.name + '</span>' +
                '</div>'
            ).join('');
        }
    });

    currentScanProc
        .then(() => onScanComplete(profileId, profileTitle, resultsXmlPath, tailoringPath))
        .catch(err => {
            /* oscap exits 2 when the scan ran but some rules failed — this is normal */
            if (err.exit_status === 2) {
                onScanComplete(profileId, profileTitle, resultsXmlPath, tailoringPath);
            } else if (scanCancelledByUser || err.problem === 'cancelled') {
                scanCancelledByUser = false;
                onScanCancelled();
            } else {
                onScanError(err.message || String(err), scanOutput);
            }
        });
}

function onCancelClick() {
    if (currentScanProc) {
        scanCancelledByUser = true;
        currentScanProc.close('terminate');
    }
}

function onScanCancelled() {
    currentScanProc = null;
    appendActivityLog({ type: 'scan_cancel', tab: 'host' });
    showScanSetup();
}

function onScanComplete(profileId, profileTitle, resultsXmlPath, tailoringPath) {
    currentScanProc = null;

    cockpit.spawn(['python3', '-c', PY_PARSE_RESULTS, resultsXmlPath],
                  { superuser: 'require', err: 'out' })
        .then(output => {
            const parsed   = JSON.parse(output);
            const tailorSc   = tailoringPath ? tailoringFilesMap[tailoringPath] : null;
            const manifest = {
                timestamp:            currentTimestamp,
                sds_file:             currentSdsPath,
                profile_id:           profileId,
                profile_title:        profileTitle,
                tailoring_file:       tailoringPath || null,
                result_id:            parsed.result_id,
                counts:               parsed.counts,
                severity_counts:      parsed.sev,
                score:                parsed.score,
                scan_duration_s:      Math.round((Date.now() - hostScanStart) / 1000),
                scan_id:              generateScanId(),
                has_arf:              true,
                compliance_threshold: tailorSc ? (tailorSc.compliance_threshold || 90) : null,
            };
            return cockpit.file(currentResultsDir + 'manifest.json', { superuser: 'require' })
                .replace(JSON.stringify(manifest, null, 2))
                .then(() => manifest);
        })
        .then(manifest => {
            buildPersistenceCache(manifest); // fire-and-forget; errors logged internally
            appendActivityLog({ type: 'scan_complete', tab: 'host',
                content: manifest.sds_file.split('/').pop(), profile: manifest.profile_title,
                score: manifest.score.toFixed(1), pass: manifest.counts.pass, fail: manifest.counts.fail });
            showResults(manifest);
            // Remediation generation, pruning, and perms run in the background so results
            // display immediately after the scan — not after 7-8 min of oscap generate fix.
            remediationGenerating = true;
            updateApplyGate1Btn();
            const remDir = currentResultsDir;
            generateRemediation(manifest.result_id, resultsXmlPath, tailoringPath)
                .catch(err => {
                    console.error('Remediation generation failed:', err.message || err);
                    currentRemBashPath    = null;
                    currentRemAnsiblePath = null;
                })
                .finally(() => {
                    remediationGenerating = false;
                    updateApplyGate1Btn();
                    refreshActionBoardAutomatable();
                    cockpit.spawn(
                        ['find', remDir, '-maxdepth', '1', '-name', 'remediation.*',
                         '-exec', 'chmod', '644', '{}', '+'],
                        { superuser: 'require' }
                    ).catch(() => {});
                });
            pruneHistoryByType('host').catch(() => {});
            relaxResultsPerms().catch(() => {});
            cockpit.spawn(['gzip', currentResultsDir + 'results.arf'], { superuser: 'require' }).catch(() => {});
        })
        .catch(err => onScanError('Failed to process results: ' + (err.message || String(err))));
}

function buildPersistenceCache(manifest) {
    return cockpit.spawn(['ls', RESULTS_BASE], { err: 'message' })
        .then(output => {
            const dirs = output.trim().split('\n').filter(d => TIMESTAMP_RE.test(d));
            return Promise.all(
                dirs.map(dir =>
                    cockpit.file(RESULTS_BASE + dir + '/manifest.json').read()
                        .then(c => JSON.parse(c))
                        .catch(() => null)
                )
            ).then(manifests => {
                const relevant = manifests
                    .filter(m => m && m.scan_type !== 'container' &&
                                 m.profile_id === manifest.profile_id &&
                                 m.sds_file   === manifest.sds_file)
                    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
                    .slice(0, 15);
                if (relevant.length < 2) return;
                const xmlPaths = relevant.map(m => RESULTS_BASE + m.timestamp + '/results.xml');
                return cockpit.spawn(['python3', '-c', PY_BUILD_PERSISTENCE, ...xmlPaths], { err: 'message' })
                    .then(output => {
                        const failures = JSON.parse(output);
                        return cockpit.file(PERSISTENCE_CACHE_PATH).read()
                            .then(data => {
                                const cache = (data && data.trim()) ? JSON.parse(data) : { profiles: {} };
                                cache.profiles[manifest.profile_id] = {
                                    computed_at:   manifest.timestamp,
                                    profile_title: manifest.profile_title,
                                    sds_file:      manifest.sds_file,
                                    scan_count:    relevant.length,
                                    failures,
                                };
                                return cockpit.file(PERSISTENCE_CACHE_PATH, { superuser: 'require' })
                                    .replace(JSON.stringify(cache, null, 2));
                            });
                    });
            });
        })
        .catch(err => console.error('buildPersistenceCache:', err.message || err));
}

function generateRemediation(resultId, resultsXmlPath, tailoringPath) {
    const tailoringArgs = tailoringPath ? ['--tailoring-file', tailoringPath] : [];
    const run = (fixType, outputPath) =>
        cockpit.spawn([
            'oscap', 'xccdf', 'generate', 'fix',
            ...tailoringArgs,
            '--fix-type', fixType,
            '--result-id', resultId,
            '--output', outputPath,
            resultsXmlPath,
        ], { superuser: 'require', err: 'out' })
        .catch(err => {
            console.error('generate fix (' + fixType + ') failed [result-id=' + resultId +
                          ', tailoring=' + (tailoringPath || 'none') + ']:', err.message || err);
            throw err;
        });
    return Promise.all([run('bash', currentRemBashPath), run('ansible', currentRemAnsiblePath)]);
}

/* ---- Selective Remediation --------------------------------- */

function openRemediationPanel(resultsDir) {
    remediationDir   = resultsDir;
    remediationRules = [];

    document.getElementById('ct-rem-search').value = '';
    document.getElementById('ct-apply-output-area').classList.add('hidden');

    openRemDrawer();

    document.getElementById('ct-remediation-loading').classList.remove('hidden');
    document.getElementById('ct-remediation-content').classList.add('hidden');
    document.getElementById('ct-remediation-error').classList.add('hidden');
    document.getElementById('ct-rem-context').classList.add('hidden');

    /* Load manifest for context header */
    cockpit.file(resultsDir + 'manifest.json').read()
        .then(content => {
            const m = JSON.parse(content);
            const ts      = (m.timestamp || '').replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
            const profile = m.profile_title || m.profile_id || '—';
            const sds     = m.sds_file ? m.sds_file.split('/').pop() : '—';
            const score   = m.score != null ? parseFloat(m.score).toFixed(1) + '%' : '—';
            const fail    = m.counts && m.counts.fail != null ? m.counts.fail : '—';
            const ctx = document.getElementById('ct-rem-context');
            ctx.innerHTML =
                '<span class="ct-rem-ctx-item"><strong>Profile:</strong> ' + escHtmlRem(profile) + '</span>' +
                '<span class="ct-rem-ctx-item"><strong>Score:</strong> ' + escHtmlRem(score) + '</span>' +
                '<span class="ct-rem-ctx-item"><strong>Failing:</strong> ' + escHtmlRem(String(fail)) + '</span>' +
                '<span class="ct-rem-ctx-item"><strong>Content:</strong> ' + escHtmlRem(sds) + '</span>' +
                '<span class="ct-rem-ctx-item"><strong>Scanned:</strong> ' + escHtmlRem(ts) + '</span>';
            ctx.classList.remove('hidden');
        })
        .catch(() => {});

    const showRules = (rules) => {
        remediationRules = rules;
        document.getElementById('ct-remediation-loading').classList.add('hidden');
        renderRemediationRules(remediationRules);
        document.getElementById('ct-remediation-content').classList.remove('hidden');
    };

    /* Reuse eagerly pre-loaded rules if they match the current results dir */
    if (eagerRemRules && resultsDir === currentResultsDir) {
        const reused = eagerRemRules;
        eagerRemRules = null;
        showRules(reused);
        return;
    }

    const spawnArgs = [resultsDir + 'results.xml'];
    const remBashForDir = resultsDir === currentResultsDir ? currentRemBashPath : resultsDir + 'remediation.sh';
    if (remBashForDir) spawnArgs.push(remBashForDir);
    cockpit.spawn(['python3', '-c', PY_EXTRACT_FAILING_RULES, ...spawnArgs],
                  { err: 'message' })
        .then(output => { const d = JSON.parse(output); showRules(d.fails || d); })
        .catch(err => {
            pendingQuickFix = false;
            document.getElementById('ct-remediation-loading').classList.add('hidden');
            document.getElementById('ct-remediation-error-msg').textContent =
                'Failed to load failing rules: ' + (err.message || String(err));
            document.getElementById('ct-remediation-error').classList.remove('hidden');
        });
}

function buildRemPanelDOM(container, rules, updateCountFn, remPath) {
    const groups = { high: [], medium: [], low: [], unknown: [] };
    rules.forEach(r => (groups[r.severity] || groups.unknown).push(r));

    container.innerHTML = '';

    const order = [['high','High','ct-sev-high'],['medium','Medium','ct-sev-medium'],['low','Low','ct-sev-low']];
    order.forEach(([sev, label, cls]) => {
        const list = groups[sev];
        if (!list || !list.length) return;

        const details = document.createElement('details');
        details.open = false;
        details.className = 'ct-rem-group';

        const summary = document.createElement('summary');
        summary.className = 'ct-rem-group-summary';
        summary.innerHTML =
            '<span class="ct-sev-badge ' + cls + '">' + label + '</span>' +
            '<span class="ct-rem-group-count">' + list.length + ' rule' + (list.length !== 1 ? 's' : '') + '</span>' +
            '<button class="pf-v6-c-button pf-m-link ct-rem-select-sev" type="button" data-sev="' + sev + '">Select all</button>';
        details.appendChild(summary);

        list.forEach(rule => {
            const shortId = rule.id.split('_rule_').pop();
            const item = document.createElement('div');
            item.className = 'ct-rem-rule-item';
            item.dataset.title  = (rule.title || '').toLowerCase();
            item.dataset.ruleid = shortId.toLowerCase();

            const row = document.createElement('label');
            row.className = 'ct-rem-rule-row';
            row.innerHTML =
                '<input type="checkbox" class="ct-rem-checkbox" data-id="' + escapeAttr(rule.id) + '" checked>' +
                '<span class="ct-rem-rule-title">' + escHtmlRem(rule.title) + '</span>' +
                '<span class="ct-rem-rule-id">' + escHtmlRem(shortId) + '</span>';
            item.appendChild(row);

            if (rule.desc) {
                const det = document.createElement('details');
                det.className = 'ct-rem-rule-detail';
                const rat = rule.rat
                    ? '<p class="ct-rem-detail-rat"><strong>Rationale:</strong> ' + escHtmlRem(rule.rat) + '</p>'
                    : '';
                det.innerHTML =
                    '<summary class="ct-rem-detail-toggle">Details</summary>' +
                    '<div class="ct-rem-detail-body">' +
                        '<p class="ct-rem-detail-desc">' + escHtmlRem(rule.desc) + '</p>' +
                        rat +
                    '</div>';
                if (rule.fix) det.querySelector('.ct-rem-detail-body').appendChild(buildFixBlock(rule, remPath));
                item.appendChild(det);
            }

            details.appendChild(item);
        });
        container.appendChild(details);
    });

    container.querySelectorAll('.ct-rem-select-sev').forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            const group = btn.closest('details');
            const groupChecks = group.querySelectorAll('.ct-rem-checkbox');
            const allChecked = Array.from(groupChecks).every(c => c.checked);
            groupChecks.forEach(c => { c.checked = !allChecked; });
            updateCountFn();
        });
    });

    container.removeEventListener('change', updateCountFn);
    container.addEventListener('change', updateCountFn);
    updateCountFn();
}

function renderRemediationRules(rules) {
    buildRemPanelDOM(
        document.getElementById('ct-remediation-rules'),
        rules,
        updateRemediationCount,
        currentRemBashPath
    );
    updateAdminControls();

    if (pendingQuickFix) {
        pendingQuickFix = false;
        const highCritIds = new Set(rules
            .filter(r => ['high', 'critical'].includes(r.severity) && r.automated)
            .map(r => r.id));
        const recIds = highCritIds.size > 0 ? highCritIds : new Set(rules
            .filter(r => r.severity === 'medium' && r.automated)
            .map(r => r.id));
        document.querySelectorAll('#ct-remediation-rules .ct-rem-checkbox').forEach(cb => {
            cb.checked = recIds.has(cb.dataset.id);
        });
        updateRemediationCount();
    }

    if (pendingPersistentRuleIds) {
        const ids = new Set(pendingPersistentRuleIds);
        pendingPersistentRuleIds = null;
        document.querySelectorAll('#ct-remediation-rules .ct-rem-checkbox').forEach(cb => {
            cb.checked = ids.has(cb.dataset.id);
        });
        updateRemediationCount();
    }
}

function onRemediationSearch() {
    const term = document.getElementById('ct-rem-search').value.toLowerCase();
    document.querySelectorAll('#ct-remediation-rules .ct-rem-rule-item').forEach(item => {
        const match = !term ||
            item.dataset.title.includes(term) ||
            item.dataset.ruleid.includes(term);
        item.style.display = match ? '' : 'none';
    });
    document.querySelectorAll('#ct-remediation-rules .ct-rem-group').forEach(group => {
        const hasVisible = Array.from(group.querySelectorAll('.ct-rem-rule-item'))
            .some(i => i.style.display !== 'none');
        group.style.display = hasVisible ? '' : 'none';
        if (hasVisible && term) group.open = true;
    });
    const anyVisible = Array.from(
        document.querySelectorAll('#ct-remediation-rules .ct-rem-rule-item')
    ).some(i => i.style.display !== 'none');
    let noResults = document.getElementById('ct-rem-no-results');
    if (!noResults) {
        noResults = document.createElement('p');
        noResults.id = 'ct-rem-no-results';
        noResults.className = 'ct-rem-no-results';
        noResults.textContent = 'No matching rules.';
        document.getElementById('ct-remediation-rules').after(noResults);
    }
    noResults.classList.toggle('hidden', !term || anyVisible);
}

function updateRemediationCount() {
    const all     = document.querySelectorAll('#ct-remediation-rules .ct-rem-checkbox');
    const checked = Array.from(all).filter(c => c.checked).length;
    document.getElementById('ct-remediation-count').textContent =
        checked + ' of ' + all.length + ' rules selected';
    const disabled = checked === 0;
    document.getElementById('ct-rem-apply-btn').disabled   = disabled;
    document.getElementById('ct-rem-bash-btn').disabled    = disabled;
    document.getElementById('ct-rem-ansible-btn').disabled = disabled;

    /* Update per-group counts and Select all / Deselect all toggle */
    document.querySelectorAll('#ct-remediation-rules .ct-rem-group').forEach(group => {
        const groupAll     = group.querySelectorAll('.ct-rem-checkbox');
        const groupChecked = Array.from(groupAll).filter(c => c.checked).length;
        const countEl      = group.querySelector('.ct-rem-group-count');
        if (countEl) {
            countEl.textContent = groupChecked + ' of ' + groupAll.length +
                ' rule' + (groupAll.length !== 1 ? 's' : '') + ' selected';
        }
        const sevBtn = group.querySelector('.ct-rem-select-sev');
        if (sevBtn) {
            sevBtn.textContent = groupChecked === groupAll.length ? 'Deselect all' : 'Select all';
        }
    });
}

function generateSelectiveFix(fixType, selectedIds, btnEl) {
    const selected = selectedIds ||
        Array.from(document.querySelectorAll('#ct-remediation-rules .ct-rem-checkbox'))
            .filter(c => c.checked).map(c => c.dataset.id);
    if (!selected.length) return;

    const remFile = remediationDir + (fixType === 'bash' ? 'remediation.sh' : 'remediation.yml');
    const ext     = fixType === 'bash' ? '.sh' : '.yml';
    const mime    = fixType === 'bash' ? 'text/x-shellscript' : 'text/yaml';
    const ts      = remediationDir.replace(/\/$/, '').split('/').pop();
    const fname   = 'selective-remediation-' + ts + ext;
    const btn     = btnEl || document.getElementById(fixType === 'bash' ? 'ct-rem-bash-btn' : 'ct-rem-ansible-btn');

    cockpit.spawn(
        ['python3', '-c', PY_FILTER_FIX, remFile, fixType, JSON.stringify(selected)],
        { err: 'message' }
    )
    .then(output => {
        const blob = new Blob([output], { type: mime });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = fname;
        a.click();
        URL.revokeObjectURL(url);
        if (btn) {
            const orig = btn.textContent;
            btn.textContent = '✓ Downloaded';
            setTimeout(() => { btn.textContent = orig; }, 2000);
        }
        appendActivityLog({ type: 'remediate_download', tab: 'host',
            fix_type: fixType, rules_selected: selected.length });
    })
    .catch(err => console.error('Selective remediation failed:', err.message || err));
}

let pendingApplyRules  = [];
let pendingApplyTitles = [];

function updateApplyGate1Btn() {
    const btn    = document.getElementById('ct-apply-gate1-proceed');
    const status = document.getElementById('ct-rem-generating-status');
    if (btn) {
        btn.disabled = remediationGenerating;
        btn.title    = remediationGenerating ? 'Generating remediation script, please wait…' : '';
    }
    if (status) status.classList.toggle('hidden', !remediationGenerating);
}

function onApplyNowClick() {
    const all = document.querySelectorAll('#ct-remediation-rules .ct-rem-checkbox');
    const checked = Array.from(all).filter(c => c.checked);
    pendingApplyRules  = checked.map(c => c.dataset.id);
    pendingApplyTitles = checked.map(c =>
        c.closest('.ct-rem-rule-item')?.querySelector('.ct-rem-rule-title')?.textContent || c.dataset.id
    );
    if (!pendingApplyRules.length) return;
    document.getElementById('ct-apply-gate1').classList.remove('hidden');
}

function onApplyGate1Proceed() {
    document.getElementById('ct-apply-gate1').classList.add('hidden');

    const remFile = remediationDir + 'remediation.sh';
    cockpit.spawn(
        ['python3', '-c', PY_FILTER_FIX, remFile, 'bash', JSON.stringify(pendingApplyRules)],
        { err: 'message' }
    )
    .then(scriptContent => {
        pendingApplyScript = scriptContent;
        const n = pendingApplyRules.length;
        document.getElementById('ct-apply-gate2-desc').textContent =
            'The following ' + n + ' rule' + (n > 1 ? 's' : '') +
            ' will be applied to this host:';
        const list = document.getElementById('ct-apply-rule-list');
        list.innerHTML = '';
        pendingApplyTitles.forEach(title => {
            const li = document.createElement('li');
            li.textContent = title;
            list.appendChild(li);
        });
        document.getElementById('ct-apply-script-preview').textContent = scriptContent;
        document.getElementById('ct-apply-gate2').classList.remove('hidden');
    })
    .catch(err => {
        showConfirmModal('Script Generation Failed',
            'Could not generate remediation script: ' + (err.message || String(err)),
            () => {}, 'OK');
    });
}

function onApplyGate2Execute() {
    document.getElementById('ct-apply-gate2').classList.add('hidden');

    const scriptContent = pendingApplyScript;
    const applyPath     = remediationDir + 'remediation-apply.sh';
    const outputEl      = document.getElementById('ct-apply-output');
    const areaEl        = document.getElementById('ct-apply-output-area');
    const titleEl       = document.getElementById('ct-apply-output-title');
    const okEl          = document.getElementById('ct-apply-status-ok');
    const errEl         = document.getElementById('ct-apply-status-err');
    const exitEl        = document.getElementById('ct-apply-exit-code');
    const logSavedEl    = document.getElementById('ct-apply-log-saved');

    const ts         = remediationDir.replace(/\/$/, '').split('/').pop();
    const profileSlug = (currentManifest && currentManifest.profile_id || 'unknown')
        .replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    const logFile    = REMEDIATION_LOG_BASE + ts + '-' + profileSlug + '.log';

    outputEl.textContent = '';
    okEl.classList.add('hidden');
    errEl.classList.add('hidden');
    logSavedEl.classList.add('hidden');
    titleEl.textContent = 'Applying remediation…';
    areaEl.classList.remove('hidden');
    areaEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    function persistLog(exitCode) {
        const profile   = (currentManifest && currentManifest.profile_title) || profileSlug;
        const sds       = (currentManifest && currentManifest.content_file)  || '?';
        const header    = [
            '# cockpit-scap remediation log',
            '# timestamp:     ' + new Date().toISOString(),
            '# user:          ' + (currentUser || '?'),
            '# profile:       ' + profile,
            '# sds:           ' + sds,
            '# rules_applied: ' + pendingApplyRules.length,
            '# exit_code:     ' + exitCode,
            '',
        ].join('\n');

        cockpit.spawn(['mkdir', '-p', REMEDIATION_LOG_BASE], { superuser: 'require' })
            .then(() => cockpit.file(logFile, { superuser: 'require' })
                .replace(header + outputEl.textContent))
            .then(() => {
                logSavedEl.classList.remove('hidden');
                cockpit.spawn([
                    'logger', '-t', 'cockpit-scap',
                    'Remediation script executed — user: ' + (currentUser || '?') +
                    ', profile: ' + profile +
                    ', rules: ' + pendingApplyRules.length +
                    ', exit: ' + exitCode,
                ], { superuser: 'require' }).catch(() => {});
            })
            .catch(() => {});
    }

    cockpit.file(applyPath, { superuser: 'require' })
        .replace(scriptContent)
        .then(() =>
            cockpit.spawn(['bash', applyPath], { superuser: 'require', err: 'out' })
                .stream(data => {
                    outputEl.textContent += data;
                    outputEl.scrollTop = outputEl.scrollHeight;
                })
                .then(() => {
                    titleEl.textContent = 'Remediation complete';
                    okEl.classList.remove('hidden');
                    persistLog(0);
                    appendActivityLog({ type: 'remediate_apply', tab: 'host',
                        rules_applied: pendingApplyRules.length, exit_code: 0,
                        log_path: logFile });
                    cockpit.spawn(['rm', '-f', applyPath], { superuser: 'require' }).catch(() => {});
                })
                .catch(err => {
                    const code = err.exit_status || '?';
                    titleEl.textContent = 'Remediation finished';
                    exitEl.textContent  = code;
                    errEl.classList.remove('hidden');
                    persistLog(code);
                    appendActivityLog({ type: 'remediate_apply', tab: 'host',
                        rules_applied: pendingApplyRules.length, exit_code: code,
                        log_path: logFile });
                    cockpit.spawn(['rm', '-f', applyPath], { superuser: 'require' }).catch(() => {});
                })
        )
        .catch(err => {
            titleEl.textContent = 'Failed to write script';
            outputEl.textContent = err.message || String(err);
            errEl.classList.remove('hidden');
        });
}

function escHtmlRem(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;');
}

/* Resolve .. and . in a path string without filesystem access */
function normalizePath(path) {
    const parts = path.split('/');
    const out = [];
    for (const p of parts) {
        if (p === '..') out.pop();
        else if (p !== '.') out.push(p);
    }
    return out.join('/');
}

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;

/* ---- End Selective Remediation ----------------------------- */

function pruneHistoryByType(scanType) {
    return cockpit.spawn(['ls', RESULTS_BASE], { err: 'message' })
        .then(output => {
            const dirs = output.trim().split('\n')
                .filter(d => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(d));
            if (!dirs.length) return;

            return Promise.all(
                dirs.map(dir =>
                    cockpit.file(RESULTS_BASE + dir + '/manifest.json').read()
                        .then(c => {
                            const m = JSON.parse(c);
                            /* Old host scan manifests predate scan_type field — treat as host */
                            const type = (m && m.scan_type) || 'host';
                            return type === scanType ? dir : null;
                        })
                        .catch(() => null)
                )
            ).then(results => {
                const matching = results.filter(Boolean).sort().reverse();
                const limit    = scanType === 'container' ? containerRetention : hostRetention;
                const toDelete = matching.slice(limit);
                if (!toDelete.length) return;
                return Promise.all(
                    toDelete.map(dir =>
                        cockpit.spawn(['rm', '-rf', RESULTS_BASE + dir], { superuser: 'require' })
                            .catch(e => console.error('Failed to prune', dir, e))
                    )
                );
            });
        })
        .catch(() => {});
}

function relaxResultsPerms() {
    return cockpit.spawn(['chmod', '755', currentResultsDir], { superuser: 'require' })
        .then(() => cockpit.spawn(
            ['find', currentResultsDir, '-maxdepth', '1', '-type', 'f', '-exec', 'chmod', '644', '{}', '+'],
            { superuser: 'require' }
        ))
        .catch(err => console.error('chmod failed:', err.message || err));
}

function onScanError(message, output) {
    appendActivityLog({ type: 'scan_error', tab: 'host', message });
    currentScanProc = null;
    showScanSetup();
    document.getElementById('ct-scan-error-message').textContent = message;
    const detailsEl = document.getElementById('ct-scan-error-details');
    const outputEl  = document.getElementById('ct-scan-error-output');
    if (output && output.trim()) {
        outputEl.textContent = output.trim();
        detailsEl.classList.remove('hidden');
    } else {
        detailsEl.classList.add('hidden');
    }
    document.getElementById('ct-scan-error-alert').classList.remove('hidden');
}

function hideScanError() {
    document.getElementById('ct-scan-error-alert').classList.add('hidden');
    document.getElementById('ct-scan-error-details').classList.add('hidden');
}

/* ---- Results XML parsing ----------------------------------- */

/* ---- Results display --------------------------------------- */

function findPreviousScan(manifest, history) {
    return history.find(m =>
        m.timestamp < manifest.timestamp &&
        m.profile_id === manifest.profile_id &&
        m.sds_file   === manifest.sds_file
    ) || null;
}

function loadScanDiff(newXml, oldXml, containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = '<p class="ct-diff-loading">Comparing scans…</p>';
    container.classList.remove('hidden');

    cockpit.spawn(['python3', '-c', PY_SCAN_DIFF, newXml, oldXml], { err: 'message' })
        .then(output => {
            const { fixed, regressed, new_failures } = JSON.parse(output);
            if (!fixed.length && !regressed.length && !new_failures.length) {
                container.innerHTML = '<p class="ct-diff-empty">No rule state changes between these scans.</p>';
                return;
            }
            container.innerHTML = '';
            [
                { label: 'Fixed',        cls: 'ct-diff-fixed',     list: fixed,        open: true  },
                { label: 'Regressed',    cls: 'ct-diff-regressed',  list: regressed,    open: true  },
                { label: 'New failures', cls: 'ct-diff-new',        list: new_failures, open: false },
            ].forEach(({ label, cls, list, open }) => {
                if (!list.length) return;
                const details = document.createElement('details');
                details.className = 'ct-diff-group ' + cls;
                details.open = open;
                const summary = document.createElement('summary');
                summary.className = 'ct-diff-group-summary';
                summary.textContent = label + ' — ' + list.length + ' rule' + (list.length === 1 ? '' : 's');
                details.appendChild(summary);
                const ruleList = document.createElement('div');
                ruleList.className = 'ct-failing-rule-list';
                list.forEach(r => {
                    const row = document.createElement('div');
                    row.className = 'ct-failing-rule-row';
                    const textCol = document.createElement('div');
                    textCol.className = 'ct-rule-text-col';
                    const title = document.createElement('span');
                    title.className = 'ct-rule-title';
                    title.textContent = r.title;
                    textCol.appendChild(title);
                    if (r.cce) {
                        const cce = document.createElement('span');
                        cce.className = 'ct-rule-cce';
                        cce.textContent = r.cce;
                        textCol.appendChild(cce);
                    }
                    row.appendChild(textCol);
                    ruleList.appendChild(row);
                });
                details.appendChild(ruleList);
                container.appendChild(details);
            });
        })
        .catch(() => {
            container.innerHTML = '<p class="ct-diff-empty">Could not compare scans.</p>';
        });
}

function buildScoreDonut(score, threshold, animate) {
    const r      = 52;
    const circ   = 2 * Math.PI * r;
    const offset = circ * (1 - score / 100);
    const color  = score >= threshold ? 'var(--ct-color-success)' : 'var(--ct-color-danger)';
    const NS = 'http://www.w3.org/2000/svg';

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '128');
    svg.setAttribute('height', '128');
    svg.setAttribute('viewBox', '0 0 128 128');
    svg.classList.add('ct-score-donut');

    const track = document.createElementNS(NS, 'circle');
    track.setAttribute('cx', '64'); track.setAttribute('cy', '64');
    track.setAttribute('r', String(r)); track.setAttribute('fill', 'none');
    track.setAttribute('stroke-width', '8');
    track.style.stroke = 'var(--ct-color-border)';
    svg.appendChild(track);

    const arc = document.createElementNS(NS, 'circle');
    arc.setAttribute('cx', '64'); arc.setAttribute('cy', '64');
    arc.setAttribute('r', String(r)); arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke-width', '8');
    arc.setAttribute('stroke-linecap', 'round');
    arc.setAttribute('stroke-dasharray', String(circ));
    arc.setAttribute('stroke-dashoffset', String(offset));
    arc.setAttribute('transform', 'rotate(-90 64 64)');
    arc.style.stroke = color;
    svg.appendChild(arc);

    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', '64'); text.setAttribute('y', '70');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '18');
    text.setAttribute('font-weight', '700');
    text.setAttribute('fill', 'currentColor');
    text.textContent = score.toFixed(1) + '%';
    svg.appendChild(text);

    if (animate) {
        arc.setAttribute('stroke-dashoffset', String(circ));
        arc.style.transition = 'stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)';
        requestAnimationFrame(() => requestAnimationFrame(() => {
            arc.setAttribute('stroke-dashoffset', String(offset));
        }));
    }

    return svg;
}

function onFailingSummarySearch(groupsId, searchId) {
    const term   = document.getElementById(searchId).value.toLowerCase();
    const groups = document.querySelectorAll('#' + groupsId + ' .ct-failing-group');
    groups.forEach(group => {
        const items = group.querySelectorAll('.ct-rule-item');
        let visible = 0;
        items.forEach(item => {
            const match = !term ||
                (item.dataset.title || '').includes(term) ||
                (item.dataset.cce   || '').includes(term);
            item.style.display = match ? '' : 'none';
            if (match) visible++;
        });
        if (!term) {
            group.style.display = '';
            group.open = group.dataset.defaultOpen === '1';
        } else {
            group.style.display = visible ? '' : 'none';
            if (visible) group.open = true;
        }
    });
}

function buildRefsEl(refs) {
    if (!refs || !refs.length) return null;
    const el = document.createElement('div');
    el.className = 'ct-rule-refs';
    refs.forEach(ref => {
        const chip = document.createElement('span');
        chip.className = 'ct-rule-ref-chip';
        const a = document.createElement('a');
        a.href = ref.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = ref.label;
        chip.appendChild(a);
        const MAX = 3;
        const vals = ref.values.slice(0, MAX);
        const extra = ref.values.length - MAX;
        chip.appendChild(document.createTextNode(': ' + vals.join(', ') + (extra > 0 ? ' +' + extra + ' more' : '')));
        el.appendChild(chip);
    });
    return el;
}

function buildFixBlock(r, remPath) {
    const remDetails = document.createElement('details');
    remDetails.className = 'ct-rule-rem-details';
    const remSummary = document.createElement('summary');
    remSummary.className = 'ct-rule-rem-summary';
    remSummary.textContent = 'Remediation Script';
    remDetails.appendChild(remSummary);
    const pre = document.createElement('pre');
    pre.className = 'ct-rule-rem-pre';
    pre.textContent = r.fix;
    remDetails.appendChild(pre);
    if (remPath) {
        const dlRow = document.createElement('div');
        dlRow.className = 'ct-rule-rem-dl-row';
        [['bash', 'Download .sh', 'text/x-shellscript', '.sh'],
         ['ansible', 'Download .yml', 'text/yaml', '.yml']
        ].forEach(([fixType, label, mime, ext]) => {
            const btn = document.createElement('button');
            btn.className = 'pf-v6-c-button pf-m-link ct-rule-rem-dl';
            btn.type = 'button';
            btn.textContent = label;
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const remFile = fixType === 'bash' ? remPath : remPath.replace('.sh', '.yml');
                cockpit.spawn(['python3', '-c', PY_FILTER_FIX, remFile, fixType, JSON.stringify([r.id])], { err: 'message' })
                    .then(output => {
                        const blob = new Blob([output], { type: mime });
                        const url  = URL.createObjectURL(blob);
                        const a    = document.createElement('a');
                        a.href     = url;
                        a.download = 'fix-' + (r.cce || r.id.split('_').pop()) + ext;
                        a.click();
                        URL.revokeObjectURL(url);
                    })
                    .catch(() => {});
            });
            dlRow.appendChild(btn);
        });
        remDetails.appendChild(dlRow);
    }
    return remDetails;
}

function renderFailingSummary(resultsXmlPath, groupsId, loadingId, remPath, searchId) {
    const groupsEl  = document.getElementById(groupsId);
    const loadingEl = document.getElementById(loadingId);
    groupsEl.innerHTML = '';
    loadingEl.classList.remove('hidden');
    if (searchId) {
        const s = document.getElementById(searchId);
        if (s) { s.value = ''; }
        const ctrl = document.getElementById(searchId.replace('-search', '-controls'));
        if (ctrl) ctrl.classList.add('hidden');
    }

    const spawnArgs = remPath
        ? ['python3', '-c', PY_EXTRACT_FAILING_RULES, resultsXmlPath, remPath]
        : ['python3', '-c', PY_EXTRACT_FAILING_RULES, resultsXmlPath];
    cockpit.spawn(spawnArgs, { err: 'message' })
        .then(output => {
            loadingEl.classList.add('hidden');
            const data = JSON.parse(output);
            const rules = data.fails || data;
            const errorRules = data.errors || [];
            const notcheckedRules = data.notchecked || [];
            const notapplicableRules = data.notapplicable || [];
            const buckets = { high: [], medium: [], low: [] };
            rules.forEach(r => {
                const sev = r.severity.toLowerCase();
                (buckets[sev] || buckets.low).push(r);
            });
            [['high', 'HIGH'], ['medium', 'MEDIUM'], ['low', 'LOW']].forEach(([sev, label], idx) => {
                const list = buckets[sev];
                if (!list.length) return;
                const details = document.createElement('details');
                details.className = 'ct-failing-group ct-failing-group-' + sev;
                details.dataset.defaultOpen = idx === 0 ? '1' : '0';
                if (idx === 0) details.open = true;
                const summary = document.createElement('summary');
                summary.className = 'ct-failing-group-summary';
                summary.textContent = label + ' — ' + list.length + ' failing';
                details.appendChild(summary);
                const ruleList = document.createElement('div');
                ruleList.className = 'ct-failing-rule-list';
                list.forEach(r => {
                    const hasExpand = !!(r.desc || r.fix);
                    const wrapper = hasExpand
                        ? document.createElement('details')
                        : document.createElement('div');
                    wrapper.className = 'ct-rule-item';
                    wrapper.dataset.title = (r.title || '').toLowerCase();
                    wrapper.dataset.cce   = (r.cce   || '').toLowerCase();

                    const row = hasExpand
                        ? document.createElement('summary')
                        : document.createElement('div');
                    row.className = 'ct-failing-rule-row' + (hasExpand ? ' ct-rule-row-expandable' : '');

                    const textCol = document.createElement('div');
                    textCol.className = 'ct-rule-text-col';
                    const title = document.createElement('span');
                    title.className = 'ct-rule-title';
                    title.textContent = r.title;
                    textCol.appendChild(title);
                    if (r.cce) {
                        const cce = document.createElement('span');
                        cce.className = 'ct-rule-cce';
                        cce.textContent = r.cce;
                        textCol.appendChild(cce);
                    }
                    row.appendChild(textCol);
                    if (r.automated !== undefined) {
                        const tag = document.createElement('span');
                        tag.className = r.automated
                            ? 'ct-rule-tag ct-rule-tag-auto'
                            : 'ct-rule-tag ct-rule-tag-manual';
                        tag.textContent = r.automated ? 'Automated' : 'Manual';
                        row.appendChild(tag);
                    }
                    wrapper.appendChild(row);

                    if (hasExpand) {
                        const body = document.createElement('div');
                        body.className = 'ct-rule-expand';
                        const desc = document.createElement('p');
                        desc.className = 'ct-rule-expand-desc';
                        desc.textContent = r.desc;
                        body.appendChild(desc);
                        if (r.rat && r.rat !== r.desc) {
                            const ratLabel = document.createElement('p');
                            ratLabel.className = 'ct-rule-expand-label';
                            ratLabel.textContent = 'Rationale';
                            const rat = document.createElement('p');
                            rat.className = 'ct-rule-expand-rat';
                            rat.textContent = r.rat;
                            body.appendChild(ratLabel);
                            body.appendChild(rat);
                        }
                        const refsEl = buildRefsEl(r.refs);
                        if (refsEl) body.appendChild(refsEl);
                        if (r.fix) {
                            body.appendChild(buildFixBlock(r, remPath));
                        }
                        wrapper.appendChild(body);
                    }
                    ruleList.appendChild(wrapper);
                });
                details.appendChild(ruleList);
                groupsEl.appendChild(details);
            });
            [['error', 'ERRORS'], ['notchecked', 'NOT CHECKED']].forEach(([type, label]) => {
                const list = type === 'error' ? errorRules : notcheckedRules;
                if (!list.length) return;
                const details = document.createElement('details');
                details.className = 'ct-failing-group ct-failing-group-' + type;
                const summary = document.createElement('summary');
                summary.className = 'ct-failing-group-summary';
                summary.textContent = label + ' — ' + list.length + ' rule' + (list.length === 1 ? '' : 's');
                details.appendChild(summary);
                const ruleList = document.createElement('div');
                ruleList.className = 'ct-failing-rule-list';
                list.forEach(r => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'ct-rule-item';
                    const row = document.createElement('div');
                    row.className = 'ct-failing-rule-row';
                    const textCol = document.createElement('div');
                    textCol.className = 'ct-rule-text-col';
                    const title = document.createElement('span');
                    title.className = 'ct-rule-title';
                    title.textContent = r.title;
                    textCol.appendChild(title);
                    if (r.cce) {
                        const cce = document.createElement('span');
                        cce.className = 'ct-rule-cce';
                        cce.textContent = r.cce;
                        textCol.appendChild(cce);
                    }
                    if (r.message) {
                        const msg = document.createElement('span');
                        msg.className = 'ct-rule-msg';
                        msg.textContent = r.message;
                        textCol.appendChild(msg);
                    }
                    row.appendChild(textCol);
                    wrapper.appendChild(row);
                    ruleList.appendChild(wrapper);
                });
                details.appendChild(ruleList);
                groupsEl.appendChild(details);
            });

            if (notapplicableRules.length) {
                const details = document.createElement('details');
                details.className = 'ct-failing-group ct-failing-group-notapplicable';
                const summary = document.createElement('summary');
                summary.className = 'ct-failing-group-summary';
                summary.textContent = 'NOT APPLICABLE — ' + notapplicableRules.length + ' rule' + (notapplicableRules.length === 1 ? '' : 's');
                details.appendChild(summary);
                const ruleList = document.createElement('div');
                ruleList.className = 'ct-failing-rule-list';
                notapplicableRules.forEach(r => {
                    const hasDesc = !!r.desc;
                    const wrapper = hasDesc ? document.createElement('details') : document.createElement('div');
                    wrapper.className = 'ct-rule-item';
                    const row = hasDesc ? document.createElement('summary') : document.createElement('div');
                    row.className = 'ct-failing-rule-row' + (hasDesc ? ' ct-rule-row-expandable' : '');
                    const textCol = document.createElement('div');
                    textCol.className = 'ct-rule-text-col';
                    const title = document.createElement('span');
                    title.className = 'ct-rule-title';
                    title.textContent = r.title;
                    textCol.appendChild(title);
                    if (r.cce) {
                        const cce = document.createElement('span');
                        cce.className = 'ct-rule-cce';
                        cce.textContent = r.cce;
                        textCol.appendChild(cce);
                    }
                    row.appendChild(textCol);
                    wrapper.appendChild(row);
                    if (hasDesc) {
                        const body = document.createElement('div');
                        body.className = 'ct-rule-expand';
                        const desc = document.createElement('p');
                        desc.className = 'ct-rule-expand-desc';
                        desc.textContent = r.desc;
                        body.appendChild(desc);
                        wrapper.appendChild(body);
                    }
                    ruleList.appendChild(wrapper);
                });
                details.appendChild(ruleList);
                groupsEl.appendChild(details);
            }
            if (searchId) {
                const ctrl = document.getElementById(searchId.replace('-search', '-controls'));
                if (ctrl) ctrl.classList.remove('hidden');
            }
        })
        .catch(() => { loadingEl.classList.add('hidden'); });
}

function loadScanFromHistory(manifest) {
    if (!TIMESTAMP_RE.test(manifest.timestamp)) return;
    const dir = RESULTS_BASE + manifest.timestamp + '/';
    currentTimestamp      = manifest.timestamp;
    currentResultsDir     = dir;
    currentRemBashPath    = dir + 'remediation.sh';
    currentRemAnsiblePath = dir + 'remediation.yml';
    currentSdsPath        = manifest.sds_file || null;
    document.getElementById('ct-scan-row').classList.add('hidden');
    showResults(manifest);
    document.getElementById('ct-results').scrollIntoView({ behavior: 'smooth' });
}

function updateActionBoard(sev, totalFail, autoCount, mode) {
    const board = document.getElementById('ct-action-board');
    if (!board) return;

    const sevEl = document.getElementById('ct-action-board-sev');
    sevEl.innerHTML = '';
    [['high','High','ct-sev-high'],['medium','Medium','ct-sev-medium'],['low','Low','ct-sev-low']].forEach(([key, label, cls]) => {
        const n = (sev && sev[key]) || 0;
        const span = document.createElement('span');
        span.className = 'ct-sev-badge ' + (n ? cls : 'ct-sev-zero');
        span.textContent = label + ': ' + n;
        sevEl.appendChild(span);
    });

    const autoEl = document.getElementById('ct-action-board-auto');
    const qBtn   = document.getElementById('ct-quick-fix-btn');
    const rBtn   = document.getElementById('ct-review-all-btn');

    if (autoCount === null) {
        autoEl.textContent = 'Checking for auto-remediable rules…';
        qBtn.disabled = true;
        qBtn.textContent = 'Critical Rules';
        qBtn.title = '';
    } else if (autoCount === 0) {
        autoEl.textContent = 'No automated fixes available';
        qBtn.disabled = true;
        qBtn.textContent = 'Critical Rules';
        qBtn.title = '';
    } else {
        const modeLabel = mode === 'medium' ? 'medium' : 'critical/high';
        autoEl.textContent = autoCount + ' ' + modeLabel + ' rule' + (autoCount !== 1 ? 's' : '') + ' can be auto-remediated';
        qBtn.disabled = false;
        qBtn.textContent = 'Critical Rules (' + autoCount + ')';
        qBtn.title = 'Pre-selects the ' + autoCount + ' automatable ' + modeLabel + ' rule' +
            (autoCount !== 1 ? 's' : '') + '. Review and confirm before anything is applied.';
    }

    rBtn.textContent = 'All Failures (' + totalFail + ')';
    rBtn.disabled = totalFail === 0;
    board.classList.remove('hidden');
}

function refreshActionBoardAutomatable() {
    if (!currentRemBashPath || !currentManifest) return;
    const sev = currentManifest.severity_counts || {};
    const totalFail = (currentManifest.counts || {}).fail || 0;
    cockpit.spawn(['python3', '-c', PY_EXTRACT_FAILING_RULES,
                  currentResultsDir + 'results.xml', currentRemBashPath], { err: 'message' })
        .then(output => {
            const d = JSON.parse(output);
            eagerRemRules = d.fails || d;
            const highCritRules = eagerRemRules.filter(r => ['high','critical'].includes(r.severity) && r.automated);
            const medRules      = eagerRemRules.filter(r => r.severity === 'medium' && r.automated);
            quickFixMode        = highCritRules.length > 0 ? 'high' : 'medium';
            const recCount      = quickFixMode === 'high' ? highCritRules.length : medRules.length;
            updateActionBoard(sev, totalFail, recCount, quickFixMode);
        })
        .catch(() => {});
}

function onQuickFixClick() {
    pendingQuickFix = true;
    openRemediationPanel(currentResultsDir);
}

function generateScanId() {
    return 'scan-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
}

function openRemDrawer() {
    document.getElementById('ct-remediation-panel').classList.add('ct-drawer-open');
    document.getElementById('ct-drawer-backdrop').classList.add('open');
}

function closeRemDrawer() {
    document.getElementById('ct-remediation-panel').classList.remove('ct-drawer-open');
    document.getElementById('ct-drawer-backdrop').classList.remove('open');
}

function openRuleDetailDrawer() {
    closeRemDrawer();
    closeCsRemDrawer();
    document.getElementById('ct-rule-detail-drawer').classList.add('ct-drawer-open');
    document.getElementById('ct-drawer-backdrop').classList.add('open');
}

function closeRuleDetailDrawer() {
    document.getElementById('ct-rule-detail-drawer').classList.remove('ct-drawer-open');
    document.getElementById('ct-drawer-backdrop').classList.remove('open');
}

function formatDuration(seconds) {
    if (seconds < 60) return seconds + 's';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
}

function showResults(manifest) {
    clearInterval(hostScanTimer);
    hostScanTimer = null;
    currentManifest = manifest;
    const { counts, score, profile_title, timestamp } = manifest;

    document.getElementById('ct-results-profile-title').textContent = profile_title;
    document.getElementById('ct-results-timestamp').textContent = timestamp
        ? timestamp.replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2')
        : '';
    const durEl = document.getElementById('ct-results-duration');
    if (manifest.scan_duration_s != null) {
        durEl.textContent = 'Completed in ' + formatDuration(manifest.scan_duration_s);
        durEl.classList.remove('hidden');
    } else {
        durEl.classList.add('hidden');
    }
    const idEl = document.getElementById('ct-results-scan-id');
    if (manifest.scan_id) {
        idEl.textContent = manifest.scan_id;
        idEl.classList.remove('hidden');
    } else {
        idEl.classList.add('hidden');
    }

    const badges = document.getElementById('ct-result-badges');
    badges.innerHTML = '';
    const badgeDefs = [
        ['Pass',          counts.pass,          'ct-badge-pass'],
        ['Fail',          counts.fail,          'ct-badge-fail'],
        ['Error',         counts.error,         'ct-badge-error'],
        ['Not checked',   counts.notchecked,    'ct-badge-neutral'],
    ];
    if ((counts.notapplicable || 0) > 0) {
        badgeDefs.splice(3, 0, ['Not applicable', counts.notapplicable, 'ct-badge-na']);
    }
    badgeDefs.forEach(([label, count, cls]) => {
        const span = document.createElement('span');
        span.className   = 'ct-result-badge ' + cls;
        span.textContent = label + ': ' + count;
        badges.appendChild(span);
    });

    const arfBtn = document.getElementById('ct-download-arf-btn');
    arfBtn.disabled = !manifest.has_arf;
    if (!manifest.has_arf) arfBtn.title = 'ARF not available — rescan to generate';

    const scoreEl  = document.getElementById('ct-result-score');
    const threshold = manifest.compliance_threshold != null ? manifest.compliance_threshold : 90;
    scoreEl.innerHTML = '';
    scoreEl.appendChild(buildScoreDonut(score, threshold, true));

    const targetEl = document.getElementById('ct-results-target');
    if (manifest.compliance_threshold != null) {
        targetEl.textContent = 'Policy target: ' + manifest.compliance_threshold + '%';
        targetEl.classList.remove('hidden');
    } else {
        targetEl.classList.add('hidden');
    }

    const uploadedWarn = document.getElementById('ct-uploaded-content-warning');
    if (currentSdsPath && currentSdsPath.startsWith(CONTENT_BASE)) {
        uploadedWarn.classList.remove('hidden');
    } else {
        uploadedWarn.classList.add('hidden');
    }

    const prev = findPreviousScan(manifest, currentHostHistory);
    const deltaEl = document.getElementById('ct-result-score-delta');
    if (prev) {
        const scoreDiff = score - prev.score;
        if (Math.abs(scoreDiff) >= 0.05) {
            const sign = scoreDiff > 0 ? '+' : '';
            deltaEl.textContent = sign + scoreDiff.toFixed(1) + ' pts vs. last scan';
            deltaEl.className = 'ct-result-score-delta ' +
                (scoreDiff > 0 ? 'ct-delta-up' : 'ct-delta-down');
        } else {
            deltaEl.className = 'ct-result-score-delta hidden';
        }
    } else {
        deltaEl.className = 'ct-result-score-delta hidden';
    }
    const improvementAlert = document.getElementById('ct-improvement-alert');
    const regressionAlert  = document.getElementById('ct-regression-alert');
    const diffContainer    = document.getElementById('ct-scan-diff');
    diffContainer.innerHTML = '';
    diffContainer.classList.add('hidden');

    if (prev && counts.fail < prev.counts.fail) {
        const delta    = prev.counts.fail - counts.fail;
        const prevDate = prev.timestamp.replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
        document.getElementById('ct-improvement-msg').textContent =
            delta + ' fewer failing rule' + (delta === 1 ? '' : 's') +
            ' than your previous scan on ' + prevDate +
            ' (' + prev.counts.fail + ' → ' + counts.fail + ')';
        improvementAlert.classList.remove('hidden');
        regressionAlert.classList.add('hidden');
        const prevXml = RESULTS_BASE + prev.timestamp + '/results.xml';
        document.getElementById('ct-diff-btn').addEventListener('click',
            () => loadScanDiff(currentResultsDir + 'results.xml', prevXml, 'ct-scan-diff'), { once: true });
    } else if (prev && counts.fail > prev.counts.fail) {
        const delta    = counts.fail - prev.counts.fail;
        const prevDate = prev.timestamp.replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
        document.getElementById('ct-regression-msg').textContent =
            delta + ' more failing rule' + (delta === 1 ? '' : 's') +
            ' than your previous scan on ' + prevDate +
            ' (' + prev.counts.fail + ' → ' + counts.fail + ')';
        regressionAlert.classList.remove('hidden');
        improvementAlert.classList.add('hidden');
        const prevXml = RESULTS_BASE + prev.timestamp + '/results.xml';
        document.getElementById('ct-diff-btn-reg').addEventListener('click',
            () => loadScanDiff(currentResultsDir + 'results.xml', prevXml, 'ct-scan-diff'), { once: true });
    } else {
        improvementAlert.classList.add('hidden');
        regressionAlert.classList.add('hidden');
    }


    if (!currentScanProc) document.getElementById('ct-scan-progress').classList.add('hidden');
    document.getElementById('ct-results').classList.remove('hidden');
    renderFailingSummary(currentResultsDir + 'results.xml',
                         'ct-failing-summary-groups', 'ct-failing-summary-loading',
                         currentRemBashPath || null, 'ct-failing-search');

    /* Action Board — show severity counts immediately, load automatable count async */
    eagerRemRules = null;
    const sev = manifest.severity_counts || {};
    updateActionBoard(sev, counts.fail, null);
    const eagerArgs = [currentResultsDir + 'results.xml'];
    if (currentRemBashPath) eagerArgs.push(currentRemBashPath);
    cockpit.spawn(['python3', '-c', PY_EXTRACT_FAILING_RULES, ...eagerArgs], { err: 'message' })
        .then(output => {
            const d = JSON.parse(output); eagerRemRules = d.fails || d;
            const highCritRules = eagerRemRules.filter(r => ['high','critical'].includes(r.severity) && r.automated);
            const medRules      = eagerRemRules.filter(r => r.severity === 'medium' && r.automated);
            quickFixMode        = highCritRules.length > 0 ? 'high' : 'medium';
            const recCount      = quickFixMode === 'high' ? highCritRules.length : medRules.length;
            updateActionBoard(sev, counts.fail, recCount, quickFixMode);
        })
        .catch(() => updateActionBoard(sev, counts.fail, 0));

    loadHistory();
    dbInvalidate();
}

/* ---- Report / artifact actions ----------------------------- */

function viewReport() {
    viewReportFromPath(currentResultsDir + 'results.xml');
}

function generateReport(resultsXmlPath) {
    const tmpPath = '/tmp/cockpit-scap-report-' + Date.now() + '.html';
    return cockpit.spawn(
        ['oscap', 'xccdf', 'generate', 'report', '--output', tmpPath, resultsXmlPath],
        { err: 'out' }
    ).then(() => cockpit.file(tmpPath).read())
     .then(html => { cockpit.spawn(['rm', '-f', tmpPath]).catch(() => {}); return html; });
}

function storeReportInDB(html) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('cockpit-scap', 1);
        req.onupgradeneeded = e => { e.target.result.createObjectStore('reports'); };
        req.onsuccess = e => {
            const db = e.target.result;
            const tx = db.transaction('reports', 'readwrite');
            tx.objectStore('reports').put(html, 'current');
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror   = () => { db.close(); reject(tx.error); };
        };
        req.onerror = () => reject(req.error);
    });
}

function viewReportFromPath(resultsXmlPath) {
    const win = window.open('about:blank', '_blank');
    if (!win) { console.error('Popup blocked — cannot open report'); return; }
    win.document.write('<p style="font-family:sans-serif;padding:2rem;color:#151515">Generating report…</p>');
    generateReport(resultsXmlPath)
        .then(content => storeReportInDB(content))
        .then(() => { win.location.href = '/cockpit/@localhost/cockpit-scap/viewer.html'; })
        .catch(err => { win.close(); console.error('Failed to open report:', err); });
}

function downloadArtifact(filePath, filename, mimeType, btn) {
    if (!filePath) return;
    cockpit.file(filePath, { max_read_size: -1 }).read()
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
            alert('Download failed: ' + (err.message || String(err)));
        });
}

/* ---- Scan state transitions -------------------------------- */

function showScanProgress() {
    document.getElementById('ct-scan-row').classList.add('hidden');
    document.getElementById('ct-scan-progress').classList.remove('hidden');
    document.getElementById('ct-results').classList.add('hidden');
    hostScanStart = Date.now();
    const fillEl   = document.getElementById('ct-scan-progress-fill');
    const labelEl  = document.getElementById('ct-scan-elapsed');
    fillEl.style.width = '0%';
    fillEl.classList.remove('ct-indeterminate');
    labelEl.textContent = '';
    document.getElementById('ct-rule-feed').classList.add('hidden');
    document.getElementById('ct-rule-feed-list').innerHTML = '';
    document.getElementById('ct-rule-tally').textContent = '';
    const _profileId = (document.getElementById('ct-profile-select') || {}).value || null;
    const _prevScan  = currentHostHistory.find(m =>
        m.profile_id === _profileId && m.sds_file === currentSdsPath && m.scan_duration_s != null
    );
    const _estSecs = _prevScan ? _prevScan.scan_duration_s : null;
    if (!_estSecs) fillEl.classList.add('ct-indeterminate');
    hostScanTimer = setInterval(() => {
        const s = Math.floor((Date.now() - hostScanStart) / 1000);
        if (_estSecs) {
            fillEl.style.width = Math.min(100, Math.round((s / _estSecs) * 100)) + '%';
            if (s >= _estSecs * 1.5) {
                const m = Math.floor(s / 60);
                labelEl.textContent = m > 0 ? m + 'm ' + (s % 60) + 's' : s + 's';
            } else {
                const rem = Math.max(0, _estSecs - s);
                const rm  = Math.floor(rem / 60);
                const rs  = rem % 60;
                labelEl.textContent = rem === 0 ? 'finishing…'
                    : rm > 0 ? '~' + rm + 'm ' + String(rs).padStart(2, '0') + 's remaining'
                    : '~' + rs + 's remaining';
            }
        } else {
            const m = Math.floor(s / 60);
            labelEl.textContent = m > 0 ? m + 'm ' + (s % 60) + 's' : s + 's';
        }
    }, 1000);
    loadHistory();
}

function showScanSetup() {
    clearInterval(hostScanTimer);
    hostScanTimer = null;
    document.getElementById('ct-scan-row').classList.remove('hidden');
    document.getElementById('ct-scan-progress').classList.add('hidden');
    document.getElementById('ct-results').classList.add('hidden');
    document.getElementById('ct-failing-summary-groups').innerHTML = '';
    document.getElementById('ct-failing-summary-loading').classList.add('hidden');
    document.getElementById('ct-improvement-alert').classList.add('hidden');
    document.getElementById('ct-regression-alert').classList.add('hidden');
    const d = document.getElementById('ct-scan-diff');
    d.innerHTML = ''; d.classList.add('hidden');
    currentScanProc       = null;
    currentRemBashPath    = null;
    currentRemAnsiblePath = null;
    remediationGenerating = false;
}

/* ---- UI helpers -------------------------------------------- */

function showNoContentAlert() {
    document.getElementById('ct-no-content-alert-section').classList.remove('hidden');
}

function hideNoContentAlert() {
    document.getElementById('ct-no-content-alert-section').classList.add('hidden');
}

function resetProfileSelect() {
    const select = document.getElementById('ct-profile-select');
    select.innerHTML = '';
    appendOption(select, '', 'Select content first');
    select.disabled = true;
}

function showProfileDescription(profileTitle, descText) {
    document.getElementById('ct-profile-desc-title').textContent = profileTitle;
    document.getElementById('ct-profile-desc-placeholder').classList.add('hidden');
    const el = document.getElementById('ct-profile-description');
    el.textContent = descText;
    el.classList.remove('hidden');
}

function hideProfileDescription() {
    document.getElementById('ct-profile-desc-title').textContent = 'Profile';
    document.getElementById('ct-profile-desc-placeholder').classList.remove('hidden');
    const el = document.getElementById('ct-profile-description');
    el.classList.add('hidden');
    el.textContent = '';
}

function setScanButtonEnabled(enabled) {
    const adminAllowed = !adminPermission || adminPermission.allowed !== false;
    document.getElementById('ct-scan-btn').disabled = !enabled || !adminAllowed;
    updateHostScanCmd();
}

function updateHostScanCmd() {
    const profileSelect  = document.getElementById('ct-profile-select');
    const tailorSelect   = document.getElementById('ct-tailor-file-select');
    const tailoringPath  = tailorSelect.value;
    const details        = document.getElementById('ct-scan-cmd-details');
    const cmdEl          = document.getElementById('ct-scan-cmd');

    let profileId;
    if (tailoringPath && tailoringFilesMap[tailoringPath]) {
        profileId = tailoringFilesMap[tailoringPath].profile_id;
    } else {
        profileId = profileSelect.value;
    }

    const remEnabled = !!(currentSdsPath && profileId);
    document.getElementById('ct-profile-rem-toggle').disabled = !remEnabled;

    if (!currentSdsPath || !profileId) {
        details.classList.add('hidden');
        return;
    }

    let cmd = 'oscap xccdf eval --profile ' + profileId;
    if (tailoringPath) cmd += ' --tailoring-file ' + tailoringPath;
    cmd += ' --results /var/lib/cockpit-scap/results/<timestamp>/results.xml';
    // report.html is generated on demand — not passed to oscap at scan time
    cmd += ' --results-arf /var/lib/cockpit-scap/results/<timestamp>/results.arf';
    cmd += ' ' + currentSdsPath;

    cmdEl.textContent = cmd;
    details.classList.remove('hidden');
}

function remFixMeta(fixType) {
    if (fixType === 'bash')       return { ext: '.sh',              mime: 'text/x-shellscript' };
    if (fixType === 'puppet')     return { ext: '.pp',              mime: 'text/plain' };
    if (fixType === 'ansible')    return { ext: '-ansible.yml',     mime: 'text/yaml' };
    return { ext: '.txt', mime: 'text/plain' };
}

function downloadProfileRemediation(fixType, btnEl) {
    const tailorSelect  = document.getElementById('ct-tailor-file-select');
    const tailoringPath = tailorSelect ? tailorSelect.value : '';
    let profileId;
    if (tailoringPath && tailoringFilesMap[tailoringPath]) {
        profileId = tailoringFilesMap[tailoringPath].profile_id;
    } else {
        profileId = (document.getElementById('ct-profile-select') || {}).value || '';
    }
    if (!currentSdsPath || !profileId) return;

    const args = ['oscap', 'xccdf', 'generate', 'fix', '--fix-type', fixType,
                  '--profile', profileId];
    if (tailoringPath) args.push('--tailoring-file', tailoringPath);
    args.push(currentSdsPath);

    const { ext, mime } = remFixMeta(fixType);
    const profileSel  = document.getElementById('ct-profile-select');
    const profileText = profileSel && profileSel.selectedIndex >= 0
        ? profileSel.options[profileSel.selectedIndex].text : profileId;
    const safeName = profileText.toLowerCase()
        .replace(/[()]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const fname    = 'profile-remediation-' + safeName + ext;
    const origText = btnEl.textContent;
    btnEl.disabled = true;
    btnEl.textContent = 'Generating…';

    cockpit.spawn(args, { err: 'message' })
        .then(output => {
            if (!output || !output.trim()) {
                btnEl.textContent = 'No content for this profile';
                setTimeout(() => { btnEl.disabled = false; btnEl.textContent = origText; }, 3000);
                return;
            }
            const blob = new Blob([output], { type: mime });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href = url; a.download = fname; a.click();
            URL.revokeObjectURL(url);
            btnEl.textContent = '✓ Downloaded';
            setTimeout(() => { btnEl.disabled = false; btnEl.textContent = origText; }, 2000);
            appendActivityLog({ type: 'profile_rem_download', tab: 'host',
                fix_type: fixType, profile_id: profileId });
        })
        .catch(() => {
            btnEl.textContent = 'Failed';
            setTimeout(() => { btnEl.disabled = false; btnEl.textContent = origText; }, 2000);
        });
}

function updateGuideButton() {
    const profileId     = document.getElementById('ct-profile-select').value;
    const tailoringPath = document.getElementById('ct-tailor-file-select').value;
    document.getElementById('ct-guide-btn').disabled =
        !currentSdsPath || (!profileId && !tailoringPath);
}

function onViewGuideClick() {
    const btn           = document.getElementById('ct-guide-btn');
    const profileId     = document.getElementById('ct-profile-select').value;
    const tailoringPath = document.getElementById('ct-tailor-file-select').value;

    const args = ['oscap', 'xccdf', 'generate', 'guide'];
    if (tailoringPath && tailoringFilesMap[tailoringPath]) {
        args.push('--tailoring-file', tailoringPath,
                  '--profile', tailoringFilesMap[tailoringPath].profile_id);
    } else {
        args.push('--profile', profileId);
    }
    args.push(currentSdsPath);

    btn.disabled    = true;
    btn.textContent = 'Generating…';

    const win = window.open('about:blank', '_blank');
    if (!win) {
        btn.disabled    = false;
        btn.textContent = 'View Compliance Guide';
        console.error('Popup blocked — cannot open guide');
        return;
    }
    win.document.write('<html><body style="font-family:RedHatText,sans-serif;padding:48px;color:#151515">' +
        '<p>Generating compliance guide… this may take 15–20 seconds.</p></body></html>');
    cockpit.spawn(args, { err: 'message' })
        .then(html => storeReportInDB(html))
        .then(() => {
            appendActivityLog({ type: 'guide', tab: 'host', profile: profileId });
            win.location.href = '/cockpit/@localhost/cockpit-scap/viewer.html';
        })
        .catch(err => {
            win.close();
            console.error('Guide generation failed:', err.message || err);
        })
        .then(() => {
            btn.disabled    = false;
            btn.textContent = 'View Compliance Guide';
        });
}

function onTailorViewGuideClick() {
    const btn       = document.getElementById('ct-tailor-guide-btn');
    const profileId = document.getElementById('ct-tailor-profile-select').value;

    btn.disabled    = true;
    btn.textContent = 'Generating…';

    const win = window.open('about:blank', '_blank');
    if (!win) {
        btn.disabled    = false;
        btn.textContent = 'View Compliance Guide';
        console.error('Popup blocked — cannot open guide');
        return;
    }
    win.document.write('<html><body style="font-family:RedHatText,sans-serif;padding:48px;color:#151515">' +
        '<p>Generating compliance guide… this may take 15–20 seconds.</p></body></html>');
    cockpit.spawn(['oscap', 'xccdf', 'generate', 'guide', '--profile', profileId, tailorSdsPath],
                  { err: 'message' })
        .then(html => storeReportInDB(html))
        .then(() => {
            appendActivityLog({ type: 'guide', tab: 'tailoring', profile: profileId });
            win.location.href = '/cockpit/@localhost/cockpit-scap/viewer.html';
        })
        .catch(err => {
            win.close();
            console.error('Guide generation failed:', err.message || err);
        })
        .then(() => {
            btn.disabled    = false;
            btn.textContent = 'View Compliance Guide';
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

/* ---- Scan history ------------------------------------------ */

function loadHistory() {
    cockpit.spawn(['ls', RESULTS_BASE], { err: 'message' })
        .then(output => {
            const dirs = output.trim().split('\n')
                .filter(d => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(d));

            if (dirs.length === 0) {
                renderHistory([]);
                return;
            }

            return Promise.all(
                dirs.map(dir =>
                    cockpit.file(RESULTS_BASE + dir + '/manifest.json').read()
                        .then(content => {
                            const m = JSON.parse(content);
                            return (m && m.scan_type === 'container') ? null : m;
                        })
                        .catch(() => null)
                )
            ).then(manifests => {
                const valid = manifests.filter(Boolean);
                valid.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
                renderHistory(valid);
            });
        })
        .catch(() => renderHistory([]));
}

function renderHistory(manifests) {
    const empty = document.getElementById('ct-history-empty');
    const table = document.getElementById('ct-history-table');
    const tbody = document.getElementById('ct-history-tbody');

    currentHostHistory = manifests;
    document.getElementById('ct-export-csv-btn').disabled = manifests.length === 0;

    if (manifests.length === 0) {
        empty.classList.remove('hidden');
        table.classList.add('hidden');
        return;
    }

    tbody.innerHTML = '';
    manifests.forEach(m => tbody.appendChild(buildHistoryRow(m)));
    empty.classList.add('hidden');
    table.classList.remove('hidden');
    updateAdminControls();
}

function buildHistoryRow(manifest) {
    const dir = RESULTS_BASE + manifest.timestamp + '/';
    const tr  = document.createElement('tr');

    const date = manifest.timestamp
        .replace('T', ' ')
        .replace(/-(\d{2})-(\d{2})$/, ':$1:$2');

    const isUploaded = manifest.sds_file && manifest.sds_file.startsWith(CONTENT_BASE);

    const prev      = findPreviousScan(manifest, currentHostHistory);
    const score     = manifest.score || 0;
    const scoreText = score.toFixed(1) + '%';
    const threshold = manifest.compliance_threshold != null ? manifest.compliance_threshold : 90;
    const scoreCls  = score >= threshold ? 'ct-score-high' : 'ct-score-low';
    const scoreTitle = score >= threshold ? 'Compliant (target: ' + threshold + '%)' : 'Non-compliant (target: ' + threshold + '%)';
    let   scoreDelta = '';
    if (prev && prev.score != null && manifest.score != null) {
        const d = parseFloat((manifest.score - prev.score).toFixed(1));
        if (d > 0)      scoreDelta = ' ↑+' + d + '%';
        else if (d < 0) scoreDelta = ' ↓' + d + '%';
    }

    const profileTitle = manifest.profile_title || '—';
    const cells = [
        { text: date,         cls: 'ct-history-date-cell' },
        { text: hostName,     cls: 'ct-history-target-cell' },
        { text: profileTitle, cls: 'ct-history-profile-cell',
          title: isUploaded ? profileTitle + ' (custom: ' + (manifest.sds_file || '').split('/').pop() + ')' : profileTitle },
        { text: String(manifest.counts.pass), cls: 'ct-history-num-cell' },
        { text: String(manifest.counts.fail), cls: 'ct-history-num-cell' },
        { text: scoreText,    cls: 'ct-history-num-cell ' + scoreCls, delta: scoreDelta, title: scoreTitle },
    ];

    cells.forEach(({ text, cls, title, delta }) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (cls)   td.className = cls;
        if (title) td.title     = title;
        if (delta) {
            const sp = document.createElement('span');
            sp.className   = delta.includes('↑') ? 'ct-score-delta-up' : 'ct-score-delta-down';
            sp.textContent = delta;
            td.appendChild(sp);
        }
        tr.appendChild(td);
    });

    const actionsTd = document.createElement('td');
    actionsTd.className = 'ct-history-actions';

    const rerunBtn = document.createElement('button');
    rerunBtn.className   = 'pf-v6-c-button pf-m-link ct-history-rerun-btn';
    rerunBtn.type        = 'button';
    rerunBtn.textContent = 'Run Again';
    rerunBtn.disabled    = !!currentScanProc;
    rerunBtn.addEventListener('click', () => rerunHostScan(manifest));
    actionsTd.appendChild(rerunBtn);

    [
        ['View Scan',  () => loadScanFromHistory(manifest),                          false],
        ['Remediate',  () => { loadScanFromHistory(manifest); openRemediationPanel(dir); }, false],
    ].forEach(([label, handler, disabled]) => {
        const btn = document.createElement('button');
        btn.className   = 'pf-v6-c-button pf-m-link';
        btn.type        = 'button';
        btn.textContent = label;
        btn.disabled    = disabled;
        btn.addEventListener('click', handler);
        actionsTd.appendChild(btn);
    });

    const delBtn = document.createElement('button');
    delBtn.className   = 'pf-v6-c-button pf-m-link ct-btn-danger-link ct-requires-admin';
    delBtn.type        = 'button';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => onDeleteHistoryEntry(manifest));
    actionsTd.appendChild(delBtn);

    tr.appendChild(actionsTd);
    return tr;
}

function onDeleteHistoryEntry(manifest) {
    const date = manifest.timestamp
        .replace('T', ' ')
        .replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
    showConfirmModal(
        'Delete Scan',
        'Delete the scan from ' + date + '? The report, results, and remediation files will be permanently removed.',
        () => {
            if (!TIMESTAMP_RE.test(manifest.timestamp)) return;
            cockpit.spawn(['rm', '-rf', RESULTS_BASE + manifest.timestamp], { superuser: 'require' })
                .then(() => {
                    appendActivityLog({ type: 'scan_delete', tab: 'host', content: manifest.sds_file, profile: manifest.profile_id });
                    loadHistory();
                    dbInvalidate();
                })
                .catch(err => console.error('Failed to delete scan:', err.message || err));
        }
    );
}

function rerunHostScan(manifest, autoStart = false) {
    if (currentScanProc) return;
    showScanSetup();
    document.getElementById('tab-btn-scan').click();

    const contentSelect = document.getElementById('ct-content-select');
    contentSelect.value = manifest.sds_file;
    if (contentSelect.value !== manifest.sds_file) return;

    currentSdsPath = manifest.sds_file;
    resetProfileSelect();
    hideProfileDescription();
    setScanButtonEnabled(false);

    Promise.all([
        loadProfiles(manifest.sds_file),
        detectTailoringFiles(),
    ]).then(() => {
        const profileSelect = document.getElementById('ct-profile-select');
        if (manifest.tailoring_file) {
            const sidecar = tailoringFilesMap[manifest.tailoring_file];
            const baseId  = sidecar ? sidecar.base_profile_id : null;
            if (baseId) {
                profileSelect.value = baseId;
                if (profileSelect.value) profileSelect.dispatchEvent(new Event('change'));
            }
            document.getElementById('ct-tailor-file-select').value = manifest.tailoring_file;
        } else {
            profileSelect.value = manifest.profile_id;
            if (profileSelect.value) profileSelect.dispatchEvent(new Event('change'));
        }
        if (autoStart) document.getElementById('ct-scan-btn').click();
    });
}

/* ---- Tailoring file detection (scan tab) ------------------- */

function detectTailoringFiles() {
    const gen = ++tailoringFilesGen;
    const scanSelect = document.getElementById('ct-tailor-file-select');

    return cockpit.spawn(['ls', TAILORING_BASE], { err: 'message' })
        .then(output => {
            if (gen !== tailoringFilesGen) return;

            const files = output.trim().split('\n')
                .filter(f => f && f.endsWith('.json'));

            if (files.length === 0) {
                tailoringFilesMap = {};
                scanSelect.innerHTML = '';
                appendOption(scanSelect, '', '(No tailoring — use full profile)');
                renderTailoringList([]);
                return;
            }

            return Promise.all(
                files.map(f =>
                    cockpit.file(TAILORING_BASE + f).read()
                        .then(content => JSON.parse(content))
                        .catch(() => null)
                )
            ).then(sidecars => {
                if (gen !== tailoringFilesGen) return;

                const all   = sidecars.filter(Boolean);
                /* Scan tab dropdown: only files matching the current SDS */
                const forScan = all.filter(sc => !currentSdsPath || sc.sds_path === currentSdsPath);

                tailoringFilesMap = {};
                scanSelect.innerHTML = '';
                appendOption(scanSelect, '', '(No tailoring — use full profile)');

                if (forScan.length > 0) {
                    forScan.forEach(sc => {
                        tailoringFilesMap[sc.path] = sc;
                        const created = sc.created
                            ? sc.created.slice(0, 10) + ' ' + sc.created.slice(11).replace(/-/g, ':')
                            : '';
                        const label = created ? sc.name + ' (' + created + ')' : sc.name;
                        appendOption(scanSelect, sc.path, label);
                    });
                }

                /* Backfill rules_modified for sidecars saved before v3.9 */
                const needsBackfill = all.filter(sc => sc.rules_modified == null && sc.path);
                if (needsBackfill.length === 0) {
                    renderTailoringList(all);
                } else {
                    Promise.all(needsBackfill.map(sc =>
                        cockpit.file(sc.path).read()
                            .then(xml => {
                                if (!xml) return;
                                sc.rules_modified = (xml.match(/<(?:[a-z]+:)?select\s+idref=/gi) || []).length;
                                const jsonPath = sc.path.replace(/\.xml$/, '.json');
                                return cockpit.file(jsonPath, { superuser: 'require' })
                                    .replace(JSON.stringify(sc, null, 2));
                            })
                            .catch(() => {})
                    )).then(() => {
                        if (gen !== tailoringFilesGen) return;
                        renderTailoringList(all);
                    });
                }
            });
        })
        .catch(() => {
            if (gen !== tailoringFilesGen) return;
            tailoringFilesMap = {};
            scanSelect.innerHTML = '';
            appendOption(scanSelect, '', '(No tailoring — use full profile)');
            renderTailoringList([]);
        });
}

function onTailorFileSelectChange() {
    const tailoringPath = document.getElementById('ct-tailor-file-select').value;

    if (!tailoringPath) {
        const profileId = document.getElementById('ct-profile-select').value;
        setScanButtonEnabled(!!profileId);
        updateGuideButton();
        return;
    }

    const sidecar = tailoringFilesMap[tailoringPath];
    if (sidecar && sidecar.base_profile_id && sidecar.sds_path) {
        const profileSelect = document.getElementById('ct-profile-select');
        const contentSelect = document.getElementById('ct-content-select');

        const setProfile = () => {
            const opt = Array.from(profileSelect.options).find(o => o.value === sidecar.base_profile_id);
            if (opt) {
                profileSelect.value = sidecar.base_profile_id;
                loadProfileDescription(sidecar.sds_path, sidecar.base_profile_id);
            }
        };

        if (currentSdsPath !== sidecar.sds_path) {
            contentSelect.value = sidecar.sds_path;
            if (contentSelect.value === sidecar.sds_path) {
                currentSdsPath = sidecar.sds_path;
                loadProfiles(sidecar.sds_path).then(setProfile);
                detectTailoringFiles();
            }
        } else {
            setProfile();
        }
    }

    setScanButtonEnabled(true);
    updateGuideButton();
}

/* ---- Tailoring tab ----------------------------------------- */

function resetTailorForm() {
    tailorData           = null;
    tailorRuleChanges    = {};
    tailorValueChanges   = {};
    tailorEditingSidecar = null;

    document.getElementById('ct-tailor-update-btn').classList.add('hidden');
    const saveBtn = document.getElementById('ct-tailor-save-btn');
    saveBtn.textContent = 'Save Policy';
    saveBtn.classList.add('pf-m-primary');
    saveBtn.classList.remove('pf-m-secondary');

    document.getElementById('ct-tailor-editor').classList.add('hidden');
    document.getElementById('ct-tailor-error-alert').classList.add('hidden');

    document.getElementById('ct-tailor-profile-select').value = '';
    const nameInput = document.getElementById('ct-tailor-name-input');
    nameInput.value    = '';
    nameInput.disabled = true;
    if (nameInput._editorSyncHandler) {
        nameInput.removeEventListener('input', nameInput._editorSyncHandler);
        nameInput._editorSyncHandler = null;
    }
    document.getElementById('ct-tailor-load-btn').disabled = true;
    hideTailorProfileDesc();
}

function showTailorProfileDesc(profileTitle, descText) {
    document.getElementById('ct-tailor-desc-title').textContent = profileTitle;
    document.getElementById('ct-tailor-desc-placeholder').classList.add('hidden');
    const el = document.getElementById('ct-tailor-desc-text');
    el.textContent = descText;
    el.classList.remove('hidden');
}

function hideTailorProfileDesc() {
    document.getElementById('ct-tailor-desc-title').textContent = 'Base Profile';
    document.getElementById('ct-tailor-desc-placeholder').classList.remove('hidden');
    const el = document.getElementById('ct-tailor-desc-text');
    el.classList.add('hidden');
    el.textContent = '';
}

function onTailorContentChange() {
    const sdsPath = document.getElementById('ct-tailor-content-select').value;
    tailorSdsPath = sdsPath || null;

    const profileSelect = document.getElementById('ct-tailor-profile-select');
    profileSelect.innerHTML = '';
    appendOption(profileSelect, '', 'Select content first');
    profileSelect.disabled = true;

    document.getElementById('ct-tailor-name-input').value    = '';
    document.getElementById('ct-tailor-name-input').disabled = true;
    document.getElementById('ct-tailor-load-btn').disabled   = true;
    document.getElementById('ct-tailor-editor').classList.add('hidden');
    document.getElementById('ct-tailor-error-alert').classList.add('hidden');
    hideTailorProfileDesc();

    if (!sdsPath) return;
    loadProfiles(sdsPath, 'ct-tailor-profile-select');
}

function onTailorProfileChange() {
    const profileSelect = document.getElementById('ct-tailor-profile-select');
    const profileId     = profileSelect.value;
    const nameInput     = document.getElementById('ct-tailor-name-input');

    if (!profileId) {
        nameInput.disabled = true;
        document.getElementById('ct-tailor-load-btn').disabled = true;
        hideTailorProfileDesc();
        return;
    }

    const profileTitle   = profileSelect.options[profileSelect.selectedIndex].text;
    nameInput.value      = profileTitle + ' — Custom';
    nameInput.disabled   = false;
    updateTailorLoadBtn();

    cockpit.spawn(['oscap', 'info', '--profile', profileId, tailorSdsPath], { err: 'out' })
        .then(output => {
            const desc = parseProfileDescription(output);
            if (desc) showTailorProfileDesc(profileTitle, desc);
        })
        .catch(() => hideTailorProfileDesc());
}

function updateTailorLoadBtn() {
    const profileId  = document.getElementById('ct-tailor-profile-select').value;
    const name       = document.getElementById('ct-tailor-name-input').value.trim();
    const remEnabled = !!(profileId && tailorSdsPath);
    document.getElementById('ct-tailor-load-btn').disabled          = !profileId || !name;
    document.getElementById('ct-tailor-guide-btn').disabled          = !remEnabled;
    document.getElementById('ct-tailor-profile-rem-toggle').disabled = !remEnabled;
}

function downloadTailorProfileRemediation(fixType, btnEl) {
    const profileId = document.getElementById('ct-tailor-profile-select').value;
    if (!profileId || !tailorSdsPath) return;

    const args = ['oscap', 'xccdf', 'generate', 'fix', '--fix-type', fixType,
                  '--profile', profileId];
    if (tailorEditingSidecar && tailorEditingSidecar.path) {
        args.push('--tailoring-file', tailorEditingSidecar.path);
    }
    args.push(tailorSdsPath);

    const { ext, mime: remMime } = remFixMeta(fixType);
    const profileSel = document.getElementById('ct-tailor-profile-select');
    const profileText = profileSel && profileSel.selectedIndex >= 0
        ? profileSel.options[profileSel.selectedIndex].text : profileId;
    const safeName = profileText.toLowerCase()
        .replace(/[()]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const tailorTag  = tailorEditingSidecar ? '-tailored' : '';
    const fname      = 'profile-remediation-' + safeName + tailorTag + ext;
    const origText   = btnEl.textContent;
    btnEl.disabled   = true;
    btnEl.textContent = 'Generating…';

    cockpit.spawn(args, { err: 'message' })
        .then(output => {
            if (!output || !output.trim()) {
                btnEl.textContent = 'No content for this profile';
                setTimeout(() => { btnEl.disabled = false; btnEl.textContent = origText; }, 3000);
                return;
            }
            const blob = new Blob([output], { type: remMime });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href = url; a.download = fname; a.click();
            URL.revokeObjectURL(url);
            btnEl.textContent = '✓ Downloaded';
            setTimeout(() => { btnEl.disabled = false; btnEl.textContent = origText; }, 2000);
            appendActivityLog({ type: 'profile_rem_download', tab: 'tailoring',
                fix_type: fixType, profile_id: profileId });
        })
        .catch(() => {
            btnEl.textContent = 'Failed';
            setTimeout(() => { btnEl.disabled = false; btnEl.textContent = origText; }, 2000);
        });
}

function onTailorLoadClick() {
    const profileId = document.getElementById('ct-tailor-profile-select').value;
    if (!profileId || !tailorSdsPath) return;

    const hasUnsaved = Object.keys(tailorRuleChanges).length > 0 ||
                       Object.keys(tailorValueChanges).length > 0;

    if (hasUnsaved) {
        showConfirmModal(
            'Discard unsaved changes?',
            'Loading a new profile will discard your current changes. This cannot be undone.',
            () => doLoadProfile(profileId),
            'Discard Changes'
        );
    } else {
        doLoadProfile(profileId);
    }
}

function doLoadProfile(profileId) {
    document.getElementById('ct-tailor-editor').classList.add('hidden');
    document.getElementById('ct-tailor-error-alert').classList.add('hidden');
    document.getElementById('ct-tailor-loading').classList.remove('hidden');

    tailorRuleChanges  = {};
    tailorValueChanges = {};

    cockpit.spawn(['python3', '-c', PY_EXTRACT_PROFILE, profileId, tailorSdsPath], { err: 'out' })
        .then(output => {
            try {
                tailorData = JSON.parse(output);
            } catch (e) {
                throw new Error('Failed to parse profile data from oscap: ' + e.message);
            }
            document.getElementById('ct-tailor-loading').classList.add('hidden');
            renderTailorEditor(tailorData);
        })
        .catch(err => {
            document.getElementById('ct-tailor-loading').classList.add('hidden');
            document.getElementById('ct-tailor-error-message').textContent =
                err.message || String(err);
            document.getElementById('ct-tailor-error-alert').classList.remove('hidden');
        });
}

function renderTailorEditor(data) {
    document.getElementById('ct-tailor-search').value        = '';
    document.getElementById('ct-tailor-values-search').value = '';
    const nameInput  = document.getElementById('ct-tailor-name-input');
    const editorName = document.getElementById('ct-tailor-editor-name');
    editorName.value = nameInput.value.trim();
    document.getElementById('ct-tailor-threshold').value =
        (tailorEditingSidecar && tailorEditingSidecar.compliance_threshold != null)
            ? tailorEditingSidecar.compliance_threshold
            : 90;
    /* keep setup-form field in sync with the inline editor name field */
    if (nameInput._editorSyncHandler) {
        nameInput.removeEventListener('input', nameInput._editorSyncHandler);
    }
    nameInput._editorSyncHandler = () => { editorName.value = nameInput.value; };
    nameInput.addEventListener('input', nameInput._editorSyncHandler);
    document.getElementById('ct-tailor-values-grid').classList.add('hidden');
    document.getElementById('ct-tailor-values-search')
        .closest('.ct-tailor-search-wrap').classList.add('hidden');
    document.getElementById('ct-tailor-values-collapse').textContent = 'Expand';
    renderTailorTree(data);
    renderTailorValues(data.values || []);
    const statusEl = document.getElementById('ct-tailor-save-status');
    statusEl.textContent = '';
    statusEl.className   = 'ct-tailor-save-status hidden';
    document.getElementById('ct-tailor-editor').classList.remove('hidden');
    updateTailorSummary();
}

function renderTailorTree(data) {
    const container = document.getElementById('ct-tailor-tree');
    container.innerHTML = '';
    tailorFilterStatus = 'all';
    tailorFilterSev    = 'all';
    document.querySelectorAll('#ct-tailor-filter-bar .ct-tailor-filter-btn').forEach(b => {
        const isAll = b.dataset.filterStatus === 'all' || b.dataset.filterSev === 'all';
        b.classList.toggle('active', isAll);
    });

    function countGroup(group) {
        let total = (group.rules || []).length;
        let modified = (group.rules || []).filter(r => r.id in tailorRuleChanges).length;
        (group.groups || []).forEach(sg => {
            const c = countGroup(sg);
            total += c.total; modified += c.modified;
        });
        return { total, modified };
    }

    function buildRule(rule) {
        const div = document.createElement('div');
        div.className = 'ct-tailor-rule';
        div.dataset.ruleId = rule.id;
        div.dataset.sev    = rule.severity || 'unknown';

        const label = document.createElement('label');
        label.className = 'ct-tailor-rule-label';

        const cb      = document.createElement('input');
        cb.type       = 'checkbox';
        cb.className  = 'ct-tailor-rule-check';
        const origSel = rule.selected;
        cb.checked    = (rule.id in tailorRuleChanges) ? tailorRuleChanges[rule.id] : origSel;
        cb.addEventListener('change', () => {
            if (cb.checked === origSel) {
                delete tailorRuleChanges[rule.id];
            } else {
                tailorRuleChanges[rule.id] = cb.checked;
            }
            updateTailorSummary();
            applyTailorFilter();
        });

        const titleSpan     = document.createElement('span');
        titleSpan.className = 'ct-tailor-rule-title' + (rule.description ? ' ct-tailor-rule-title-expandable' : '');

        const sevSpan       = document.createElement('span');
        sevSpan.className   = 'ct-tailor-rule-sev ct-sev-' + (rule.severity || 'unknown');
        sevSpan.textContent = rule.severity || '';

        if (rule.description) {
            const arrow = document.createElement('span');
            arrow.className   = 'ct-tailor-rule-arrow';
            arrow.textContent = '▸';
            titleSpan.appendChild(arrow);

            const titleText       = document.createElement('span');
            titleText.textContent = rule.title || rule.id;
            titleSpan.appendChild(titleText);

            const descDiv = document.createElement('div');
            descDiv.className = 'ct-tailor-rule-desc hidden';
            descDiv.textContent = rule.description;

            titleSpan.addEventListener('click', e => {
                e.preventDefault();
                const open = descDiv.classList.toggle('hidden');
                arrow.classList.toggle('ct-tailor-rule-arrow-open', !open);
            });

            label.appendChild(cb);
            label.appendChild(titleSpan);
            label.appendChild(sevSpan);
            div.appendChild(label);
            div.appendChild(descDiv);
        } else {
            titleSpan.textContent = rule.title || rule.id;
            label.appendChild(cb);
            label.appendChild(titleSpan);
            label.appendChild(sevSpan);
            div.appendChild(label);
        }

        return div;
    }

    function buildGroup(group) {
        const details = document.createElement('details');
        details.className = 'ct-tailor-group';
        details.dataset.groupId = group.id;

        const summary     = document.createElement('summary');
        summary.className = 'ct-tailor-group-summary';

        const titleSpan       = document.createElement('span');
        titleSpan.className   = 'ct-tailor-group-title';
        titleSpan.textContent = group.title || group.id;

        const countSpan       = document.createElement('span');
        countSpan.className   = 'ct-tailor-group-count';
        const { total, modified } = countGroup(group);
        countSpan.textContent = total + ' rules' + (modified > 0 ? ' · ' + modified + ' modified' : '');
        if (modified > 0) countSpan.classList.add('ct-tailor-group-count-modified');
        countSpan.dataset.groupId = group.id;

        summary.appendChild(titleSpan);
        summary.appendChild(countSpan);
        details.appendChild(summary);

        (group.groups || []).forEach(sg => details.appendChild(buildGroup(sg)));
        (group.rules  || []).forEach(r  => details.appendChild(buildRule(r)));
        return details;
    }

    (data.groups || []).forEach(g => container.appendChild(buildGroup(g)));
    (data.rules  || []).forEach(r => container.appendChild(buildRule(r)));
}

function renderTailorValues(values) {
    const grid    = document.getElementById('ct-tailor-values-grid');
    const section = document.getElementById('ct-tailor-values-section');
    const divider = document.getElementById('ct-tailor-values-divider');
    grid.innerHTML = '';

    if (!values || values.length === 0) {
        section.classList.add('hidden');
        divider.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    divider.classList.remove('hidden');
    values.forEach(val => {
        const isModified  = val.id in tailorValueChanges;
        const row         = document.createElement('div');
        row.className     = 'ct-tailor-value-row' + (isModified ? ' ct-tailor-val-modified' : '');
        row.dataset.valId = val.id;

        const lbl         = document.createElement('label');
        lbl.className     = 'ct-tailor-value-label';
        lbl.htmlFor       = 'ct-val-' + val.id;

        const labelText       = document.createElement('span');
        labelText.textContent = val.title || val.id;
        lbl.appendChild(labelText);

        if (isModified) {
            const badge       = document.createElement('span');
            badge.className   = 'ct-tailor-val-modified-badge';
            badge.textContent = 'Modified';
            lbl.appendChild(badge);
        }

        let input;
        const baseValue   = val.current || val.default || '';
        const activeValue = (val.id in tailorValueChanges) ? tailorValueChanges[val.id] : baseValue;

        if (val.options && val.options.length > 0) {
            input = document.createElement('select');
            val.options.forEach(opt => {
                const o       = document.createElement('option');
                o.value       = opt.value;
                o.textContent = opt.selector === opt.value ? opt.value : opt.selector + ': ' + opt.value;
                o.selected    = (opt.value === activeValue);
                input.appendChild(o);
            });
            if (activeValue && !val.options.some(o => o.value === activeValue)) {
                const o       = document.createElement('option');
                o.value       = activeValue;
                o.textContent = 'Current: ' + activeValue;
                o.selected    = true;
                input.insertBefore(o, input.firstChild);
            }
        } else {
            input       = document.createElement('input');
            input.type  = 'text';
            input.value = activeValue;
        }

        input.id              = 'ct-val-' + val.id;
        input.className       = 'ct-tailor-value-input';
        input.dataset.valueId = val.id;
        input.addEventListener('change', () => {
            if (input.value === baseValue) {
                delete tailorValueChanges[val.id];
            } else {
                tailorValueChanges[val.id] = input.value;
            }
            updateTailorSummary();
        });

        row.appendChild(lbl);
        row.appendChild(input);
        grid.appendChild(row);
    });
}

function applyTailorFilter() {
    const container = document.getElementById('ct-tailor-tree');
    if (!container) return;

    container.querySelectorAll('.ct-tailor-rule').forEach(ruleDiv => {
        const ruleId  = ruleDiv.dataset.ruleId;
        const ruleSev = ruleDiv.dataset.sev || 'unknown';
        const cb      = ruleDiv.querySelector('input[type="checkbox"]');
        const isDisabled = cb && !cb.checked;
        const isModified = ruleId in tailorRuleChanges;

        let show = true;
        if (tailorFilterSev !== 'all' && ruleSev !== tailorFilterSev) show = false;
        if (tailorFilterStatus === 'disabled' && !isDisabled) show = false;
        if (tailorFilterStatus === 'modified' && !isModified) show = false;
        ruleDiv.classList.toggle('ct-filter-hidden', !show);
    });

    container.querySelectorAll('.ct-tailor-group').forEach(group => {
        const hasVisible = Array.from(group.querySelectorAll('.ct-tailor-rule'))
            .some(r => !r.classList.contains('ct-filter-hidden'));
        group.classList.toggle('ct-filter-hidden', !hasVisible);
    });
}

function flattenTailorRules() {
    const out = [];
    if (!tailorData) return out;
    function walk(items) {
        (items || []).forEach(item => {
            if (item.groups || item.rules) {
                walk(item.groups || []);
                walk(item.rules  || []);
            } else {
                out.push(item);
            }
        });
    }
    walk(tailorData.groups || []);
    walk(tailorData.rules  || []);
    return out;
}

function updateTailorSummary() {
    if (!tailorData) return;

    const ruleCount  = Object.keys(tailorRuleChanges).length;
    const valueCount = Object.keys(tailorValueChanges).length;
    const total      = ruleCount + valueCount;

    const countEl   = document.getElementById('ct-tailor-change-count');
    const hintEl    = document.getElementById('ct-tailor-summary-hint');
    const contentEl = document.getElementById('ct-tailor-summary-content');
    const exportBtn = document.getElementById('ct-tailor-export-btn');
    const rulesSec  = document.getElementById('ct-tailor-summary-rules-section');
    const valuesSec = document.getElementById('ct-tailor-summary-values-section');
    const rulesEl   = document.getElementById('ct-tailor-summary-rules-list');
    const valuesEl  = document.getElementById('ct-tailor-summary-values-list');

    if (total === 0) {
        countEl.textContent = '';
        countEl.className   = 'ct-tailor-change-count';
        hintEl.textContent  = 'No changes from the base profile yet.';
        hintEl.classList.remove('hidden');
        contentEl.classList.add('hidden');
        exportBtn.classList.add('hidden');
        return;
    }

    const parts = [];
    if (ruleCount)  parts.push(ruleCount  + ' rule'     + (ruleCount  === 1 ? '' : 's'));
    if (valueCount) parts.push(valueCount + ' variable' + (valueCount === 1 ? '' : 's'));
    countEl.textContent = parts.join(' · ') + ' changed';
    countEl.className   = 'ct-tailor-change-count ct-tailor-change-count-active';
    hintEl.textContent  = parts.join(', ') + ' deviate from the base profile.';
    contentEl.classList.remove('hidden');
    exportBtn.classList.remove('hidden');

    const ruleMap = {};
    flattenTailorRules().forEach(r => { ruleMap[r.id] = r; });

    if (ruleCount > 0) {
        rulesSec.classList.remove('hidden');
        rulesEl.innerHTML = Object.entries(tailorRuleChanges)
            .sort((a, b) => {
                const sevOrder = { high: 0, medium: 1, low: 2, unknown: 3 };
                const ra = ruleMap[a[0]] || {}; const rb = ruleMap[b[0]] || {};
                return (sevOrder[ra.severity] || 3) - (sevOrder[rb.severity] || 3);
            })
            .map(([id, enabled]) => {
                const rule   = ruleMap[id] || { title: id, severity: 'unknown' };
                const sev    = rule.severity || 'unknown';
                const action = enabled ? 'Enabled' : 'Disabled';
                const cls    = enabled ? 'ct-tailor-sum-enabled' : 'ct-tailor-sum-disabled';
                const sevBadge = sev !== 'unknown'
                    ? '<span class="ct-tailor-rule-sev ct-sev-' + sev + '">' + sev + '</span>'
                    : '';
                return '<div class="ct-tailor-sum-row">' +
                    '<span class="ct-tailor-sum-action ' + cls + '">' + action + '</span>' +
                    sevBadge +
                    '<span class="ct-tailor-sum-title">' + (rule.title || id) + '</span>' +
                    '</div>';
            }).join('');
    } else {
        rulesSec.classList.add('hidden');
    }

    const valMap = {};
    (tailorData.values || []).forEach(v => { valMap[v.id] = v; });

    if (valueCount > 0) {
        valuesSec.classList.remove('hidden');
        valuesEl.innerHTML = Object.entries(tailorValueChanges).map(([id, newVal]) => {
            const val  = valMap[id] || { title: id, current: '?', default: '?' };
            const from = val.current || val.default || '?';
            return '<div class="ct-tailor-sum-row">' +
                '<span class="ct-tailor-sum-val-title">' + (val.title || id) + '</span>' +
                '<span class="ct-tailor-sum-val-change">' +
                '<span class="ct-tailor-sum-val-from">' + from + '</span>' +
                ' &rarr; ' +
                '<span class="ct-tailor-sum-val-to">' + newVal + '</span>' +
                '</span>' +
                '</div>';
        }).join('');
    } else {
        valuesSec.classList.add('hidden');
    }

    /* Update group count badges to reflect current tailorRuleChanges */
    document.querySelectorAll('#ct-tailor-tree .ct-tailor-group-count').forEach(badge => {
        const group = badge.closest('.ct-tailor-group');
        if (!group) return;
        const allRules  = Array.from(group.querySelectorAll('.ct-tailor-rule'));
        const total     = allRules.length;
        const modified  = allRules.filter(r => r.dataset.ruleId in tailorRuleChanges).length;
        badge.textContent = total + ' rules' + (modified > 0 ? ' · ' + modified + ' modified' : '');
        badge.classList.toggle('ct-tailor-group-count-modified', modified > 0);
    });
}

function exportTailorSummary() {
    if (!tailorData) return;
    const name = document.getElementById('ct-tailor-editor-name').value.trim() || 'Tailoring';
    const base = tailorData.profile.title || tailorData.profile.id || 'Base Profile';
    const lines = [
        'Policy Deviations: ' + name,
        'Base Profile: ' + base,
        'Generated: ' + new Date().toISOString().replace('T', ' ').slice(0, 19),
        '',
    ];
    const ruleMap = {};
    flattenTailorRules().forEach(r => { ruleMap[r.id] = r; });
    const ruleEntries = Object.entries(tailorRuleChanges);
    if (ruleEntries.length) {
        lines.push('Rules changed (' + ruleEntries.length + '):');
        ruleEntries.forEach(([id, enabled]) => {
            const rule = ruleMap[id] || { title: id, severity: '?' };
            const sev  = (rule.severity || '?').toUpperCase();
            lines.push('  ' + (enabled ? '+ ENABLED ' : '- DISABLED') + ' [' + sev + '] ' + (rule.title || id));
        });
        lines.push('');
    }
    const valMap = {};
    (tailorData.values || []).forEach(v => { valMap[v.id] = v; });
    const valEntries = Object.entries(tailorValueChanges);
    if (valEntries.length) {
        lines.push('Variables changed (' + valEntries.length + '):');
        valEntries.forEach(([id, newVal]) => {
            const val  = valMap[id] || { title: id, current: '?', default: '?' };
            const from = val.current || val.default || '?';
            lines.push('  ' + (val.title || id) + ': ' + from + ' → ' + newVal);
        });
    }
    const btn = document.getElementById('ct-tailor-export-btn');
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✓ Copied';
        setTimeout(() => { btn.textContent = orig; }, 2000);
    }).catch(() => {});
}

function doUpdateTailoringFile() {
    if (!tailorData || !tailorEditingSidecar) return;

    const sidecar          = tailorEditingSidecar;
    const newProfileTitle  = document.getElementById('ct-tailor-editor-name').value.trim() || sidecar.name;
    const baseProfileId    = sidecar.base_profile_id;

    if (!normalizePath(sidecar.path).startsWith(TAILORING_BASE)) {
        console.error('doUpdateTailoringFile: sidecar.path outside TAILORING_BASE', sidecar.path);
        return;
    }

    const xml = generateTailoringXml(
        baseProfileId, sidecar.profile_id, newProfileTitle,
        tailorRuleChanges, tailorValueChanges
    );

    const thresholdVal = Math.max(0, Math.min(100,
        parseInt(document.getElementById('ct-tailor-threshold').value, 10) || 90));
    const updatedSidecar = Object.assign({}, sidecar, {
        name:                 newProfileTitle,
        modified:             makeTimestamp(),
        rules_modified:       Object.keys(tailorRuleChanges).length,
        compliance_threshold: thresholdVal,
    });

    const jsonPath  = sidecar.path.replace(/\.xml$/, '.json');
    const saveBtn   = document.getElementById('ct-tailor-update-btn');
    const statusEl  = document.getElementById('ct-tailor-save-status');
    saveBtn.disabled     = true;
    statusEl.textContent = 'Saving…';
    statusEl.className   = 'ct-tailor-save-status';
    statusEl.classList.remove('hidden');

    Promise.all([
        cockpit.file(sidecar.path, { superuser: 'require' }).replace(xml),
        cockpit.file(jsonPath,     { superuser: 'require' }).replace(JSON.stringify(updatedSidecar, null, 2)),
    ])
    .then(() => cockpit.spawn(['chmod', '644', sidecar.path, jsonPath], { superuser: 'require' }))
    .then(() => {
        appendActivityLog({ type: 'tailor_save', tab: 'tailoring',
            file: sidecar.path.split('/').pop(), profile: newProfileTitle });
        saveBtn.disabled = false;
        detectTailoringFiles();
        if (typeof csDetectTailoringFiles === 'function') csDetectTailoringFiles();
        resetTailorForm();
    })
    .catch(err => {
        statusEl.textContent = 'Update failed: ' + (err.message || String(err));
        statusEl.className   = 'ct-tailor-save-status ct-tailor-save-status-err';
        statusEl.classList.remove('hidden');
        saveBtn.disabled = false;
    });
}

function onTailorSaveClick() {
    if (!tailorData) return;

    const profileSelect   = document.getElementById('ct-tailor-profile-select');
    const baseProfileId   = profileSelect.value;
    const newProfileTitle = document.getElementById('ct-tailor-editor-name').value.trim();

    if (!baseProfileId || !newProfileTitle) return;

    const safeName     = newProfileTitle.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const newProfileId = 'xccdf_cockpit-scap_profile_' + safeName;
    const ts           = makeTimestamp();
    const filename     = safeName + '-' + ts;
    const xmlPath      = TAILORING_BASE + filename + '.xml';
    const jsonPath     = TAILORING_BASE + filename + '.json';

    const xml = generateTailoringXml(
        baseProfileId, newProfileId, newProfileTitle,
        tailorRuleChanges, tailorValueChanges
    );
    const thresholdVal = Math.max(0, Math.min(100,
        parseInt(document.getElementById('ct-tailor-threshold').value, 10) || 90));
    const sidecar = {
        name:                 newProfileTitle,
        base_profile_id:      baseProfileId,
        base_profile_title:   tailorData.profile.title,
        profile_id:           newProfileId,
        sds_path:             tailorSdsPath,
        path:                 xmlPath,
        created:              ts,
        rules_modified:       Object.keys(tailorRuleChanges).length,
        compliance_threshold: thresholdVal,
    };

    const saveBtn  = document.getElementById('ct-tailor-save-btn');
    const statusEl = document.getElementById('ct-tailor-save-status');
    saveBtn.disabled     = true;
    statusEl.textContent = 'Saving…';
    statusEl.className   = 'ct-tailor-save-status';
    statusEl.classList.remove('hidden');

    cockpit.spawn(['mkdir', '-p', TAILORING_BASE], { superuser: 'require' })
        .then(() => Promise.all([
            cockpit.file(xmlPath,  { superuser: 'require' }).replace(xml),
            cockpit.file(jsonPath, { superuser: 'require' }).replace(JSON.stringify(sidecar, null, 2)),
        ]))
        .then(() => cockpit.spawn(['chmod', '644', xmlPath, jsonPath], { superuser: 'require' }))
        .then(() => cockpit.file(xmlPath).read())
        .then(written => {
            if (written !== xml) throw new Error(
                'File not written — on hardened systems, add ' +
                'Defaults!/usr/bin/cockpit-bridge !use_pty to /etc/sudoers.d/cockpit-bridge'
            );
            appendActivityLog({ type: 'tailor_save', tab: 'tailoring', file: filename + '.xml', profile: newProfileTitle });
            saveBtn.disabled = false;
            detectTailoringFiles();
            if (typeof csDetectTailoringFiles === 'function') csDetectTailoringFiles();
            resetTailorForm();
        })
        .catch(err => {
            statusEl.textContent = 'Save failed: ' + (err.message || String(err));
            statusEl.className   = 'ct-tailor-save-status ct-tailor-save-status-err';
            saveBtn.disabled     = false;
        });
}

function generateTailoringXml(baseProfileId, newProfileId, newProfileTitle, ruleChanges, valueChanges) {
    const esc = s => String(s)
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
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

/* ---- Saved tailoring files list ---------------------------- */

function renderTailoringList(sidecars) {
    const tbody = document.getElementById('ct-tailor-list-tbody');
    const table = document.getElementById('ct-tailor-list-table');
    const empty = document.getElementById('ct-tailor-list-empty');
    tbody.innerHTML = '';

    if (!sidecars || sidecars.length === 0) {
        table.classList.add('hidden');
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    table.classList.remove('hidden');
    const sorted = sidecars.slice().sort((a, b) =>
        (b.created || '').localeCompare(a.created || ''));

    sorted.forEach(sc => {
        const tr = document.createElement('tr');

        const created = sc.created
            ? sc.created.slice(0, 10) + ' ' + sc.created.slice(11).replace(/-/g, ':')
            : '';

        const sdsVer = sc.sds_path && sc.sds_path.match(/ssg-rhel(\d+)-ds\.xml/);
        const contentName = sdsVer
            ? 'RHEL ' + sdsVer[1]
            : (sc.sds_path ? sdsDisplayName(sc.sds_path.split('/').pop()) : '—');
        const rulesText     = sc.rules_modified != null ? String(sc.rules_modified) : '—';
        const thresholdText = sc.compliance_threshold != null
            ? sc.compliance_threshold + '%'
            : '90%';

        [
            [created,                               'ct-history-date-cell'],
            [sc.name,                               'ct-tailor-name-cell'],
            [contentName,                           'ct-tailor-content-cell'],
            [sc.base_profile_title || sc.base_profile_id, 'ct-tailor-profile-cell'],
            [rulesText,                             'ct-tailor-rules-cell'],
            [thresholdText,                         'ct-tailor-rules-cell'],
        ].forEach(([text, cls]) => {
            const td = document.createElement('td');
            td.textContent = text || '—';
            if (cls) td.className = cls;
            tr.appendChild(td);
        });

        const actionsTd = document.createElement('td');
        actionsTd.className = 'ct-history-actions';

        const editBtn       = document.createElement('button');
        editBtn.className   = 'pf-v6-c-button pf-m-link';
        editBtn.type        = 'button';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => onEditTailoringFile(sc));

        const dlBtn       = document.createElement('button');
        dlBtn.className   = 'pf-v6-c-button pf-m-link';
        dlBtn.type        = 'button';
        dlBtn.textContent = 'Download';
        dlBtn.addEventListener('click', () => {
            const fname = sc.path.split('/').pop();
            downloadArtifact(sc.path, fname, 'application/xml');
            appendActivityLog({ type: 'tailor_download', tab: 'tailoring', file: fname, profile: sc.name });
        });

        const delBtn       = document.createElement('button');
        delBtn.className   = 'pf-v6-c-button pf-m-link ct-btn-danger-link ct-requires-admin';
        delBtn.type        = 'button';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', () => onDeleteTailoringFile(sc));

        actionsTd.appendChild(editBtn);
        actionsTd.appendChild(dlBtn);
        actionsTd.appendChild(delBtn);
        tr.appendChild(actionsTd);
        tbody.appendChild(tr);
    });
    updateAdminControls();
}

function onEditTailoringFile(sidecar) {
    const hasUnsaved = Object.keys(tailorRuleChanges).length > 0 ||
                       Object.keys(tailorValueChanges).length > 0;

    if (hasUnsaved) {
        showConfirmModal(
            'Discard unsaved changes?',
            'Loading a new profile will discard your current changes. This cannot be undone.',
            () => doEditTailoringFile(sidecar),
            'Discard Changes'
        );
    } else {
        doEditTailoringFile(sidecar);
    }
}

function doEditTailoringFile(sidecar) {
    appendActivityLog({ type: 'tailor_load', tab: 'tailoring', file: sidecar.path.split('/').pop(), profile: sidecar.name });
    tailorSdsPath        = sidecar.sds_path;
    tailorRuleChanges    = {};
    tailorValueChanges   = {};
    tailorEditingSidecar = sidecar;

    document.getElementById('ct-tailor-update-btn').classList.remove('hidden');
    const saveBtn = document.getElementById('ct-tailor-save-btn');
    saveBtn.textContent = 'Save as New';
    saveBtn.classList.remove('pf-m-primary');
    saveBtn.classList.add('pf-m-secondary');

    /* Pre-populate the setup form fields */
    document.getElementById('ct-tailor-content-select').value = sidecar.sds_path;
    document.getElementById('ct-tailor-name-input').value     = sidecar.name;
    document.getElementById('ct-tailor-name-input').disabled  = false;
    document.getElementById('ct-tailor-load-btn').disabled    = false;

    document.getElementById('ct-tailor-editor').classList.add('hidden');
    document.getElementById('ct-tailor-error-alert').classList.add('hidden');
    document.getElementById('ct-tailor-loading').classList.remove('hidden');

    /* Parse saved tailoring XML to restore prior changes, then load base profile */
    cockpit.file(sidecar.path).read()
        .then(xmlContent => {
            const changes  = parseTailoringXml(xmlContent);
            tailorRuleChanges  = changes.ruleChanges;
            tailorValueChanges = changes.valueChanges;
        })
        .then(() => loadProfiles(sidecar.sds_path, 'ct-tailor-profile-select'))
        .then(() => {
            const profileSelect = document.getElementById('ct-tailor-profile-select');
            profileSelect.value = sidecar.base_profile_id;
            const profileTitle  = profileSelect.options[profileSelect.selectedIndex]?.text
                                  || sidecar.base_profile_id;
            cockpit.spawn(['oscap', 'info', '--profile', sidecar.base_profile_id, sidecar.sds_path],
                          { err: 'out' })
                .then(out => {
                    const desc = parseProfileDescription(out);
                    if (desc) showTailorProfileDesc(profileTitle, desc);
                })
                .catch(() => {});
        })
        .then(() => cockpit.spawn(
            ['python3', '-c', PY_EXTRACT_PROFILE, sidecar.base_profile_id, sidecar.sds_path],
            { err: 'out' }
        ))
        .then(output => {
            tailorData = JSON.parse(output);
            document.getElementById('ct-tailor-loading').classList.add('hidden');
            renderTailorEditor(tailorData);
            /* Scroll editor into view */
            document.getElementById('ct-tailor-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
        })
        .catch(err => {
            document.getElementById('ct-tailor-loading').classList.add('hidden');
            document.getElementById('ct-tailor-error-message').textContent =
                err.message || String(err);
            document.getElementById('ct-tailor-error-alert').classList.remove('hidden');
        });
}

function parseTailoringXml(xmlContent) {
    const NS  = 'http://checklists.nist.gov/xccdf/1.2';
    const doc = new DOMParser().parseFromString(xmlContent, 'application/xml');
    const ruleChanges  = {};
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

function onDeleteTailoringFile(sidecar) {
    showConfirmModal(
        'Delete Policy',
        'Delete "' + sidecar.name + '"? This cannot be undone.',
        () => {
            if (!normalizePath(sidecar.path).startsWith(TAILORING_BASE)) {
                console.error('onDeleteTailoringFile: sidecar.path outside TAILORING_BASE', sidecar.path);
                return;
            }
            const jsonPath = sidecar.path.replace(/\.xml$/, '.json');
            Promise.all([
                cockpit.spawn(['rm', '-f', sidecar.path], { superuser: 'require' }),
                cockpit.spawn(['rm', '-f', jsonPath],     { superuser: 'require' }),
            ])
            .then(() => {
                appendActivityLog({ type: 'tailor_delete', tab: 'tailoring', file: sidecar.path.split('/').pop(), profile: sidecar.name });
                detectTailoringFiles();
                if (typeof csDetectTailoringFiles === 'function') csDetectTailoringFiles();
            })
            .catch(err => console.error('Failed to delete tailoring file:', err.message || err));
        }
    );
}

/* ---- Rule tree controls ------------------------------------ */

function expandAllGroups() {
    document.querySelectorAll('#ct-tailor-tree details.ct-tailor-group')
        .forEach(d => { d.open = true; });
}

function collapseAllGroups() {
    document.querySelectorAll('#ct-tailor-tree details.ct-tailor-group')
        .forEach(d => { d.open = false; });
}

function onTailorSearch() {
    const term = document.getElementById('ct-tailor-search').value.trim().toLowerCase();
    const tree = document.getElementById('ct-tailor-tree');

    /* Reset visibility */
    tree.querySelectorAll('.ct-tailor-rule').forEach(r => r.classList.remove('hidden'));
    tree.querySelectorAll('details.ct-tailor-group').forEach(g => g.classList.remove('hidden'));

    if (!term) {
        collapseAllGroups();
        return;
    }

    /* Hide non-matching rules */
    tree.querySelectorAll('.ct-tailor-rule').forEach(r => {
        const titleEl = r.querySelector('.ct-tailor-rule-title');
        const matches = titleEl && titleEl.textContent.toLowerCase().includes(term);
        r.classList.toggle('hidden', !matches);
    });

    /* Hide groups with no visible rule descendants; open those that have some */
    tree.querySelectorAll('details.ct-tailor-group').forEach(g => {
        const hasVisible = !!g.querySelector('.ct-tailor-rule:not(.hidden)');
        g.classList.toggle('hidden', !hasVisible);
        if (hasVisible) g.open = true;
    });
}

/* ---- Tailoring file upload --------------------------------- */

function handleTailoringUpload(file) {
    const reader = new FileReader();
    reader.onload = e => {
        const xmlContent = e.target.result;
        const NS  = 'http://checklists.nist.gov/xccdf/1.2';
        const doc = new DOMParser().parseFromString(xmlContent, 'application/xml');

        if (doc.getElementsByTagName('parsererror').length) {
            alert('The uploaded file is not valid XML and cannot be imported.');
            return;
        }
        const profileEl = doc.getElementsByTagNameNS(NS, 'Profile')[0];
        if (!profileEl) {
            alert('The uploaded file does not appear to be a valid XCCDF tailoring file (no Profile element found).');
            return;
        }

        const profileId  = profileEl.getAttribute('id') || '';
        const extendsId  = profileEl.getAttribute('extends') || '';
        const titleEl    = profileEl.getElementsByTagNameNS(NS, 'title')[0];
        const name       = titleEl ? titleEl.textContent.trim() : (profileId || file.name);

        const sdsPath = document.getElementById('ct-tailor-content-select').value || '';

        /* Try to resolve base profile title from currently loaded profile select */
        let baseProfileTitle = extendsId;
        Array.from(document.getElementById('ct-tailor-profile-select').options).forEach(opt => {
            if (opt.value === extendsId) baseProfileTitle = opt.text;
        });

        const ts       = makeTimestamp();
        const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const filename = safeName + '-' + ts;
        const xmlPath  = TAILORING_BASE + filename + '.xml';
        const jsonPath = TAILORING_BASE + filename + '.json';

        const sidecar = {
            name:               name,
            base_profile_id:    extendsId,
            base_profile_title: baseProfileTitle,
            profile_id:         profileId,
            sds_path:           sdsPath,
            path:               xmlPath,
            created:            ts,
        };

        cockpit.spawn(['mkdir', '-p', TAILORING_BASE], { superuser: 'require' })
            .then(() => Promise.all([
                cockpit.file(xmlPath,  { superuser: 'require' }).replace(xmlContent),
                cockpit.file(jsonPath, { superuser: 'require' }).replace(JSON.stringify(sidecar, null, 2)),
            ]))
            .then(() => cockpit.spawn(['chmod', '644', xmlPath, jsonPath], { superuser: 'require' }))
            .then(() => {
                appendActivityLog({ type: 'tailor_upload', tab: 'tailoring', file: filename + '.xml', profile: name });
                detectTailoringFiles();
                if (typeof csDetectTailoringFiles === 'function') csDetectTailoringFiles();
            })
            .catch(err => console.error('Upload failed:', err.message || err));
    };
    reader.readAsText(file);
}

/* ---- Admin gate -------------------------------------------- */

function updateAdminControls() {
    /* Default to allowed when permission API unavailable — { superuser: 'require' }
     * on the operations themselves is the real enforcement boundary. */
    const allowed = !adminPermission || adminPermission.allowed !== false;
    document.querySelectorAll('.ct-requires-admin').forEach(btn => {
        btn.disabled = !allowed;
        if (!allowed) {
            btn.title = 'Administrative access required';
        } else {
            btn.removeAttribute('title');
        }
    });
    document.getElementById('ct-settings-admin-alert')
        .classList.toggle('hidden', allowed);

    /* Re-evaluate scan buttons so admin state is reflected immediately */
    const scanBtn = document.getElementById('ct-scan-btn');
    if (scanBtn && !scanBtn.disabled) setScanButtonEnabled(true);
    if (typeof csUpdateScanBtn === 'function') csUpdateScanBtn();
}

/* ---- Content tab ------------------------------------------- */

function renderContentTab() {
    renderSystemContentList();
    renderUserContentList();
}

function renderSystemContentList() {
    const container = document.getElementById('ct-system-content-list');
    cockpit.spawn(['ls', SSG_CONTENT_DIR], { err: 'message' })
        .then(output => {
            const files = output.trim().split('\n').filter(f => f.endsWith('-ds.xml'));
            if (files.length === 0) {
                container.innerHTML = '<p class="ct-content-empty">No system SCAP content found. Install <code>scap-security-guide</code>.</p>';
                return;
            }
            const table = document.createElement('table');
            table.className = 'pf-v6-c-table pf-m-compact';
            table.setAttribute('role', 'grid');
            table.setAttribute('aria-label', 'System SCAP content');
            const thead = table.createTHead();
            const hr = thead.insertRow();
            hr.setAttribute('role', 'row');
            ['Name', 'File', 'Size', 'Version', 'Actions'].forEach(h => {
                const th = document.createElement('th');
                th.setAttribute('role', 'columnheader');
                th.scope = 'col';
                th.textContent = h;
                hr.appendChild(th);
            });
            const tbody = table.createTBody();
            const entries = files.map(f => ({ f, name: sdsDisplayName(f), path: SSG_CONTENT_DIR + f }));
            container.innerHTML = '';
            container.appendChild(table);
            entries.forEach(e => {
                const tr  = tbody.insertRow();
                tr.insertCell().textContent = e.name;
                const tdF = tr.insertCell();
                const code = document.createElement('code');
                code.textContent = e.f;
                tdF.appendChild(code);
                const tdS = tr.insertCell();
                const tdV = tr.insertCell();
                tdS.textContent = '…';
                tdV.textContent = '…';
                cockpit.spawn(['python3', '-c', PY_SDS_VERSION, e.path], { err: 'ignore' })
                    .then(out => {
                        const parts = out.trim().split(' ');
                        tdS.textContent = parts[0] ? (parseInt(parts[0], 10) / 1024 / 1024).toFixed(1) + ' MB' : '—';
                        tdV.textContent = parts[1] || '?';
                    })
                    .catch(() => { tdS.textContent = '—'; tdV.textContent = '?'; });
                const tdA    = tr.insertCell();
                const valBtn = document.createElement('button');
                valBtn.className   = 'pf-v6-c-button pf-m-link';
                valBtn.type        = 'button';
                valBtn.textContent = 'Validate';
                valBtn.addEventListener('click', () => validateContent(
                    { xmlPath: e.path, filename: e.f, name: e.name }, valBtn));
                tdA.appendChild(valBtn);
            });
        })
        .catch(() => {
            container.innerHTML = '<p class="ct-content-empty">System content directory not found.</p>';
        });
}

function renderUserContentList() {
    const container = document.getElementById('ct-user-content-list');

    function buildTable() {
        const table = document.createElement('table');
        table.className = 'pf-v6-c-table pf-m-compact';
        table.setAttribute('role', 'grid');
        table.setAttribute('aria-label', 'Uploaded SCAP content');
        const thead = table.createTHead();
        const hr = thead.insertRow();
        hr.setAttribute('role', 'row');
        ['Name', 'File', 'Size', 'Version', 'Actions'].forEach(h => {
            const th = document.createElement('th');
            th.setAttribute('role', 'columnheader');
            th.scope = 'col';
            th.textContent = h;
            hr.appendChild(th);
        });
        return table;
    }

    cockpit.spawn(['ls', CONTENT_BASE], { err: 'message' })
        .then(output => {
            const files = output.trim().split('\n').filter(f => f.endsWith('.xml'));
            if (files.length === 0) {
                const table = buildTable();
                const tbody = table.createTBody();
                const tr = tbody.insertRow();
                const td = tr.insertCell();
                td.colSpan = 5;
                td.className = 'ct-content-empty';
                td.textContent = 'No SDS files found. Stage files using the instructions above, then click Refresh.';
                container.innerHTML = '';
                container.appendChild(table);
                return;
            }
            const entries = files.map(f => ({
                filename: f,
                name:     sdsDisplayName(f),
                xmlPath:  CONTENT_BASE + f,
                jsonPath: CONTENT_BASE + f.replace(/\.xml$/, '.json'),
            }));

            return Promise.all(
                entries.map(e =>
                    cockpit.spawn(['python3', '-c', PY_SDS_VERSION, e.xmlPath], { err: 'ignore' })
                        .then(out => {
                            const parts = out.trim().split(' ');
                            e.sizeMB  = (parseInt(parts[0], 10) / 1024 / 1024).toFixed(1) + ' MB';
                            e.version = parts[1] || '?';
                        })
                        .catch(() => { e.sizeMB = '—'; e.version = '?'; })
                )
            ).then(() => {
                const table = buildTable();
                const tbody = table.createTBody();
                entries.forEach(e => {
                    const tr  = tbody.insertRow();
                    tr.insertCell().textContent = e.name;
                    const tdF = tr.insertCell();
                    const code = document.createElement('code');
                    code.textContent = e.filename;
                    tdF.appendChild(code);
                    tr.insertCell().textContent = e.sizeMB;
                    tr.insertCell().textContent = e.version;

                    const tdA    = tr.insertCell();
                    const valBtn = document.createElement('button');
                    valBtn.className   = 'pf-v6-c-button pf-m-link';
                    valBtn.type        = 'button';
                    valBtn.textContent = 'Validate';
                    valBtn.addEventListener('click', () => validateContent(e, valBtn));
                    tdA.appendChild(valBtn);

                    const btn    = document.createElement('button');
                    btn.className = 'pf-v6-c-button pf-m-link ct-danger-link ct-requires-admin';
                    btn.type      = 'button';
                    btn.textContent = 'Delete';
                    btn.addEventListener('click', () => {
                        showConfirmModal(
                            'Delete content file',
                            'Delete "' + e.name + '"? This cannot be undone.',
                            () => deleteUserContent(e.xmlPath, e.jsonPath)
                        );
                    });
                    tdA.appendChild(btn);
                });
                container.innerHTML = '';
                container.appendChild(table);
                updateAdminControls();
            });
        })
        .catch(() => {
            container.innerHTML = '<p class="ct-content-empty">Could not read content directory.</p>';
        });
}

function deleteUserContent(xmlPath, jsonPath) {
    const fileName = xmlPath.split('/').pop();
    cockpit.spawn(['rm', '-f', xmlPath, jsonPath], { superuser: 'require', err: 'message' })
        .then(() => {
            appendActivityLog({ type: 'content_delete', tab: 'content', file: fileName });
            renderUserContentList();
            detectContent();
            if (typeof csDetectContent === 'function') csDetectContent();
        })
        .catch(err => console.error('Failed to delete content file:', err.message || err));
}

function uploadContent(file) {
    const status   = document.getElementById('ct-content-upload-status');
    const btn      = document.getElementById('ct-content-upload-btn');
    if (file.name.includes('/') || file.name.includes('..')) {
        status.className   = 'ct-content-upload-status ct-content-upload-err';
        status.textContent = 'Invalid filename.';
        status.classList.remove('hidden');
        return;
    }
    const destPath = CONTENT_BASE + file.name;
    const sizeMB   = (file.size / 1024 / 1024).toFixed(1);

    btn.disabled       = true;
    btn.textContent    = 'Checking…';
    status.className   = 'ct-content-upload-status';
    status.textContent = 'Checking ' + file.name + '…';
    status.classList.remove('hidden');

    cockpit.spawn(['stat', '--format=%s %Y', destPath], { err: 'ignore' })
        .then(out => {
            const parts  = out.trim().split(' ');
            const exMB   = (parseInt(parts[0], 10) / 1024 / 1024).toFixed(1);
            const exDate = new Date(parseInt(parts[1], 10) * 1000).toLocaleDateString();

            btn.disabled    = false;
            btn.textContent = 'Upload SDS File';
            status.classList.add('hidden');

            showConfirmModal(
                'Replace existing file?',
                file.name + ' already exists (' + exMB + ' MB, ' + exDate + '). Replace with new file (' + sizeMB + ' MB)?',
                () => doWriteContent(file, destPath, sizeMB),
                'Replace'
            );
        })
        .catch(() => doWriteContent(file, destPath, sizeMB));
}

function doWriteContent(file, destPath, sizeMB) {
    const status = document.getElementById('ct-content-upload-status');
    const btn    = document.getElementById('ct-content-upload-btn');

    btn.disabled       = true;
    btn.textContent    = 'Uploading…';
    status.className   = 'ct-content-upload-status';
    status.textContent = 'Uploading ' + file.name + ' (' + sizeMB + ' MB)…';
    status.classList.remove('hidden');

    const reader = new FileReader();
    reader.onload = ev => {
        cockpit.file(destPath, { superuser: 'require' }).replace(ev.target.result)
            .then(() => {
                status.className   = 'ct-content-upload-status ct-content-upload-ok';
                status.textContent = file.name + ' (' + sizeMB + ' MB) uploaded successfully.';
                appendActivityLog({ type: 'content_upload', tab: 'content', file: file.name });
                renderUserContentList();
                detectContent();
                if (typeof csDetectContent === 'function') csDetectContent();
            })
            .catch(err => {
                status.className   = 'ct-content-upload-status ct-content-upload-err';
                status.textContent = 'Upload failed: ' + (err.message || String(err));
            })
            .finally(() => {
                btn.disabled    = false;
                btn.textContent = 'Upload SDS File';
            });
    };
    reader.onerror = () => {
        status.className   = 'ct-content-upload-status ct-content-upload-err';
        status.textContent = 'Failed to read file from disk.';
        btn.disabled    = false;
        btn.textContent = 'Upload SDS File';
    };
    reader.readAsText(file);
}

/* ---- CSV export -------------------------------------------- */

/* ---- Activity log ------------------------------------------ */

/* ---- Settings tab ------------------------------------------ */

function loadSettings() {
    return cockpit.file(SETTINGS_PATH).read()
        .then(content => {
            if (!content) return;
            const s = JSON.parse(content);
            if (typeof s.host_retention === 'number' && s.host_retention >= RETENTION_MIN)
                hostRetention = Math.min(s.host_retention, RETENTION_MAX);
            if (typeof s.container_retention === 'number' && s.container_retention >= RETENTION_MIN)
                containerRetention = Math.min(s.container_retention, RETENTION_MAX);
            if (typeof s.container_scan_enabled === 'boolean')
                containerScanEnabled = s.container_scan_enabled;
            if (typeof s.dashboard_enabled === 'boolean')
                dashboardEnabled = s.dashboard_enabled;
            if (typeof s.tailoring_enabled === 'boolean')
                tailoringEnabled = s.tailoring_enabled;
        })
        .catch(() => {})
        .then(() => applyTabVisibility());
}

function applyTabVisibility() {
    document.getElementById('tab-btn-container-scan').closest('li')
        .classList.toggle('hidden', !containerScanEnabled);
    document.getElementById('tab-btn-dashboard').closest('li')
        .classList.toggle('hidden', !dashboardEnabled);
    document.getElementById('tab-btn-tailoring').closest('li')
        .classList.toggle('hidden', !tailoringEnabled);

    const cActive = document.getElementById('tab-btn-container-scan').getAttribute('aria-selected') === 'true';
    const dActive = document.getElementById('tab-btn-dashboard').getAttribute('aria-selected') === 'true';
    const tActive = document.getElementById('tab-btn-tailoring').getAttribute('aria-selected') === 'true';
    if ((!containerScanEnabled && cActive) || (!dashboardEnabled && dActive) || (!tailoringEnabled && tActive))
        document.getElementById('tab-btn-scan').click();
}

function initSettings() {
    document.getElementById('tab-btn-settings')
        .addEventListener('click', onSettingsTabOpen);
    document.getElementById('ct-settings-save-btn')
        .addEventListener('click', saveSettings);
    document.getElementById('ct-setting-host-retention')
        .addEventListener('input', onRetentionInput);
    document.getElementById('ct-setting-container-retention')
        .addEventListener('input', onRetentionInput);
    document.getElementById('ct-clear-scan-btn')
        .addEventListener('click', () =>
            document.getElementById('ct-clear-scan-modal').classList.remove('hidden'));
    document.getElementById('ct-clear-scan-ok')
        .addEventListener('click', () => {
            document.getElementById('ct-clear-scan-modal').classList.add('hidden');
            clearScanData();
        });
    document.getElementById('ct-clear-scan-cancel')
        .addEventListener('click', () =>
            document.getElementById('ct-clear-scan-modal').classList.add('hidden'));
    document.getElementById('ct-clear-policies-btn')
        .addEventListener('click', () =>
            document.getElementById('ct-clear-policies-modal').classList.remove('hidden'));
    document.getElementById('ct-clear-policies-ok')
        .addEventListener('click', () => {
            document.getElementById('ct-clear-policies-modal').classList.add('hidden');
            clearPolicies();
        });
    document.getElementById('ct-clear-policies-cancel')
        .addEventListener('click', () =>
            document.getElementById('ct-clear-policies-modal').classList.add('hidden'));
}

function onSettingsTabOpen() {
    document.getElementById('ct-setting-host-retention').value          = hostRetention;
    document.getElementById('ct-setting-container-retention').value     = containerRetention;
    document.getElementById('ct-setting-container-enabled').checked     = containerScanEnabled;
    document.getElementById('ct-setting-dashboard-enabled').checked     = dashboardEnabled;
    document.getElementById('ct-setting-tailoring-enabled').checked     = tailoringEnabled;
    document.getElementById('ct-settings-warn').classList.add('hidden');
    document.getElementById('ct-settings-saved').classList.add('hidden');
    document.getElementById('ct-settings-save-error').classList.add('hidden');
    fetchDiskUsage();
    renderContentTab();
    detectContent();
}


function fetchDiskUsage() {
    const usedEl = document.getElementById('ct-settings-disk-usage');
    const freeEl = document.getElementById('ct-settings-disk-free');
    usedEl.textContent = '…';
    freeEl.textContent = '…';
    cockpit.spawn(['du', '-sh', '/var/lib/cockpit-scap/'], { err: 'message' })
        .then(out => { usedEl.textContent = out.split('\t')[0].trim(); })
        .catch(() => { usedEl.textContent = '—'; });
    cockpit.spawn(['df', '-h', '--output=avail', '/var/lib/cockpit-scap/'], { err: 'message' })
        .then(out => { freeEl.textContent = out.trim().split('\n').pop().trim(); })
        .catch(() => { freeEl.textContent = '—'; });
}

function clearScanData() {
    const dirs = ['/var/lib/cockpit-scap/results/', REMEDIATION_LOG_BASE];
    Promise.all(dirs.map(dir =>
        cockpit.spawn(['find', dir, '-mindepth', '1', '-delete'],
            { superuser: 'require', err: 'message' })
            .catch(err => console.error('clearScanData: failed for ' + dir, err.message || err))
    ))
    .then(() => cockpit.file(ACTIVITY_LOG, { superuser: 'require' }).replace(''))
    .then(() => {
        appendActivityLog({ type: 'data_clear', tab: 'settings' });
        loadHistory();
        csLoadHistory();
        loadActivityLog();
        fetchDiskUsage();
    })
    .catch(err => console.error('clearScanData failed:', err.message || err));
}

function clearPolicies() {
    cockpit.spawn(['find', TAILORING_BASE, '-mindepth', '1', '-delete'],
        { superuser: 'require', err: 'message' })
        .then(() => {
            appendActivityLog({ type: 'data_clear', tab: 'settings' });
            renderUserContentList();
            fetchDiskUsage();
        })
        .catch(err => console.error('clearPolicies failed:', err.message || err));
}

function onRetentionInput() {
    const hVal = parseInt(document.getElementById('ct-setting-host-retention').value, 10);
    const cVal = parseInt(document.getElementById('ct-setting-container-retention').value, 10);
    const reducing = (!isNaN(hVal) && hVal < hostRetention) ||
                     (!isNaN(cVal) && cVal < containerRetention);
    document.getElementById('ct-settings-warn').classList.toggle('hidden', !reducing);
}

function saveSettings() {
    const hInput = document.getElementById('ct-setting-host-retention');
    const cInput = document.getElementById('ct-setting-container-retention');
    const hVal = Math.max(RETENTION_MIN, Math.min(RETENTION_MAX, parseInt(hInput.value, 10) || RETENTION_DEFAULT));
    const cVal = Math.max(RETENTION_MIN, Math.min(RETENTION_MAX, parseInt(cInput.value, 10) || RETENTION_DEFAULT));

    hInput.value = hVal;
    cInput.value = cVal;

    const ceVal = document.getElementById('ct-setting-container-enabled').checked;
    const deVal = document.getElementById('ct-setting-dashboard-enabled').checked;
    const teVal = document.getElementById('ct-setting-tailoring-enabled').checked;

    const prevHost      = hostRetention;
    const prevContainer = containerRetention;
    const prevCe        = containerScanEnabled;
    const prevDe        = dashboardEnabled;
    const prevTe        = tailoringEnabled;

    const newSettings = JSON.stringify({
        host_retention:         hVal,
        container_retention:    cVal,
        container_scan_enabled: ceVal,
        dashboard_enabled:      deVal,
        tailoring_enabled:      teVal,
    }, null, 2);

    cockpit.file(SETTINGS_PATH, { superuser: 'require' })
        .replace(newSettings)
        .then(() => cockpit.file(SETTINGS_PATH).read())
        .then(written => {
            if (written !== newSettings) throw new Error('File not written');
            hostRetention        = hVal;
            containerRetention   = cVal;
            containerScanEnabled = ceVal;
            dashboardEnabled     = deVal;
            tailoringEnabled     = teVal;
            applyTabVisibility();
            return Promise.all([
                pruneHistoryByType('host'),
                pruneHistoryByType('container'),
            ]);
        })
        .then(() => {
            const parts = [];
            if (hVal  !== prevHost)      parts.push('host retention: ' + prevHost + ' → ' + hVal);
            if (cVal  !== prevContainer) parts.push('container retention: ' + prevContainer + ' → ' + cVal);
            if (ceVal !== prevCe)        parts.push('container scan: ' + (ceVal ? 'enabled' : 'disabled'));
            if (deVal !== prevDe)        parts.push('dashboard: ' + (deVal ? 'enabled' : 'disabled'));
            if (teVal !== prevTe)        parts.push('policy tailoring: ' + (teVal ? 'enabled' : 'disabled'));
            if (parts.length)
                appendActivityLog({ type: 'settings_change', tab: 'settings',
                                    detail: parts.join(', ') });

            document.getElementById('ct-settings-warn').classList.add('hidden');
            document.getElementById('ct-settings-save-error').classList.add('hidden');
            document.getElementById('ct-settings-saved').classList.remove('hidden');
            fetchDiskUsage();
        })
        .catch(err => {
            console.error('Settings save failed:', err.message || err);
            document.getElementById('ct-settings-save-error').classList.remove('hidden');
        });
}

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
        case 'remediate_apply':
            return 'Remediation applied — rules: ' + (e.rules_applied || 0) + ', exit: ' + e.exit_code;
        case 'content_upload':
            return 'SDS content uploaded — ' + (e.file || '?');
        case 'content_delete':
            return 'SDS content deleted — ' + (e.file || '?');
        case 'tailor_save':
            return 'Tailoring policy saved — ' + (e.file || e.profile || '?');
        case 'tailor_delete':
            return 'Tailoring policy deleted — ' + (e.file || '?');
        case 'settings_change':
            return 'Settings updated — ' + (e.detail || '?');
        case 'activity_clear':
            return 'Activity log cleared';
        case 'data_clear':
            return 'All module data cleared';
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
    guide:               'Compliance Guide Generated',
    validate:            'Content Validated',
    content_upload:      'Content Uploaded',
    content_delete:      'Content Deleted',
    tailor_upload:       'Tailoring Uploaded',
    tailor_load:         'Tailoring Loaded',
    tailor_save:         'Tailoring Saved',
    tailor_delete:       'Tailoring Deleted',
    tailor_download:     'Tailoring Downloaded',
    remediate_download:  'Remediation Downloaded',
    settings_change:     'Settings Updated',
    remediate_apply:     'Remediation Applied',
    data_clear:          'All Data Cleared',
};

const ACTIVITY_BADGE_CLASS = {
    scan_start:          'ct-activity-scan',
    scan_complete:       'ct-activity-scan',
    scan_cancel:         'ct-activity-scan',
    scan_error:          'ct-activity-danger',
    scan_delete:         'ct-activity-danger',
    guide:               'ct-activity-guide',
    validate:            'ct-activity-validate',
    content_upload:      'ct-activity-validate',
    content_delete:      'ct-activity-danger',
    tailor_upload:       'ct-activity-tailor',
    tailor_load:         'ct-activity-tailor',
    tailor_save:         'ct-activity-tailor',
    tailor_delete:       'ct-activity-danger',
    tailor_download:     'ct-activity-tailor',
    remediate_download:  'ct-activity-remediate',
    settings_change:     'ct-activity-validate',
    remediate_apply:     'ct-activity-danger',
    data_clear:          'ct-activity-danger',
};

const ACTIVITY_FILTER_MAP = {
    scan:      ['scan_start', 'scan_complete', 'scan_cancel', 'scan_error', 'scan_delete', 'remediate_download'],
    guide:     ['guide'],
    validate:  ['validate', 'content_delete', 'content_upload'],
    tailoring: ['tailor_upload', 'tailor_load', 'tailor_save', 'tailor_delete', 'tailor_download'],
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
            <td><span class="ct-activity-badge ${ACTIVITY_BADGE_CLASS[e.type] || 'ct-activity-scan'}">${escHtmlRem(ACTIVITY_TYPE_LABELS[e.type] || e.type)}</span></td>
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
    if (e.type === 'tailor_save' || e.type === 'tailor_load' || e.type === 'tailor_delete')
        return esc(e.profile || e.file);
    if (e.type === 'scan_error')      return esc(e.message);
    if (e.type === 'settings_change')  return esc(e.detail || '');
    if (e.type === 'remediate_apply') {
        const rulesText = esc(e.rules_applied + ' rule' + (e.rules_applied !== 1 ? 's' : '') + ' applied');
        if (e.log_path) {
            return rulesText + ' &nbsp;<button class="pf-v6-c-button pf-m-link ct-activity-view-log" type="button" data-log-path="' + escapeAttr(e.log_path) + '">View Log</button>';
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
    cockpit.file(ACTIVITY_LOG, { superuser: 'require' }).replace('')
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

function exportHostHistoryCSV() {
    const headers = [
        'Timestamp', 'Date', 'SDS File', 'Profile Title', 'Policy',
        'Pass', 'Fail', 'Error', 'Not Checked', 'Not Applicable', 'Score %',
    ];
    const rows = currentHostHistory.map(m => [
        m.timestamp,
        m.timestamp.replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2'),
        m.sds_file        || '',
        m.profile_title   || '',
        m.tailoring_file  || '',
        m.counts.pass,
        m.counts.fail,
        m.counts.error        || 0,
        m.counts.notchecked   || 0,
        m.counts.notapplicable || 0,
        (m.score || 0).toFixed(1),
    ]);
    downloadCSV('host-scan-history.csv', [headers, ...rows]);
}

function validateContent(entry, btn) {
    btn.disabled    = true;
    btn.textContent = 'Validating…';
    btn.className   = 'pf-v6-c-button pf-m-link';

    cockpit.spawn(['oscap', 'ds', 'sds-validate', entry.xmlPath], { err: 'out' })
        .then(() => {
            btn.disabled    = false;
            btn.textContent = '✓ Valid';
            btn.className   = 'pf-v6-c-button pf-m-link ct-validate-ok';
            appendActivityLog({ type: 'validate', tab: 'content', file: entry.name, result: 'pass' });
        })
        .catch(err => {
            btn.disabled    = false;
            btn.textContent = '✗ Invalid';
            btn.className   = 'pf-v6-c-button pf-m-link ct-validate-fail';
            appendActivityLog({ type: 'validate', tab: 'content', file: entry.name, result: 'fail' });
            const detail = (err.message || String(err)).trim() || 'Validation failed with no output.';
            btn.addEventListener('click', () => showInfoModal('Validation Error: ' + entry.name, detail), { once: true });
        });
}

function showInfoModal(title, body) {
    document.getElementById('ct-info-title').textContent = title;
    document.getElementById('ct-info-body').textContent  = body;
    document.getElementById('ct-info-backdrop').classList.remove('hidden');
}
