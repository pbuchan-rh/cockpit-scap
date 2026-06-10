'use strict';

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

    if (!inPlaceRemEnabled)
        document.getElementById('ct-rem-apply-btn').disabled = true;
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
                        const orphaned = allTailoringSidecars.filter(sc => sc.sds_path === e.xmlPath);
                        const body = orphaned.length > 0
                            ? 'Delete "' + e.name + '"? The following saved policies reference this content and will no longer load:\n\n' +
                              orphaned.map(sc => '• ' + sc.name).join('\n') +
                              '\n\nThis cannot be undone.'
                            : 'Delete "' + e.name + '"? This cannot be undone.';
                        showConfirmModal('Delete content file', body, () => deleteUserContent(e.xmlPath, e.jsonPath));
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
            .then(() => cockpit.spawn(['chmod', '644', destPath], { superuser: 'require' }))
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
            if (typeof s.tailoring_enabled === 'boolean')
                tailoringEnabled = s.tailoring_enabled;
            if (typeof s.host_scan_tab_enabled === 'boolean')
                hostScanTabEnabled = s.host_scan_tab_enabled;
            if (typeof s.in_place_remediation_enabled === 'boolean')
                inPlaceRemEnabled = s.in_place_remediation_enabled;
        })
        .catch(() => {})
        .then(() => { applyTabVisibility(); applyRemediationState(); });
}

function applyTabVisibility() {
    document.getElementById('tab-btn-scan').closest('li')
        .classList.toggle('hidden', !hostScanTabEnabled);
    document.getElementById('tab-btn-container-scan').closest('li')
        .classList.toggle('hidden', !containerScanEnabled);
    document.getElementById('tab-btn-tailoring').closest('li')
        .classList.toggle('hidden', !tailoringEnabled);

    const hActive = document.getElementById('tab-btn-scan').getAttribute('aria-selected') === 'true';
    const cActive = document.getElementById('tab-btn-container-scan').getAttribute('aria-selected') === 'true';
    const tActive = document.getElementById('tab-btn-tailoring').getAttribute('aria-selected') === 'true';
    if (!hostScanTabEnabled && hActive)
        document.getElementById('tab-btn-settings').click();
    else if ((!containerScanEnabled && cActive) || (!tailoringEnabled && tActive))
        document.getElementById('tab-btn-scan').click();
}

function applyRemediationState() {
    document.getElementById('ct-rem-apply-btn').disabled = !inPlaceRemEnabled;
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
    document.getElementById('ct-setting-host-scan-tab-enabled').checked  = hostScanTabEnabled;
    document.getElementById('ct-setting-container-enabled').checked     = containerScanEnabled;
    document.getElementById('ct-setting-tailoring-enabled').checked     = tailoringEnabled;
    document.getElementById('ct-setting-in-place-rem-enabled').checked  = inPlaceRemEnabled;
    document.getElementById('ct-settings-warn').classList.add('hidden');
    document.getElementById('ct-settings-saved').classList.add('hidden');
    document.getElementById('ct-settings-save-error').classList.add('hidden');
    fetchDiskUsage();
    renderContentTab();
    detectContent();
}


function fetchDiskUsage() {
    const freeEl = document.getElementById('ct-settings-disk-free');
    const dirs = [
        [RESULTS_BASE, 'ct-settings-disk-results'],
        [CONTENT_BASE, 'ct-settings-disk-content'],
    ];
    dirs.forEach(([path, id]) => {
        const el = document.getElementById(id);
        el.textContent = '…';
        cockpit.spawn(['du', '-sh', path], { err: 'message', superuser: 'try' })
            .then(out => { el.textContent = out.split('\t')[0].trim(); })
            .catch(() => { el.textContent = '—'; });
    });
    freeEl.textContent = '…';
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
            appendActivityLog({ type: 'policy_clear', tab: 'settings' });
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

    const hsVal = document.getElementById('ct-setting-host-scan-tab-enabled').checked;
    const ceVal = document.getElementById('ct-setting-container-enabled').checked;
    const teVal = document.getElementById('ct-setting-tailoring-enabled').checked;
    const irVal = document.getElementById('ct-setting-in-place-rem-enabled').checked;

    const prevHost      = hostRetention;
    const prevContainer = containerRetention;
    const prevHs        = hostScanTabEnabled;
    const prevCe        = containerScanEnabled;
    const prevTe        = tailoringEnabled;
    const prevIr        = inPlaceRemEnabled;

    const newSettings = JSON.stringify({
        host_retention:              hVal,
        container_retention:         cVal,
        host_scan_tab_enabled:       hsVal,
        container_scan_enabled:      ceVal,
        tailoring_enabled:           teVal,
        in_place_remediation_enabled: irVal,
    }, null, 2);

    cockpit.file(SETTINGS_PATH, { superuser: 'require' })
        .replace(newSettings)
        .then(() => cockpit.spawn(['chmod', '644', SETTINGS_PATH], { superuser: 'require' }))
        .then(() => {
            hostRetention        = hVal;
            containerRetention   = cVal;
            hostScanTabEnabled   = hsVal;
            containerScanEnabled = ceVal;
            tailoringEnabled     = teVal;
            inPlaceRemEnabled    = irVal;
            applyTabVisibility();
            applyRemediationState();
            return Promise.all([
                pruneHistoryByType('host'),
                pruneHistoryByType('container'),
            ]);
        })
        .then(() => {
            const parts = [];
            if (hVal  !== prevHost)      parts.push('host retention: ' + prevHost + ' → ' + hVal);
            if (cVal  !== prevContainer) parts.push('container retention: ' + prevContainer + ' → ' + cVal);
            if (hsVal !== prevHs)        parts.push('host scan tab: ' + (hsVal ? 'enabled' : 'disabled'));
            if (ceVal !== prevCe)        parts.push('container scan: ' + (ceVal ? 'enabled' : 'disabled'));
            if (teVal !== prevTe)        parts.push('policy tailoring: ' + (teVal ? 'enabled' : 'disabled'));
            if (irVal !== prevIr)        parts.push('in-place remediation: ' + (irVal ? 'enabled' : 'disabled'));
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

/* ---- Content validation ------------------------------------ */

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
