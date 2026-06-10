'use strict';

/* ---- Remediation panel state -------------------------------- */

let pendingApplyRules  = [];
let pendingApplyTitles = [];

/* ---- Drawer helpers ----------------------------------------- */

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

/* ---- Action board ------------------------------------------- */

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
                  currentResultsDir + 'results.xml', currentRemBashPath], { err: 'message', superuser: 'try' })
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

/* ---- Remediation generation --------------------------------- */

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

/* ---- Selective remediation panel ---------------------------- */

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
    cockpit.file(resultsDir + 'manifest.json', { superuser: 'try' }).read()
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
                  { err: 'message', superuser: 'try' })
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
    document.getElementById('ct-rem-apply-btn').disabled   = disabled || !inPlaceRemEnabled;
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
    })
    .catch(err => console.error('Selective remediation failed:', err.message || err));
}

/* ---- Apply gates -------------------------------------------- */

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
        { err: 'message', superuser: 'require' }
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
    const drawerBody = areaEl.closest('.pf-v6-c-card__body');
    if (drawerBody) {
        const offset = areaEl.getBoundingClientRect().top - drawerBody.getBoundingClientRect().top;
        drawerBody.scrollBy({ top: offset, behavior: 'smooth' });
    }

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
                const dlBtn = document.getElementById('ct-apply-download-log');
                if (dlBtn) dlBtn.dataset.logPath = logFile;
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
                        rules_applied: pendingApplyRules.length, rule_ids: pendingApplyRules.slice(),
                        exit_code: 0, log_path: logFile });
                    cockpit.spawn(['rm', '-f', applyPath], { superuser: 'require' }).catch(() => {});
                })
                .catch(err => {
                    const code = err.exit_status || '?';
                    titleEl.textContent = 'Remediation finished';
                    exitEl.textContent  = code;
                    errEl.classList.remove('hidden');
                    persistLog(code);
                    appendActivityLog({ type: 'remediate_apply', tab: 'host',
                        rules_applied: pendingApplyRules.length, rule_ids: pendingApplyRules.slice(),
                        exit_code: code, log_path: logFile });
                    cockpit.spawn(['rm', '-f', applyPath], { superuser: 'require' }).catch(() => {});
                })
        )
        .catch(err => {
            titleEl.textContent = 'Failed to write script';
            outputEl.textContent = err.message || String(err);
            errEl.classList.remove('hidden');
        });
}

/* ---- Profile remediation download --------------------------- */

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

/* ---- HTML escaping ------------------------------------------ */

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
