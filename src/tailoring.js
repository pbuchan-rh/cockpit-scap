'use strict';

/* ---- Tailoring guide button -------------------------------- */

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
                    cockpit.file(TAILORING_BASE + f, { superuser: 'try' }).read()
                        .then(content => JSON.parse(content))
                        .catch(() => null)
                )
            ).then(sidecars => {
                if (gen !== tailoringFilesGen) return;

                const all   = sidecars.filter(Boolean);
                allTailoringSidecars = all;
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
                        cockpit.file(sc.path, { superuser: 'try' }).read()
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
    syncTailorHighlight();
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
    nameInput.value      = '';
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
    document.getElementById('ct-tailor-rules-body').classList.add('hidden');
    document.getElementById('ct-tailor-rules-collapse').textContent = 'Expand';
    renderTailorTree(data);
    renderTailorValues(data.values || []);
    const statusEl = document.getElementById('ct-tailor-save-status');
    statusEl.textContent = '';
    statusEl.className   = 'ct-tailor-save-status hidden';
    document.getElementById('ct-tailor-editor').classList.remove('hidden');
    syncTailorHighlight();
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

    const totalRules = flattenTailorRules().length;
    const rulesCountEl = document.getElementById('ct-tailor-rules-count');
    if (rulesCountEl) rulesCountEl.textContent = totalRules + ' rules';

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
    const countSpan = document.getElementById('ct-tailor-values-count');
    if (countSpan) countSpan.textContent = values.length + ' variable' + (values.length !== 1 ? 's' : '');
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
        const rulesCountReset = document.getElementById('ct-tailor-rules-count');
        if (rulesCountReset) rulesCountReset.classList.remove('ct-tailor-group-count-modified');
        const valCountSpanReset = document.getElementById('ct-tailor-values-count');
        if (valCountSpanReset && tailorData && tailorData.values) {
            const n = tailorData.values.length;
            valCountSpanReset.textContent = n + ' variable' + (n !== 1 ? 's' : '');
            valCountSpanReset.classList.remove('ct-tailor-group-count-modified');
        }
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

    const rulesCountEl2 = document.getElementById('ct-tailor-rules-count');
    if (rulesCountEl2 && tailorData) {
        const n = flattenTailorRules().length;
        rulesCountEl2.textContent = n + ' rules' + (ruleCount > 0 ? ' · ' + ruleCount + ' modified' : '');
        rulesCountEl2.classList.toggle('ct-tailor-group-count-modified', ruleCount > 0);
    }

    const valCountSpan = document.getElementById('ct-tailor-values-count');
    if (valCountSpan && tailorData && tailorData.values) {
        const total = tailorData.values.length;
        valCountSpan.textContent = total + ' variable' + (total !== 1 ? 's' : '') +
            (valueCount > 0 ? ' · ' + valueCount + ' modified' : '');
        valCountSpan.classList.toggle('ct-tailor-group-count-modified', valueCount > 0);
    }

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

    const noVarsEl = document.getElementById('ct-tailor-sum-no-vars');
    if (valueCount > 0) {
        if (noVarsEl) noVarsEl.classList.add('hidden');
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
        valuesEl.innerHTML = '';
        if (noVarsEl) noVarsEl.classList.remove('hidden');
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
        tailorEditingSidecar = updatedSidecar;
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
        .then(() => cockpit.file(xmlPath, { superuser: 'try' }).read())
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
            tailorEditingSidecar = sidecar;
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

function syncTailorHighlight() {
    const visible    = !document.getElementById('ct-tailor-editor').classList.contains('hidden');
    const activePath = tailorEditingSidecar && tailorEditingSidecar.path;
    document.querySelectorAll('#ct-tailor-list-tbody tr').forEach(r => {
        r.classList.toggle('ct-row-active', visible && !!activePath && r.dataset.path === activePath);
    });
}

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
        tr.dataset.path = sc.path;

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
    syncTailorHighlight();
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
    tailorSdsPath        = sidecar.sds_path;
    tailorRuleChanges    = {};
    tailorValueChanges   = {};
    tailorEditingSidecar = sidecar;
    syncTailorHighlight();

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
    cockpit.file(sidecar.path, { superuser: 'try' }).read()
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
