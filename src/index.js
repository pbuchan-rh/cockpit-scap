'use strict';

const MODULE_VERSION = 'v3.4';
const SSG_CONTENT_DIR = '/usr/share/xml/scap/ssg/content/';
const RESULTS_BASE    = '/var/lib/cockpit-scap/results/';
const TAILORING_BASE  = '/var/lib/cockpit-scap/tailoring/';
const CONTENT_BASE    = '/var/lib/cockpit-scap/content/';

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

const HISTORY_MAX    = 10;
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
    'def t(tag): return tag.split("}")[-1] if "}" in tag else tag',
    'for _, el in ET.iterparse(path, events=("end",)):',
    '    tag = t(el.tag)',
    '    if tag == "TestResult": result_id = el.get("id", "")',
    '    elif tag == "score":',
    '        try: score = float(el.text or "0")',
    '        except: pass',
    '    elif tag == "rule-result":',
    '        for ch in el:',
    '            if t(ch.tag) == "result":',
    '                v = (ch.text or "").strip()',
    '                if v in counts: counts[v] += 1',
    '        el.clear()',
    'print(json.dumps({"result_id": result_id, "score": score, "counts": counts}))',
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
    '    return {"id": rid, "title": text(t), "severity": el.get("severity", "unknown"), "selected": is_sel(rid, d)}',
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
    'NS = "http://checklists.nist.gov/xccdf/1.2"',
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
    '    rinfo[rid] = (t.text.strip() if t is not None else rid, rule.get("severity", "unknown"), cce, desc, rat)',
    'has_rem = False; auto_rules = set()',
    'if len(sys.argv) > 2:',
    '    try:',
    '        auto_rules = set(re.findall(r"# BEGIN fix \\([^)]+\\) for \'([^\']+)\'", open(sys.argv[2]).read()))',
    '        has_rem = True',
    '    except: pass',
    'fails = []; seen = set()',
    'for rr in root.iter("{%s}rule-result" % NS):',
    '    r = rr.find("{%s}result" % NS)',
    '    if r is not None and r.text == "fail":',
    '        rid = rr.get("idref", "")',
    '        if rid in seen: continue',
    '        seen.add(rid)',
    '        t, s, cce, desc, rat = rinfo.get(rid, (rid, rr.get("severity", "unknown"), "", "", ""))',
    '        rule = {"id": rid, "title": t, "severity": s, "cce": cce, "desc": desc, "rat": rat}',
    '        if has_rem: rule["automated"] = rid in auto_rules',
    '        fails.append(rule)',
    'order = {"high":0,"medium":1,"low":2}',
    'fails.sort(key=lambda x: (order.get(x["severity"], 3), x["title"].lower()))',
    'print(json.dumps(fails))',
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
let currentReportPath     = null;
let currentRemBashPath    = null;
let currentRemAnsiblePath = null;
let currentManifest       = null;
let scanCancelledByUser   = false;

/* Module state — selective remediation */
let remediationDir   = null;   /* full path to scan results dir, trailing slash */
let remediationRules = [];     /* [{id, title, severity}] from last load */

/* Module state — tailoring */
let tailorSdsPath         = null;
let tailorData            = null;
let tailorRuleChanges     = {};
let tailorValueChanges    = {};
let tailorEditingSidecar  = null;
let tailoringFilesMap   = {};

/* Module state — content */
let cpeBlocksScan  = false;
let hostOsVersion     = null;   /* cached from /etc/os-release at startup */
let currentHostHistory = [];    /* last rendered host scan manifests */

/* Module state — confirm modal */
let confirmCallback = null;

document.addEventListener('DOMContentLoaded', () => {
    cockpit.file('/etc/os-release').read()
        .then(content => {
            const m = content && content.match(/^VERSION_ID="?(\d+)/m);
            hostOsVersion = m ? parseInt(m[1], 10) : null;
        })
        .catch(() => {});

    initTabs();
    detectContent();
    loadHistory();
    detectTailoringFiles();
    renderContentTab();
    initContainerScan();
    initDashboard();

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
        .addEventListener('click', () => downloadArtifact(
            currentReportPath,
            'scap-report-' + currentTimestamp + '.html',
            'text/html'
        ));
    document.getElementById('ct-download-xml-btn')
        .addEventListener('click', () => downloadArtifact(
            currentResultsDir + 'results.xml',
            'scap-results-' + currentTimestamp + '.xml',
            'application/xml'
        ));
    document.getElementById('ct-new-scan-btn')
        .addEventListener('click', () => {
            if (currentManifest) rerunHostScan(currentManifest);
            else showScanSetup();
        });
    document.getElementById('ct-results-close-btn')
        .addEventListener('click', showScanSetup);
    document.getElementById('ct-scan-error-close')
        .addEventListener('click', hideScanError);
    document.getElementById('ct-selective-rem-btn')
        .addEventListener('click', () => openRemediationPanel(currentResultsDir));
    document.getElementById('ct-rem-bash-btn')
        .addEventListener('click', () => generateSelectiveFix('bash'));
    document.getElementById('ct-rem-ansible-btn')
        .addEventListener('click', () => generateSelectiveFix('ansible'));
    document.getElementById('ct-rem-select-all-btn')
        .addEventListener('click', () => {
            document.querySelectorAll('#ct-remediation-rules .ct-rem-checkbox').forEach(c => { c.checked = true; });
            updateRemediationCount();
        });
    document.getElementById('ct-rem-deselect-all-btn')
        .addEventListener('click', () => {
            document.querySelectorAll('#ct-remediation-rules .ct-rem-checkbox').forEach(c => { c.checked = false; });
            updateRemediationCount();
        });
    document.getElementById('ct-rem-close-btn')
        .addEventListener('click', () => {
            document.getElementById('ct-remediation-panel').classList.add('hidden');
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
    document.getElementById('ct-tailor-editor-name-icon')
        .addEventListener('click', () => {
            const input = document.getElementById('ct-tailor-editor-name');
            input.focus();
            input.select();
        });
    document.getElementById('ct-tailor-update-btn')
        .addEventListener('click', doUpdateTailoringFile);
    document.getElementById('ct-tailor-save-btn')
        .addEventListener('click', onTailorSaveClick);
    document.getElementById('ct-tailor-cancel-btn')
        .addEventListener('click', resetTailorForm);
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

    /* Content tab */
    document.getElementById('ct-content-refresh-btn')
        .addEventListener('click', () => { renderContentTab(); detectContent(); });

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
            scanSelect.innerHTML   = '';
            tailorSelect.innerHTML = '';

            const total = sysFiles.length + userFiles.length;

            if (total === 0) {
                showNoContentAlert();
                appendOption(scanSelect,   '', 'No content found');
                appendOption(tailorSelect, '', 'No content found');
                return;
            }

            hideNoContentAlert();

            if (total === 1) {
                const item = sysFiles.length ? sysFiles[0] : userFiles[0];

                appendOption(scanSelect, item.path, item.name);
                scanSelect.value = item.path;
                currentSdsPath   = item.path;
                loadProfiles(item.path);
                checkCpeCompat(item.path);
                detectTailoringFiles();

                appendOption(tailorSelect, item.path, item.name);
                tailorSelect.value = item.path;
                tailorSdsPath      = item.path;
                loadProfiles(item.path, 'ct-tailor-profile-select');
                return;
            }

            appendOption(scanSelect,   '', 'Select content…');
            appendOption(tailorSelect, '', 'Select content…');
            populateContentOptGroups(scanSelect,   sysFiles, userFiles);
            populateContentOptGroups(tailorSelect, sysFiles, userFiles);
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
    clearCpeAlert();
    setScanButtonEnabled(false);
    updateGuideButton();
    currentSdsPath = null;

    if (!sdsPath) {
        detectTailoringFiles();
        return;
    }

    currentSdsPath = sdsPath;
    loadProfiles(sdsPath);
    checkCpeCompat(sdsPath);
    detectTailoringFiles();
}

/* ---- CPE / OS compatibility -------------------------------- */

function detectSdsVersion(sdsPath) {
    const m = sdsPath.match(/ssg-rhel(\d+)-ds\.xml$/);
    return m ? parseInt(m[1], 10) : null;
}

function checkCpeCompat(sdsPath) {
    const sdsVer = detectSdsVersion(sdsPath);
    if (!sdsVer || !hostOsVersion) return;

    if (sdsVer !== hostOsVersion) {
        cpeBlocksScan = true;
        setScanButtonEnabled(false);
        showCpeAlert(sdsVer, hostOsVersion);
    } else {
        clearCpeAlert();
    }
}

function showCpeAlert(sdsVer, hostVer) {
    document.getElementById('ct-cpe-alert-text').textContent =
        'This content targets RHEL ' + sdsVer + '. This host is RHEL ' + hostVer +
        '. Scanning is not supported for cross-version content. Tailoring is still available.';
    document.getElementById('ct-cpe-alert').classList.remove('hidden');
}

function clearCpeAlert() {
    cpeBlocksScan = false;
    document.getElementById('ct-cpe-alert').classList.add('hidden');
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

    if (!cpeBlocksScan) setScanButtonEnabled(true);
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
    currentReportPath     = currentResultsDir + 'report.html';
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
        '--profile', profileId,
        '--report',  currentReportPath,
        '--results', resultsXmlPath,
        currentSdsPath
    );

    currentScanProc = cockpit.spawn(args, { superuser: 'require', err: 'out' });

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
                onScanError(err.message || String(err));
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
            const manifest = {
                timestamp:      currentTimestamp,
                sds_file:       currentSdsPath,
                profile_id:     profileId,
                profile_title:  profileTitle,
                tailoring_file: tailoringPath || null,
                result_id:      parsed.result_id,
                counts:         parsed.counts,
                score:          parsed.score,
            };
            return cockpit.file(currentResultsDir + 'manifest.json', { superuser: 'require' })
                .replace(JSON.stringify(manifest, null, 2))
                .then(() => manifest);
        })
        .then(manifest => generateRemediation(manifest.result_id, resultsXmlPath, tailoringPath)
            .catch(err => {
                console.error('Remediation generation failed:', err.message || err);
                currentRemBashPath    = null;
                currentRemAnsiblePath = null;
            })
            .then(() => manifest))
        .then(manifest => pruneHistoryByType('host').then(() => manifest))
        .then(manifest => relaxResultsPerms().then(() => manifest))
        .then(manifest => {
            appendActivityLog({ type: 'scan_complete', tab: 'host',
                content: manifest.sds_file.split('/').pop(), profile: manifest.profile_title,
                score: manifest.score.toFixed(1), pass: manifest.counts.pass, fail: manifest.counts.fail });
            return manifest;
        })
        .then(manifest => showResults(manifest))
        .catch(err => onScanError('Failed to process results: ' + (err.message || String(err))));
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

    const panel = document.getElementById('ct-remediation-panel');
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

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

    cockpit.spawn(['python3', '-c', PY_EXTRACT_FAILING_RULES, resultsDir + 'results.xml'],
                  { err: 'message' })
        .then(output => {
            remediationRules = JSON.parse(output);
            document.getElementById('ct-remediation-loading').classList.add('hidden');
            renderRemediationRules(remediationRules);
            document.getElementById('ct-remediation-content').classList.remove('hidden');
        })
        .catch(err => {
            document.getElementById('ct-remediation-loading').classList.add('hidden');
            document.getElementById('ct-remediation-error-msg').textContent =
                'Failed to load failing rules: ' + (err.message || String(err));
            document.getElementById('ct-remediation-error').classList.remove('hidden');
        });
}

function renderRemediationRules(rules) {
    const groups = { high: [], medium: [], low: [], unknown: [] };
    rules.forEach(r => (groups[r.severity] || groups.unknown).push(r));

    const container = document.getElementById('ct-remediation-rules');
    container.innerHTML = '';

    const order = [['high','High','ct-sev-high'],['medium','Medium','ct-sev-medium'],['low','Low','ct-sev-low']];
    order.forEach(([sev, label, cls]) => {
        const list = groups[sev];
        if (!list || !list.length) return;

        const details = document.createElement('details');
        details.open = (sev === 'high');
        details.className = 'ct-rem-group';

        const summary = document.createElement('summary');
        summary.className = 'ct-rem-group-summary';
        summary.innerHTML =
            '<span class="ct-sev-badge ' + cls + '">' + label + '</span>' +
            '<span class="ct-rem-group-count">' + list.length + ' rule' + (list.length !== 1 ? 's' : '') + '</span>' +
            '<button class="pf-v6-c-button pf-m-link ct-rem-select-sev" type="button" data-sev="' + sev + '">Select all</button>';
        details.appendChild(summary);

        list.forEach(rule => {
            const row = document.createElement('label');
            row.className = 'ct-rem-rule-row';
            row.innerHTML =
                '<input type="checkbox" class="ct-rem-checkbox" data-id="' + escapeAttr(rule.id) + '" checked>' +
                '<span class="ct-rem-rule-title">' + escHtmlRem(rule.title) + '</span>' +
                '<span class="ct-rem-rule-id">' + escHtmlRem(rule.id.split('_rule_').pop()) + '</span>';
            details.appendChild(row);
        });
        container.appendChild(details);
    });

    container.querySelectorAll('.ct-rem-select-sev').forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            const sev = btn.dataset.sev;
            const checks = container.querySelectorAll('.ct-rem-checkbox[data-sev]');
            const sevChecks = container.querySelectorAll(
                '.ct-rem-checkbox[data-id]'
            );
            /* find checkboxes within this group */
            const group = btn.closest('details');
            const groupChecks = group.querySelectorAll('.ct-rem-checkbox');
            const allChecked = Array.from(groupChecks).every(c => c.checked);
            groupChecks.forEach(c => { c.checked = !allChecked; });
            updateRemediationCount();
        });
    });

    container.removeEventListener('change', updateRemediationCount);
    container.addEventListener('change', updateRemediationCount);
    updateRemediationCount();
}

function updateRemediationCount() {
    const all     = document.querySelectorAll('#ct-remediation-rules .ct-rem-checkbox');
    const checked = Array.from(all).filter(c => c.checked).length;
    document.getElementById('ct-remediation-count').textContent =
        checked + ' of ' + all.length + ' rules selected';
    const disabled = checked === 0;
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

function generateSelectiveFix(fixType) {
    const all = document.querySelectorAll('#ct-remediation-rules .ct-rem-checkbox');
    const selected = Array.from(all).filter(c => c.checked).map(c => c.dataset.id);
    if (!selected.length) return;

    const remFile = remediationDir + (fixType === 'bash' ? 'remediation.sh' : 'remediation.yml');
    const ext     = fixType === 'bash' ? '.sh' : '.yml';
    const mime    = fixType === 'bash' ? 'text/x-shellscript' : 'text/yaml';
    const ts      = remediationDir.replace(/\/$/, '').split('/').pop();
    const fname   = 'selective-remediation-' + ts + ext;

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
        appendActivityLog({ type: 'remediate_download', tab: 'host',
            fix_type: fixType, rules_selected: selected.length });
    })
    .catch(err => console.error('Selective remediation failed:', err.message || err));
}

function escHtmlRem(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;');
}

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
                const toDelete = matching.slice(HISTORY_MAX);
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

function onScanError(message) {
    appendActivityLog({ type: 'scan_error', tab: 'host', message });
    currentScanProc = null;
    showScanSetup();
    document.getElementById('ct-scan-error-message').textContent = message;
    document.getElementById('ct-scan-error-alert').classList.remove('hidden');
}

function hideScanError() {
    document.getElementById('ct-scan-error-alert').classList.add('hidden');
}

/* ---- Results XML parsing ----------------------------------- */

function parseResultsXml(content) {
    const NS  = 'http://checklists.nist.gov/xccdf/1.2';
    const doc = new DOMParser().parseFromString(content, 'application/xml');

    const byTag = (parent, tag) => {
        const ns = parent.getElementsByTagNameNS(NS, tag);
        return ns.length ? ns[0] : (parent.getElementsByTagName(tag)[0] || null);
    };

    const testResult = (() => {
        const ns = doc.getElementsByTagNameNS(NS, 'TestResult');
        return ns.length ? ns[0] : (doc.getElementsByTagName('TestResult')[0] || null);
    })();

    const resultId = testResult ? (testResult.getAttribute('id') || '') : '';
    const scoreEl  = testResult ? byTag(testResult, 'score') : null;
    const rawScore = scoreEl ? parseFloat(scoreEl.textContent) : 0;
    const score    = isNaN(rawScore) ? 0 : rawScore;

    const counts = { pass: 0, fail: 0, error: 0, notchecked: 0, notapplicable: 0, notselected: 0 };
    if (testResult) {
        let rr = testResult.getElementsByTagNameNS(NS, 'rule-result');
        if (!rr.length) rr = testResult.getElementsByTagName('rule-result');
        Array.from(rr).forEach(r => {
            const el  = byTag(r, 'result');
            const val = el ? el.textContent.trim() : '';
            if (Object.prototype.hasOwnProperty.call(counts, val)) counts[val]++;
        });
    }

    return { resultId, score, counts };
}

/* ---- Results display --------------------------------------- */

function findPreviousScan(manifest, history) {
    return history.find(m =>
        m.timestamp < manifest.timestamp &&
        m.profile_id === manifest.profile_id &&
        m.sds_file   === manifest.sds_file
    ) || null;
}

function buildScoreDonut(score, failCount) {
    const r     = 28;
    const circ  = 2 * Math.PI * r;
    const offset = circ * (1 - score / 100);
    const color  = failCount === 0  ? 'var(--ct-color-success)'
                 : failCount <= 10  ? 'var(--ct-color-warning)'
                 : 'var(--ct-color-danger)';
    const NS = 'http://www.w3.org/2000/svg';

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '72');
    svg.setAttribute('height', '72');
    svg.setAttribute('viewBox', '0 0 72 72');
    svg.classList.add('ct-score-donut');

    const track = document.createElementNS(NS, 'circle');
    track.setAttribute('cx', '36'); track.setAttribute('cy', '36');
    track.setAttribute('r', String(r)); track.setAttribute('fill', 'none');
    track.setAttribute('stroke-width', '7');
    track.style.stroke = 'var(--ct-color-border)';
    svg.appendChild(track);

    const arc = document.createElementNS(NS, 'circle');
    arc.setAttribute('cx', '36'); arc.setAttribute('cy', '36');
    arc.setAttribute('r', String(r)); arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke-width', '7');
    arc.setAttribute('stroke-linecap', 'round');
    arc.setAttribute('stroke-dasharray', String(circ));
    arc.setAttribute('stroke-dashoffset', String(offset));
    arc.setAttribute('transform', 'rotate(-90 36 36)');
    arc.style.stroke = color;
    svg.appendChild(arc);

    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', '36'); text.setAttribute('y', '41');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '13');
    text.setAttribute('font-weight', '700');
    text.setAttribute('fill', 'currentColor');
    text.textContent = score.toFixed(1) + '%';
    svg.appendChild(text);

    return svg;
}

function renderFailingSummary(resultsXmlPath, groupsId, loadingId, remPath) {
    const groupsEl  = document.getElementById(groupsId);
    const loadingEl = document.getElementById(loadingId);
    groupsEl.innerHTML = '';
    loadingEl.classList.remove('hidden');

    const spawnArgs = remPath
        ? ['python3', '-c', PY_EXTRACT_FAILING_RULES, resultsXmlPath, remPath]
        : ['python3', '-c', PY_EXTRACT_FAILING_RULES, resultsXmlPath];
    cockpit.spawn(spawnArgs, { err: 'message' })
        .then(output => {
            loadingEl.classList.add('hidden');
            const rules = JSON.parse(output);
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
                if (idx === 0) details.open = true;
                const summary = document.createElement('summary');
                summary.className = 'ct-failing-group-summary';
                summary.textContent = label + ' — ' + list.length + ' failing';
                details.appendChild(summary);
                const ruleList = document.createElement('div');
                ruleList.className = 'ct-failing-rule-list';
                list.forEach(r => {
                    const hasExpand = !!r.desc;
                    const wrapper = hasExpand
                        ? document.createElement('details')
                        : document.createElement('div');
                    wrapper.className = 'ct-rule-item';

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
                        wrapper.appendChild(body);
                    }
                    ruleList.appendChild(wrapper);
                });
                details.appendChild(ruleList);
                groupsEl.appendChild(details);
            });
        })
        .catch(() => { loadingEl.classList.add('hidden'); });
}

function loadScanFromHistory(manifest) {
    if (currentScanProc) return;
    const dir = RESULTS_BASE + manifest.timestamp + '/';
    currentTimestamp      = manifest.timestamp;
    currentResultsDir     = dir;
    currentReportPath     = dir + 'report.html';
    currentRemBashPath    = dir + 'remediation.sh';
    currentRemAnsiblePath = dir + 'remediation.yml';
    currentSdsPath        = manifest.sds_file || null;
    document.getElementById('ct-scan-row').classList.add('hidden');
    showResults(manifest);
    document.getElementById('ct-results').scrollIntoView({ behavior: 'smooth' });
}

function showResults(manifest) {
    currentManifest = manifest;
    const { counts, score, profile_title, timestamp } = manifest;

    document.getElementById('ct-results-profile-title').textContent = profile_title;
    document.getElementById('ct-results-timestamp').textContent = timestamp
        ? timestamp.replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2')
        : '';

    const badges = document.getElementById('ct-result-badges');
    badges.innerHTML = '';
    [
        ['Pass',        counts.pass,       'ct-badge-pass'],
        ['Fail',        counts.fail,       'ct-badge-fail'],
        ['Error',       counts.error,      'ct-badge-error'],
        ['Not checked', counts.notchecked, 'ct-badge-neutral'],
    ].forEach(([label, count, cls]) => {
        const span = document.createElement('span');
        span.className   = 'ct-result-badge ' + cls;
        span.textContent = label + ': ' + count;
        badges.appendChild(span);
    });

    const scoreEl = document.getElementById('ct-result-score');
    scoreEl.innerHTML = '';
    scoreEl.appendChild(buildScoreDonut(score, counts.fail));

    const uploadedWarn = document.getElementById('ct-uploaded-content-warning');
    if (currentSdsPath && currentSdsPath.startsWith(CONTENT_BASE)) {
        uploadedWarn.classList.remove('hidden');
    } else {
        uploadedWarn.classList.add('hidden');
    }

    const prev = findPreviousScan(manifest, currentHostHistory);
    const improvementAlert = document.getElementById('ct-improvement-alert');
    const regressionAlert  = document.getElementById('ct-regression-alert');
    if (prev && counts.fail < prev.counts.fail) {
        const delta    = prev.counts.fail - counts.fail;
        const prevDate = prev.timestamp.replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
        document.getElementById('ct-improvement-msg').textContent =
            delta + ' fewer failing rule' + (delta === 1 ? '' : 's') +
            ' than your previous scan on ' + prevDate +
            ' (' + prev.counts.fail + ' → ' + counts.fail + ')';
        improvementAlert.classList.remove('hidden');
        regressionAlert.classList.add('hidden');
    } else if (prev && counts.fail > prev.counts.fail) {
        const delta    = counts.fail - prev.counts.fail;
        const prevDate = prev.timestamp.replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
        document.getElementById('ct-regression-msg').textContent =
            delta + ' more failing rule' + (delta === 1 ? '' : 's') +
            ' than your previous scan on ' + prevDate +
            ' (' + prev.counts.fail + ' → ' + counts.fail + ')';
        regressionAlert.classList.remove('hidden');
        improvementAlert.classList.add('hidden');
    } else {
        improvementAlert.classList.add('hidden');
        regressionAlert.classList.add('hidden');
    }

    const remBtn = document.getElementById('ct-selective-rem-btn');
    const remFailed = !currentRemBashPath;
    remBtn.disabled = remFailed;
    remBtn.title    = remFailed ? 'Remediation scripts were not generated for this scan' : '';

    document.getElementById('ct-scan-progress').classList.add('hidden');
    document.getElementById('ct-results').classList.remove('hidden');
    renderFailingSummary(currentResultsDir + 'results.xml',
                         'ct-failing-summary-groups', 'ct-failing-summary-loading',
                         currentRemBashPath || null);
    loadHistory();
    dbInvalidate();
}

/* ---- Report / artifact actions ----------------------------- */

function viewReport() {
    viewReportFromPath(currentReportPath);
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

function viewReportFromPath(reportPath) {
    const win = window.open('about:blank', '_blank');
    cockpit.file(reportPath).read()
        .then(content => storeReportInDB(content))
        .then(() => { win.location.href = '/cockpit/@localhost/cockpit-scap/viewer.html'; })
        .catch(err => {
            win.close();
            console.error('Failed to open report:', err);
        });
}

function downloadArtifact(filePath, filename, mimeType) {
    if (!filePath) return;
    cockpit.file(filePath).read()
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
        })
        .catch(err => {
            console.error('Failed to download:', err);
            alert('Download failed — file may not exist: ' + (err.message || String(err)));
        });
}

/* ---- Scan state transitions -------------------------------- */

function showScanProgress() {
    document.getElementById('ct-scan-row').classList.add('hidden');
    document.getElementById('ct-scan-progress').classList.remove('hidden');
    document.getElementById('ct-results').classList.add('hidden');
    loadHistory();
}

function showScanSetup() {
    document.getElementById('ct-scan-row').classList.remove('hidden');
    document.getElementById('ct-scan-progress').classList.add('hidden');
    document.getElementById('ct-results').classList.add('hidden');
    document.getElementById('ct-failing-summary-groups').innerHTML = '';
    document.getElementById('ct-failing-summary-loading').classList.add('hidden');
    document.getElementById('ct-improvement-alert').classList.add('hidden');
    document.getElementById('ct-regression-alert').classList.add('hidden');
    currentScanProc       = null;
    currentRemBashPath    = null;
    currentRemAnsiblePath = null;
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
    document.getElementById('ct-scan-btn').disabled = !enabled;
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
            btn.textContent = 'View Guide';
        });
}

function onTailorViewGuideClick() {
    const btn       = document.getElementById('ct-tailor-guide-btn');
    const profileId = document.getElementById('ct-tailor-profile-select').value;

    btn.disabled    = true;
    btn.textContent = 'Generating…';

    const win = window.open('about:blank', '_blank');
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
            btn.textContent = 'View Guide';
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

function parseOscapTitle(output) {
    for (const line of output.split('\n')) {
        const m = line.match(/^\s*Title:\s+(.+)$/);
        if (m) return m[1].trim();
    }
    return null;
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
}

function restoreLastResults() {
    cockpit.spawn(['ls', RESULTS_BASE], { err: 'message' })
        .then(output => {
            const dirs = output.trim().split('\n')
                .filter(d => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(d))
                .sort().reverse();
            if (!dirs.length) return;
            return tryRestoreDir(dirs, 0);
        })
        .catch(() => {});

    function tryRestoreDir(dirs, idx) {
        if (idx >= dirs.length) return;
        const dir = RESULTS_BASE + dirs[idx] + '/';
        return cockpit.file(dir + 'manifest.json').read()
            .then(content => {
                const m = JSON.parse(content);
                if (!m || m.scan_type === 'container') return tryRestoreDir(dirs, idx + 1);
                currentTimestamp      = m.timestamp;
                currentResultsDir     = dir;
                currentReportPath     = dir + 'report.html';
                currentRemBashPath    = dir + 'remediation.sh';
                currentRemAnsiblePath = dir + 'remediation.yml';
                currentSdsPath        = m.sds_file || null;
                document.getElementById('ct-scan-row').classList.add('hidden');
                showResults(m);
            })
            .catch(() => tryRestoreDir(dirs, idx + 1));
    }
}

function buildHistoryRow(manifest) {
    const dir = RESULTS_BASE + manifest.timestamp + '/';
    const tr  = document.createElement('tr');

    const date = manifest.timestamp
        .replace('T', ' ')
        .replace(/-(\d{2})-(\d{2})$/, ':$1:$2');

    const isUploaded = manifest.sds_file && manifest.sds_file.startsWith(CONTENT_BASE);

    [
        date,
        manifest.profile_title,
        String(manifest.counts.pass),
        String(manifest.counts.fail),
        (manifest.score || 0).toFixed(1) + '%',
    ].forEach((text, i) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (i === 1) {
            td.className = 'ct-history-profile-cell';
            td.title     = isUploaded
                ? text + ' (custom: ' + (manifest.sds_file || '').split('/').pop() + ')'
                : text;
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
        ['View Scan',  () => loadScanFromHistory(manifest), !!currentScanProc],
        ['Remediate',  () => openRemediationPanel(dir),     false],
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
    delBtn.className   = 'pf-v6-c-button pf-m-link ct-btn-danger-link';
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
            cockpit.spawn(['rm', '-rf', RESULTS_BASE + manifest.timestamp], { superuser: 'require' })
                .then(() => {
                    appendActivityLog({ type: 'scan_delete', tab: 'host', content: manifest.content_file, profile: manifest.profile_id });
                    loadHistory();
                })
                .catch(err => console.error('Failed to delete scan:', err.message || err));
        }
    );
}

function rerunHostScan(manifest) {
    if (currentScanProc) return;
    showScanSetup();
    document.getElementById('tab-btn-scan').click();

    const contentSelect = document.getElementById('ct-content-select');
    contentSelect.value = manifest.sds_file;
    if (contentSelect.value !== manifest.sds_file) return;

    currentSdsPath = manifest.sds_file;
    resetProfileSelect();
    hideProfileDescription();
    clearCpeAlert();
    setScanButtonEnabled(false);
    checkCpeCompat(manifest.sds_file);

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
    });
}

/* ---- Tailoring file detection (scan tab) ------------------- */

function detectTailoringFiles() {
    tailoringFilesMap = {};
    const scanSelect = document.getElementById('ct-tailor-file-select');

    return cockpit.spawn(['ls', TAILORING_BASE], { err: 'message' })
        .then(output => {
            const files = output.trim().split('\n')
                .filter(f => f && f.endsWith('.json'));

            if (files.length === 0) {
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
                const all   = sidecars.filter(Boolean);
                /* Scan tab dropdown: only files matching the current SDS */
                const forScan = all.filter(sc => !currentSdsPath || sc.sds_path === currentSdsPath);

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

                /* Tailoring tab list: all files */
                renderTailoringList(all);
            });
        })
        .catch(() => {
            scanSelect.innerHTML = '';
            appendOption(scanSelect, '', '(No tailoring — use full profile)');
            renderTailoringList([]);
        });
}

function onTailorFileSelectChange() {
    if (cpeBlocksScan) return;
    const tailoringPath = document.getElementById('ct-tailor-file-select').value;
    if (tailoringPath) {
        setScanButtonEnabled(true);
    } else {
        const profileId = document.getElementById('ct-profile-select').value;
        setScanButtonEnabled(!!profileId);
    }
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
    saveBtn.textContent = 'Save Tailoring File';
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
    const profileId = document.getElementById('ct-tailor-profile-select').value;
    const name      = document.getElementById('ct-tailor-name-input').value.trim();
    document.getElementById('ct-tailor-load-btn').disabled  = !profileId || !name;
    document.getElementById('ct-tailor-guide-btn').disabled = !profileId || !tailorSdsPath;
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
    /* keep setup-form field in sync with the inline editor name field */
    if (nameInput._editorSyncHandler) {
        nameInput.removeEventListener('input', nameInput._editorSyncHandler);
    }
    nameInput._editorSyncHandler = () => { editorName.value = nameInput.value; };
    nameInput.addEventListener('input', nameInput._editorSyncHandler);
    document.getElementById('ct-tailor-values-grid').classList.remove('hidden');
    document.getElementById('ct-tailor-values-search')
        .closest('.ct-tailor-search-wrap').classList.remove('hidden');
    document.getElementById('ct-tailor-values-collapse').textContent = 'Collapse';
    renderTailorTree(data);
    renderTailorValues(data.values || []);
    const statusEl = document.getElementById('ct-tailor-save-status');
    statusEl.textContent = '';
    statusEl.className   = 'ct-tailor-save-status hidden';
    document.getElementById('ct-tailor-editor').classList.remove('hidden');
}

function renderTailorTree(data) {
    const container = document.getElementById('ct-tailor-tree');
    container.innerHTML = '';

    function buildRule(rule) {
        const div   = document.createElement('div');
        div.className = 'ct-tailor-rule';

        const label = document.createElement('label');
        label.className = 'ct-tailor-rule-label';

        const cb        = document.createElement('input');
        cb.type         = 'checkbox';
        cb.className    = 'ct-tailor-rule-check';
        const origSel   = rule.selected;
        cb.checked      = (rule.id in tailorRuleChanges) ? tailorRuleChanges[rule.id] : origSel;
        cb.addEventListener('change', () => {
            if (cb.checked === origSel) {
                delete tailorRuleChanges[rule.id];
            } else {
                tailorRuleChanges[rule.id] = cb.checked;
            }
        });

        const titleSpan       = document.createElement('span');
        titleSpan.className   = 'ct-tailor-rule-title';
        titleSpan.textContent = rule.title || rule.id;

        const sevSpan       = document.createElement('span');
        sevSpan.className   = 'ct-tailor-rule-sev ct-sev-' + (rule.severity || 'unknown');
        sevSpan.textContent = rule.severity || '';

        label.appendChild(cb);
        label.appendChild(titleSpan);
        label.appendChild(sevSpan);
        div.appendChild(label);
        return div;
    }

    function buildGroup(group) {
        const details = document.createElement('details');
        details.className = 'ct-tailor-group';

        const summary       = document.createElement('summary');
        summary.className   = 'ct-tailor-group-summary';
        summary.textContent = group.title || group.id;
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
        const row     = document.createElement('div');
        row.className = 'ct-tailor-value-row';

        const lbl         = document.createElement('label');
        lbl.className     = 'ct-tailor-value-label';
        lbl.textContent   = val.title || val.id;
        lbl.htmlFor       = 'ct-val-' + val.id;

        let input;
        const baseValue   = val.current || val.default || '';
        const activeValue = (val.id in tailorValueChanges) ? tailorValueChanges[val.id] : baseValue;

        if (val.options && val.options.length > 0) {
            input = document.createElement('select');
            val.options.forEach(opt => {
                const o       = document.createElement('option');
                o.value       = opt.value;
                o.textContent = opt.selector + ': ' + opt.value;
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
        });

        row.appendChild(lbl);
        row.appendChild(input);
        grid.appendChild(row);
    });
}

function doUpdateTailoringFile() {
    if (!tailorData || !tailorEditingSidecar) return;

    const sidecar          = tailorEditingSidecar;
    const newProfileTitle  = document.getElementById('ct-tailor-editor-name').value.trim() || sidecar.name;
    const baseProfileId    = sidecar.base_profile_id;

    if (!sidecar.path.startsWith(TAILORING_BASE)) {
        console.error('doUpdateTailoringFile: sidecar.path outside TAILORING_BASE', sidecar.path);
        return;
    }

    const xml = generateTailoringXml(
        baseProfileId, sidecar.profile_id, newProfileTitle,
        tailorRuleChanges, tailorValueChanges
    );

    const updatedSidecar = Object.assign({}, sidecar, {
        name:     newProfileTitle,
        modified: makeTimestamp(),
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
    const sidecar = {
        name:               newProfileTitle,
        base_profile_id:    baseProfileId,
        base_profile_title: tailorData.profile.title,
        profile_id:         newProfileId,
        sds_path:           tailorSdsPath,
        path:               xmlPath,
        created:            ts,
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
        .then(() => {
            appendActivityLog({ type: 'tailor_save', tab: 'tailoring', file: filename + '.xml', profile: newProfileTitle });
            saveBtn.disabled = false;
            detectTailoringFiles();
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

        [sc.name, sc.base_profile_title || sc.base_profile_id, created].forEach(text => {
            const td = document.createElement('td');
            td.textContent = text;
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
        delBtn.className   = 'pf-v6-c-button pf-m-link ct-btn-danger-link';
        delBtn.type        = 'button';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', () => onDeleteTailoringFile(sc));

        actionsTd.appendChild(editBtn);
        actionsTd.appendChild(dlBtn);
        actionsTd.appendChild(delBtn);
        tr.appendChild(actionsTd);
        tbody.appendChild(tr);
    });
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
        'Delete Tailoring File',
        'Delete "' + sidecar.name + '"? This cannot be undone.',
        () => {
            const jsonPath = sidecar.path.replace(/\.xml$/, '.json');
            Promise.all([
                cockpit.spawn(['rm', '-f', sidecar.path], { superuser: 'require' }),
                cockpit.spawn(['rm', '-f', jsonPath],     { superuser: 'require' }),
            ])
            .then(() => {
                appendActivityLog({ type: 'tailor_delete', tab: 'tailoring', file: sidecar.path.split('/').pop(), profile: sidecar.name });
                detectTailoringFiles();
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
            })
            .catch(err => console.error('Upload failed:', err.message || err));
    };
    reader.readAsText(file);
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
            table.setAttribute('aria-label', 'System SCAP content');
            const thead = table.createTHead();
            const hr = thead.insertRow();
            ['Name', 'Path'].forEach(h => {
                const th = document.createElement('th');
                th.scope = 'col';
                th.textContent = h;
                hr.appendChild(th);
            });
            const tbody = table.createTBody();
            files.forEach(f => {
                const tr   = tbody.insertRow();
                const tdN  = tr.insertCell();
                tdN.textContent = sdsDisplayName(f);
                const tdP  = tr.insertCell();
                const code = document.createElement('code');
                code.textContent = SSG_CONTENT_DIR + f;
                tdP.appendChild(code);
            });
            container.innerHTML = '';
            container.appendChild(table);
        })
        .catch(() => {
            container.innerHTML = '<p class="ct-content-empty">System content directory not found.</p>';
        });
}

function renderUserContentList() {
    const container = document.getElementById('ct-user-content-list');
    cockpit.spawn(['ls', CONTENT_BASE], { err: 'message' })
        .then(output => {
            const files = output.trim().split('\n').filter(f => f.endsWith('.xml'));
            if (files.length === 0) {
                container.innerHTML = '<p class="ct-content-empty">No SDS files found. Stage files using the instructions above, then click Refresh.</p>';
                return;
            }
            const entries = files.map(f => ({
                filename: f,
                name:     sdsDisplayName(f),
                xmlPath:  CONTENT_BASE + f,
                jsonPath: CONTENT_BASE + f.replace(/\.xml$/, '.json'),
            }));
            const table = document.createElement('table');
            table.className = 'pf-v6-c-table pf-m-compact';
            table.setAttribute('aria-label', 'Uploaded SCAP content');
            const thead = table.createTHead();
            const hr = thead.insertRow();
            ['Name', 'File', 'Actions'].forEach(h => {
                const th = document.createElement('th');
                th.scope = 'col';
                th.textContent = h;
                hr.appendChild(th);
            });
            const tbody = table.createTBody();
            entries.forEach(e => {
                const tr     = tbody.insertRow();
                const tdN    = tr.insertCell();
                tdN.textContent = e.name;
                const tdF    = tr.insertCell();
                const code   = document.createElement('code');
                code.textContent = e.filename;
                tdF.appendChild(code);
                const tdA    = tr.insertCell();
                const valBtn = document.createElement('button');
                valBtn.className   = 'pf-v6-c-button pf-m-link';
                valBtn.type        = 'button';
                valBtn.textContent = 'Validate';
                valBtn.addEventListener('click', () => validateContent(e, valBtn));
                tdA.appendChild(valBtn);

                const btn    = document.createElement('button');
                btn.className = 'pf-v6-c-button pf-m-link ct-danger-link';
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
        })
        .catch(err => console.error('Failed to delete content file:', err.message || err));
}

/* ---- CSV export -------------------------------------------- */

/* ---- Activity log ------------------------------------------ */

function appendActivityLog(entry) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
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
}

/* ---- Activity tab ------------------------------------------ */

let activityPollInterval = null;

const ACTIVITY_TYPE_LABELS = {
    scan_start:          'Scan Started',
    scan_complete:       'Scan Completed',
    scan_cancel:         'Scan Cancelled',
    scan_error:          'Scan Failed',
    scan_delete:         'Scan Deleted',
    guide:               'Guide Generated',
    validate:            'Content Validated',
    content_delete:      'Content Deleted',
    tailor_upload:       'Tailoring Uploaded',
    tailor_load:         'Tailoring Loaded',
    tailor_save:         'Tailoring Saved',
    tailor_delete:       'Tailoring Deleted',
    tailor_download:     'Tailoring Downloaded',
    remediate_download:  'Remediation Downloaded',
};

const ACTIVITY_BADGE_CLASS = {
    scan_start:          'ct-activity-scan',
    scan_complete:       'ct-activity-scan',
    scan_cancel:         'ct-activity-scan',
    scan_error:          'ct-activity-danger',
    scan_delete:         'ct-activity-danger',
    guide:               'ct-activity-guide',
    validate:            'ct-activity-validate',
    content_delete:      'ct-activity-danger',
    tailor_upload:       'ct-activity-tailor',
    tailor_load:         'ct-activity-tailor',
    tailor_save:         'ct-activity-tailor',
    tailor_delete:       'ct-activity-danger',
    tailor_download:     'ct-activity-tailor',
    remediate_download:  'ct-activity-remediate',
};

const ACTIVITY_FILTER_MAP = {
    scan:      ['scan_start', 'scan_complete', 'scan_cancel', 'scan_error', 'scan_delete', 'remediate_download'],
    guide:     ['guide'],
    validate:  ['validate', 'content_delete'],
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

            renderActivityTable(entries.slice(0, limit));
        })
        .catch(() => renderActivityTable([]));
}

function renderActivityTable(entries) {
    const table     = document.getElementById('ct-activity-table');
    const empty     = document.getElementById('ct-activity-empty');
    const tbody     = document.getElementById('ct-activity-tbody');
    const exportBtn = document.getElementById('ct-activity-export-btn');
    const clearBtn  = document.getElementById('ct-activity-clear-btn');

    const hasEntries = entries.length > 0;
    exportBtn.disabled = !hasEntries;
    clearBtn.disabled  = !hasEntries;

    if (!hasEntries) {
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
            <td>${formatActivityTime(e.ts)}</td>
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
    const labels = { host: 'Host', container: 'Container', tailoring: 'Tailoring', content: 'Content' };
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
    if (e.type === 'scan_error')    return esc(e.message);
    return '';
}

function activityResult(e) {
    if (e.type === 'scan_complete') return `${escHtmlRem(e.score)}% &nbsp;<span class="ct-pass-count">${escHtmlRem(e.pass)} pass</span> <span class="ct-fail-count">${escHtmlRem(e.fail)} fail</span>`;
    if (e.type === 'validate')      return e.result === 'pass' ? '<span class="ct-validate-ok">✓ Valid</span>' : '<span class="ct-validate-fail">✗ Invalid</span>';
    if (e.type === 'scan_error')    return '<span class="ct-validate-fail">Error</span>';
    if (e.type === 'scan_cancel')   return '<span style="color: var(--pf-v6-global--warning-color--100)">Cancelled</span>';
    return '—';
}

function clearActivityLog() {
    cockpit.file(ACTIVITY_LOG, { superuser: 'require' }).replace('')
        .then(() => loadActivityLog())
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
                'Timestamp', 'Tab', 'Action', 'Content', 'Profile',
                'Tailoring File', 'Image', 'Score %', 'Pass', 'Fail', 'Detail',
            ];
            const rows = entries.map(e => [
                e.ts || '',
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
        'Timestamp', 'Date', 'SDS File', 'Profile Title', 'Tailoring File',
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
