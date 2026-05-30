'use strict';

const MODULE_VERSION = 'v3.0';
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

const HISTORY_MAX = 10;

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

/* Module state — scan */
let currentSdsPath        = null;
let currentScanProc       = null;
let currentTimestamp      = null;
let currentResultsDir     = null;
let currentReportPath     = null;
let currentRemBashPath    = null;
let currentRemAnsiblePath = null;
let scanCancelledByUser   = false;

/* Module state — tailoring */
let tailorSdsPath       = null;
let tailorData          = null;
let tailorRuleChanges   = {};
let tailorValueChanges  = {};
let tailoringFilesMap   = {};

/* Module state — content */
let cpeBlocksScan  = false;
let hostOsVersion  = null;   /* cached from /etc/os-release at startup */

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
    document.getElementById('ct-download-bash-btn')
        .addEventListener('click', () => downloadArtifact(
            currentRemBashPath,
            'remediation-' + currentTimestamp + '.sh',
            'text/x-shellscript'
        ));
    document.getElementById('ct-download-ansible-btn')
        .addEventListener('click', () => downloadArtifact(
            currentRemAnsiblePath,
            'remediation-' + currentTimestamp + '.yml',
            'text/yaml'
        ));
    document.getElementById('ct-new-scan-btn')
        .addEventListener('click', showScanSetup);
    document.getElementById('ct-scan-error-close')
        .addEventListener('click', hideScanError);

    /* Tailoring tab */
    document.getElementById('ct-tailor-content-select')
        .addEventListener('change', onTailorContentChange);
    document.getElementById('ct-tailor-profile-select')
        .addEventListener('change', onTailorProfileChange);
    document.getElementById('ct-tailor-name-input')
        .addEventListener('input', updateTailorLoadBtn);
    document.getElementById('ct-tailor-load-btn')
        .addEventListener('click', onTailorLoadClick);
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

function showResults(manifest) {
    const { counts, score, profile_title } = manifest;

    document.getElementById('ct-results-profile-title').textContent = profile_title;

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

    document.getElementById('ct-result-score').textContent = score.toFixed(1) + '%';

    const remFailed = !currentRemBashPath;
    document.getElementById('ct-download-bash-btn').disabled    = remFailed;
    document.getElementById('ct-download-ansible-btn').disabled = remFailed;
    document.getElementById('ct-download-bash-btn').title       = remFailed ? 'Remediation generation failed' : '';
    document.getElementById('ct-download-ansible-btn').title    = remFailed ? 'Remediation generation failed' : '';

    const uploadedWarn = document.getElementById('ct-uploaded-content-warning');
    if (currentSdsPath && currentSdsPath.startsWith(CONTENT_BASE)) {
        uploadedWarn.classList.remove('hidden');
    } else {
        uploadedWarn.classList.add('hidden');
    }

    document.getElementById('ct-scan-progress').classList.add('hidden');
    document.getElementById('ct-results').classList.remove('hidden');
    loadHistory();
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
}

function showScanSetup() {
    document.getElementById('ct-scan-row').classList.remove('hidden');
    document.getElementById('ct-scan-progress').classList.add('hidden');
    document.getElementById('ct-results').classList.add('hidden');
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
        .then(() => { win.location.href = '/cockpit/@localhost/cockpit-scap/viewer.html'; })
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
        .then(() => { win.location.href = '/cockpit/@localhost/cockpit-scap/viewer.html'; })
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
        if (i === 1 && isUploaded) {
            const badge = document.createElement('span');
            badge.className   = 'ct-history-uploaded-badge';
            badge.textContent = 'uploaded content';
            badge.title       = manifest.sds_file;
            td.appendChild(badge);
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
        ['View Report', () => viewReportFromPath(dir + 'report.html')],
        ['Bash',        () => downloadArtifact(
            dir + 'remediation.sh',
            'remediation-' + manifest.timestamp + '.sh',
            'text/x-shellscript'
        )],
        ['Ansible',     () => downloadArtifact(
            dir + 'remediation.yml',
            'remediation-' + manifest.timestamp + '.yml',
            'text/yaml'
        )],
    ].forEach(([label, handler]) => {
        const btn = document.createElement('button');
        btn.className   = 'pf-v6-c-button pf-m-link';
        btn.type        = 'button';
        btn.textContent = label;
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
                .then(() => loadHistory())
                .catch(err => console.error('Failed to delete scan:', err.message || err));
        }
    );
}

function rerunHostScan(manifest) {
    if (currentScanProc) return;
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
    tailorData         = null;
    tailorRuleChanges  = {};
    tailorValueChanges = {};

    document.getElementById('ct-tailor-editor').classList.add('hidden');
    document.getElementById('ct-tailor-error-alert').classList.add('hidden');

    document.getElementById('ct-tailor-profile-select').value = '';
    document.getElementById('ct-tailor-name-input').value     = '';
    document.getElementById('ct-tailor-name-input').disabled  = true;
    document.getElementById('ct-tailor-load-btn').disabled    = true;
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
    document.getElementById('ct-tailor-editor-title').textContent =
        document.getElementById('ct-tailor-name-input').value.trim();
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

function onTailorSaveClick() {
    if (!tailorData) return;

    const profileSelect   = document.getElementById('ct-tailor-profile-select');
    const baseProfileId   = profileSelect.value;
    const newProfileTitle = document.getElementById('ct-tailor-name-input').value.trim();

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
    tailorSdsPath      = sidecar.sds_path;
    tailorRuleChanges  = {};
    tailorValueChanges = {};

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
            .then(() => detectTailoringFiles())
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
            .then(() => detectTailoringFiles())
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
    cockpit.spawn(['rm', '-f', xmlPath, jsonPath], { superuser: 'require', err: 'message' })
        .then(() => {
            renderUserContentList();
            detectContent();
        })
        .catch(err => console.error('Failed to delete content file:', err.message || err));
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
        })
        .catch(err => {
            btn.disabled    = false;
            btn.textContent = '✗ Invalid';
            btn.className   = 'pf-v6-c-button pf-m-link ct-validate-fail';
            const detail = (err.message || String(err)).trim() || 'Validation failed with no output.';
            btn.addEventListener('click', () => showInfoModal('Validation Error: ' + entry.name, detail), { once: true });
        });
}

function showInfoModal(title, body) {
    document.getElementById('ct-info-title').textContent = title;
    document.getElementById('ct-info-body').textContent  = body;
    document.getElementById('ct-info-backdrop').classList.remove('hidden');
}
