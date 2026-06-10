'use strict';

/* ---- Scan execution ----------------------------------------- */

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
    let _rulePass = 0, _ruleFail = 0, _ruleError = 0;
    const _recent = [];
    const passEl   = document.getElementById('ct-live-pass');
    const failEl   = document.getElementById('ct-live-fail');
    const errorEl  = document.getElementById('ct-live-error');
    const listEl   = document.getElementById('ct-rule-feed-list');
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
            if (result === 'pass' || result === 'fixed') _rulePass++;
            else if (result === 'fail') _ruleFail++;
            else if (result === 'error') _ruleError++;
            const name = ruleId.replace(/^.*content_rule_/, '').replace(/_/g, ' ');
            _recent.unshift({ name, result });
            if (_recent.length > 5) _recent.pop();
            passEl.textContent  = _rulePass;
            failEl.textContent  = _ruleFail;
            errorEl.textContent = _ruleError;
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
                sds_version:          currentSdsVersion || null,
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
            // chmod results.xml before showResults so unprivileged Python spawns can read it
            // (CIS umask 027 creates it as 640; relaxResultsPerms runs later for everything else)
            cockpit.spawn(['chmod', '644', resultsXmlPath, currentResultsDir + 'manifest.json'],
                  { superuser: 'require' })
                .catch(() => {})
                .finally(() => { showResults(manifest); });
            // Remediation generation, pruning, and perms run in the background so results
            // display immediately after the scan — not after 7-8 min of oscap generate fix.
            remediationGenerating = true;
            updateApplyGate1Btn();
            const remDir = currentResultsDir;
            generateRemediation(manifest.result_id, resultsXmlPath, tailoringPath)
                .then(() => cockpit.spawn(
                    ['find', remDir, '-maxdepth', '1', '-name', 'remediation.*',
                     '-exec', 'chmod', '644', '{}', '+'],
                    { superuser: 'require' }
                ).catch(() => {}))
                .catch(err => {
                    console.error('Remediation generation failed:', err.message || err);
                    currentRemBashPath    = null;
                    currentRemAnsiblePath = null;
                })
                .finally(() => {
                    remediationGenerating = false;
                    updateApplyGate1Btn();
                    refreshActionBoardAutomatable();
                    if (currentRemBashPath && currentResultsDir === remDir)
                        renderFailingSummary(remDir + 'results.xml',
                            'ct-failing-summary-groups', 'ct-failing-summary-loading',
                            currentRemBashPath, 'ct-failing-search');
                });
            pruneHistoryByType('host').catch(() => {});
            cockpit.spawn(['gzip', currentResultsDir + 'results.arf'], { superuser: 'require' })
                .catch(() => {})
                .finally(() => relaxResultsPerms().catch(() => {}));
        })
        .catch(err => onScanError('Failed to process results: ' + (err.message || String(err))));
}

/* ---- Persistence cache ------------------------------------- */

function buildPersistenceCache(manifest) {
    return cockpit.spawn(['ls', RESULTS_BASE], { err: 'message' })
        .then(output => {
            const dirs = output.trim().split('\n').filter(d => TIMESTAMP_RE.test(d));
            return Promise.all(
                dirs.map(dir =>
                    cockpit.file(RESULTS_BASE + dir + '/manifest.json', { superuser: 'try' }).read()
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
                        return cockpit.file(PERSISTENCE_CACHE_PATH, { superuser: 'try' }).read()
                            .then(existing => {
                                const cache = JSON.parse(existing || '{}');
                                const key   = manifest.profile_id + '::' + manifest.sds_file;
                                cache[key]  = { updated: manifest.timestamp, failures };
                                return cockpit.file(PERSISTENCE_CACHE_PATH, { superuser: 'require' })
                                    .replace(JSON.stringify(cache));
                            });
                    });
            });
        })
        .catch(err => console.error('buildPersistenceCache:', err.message || err));
}

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;

function pruneHistoryByType(scanType) {
    return cockpit.spawn(['ls', RESULTS_BASE], { err: 'message' })
        .then(output => {
            const dirs = output.trim().split('\n')
                .filter(d => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(d));
            if (!dirs.length) return;

            return Promise.all(
                dirs.map(dir =>
                    cockpit.file(RESULTS_BASE + dir + '/manifest.json', { superuser: 'try' }).read()
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
    cockpit.spawn(spawnArgs, { err: 'message', superuser: 'try' })
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

/* ---- History load / restore -------------------------------- */

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
    syncHostHistoryHighlight();
    document.getElementById('ct-results').scrollIntoView({ behavior: 'smooth' });
}

function generateScanId() {
    return 'scan-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
}

/* ---- Results rendering ------------------------------------- */

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
    const verEl = document.getElementById('ct-results-version');
    if (manifest.sds_version) {
        verEl.textContent = 'SSG ' + manifest.sds_version;
        verEl.classList.remove('hidden');
    } else {
        verEl.classList.add('hidden');
    }

    const breakdownEl = document.getElementById('ct-result-badges');
    breakdownEl.innerHTML = '';
    const passSpan = document.createElement('span');
    passSpan.className = 'ct-bd-pass';
    passSpan.textContent = counts.pass + ' passed';
    const failSpan = document.createElement('span');
    failSpan.className = 'ct-bd-fail';
    failSpan.textContent = counts.fail + ' failed';
    breakdownEl.appendChild(passSpan);
    breakdownEl.appendChild(document.createTextNode(' · '));
    breakdownEl.appendChild(failSpan);
    if ((counts.error || 0) > 0)
        breakdownEl.appendChild(document.createTextNode(' · ' + counts.error + ' error' + (counts.error === 1 ? '' : 's')));
    if ((counts.notapplicable || 0) > 0)
        breakdownEl.appendChild(document.createTextNode(' · ' + counts.notapplicable + ' n/a'));
    if ((counts.notchecked || 0) > 0)
        breakdownEl.appendChild(document.createTextNode(' · ' + counts.notchecked + ' not checked'));
    breakdownEl.classList.remove('hidden');

    const arfBtn = document.getElementById('ct-download-arf-btn');
    arfBtn.disabled = !manifest.has_arf;
    if (!manifest.has_arf) arfBtn.title = 'ARF not available — rescan to generate';

    const scoreEl   = document.getElementById('ct-result-score');
    const threshold = manifest.compliance_threshold != null ? manifest.compliance_threshold : 100;
    scoreEl.innerHTML = '';
    const scoreTier = score >= threshold ? 'ct-score-box-high'
                    : score >= threshold - 10 ? 'ct-score-box-warn'
                    : 'ct-score-box-low';
    const box = document.createElement('div');
    box.className = 'ct-score-box ' + scoreTier;
    const numSpan = document.createElement('span');
    numSpan.className = 'ct-score-box-num';
    numSpan.textContent = score.toFixed(1) + '%';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'ct-score-box-label';
    labelSpan.textContent = 'Compliance Score';
    box.appendChild(numSpan);
    box.appendChild(labelSpan);
    scoreEl.appendChild(box);

    const targetEl = document.getElementById('ct-results-target');
    const above = score >= threshold;
    targetEl.textContent = (above ? '✓ Above' : '✗ Below') + ' policy target (' + threshold + '%)';
    targetEl.className = 'ct-results-target ' + (above ? 'ct-score-above' : 'ct-score-below');

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
                         remediationGenerating ? null : currentRemBashPath,
                         'ct-failing-search');

    /* Action Board — show severity counts immediately, load automatable count async */
    eagerRemRules = null;
    const sev = manifest.severity_counts || {};
    updateActionBoard(sev, counts.fail, null);
    const eagerArgs = [currentResultsDir + 'results.xml'];
    if (currentRemBashPath) eagerArgs.push(currentRemBashPath);
    cockpit.spawn(['python3', '-c', PY_EXTRACT_FAILING_RULES, ...eagerArgs], { err: 'message', superuser: 'try' })
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
}

/* ---- Report viewer ----------------------------------------- */

function viewReport() {
    viewReportFromPath(currentResultsDir + 'results.xml');
}

function generateReport(resultsXmlPath) {
    const tmpPath = '/tmp/cockpit-scap-report-' + Date.now() + '.html';
    return cockpit.spawn(
        ['oscap', 'xccdf', 'generate', 'report', '--output', tmpPath, resultsXmlPath],
        { err: 'out', superuser: 'try' }
    ).then(() => cockpit.file(tmpPath, { superuser: 'try' }).read())
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
    document.getElementById('ct-live-pass').textContent  = '0';
    document.getElementById('ct-live-fail').textContent  = '0';
    document.getElementById('ct-live-error').textContent = '0';
    document.getElementById('ct-rule-feed-list').innerHTML =
        '<div class="ct-rule-feed-item ct-rule-feed-waiting">' +
        '<span class="ct-rule-feed-name">Waiting for first rule…</span></div>';
    const _sdsEl    = document.getElementById('ct-content-select');
    const _profEl   = document.getElementById('ct-profile-select');
    const _tailEl   = document.getElementById('ct-tailor-file-select');
    document.getElementById('ct-scan-ctx-content').textContent =
        _sdsEl.options[_sdsEl.selectedIndex]?.text || '—';
    document.getElementById('ct-scan-ctx-profile').textContent =
        _profEl.options[_profEl.selectedIndex]?.text || '—';
    document.getElementById('ct-scan-ctx-policy').textContent =
        _tailEl.value ? (_tailEl.options[_tailEl.selectedIndex]?.text || '—') : '—';
    document.getElementById('ct-scan-ctx-target').textContent = hostName || 'Local host';
    document.getElementById('ct-scan-ctx-version').textContent = '…';
    currentSdsVersion = null;
    if (currentSdsPath) {
        cockpit.spawn(['python3', '-c', PY_SDS_VERSION, currentSdsPath], { err: 'ignore' })
            .then(out => {
                currentSdsVersion = (out.trim().split(' ')[1]) || null;
                document.getElementById('ct-scan-ctx-version').textContent = currentSdsVersion || '—';
            })
            .catch(() => { document.getElementById('ct-scan-ctx-version').textContent = '—'; });
    } else {
        document.getElementById('ct-scan-ctx-version').textContent = '—';
    }
    const _tailVal   = _tailEl.value;
    const _profileId = (_tailVal && tailoringFilesMap[_tailVal])
        ? tailoringFilesMap[_tailVal].profile_id
        : (document.getElementById('ct-profile-select') || {}).value || null;
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
    syncHostHistoryHighlight();
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
                    cockpit.file(RESULTS_BASE + dir + '/manifest.json', { superuser: 'try' }).read()
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
    syncHostHistoryHighlight();
}

function syncHostHistoryHighlight() {
    const visible = !document.getElementById('ct-results').classList.contains('hidden');
    document.querySelectorAll('#ct-history-tbody tr').forEach(r => {
        r.classList.toggle('ct-row-active', visible && r.dataset.timestamp === currentTimestamp);
    });
}

function buildHistoryRow(manifest) {
    const dir = RESULTS_BASE + manifest.timestamp + '/';
    const tr  = document.createElement('tr');
    tr.dataset.timestamp = manifest.timestamp;

    const date = manifest.timestamp
        .replace('T', ' ')
        .replace(/-(\d{2})-(\d{2})$/, ':$1:$2');

    const isUploaded = manifest.sds_file && manifest.sds_file.startsWith(CONTENT_BASE);

    const prev      = findPreviousScan(manifest, currentHostHistory);
    const score     = manifest.score || 0;
    const scoreText = score.toFixed(1) + '%';
    const threshold = manifest.compliance_threshold != null ? manifest.compliance_threshold : 100;
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
    rerunBtn.textContent = 'Load Config';
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

/* ---- History CSV export ------------------------------------ */

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
