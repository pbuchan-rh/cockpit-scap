'use strict';

/* ============================================================
   Container Scan — all logic contained here.
   Entry point: initContainerScan()
   Removal: delete this file + remove initContainerScan() call
            in index.js + remove panel-container-scan from HTML
            + remove Container Scan tab button from HTML
            + delete CSS block in style.css
   ============================================================ */

/* PY_PARSE_RESULTS is defined in index.js (shared global scope) */

let csProc           = null;
let csTimestamp   = null;
let csResultsDir  = null;
let csReportPath  = null;
let csBashPath    = null;
let csAnsiblePath = null;
let csCancelled   = false;
let csSdsPath     = null;
let csTailoringMap = {};
let csImageName      = null;
let csImageId        = null;
let csVersionBlocked = false;

function initContainerScan() {
    document.getElementById('cs-image-select')
        .addEventListener('change', onCsImageChange);
    document.getElementById('cs-content-select')
        .addEventListener('change', onCsContentChange);
    document.getElementById('cs-profile-select')
        .addEventListener('change', onCsProfileChange);
    document.getElementById('cs-tailor-file-select')
        .addEventListener('change', csUpdateScanBtn);
    document.getElementById('cs-scan-btn')
        .addEventListener('click', onCsScanClick);
    document.getElementById('cs-cancel-btn')
        .addEventListener('click', onCsCancelClick);
    document.getElementById('cs-view-report-btn')
        .addEventListener('click', () => viewReportFromPath(csReportPath));
    document.getElementById('cs-download-report-btn')
        .addEventListener('click', () => downloadArtifact(
            csReportPath,
            'container-report-' + csTimestamp + '.html',
            'text/html'));
    document.getElementById('cs-download-bash-btn')
        .addEventListener('click', () => downloadArtifact(
            csBashPath,
            'container-remediation-' + csTimestamp + '.sh',
            'text/x-shellscript'));
    document.getElementById('cs-download-ansible-btn')
        .addEventListener('click', () => downloadArtifact(
            csAnsiblePath,
            'container-remediation-' + csTimestamp + '.yml',
            'text/yaml'));
    document.getElementById('cs-new-scan-btn')
        .addEventListener('click', csShowSetup);
    document.getElementById('cs-scan-error-close')
        .addEventListener('click', csClearError);

    /* Check prereqs lazily — only on first tab visit to avoid
     * triggering the superuser prompt before the user navigates here. */
    let prereqChecked = false;
    document.getElementById('tab-btn-container-scan')
        .addEventListener('click', () => {
            if (prereqChecked) return;
            prereqChecked = true;
            csCheckPrereqs();
        });
}

/* ---- Prereq check ----------------------------------------- */

function csCheckPrereqs() {
    csShowPrereq('Checking prerequisites…', []);

    /* Three-step sequential check. Each step rejects with a tagged reason
     * so the catch block can show the right message. */
    cockpit.spawn(['which', 'oscap-podman'], { err: 'message' })
        .catch(() => Promise.reject({ step: 'oscap-podman' }))

        .then(() => cockpit.spawn(['podman', '--version'], { err: 'message' })
            .catch(() => Promise.reject({ step: 'podman' })))

        .then(() => cockpit.spawn(
            ['podman', 'images', '--format', 'json'],
            { superuser: 'require', err: 'message' })
            .catch(err => Promise.reject({ step: 'images', err })))

        .then(output => {
            let images = [];
            try { images = JSON.parse(output); } catch (e) {}

            if (!images.length) {
                csShowPrereq('No container images found', [
                    'Pull images into the system (root) Podman store:',
                    { code: 'sudo podman pull <image>' },
                    'Note: per-user (rootless) images cannot be accessed by oscap-podman. ' +
                    'See DESIGN.md for the full rationale.',
                ]);
                return;
            }

            csHidePrereq();
            csPopulateImages(images);
            csDetectContent();
            csDetectTailoringFiles();
            csLoadHistory();
        })

        .catch(reason => {
            if (!reason || !reason.step) {
                csShowPrereq('No container images found', [
                    'Pull images into the system (root) Podman store:',
                    { code: 'sudo podman pull <image>' },
                    'Note: per-user (rootless) images cannot be accessed by oscap-podman.',
                ]);
                return;
            }
            if (reason.step === 'oscap-podman') {
                csShowPrereq('oscap-podman not found', [
                    'Install openscap-utils to enable container scanning:',
                    { code: 'sudo dnf install openscap-utils' },
                ]);
            } else if (reason.step === 'podman') {
                csShowPrereq('Podman not installed', [
                    'Install Podman to enable container scanning:',
                    { code: 'sudo dnf install podman' },
                ]);
            } else {
                csShowPrereq('Failed to enumerate images', [
                    (reason.err && reason.err.message) || 'Unknown error',
                ]);
            }
        });
}

/* ---- Image enumeration ------------------------------------ */

function csPopulateImages(images) {
    const select = document.getElementById('cs-image-select');
    select.innerHTML = '';
    appendOption(select, '', 'Select an image…');

    images.forEach(img => {
        const tags = img.Names || img.RepoTags || [];
        const id   = (img.Id || img.ID || '').slice(0, 12);
        const name = tags.length ? tags[0] : id;

        const opt         = document.createElement('option');
        opt.value         = name;
        opt.dataset.id    = id;
        opt.textContent   = name + (name !== id ? ' (' + id + ')' : '');
        select.appendChild(opt);
    });
}

/* ---- Content / profile / tailoring detection -------------- */

function csDetectContent() {
    Promise.all([listSystemContent(), listUserContent()])
        .then(([sysFiles, userFiles]) => {
            const select = document.getElementById('cs-content-select');
            select.innerHTML = '';
            const total = sysFiles.length + userFiles.length;

            if (total === 0) {
                appendOption(select, '', 'No content found');
                return;
            }
            if (total === 1) {
                const item = sysFiles.length ? sysFiles[0] : userFiles[0];
                appendOption(select, item.path, item.name);
                select.value = item.path;
                csSdsPath = item.path;
                loadProfiles(item.path, 'cs-profile-select');
                csDetectTailoringFiles();
                return;
            }
            appendOption(select, '', 'Select content…');
            populateContentOptGroups(select, sysFiles, userFiles);
        });
}

function csDetectTailoringFiles() {
    csTailoringMap = {};
    const select = document.getElementById('cs-tailor-file-select');
    const group  = document.getElementById('cs-tailor-file-group');

    cockpit.spawn(['ls', TAILORING_BASE], { err: 'message' })
        .then(output => {
            const files = output.trim().split('\n').filter(f => f && f.endsWith('.json'));
            if (!files.length) { group.classList.add('hidden'); return; }

            return Promise.all(
                files.map(f =>
                    cockpit.file(TAILORING_BASE + f).read()
                        .then(c => JSON.parse(c)).catch(() => null)
                )
            ).then(sidecars => {
                const forScan = sidecars.filter(sc => sc && (!csSdsPath || sc.sds_path === csSdsPath));
                select.innerHTML = '';
                appendOption(select, '', '(No tailoring — use full profile)');

                forScan.forEach(sc => {
                    csTailoringMap[sc.path] = sc;
                    const created = sc.created
                        ? sc.created.slice(0, 10) + ' ' + sc.created.slice(11).replace(/-/g, ':')
                        : '';
                    appendOption(select, sc.path, sc.name + (created ? ' (' + created + ')' : ''));
                });
            });
        })
        .catch(() => {
            select.innerHTML = '';
            appendOption(select, '', '(No tailoring — use full profile)');
        });
}

/* ---- Form event handlers ---------------------------------- */

function csDetectImageVersion(imageName) {
    if (!imageName) return null;
    const m = imageName.match(/(?:ubi|rhel)[_-]?(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
}

function csCheckVersionMatch() {
    const imageVer = csDetectImageVersion(csImageName);
    const sdsVer   = csSdsPath ? detectSdsVersion(csSdsPath) : null;
    const warn     = document.getElementById('cs-version-warn');

    if (imageVer && sdsVer && imageVer !== sdsVer) {
        csVersionBlocked = true;
        document.getElementById('cs-version-warn-text').textContent =
            'The selected image appears to be RHEL ' + imageVer +
            ' but the selected content targets RHEL ' + sdsVer +
            '. Select the matching RHEL ' + imageVer + ' content to scan this image.';
        warn.classList.remove('hidden');
    } else {
        csVersionBlocked = false;
        warn.classList.add('hidden');
    }
    csUpdateScanBtn();
}

function onCsImageChange() {
    const select = document.getElementById('cs-image-select');
    csImageName = select.value || null;
    csImageId   = (select.options[select.selectedIndex] || {}).dataset.id || csImageName;
    csCheckVersionMatch();
    csUpdateScanBtn();
}

function onCsContentChange() {
    const sdsPath = document.getElementById('cs-content-select').value;
    csSdsPath = sdsPath || null;

    const profileSelect = document.getElementById('cs-profile-select');
    profileSelect.innerHTML = '';
    appendOption(profileSelect, '', 'Select content first');
    profileSelect.disabled = true;

    csHideProfileDesc();
    csTailoringMap = {};
    csCheckVersionMatch();
    csUpdateScanBtn();

    if (!sdsPath) { csDetectTailoringFiles(); return; }
    loadProfiles(sdsPath, 'cs-profile-select');
    csDetectTailoringFiles();
}

function onCsProfileChange() {
    const profileSelect = document.getElementById('cs-profile-select');
    const profileId     = profileSelect.value;

    csHideProfileDesc();
    csUpdateScanBtn();

    if (!profileId || !csSdsPath) return;

    const profileTitle = profileSelect.options[profileSelect.selectedIndex].text;
    cockpit.spawn(['oscap', 'info', '--profile', profileId, csSdsPath], { err: 'out' })
        .then(output => {
            const desc = parseProfileDescription(output);
            if (desc) csShowProfileDesc(profileTitle, desc);
        })
        .catch(() => {});
}

function csUpdateScanBtn() {
    const imageVal  = document.getElementById('cs-image-select').value;
    const profileId = document.getElementById('cs-profile-select').value;
    const tailoring = document.getElementById('cs-tailor-file-select').value;
    document.getElementById('cs-scan-btn').disabled =
        !imageVal || (!profileId && !tailoring) || csVersionBlocked;
}

/* ---- Scan execution --------------------------------------- */

function onCsScanClick() {
    if (csProc) return;

    const imageSelect   = document.getElementById('cs-image-select');
    const profileSelect = document.getElementById('cs-profile-select');
    const tailorSelect  = document.getElementById('cs-tailor-file-select');
    const tailoringPath = tailorSelect.value;

    csImageName = imageSelect.value;
    csImageId   = (imageSelect.options[imageSelect.selectedIndex] || {}).dataset.id || csImageName;

    let profileId, profileTitle;
    if (tailoringPath && csTailoringMap[tailoringPath]) {
        const sc     = csTailoringMap[tailoringPath];
        profileId    = sc.profile_id;
        profileTitle = sc.name;
    } else {
        profileId    = profileSelect.value;
        profileTitle = profileSelect.options[profileSelect.selectedIndex].text;
    }

    csTimestamp   = makeTimestamp();
    csResultsDir  = RESULTS_BASE + csTimestamp + '/';
    csReportPath  = csResultsDir + 'report.html';
    csBashPath    = csResultsDir + 'remediation.sh';
    csAnsiblePath = csResultsDir + 'remediation.yml';
    const resultsXmlPath = csResultsDir + 'results.xml';

    csClearError();
    csShowProgress();

    cockpit.spawn(['mkdir', '-p', csResultsDir], { superuser: 'require' })
        .then(() => {
            const args = ['oscap-podman', csImageName, 'xccdf', 'eval'];
            if (tailoringPath) args.push('--tailoring-file', tailoringPath);
            args.push(
                '--profile', profileId,
                '--report',  csReportPath,
                '--results', resultsXmlPath,
                csSdsPath
            );

            csProc = cockpit.spawn(args, { superuser: 'require', err: 'out' });
            csProc
                .then(() => csScanComplete(profileId, profileTitle, resultsXmlPath, tailoringPath))
                .catch(err => {
                    /* oscap exits 2 when scan ran but rules failed — normal */
                    if (err.exit_status === 2) {
                        csScanComplete(profileId, profileTitle, resultsXmlPath, tailoringPath);
                    } else if (csCancelled || err.problem === 'cancelled') {
                        csCancelled = false;
                        csProc = null;
                        csShowSetup();
                    } else {
                        csScanError(err.message || String(err));
                    }
                });
        })
        .catch(err => csScanError('Failed to create results directory: ' + (err.message || String(err))));
}

function onCsCancelClick() {
    if (csProc) {
        csCancelled = true;
        csProc.close('terminate');
    }
}

/* ---- Scan completion -------------------------------------- */

function csScanComplete(profileId, profileTitle, resultsXmlPath, tailoringPath) {
    csProc = null;

    cockpit.spawn(['python3', '-c', PY_PARSE_RESULTS, resultsXmlPath],
                  { superuser: 'require', err: 'out' })
        .then(output => {
            const parsed   = JSON.parse(output);
            const manifest = {
                timestamp:     csTimestamp,
                scan_type:     'container',
                image_name:    csImageName,
                image_id:      csImageId,
                sds_file:      csSdsPath,
                profile_id:    profileId,
                profile_title: profileTitle,
                result_id:     parsed.result_id,
                counts:        parsed.counts,
                score:         parsed.score,
            };
            return cockpit.file(csResultsDir + 'manifest.json', { superuser: 'require' })
                .replace(JSON.stringify(manifest, null, 2))
                .then(() => manifest);
        })
        .then(manifest => {
            const tailArgs = tailoringPath ? ['--tailoring-file', tailoringPath] : [];
            const genFix   = (type, out) => cockpit.spawn([
                'oscap', 'xccdf', 'generate', 'fix',
                ...tailArgs,
                '--fix-type', type,
                '--result-id', manifest.result_id,
                '--output', out,
                resultsXmlPath,
            ], { superuser: 'require', err: 'out' });

            return Promise.all([genFix('bash', csBashPath), genFix('ansible', csAnsiblePath)])
                .catch(err => {
                    console.error('Container remediation generation failed:', err.message || err);
                    csBashPath    = null;
                    csAnsiblePath = null;
                })
                .then(() => manifest);
        })
        .then(manifest => {
            return cockpit.spawn(['chmod', '755', csResultsDir], { superuser: 'require' })
                .then(() => cockpit.spawn(
                    ['find', csResultsDir, '-maxdepth', '1', '-type', 'f', '-exec', 'chmod', '644', '{}', '+'],
                    { superuser: 'require' }
                ))
                .catch(err => console.error('chmod failed:', err.message || err))
                .then(() => manifest);
        })
        .then(manifest => csShowResults(manifest))
        .catch(err => csScanError('Failed to process results: ' + (err.message || String(err))));
}

/* ---- Results display -------------------------------------- */

function csShowResults(manifest) {
    const { counts, score, profile_title, image_name } = manifest;

    document.getElementById('cs-results-profile-title').textContent =
        profile_title + ' — ' + (image_name || 'container');

    const badges = document.getElementById('cs-result-badges');
    badges.innerHTML = '';
    [
        ['Pass',           counts.pass,           'ct-badge-pass'],
        ['Fail',           counts.fail,           'ct-badge-fail'],
        ['Error',          counts.error,          'ct-badge-error'],
        ['Not checked',    counts.notchecked,     'ct-badge-neutral'],
        ['Not applicable', counts.notapplicable,  'ct-badge-neutral'],
    ].forEach(([label, count, cls]) => {
        const span       = document.createElement('span');
        span.className   = 'ct-result-badge ' + cls;
        span.textContent = label + ': ' + count;
        badges.appendChild(span);
    });

    document.getElementById('cs-result-score').textContent = score.toFixed(1) + '%';

    const remFailed = !csBashPath;
    document.getElementById('cs-download-bash-btn').disabled    = remFailed;
    document.getElementById('cs-download-ansible-btn').disabled = remFailed;
    document.getElementById('cs-download-bash-btn').title    = remFailed ? 'Remediation generation failed' : '';
    document.getElementById('cs-download-ansible-btn').title = remFailed ? 'Remediation generation failed' : '';

    document.getElementById('cs-progress').classList.add('hidden');
    document.getElementById('cs-results').classList.remove('hidden');
    csLoadHistory();
}

/* ---- History ---------------------------------------------- */

function csLoadHistory() {
    cockpit.spawn(['ls', RESULTS_BASE], { err: 'message' })
        .then(output => {
            const dirs = output.trim().split('\n')
                .filter(d => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(d));
            if (!dirs.length) { csRenderHistory([]); return; }

            return Promise.all(
                dirs.map(dir =>
                    cockpit.file(RESULTS_BASE + dir + '/manifest.json').read()
                        .then(content => {
                            const m = JSON.parse(content);
                            return (m && m.scan_type === 'container') ? m : null;
                        })
                        .catch(() => null)
                )
            ).then(manifests => {
                const valid = manifests.filter(Boolean);
                valid.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
                csRenderHistory(valid);
            });
        })
        .catch(() => csRenderHistory([]));
}

function csRenderHistory(manifests) {
    const empty = document.getElementById('cs-history-empty');
    const table = document.getElementById('cs-history-table');
    const tbody = document.getElementById('cs-history-tbody');

    if (!manifests.length) {
        empty.classList.remove('hidden');
        table.classList.add('hidden');
        return;
    }

    tbody.innerHTML = '';
    manifests.forEach(m => tbody.appendChild(csBuildHistoryRow(m)));
    empty.classList.add('hidden');
    table.classList.remove('hidden');
}

function csShortImageName(imageName) {
    if (!imageName) return 'container';
    return imageName
        .replace(/^registry\.access\.redhat\.com\//, '')
        .replace(/^docker\.io\//, '')
        .replace(/^quay\.io\//, '');
}

function csSdsLabel(sdsFile) {
    if (!sdsFile) return '—';
    const ver = detectSdsVersion(sdsFile);
    if (ver) return 'RHEL ' + ver;
    const fname = sdsFile.split('/').pop();
    return sdsDisplayName(fname);
}

function csBuildHistoryRow(manifest) {
    const dir = RESULTS_BASE + manifest.timestamp + '/';
    const tr  = document.createElement('tr');

    const date = manifest.timestamp
        .replace('T', ' ')
        .replace(/-(\d{2})-(\d{2})$/, ':$1:$2');

    [
        date,
        csShortImageName(manifest.image_name || manifest.image_id),
        csSdsLabel(manifest.sds_file),
        manifest.profile_title,
        String(manifest.counts.pass),
        String(manifest.counts.fail),
        (manifest.score || 0).toFixed(1) + '%',
    ].forEach((text, i) => {
        const td = document.createElement('td');
        if (i === 3 && text.length > 36) {
            td.textContent = text.slice(0, 36) + '…';
            td.title       = text;
        } else {
            td.textContent = text;
        }
        tr.appendChild(td);
    });

    const actionsTd = document.createElement('td');
    actionsTd.className = 'ct-history-actions';

    [
        ['View Report', () => viewReportFromPath(dir + 'report.html')],
        ['Bash',        () => downloadArtifact(
            dir + 'remediation.sh',
            'container-remediation-' + manifest.timestamp + '.sh',
            'text/x-shellscript')],
        ['Ansible',     () => downloadArtifact(
            dir + 'remediation.yml',
            'container-remediation-' + manifest.timestamp + '.yml',
            'text/yaml')],
    ].forEach(([label, handler]) => {
        const btn       = document.createElement('button');
        btn.className   = 'pf-v6-c-button pf-m-link';
        btn.type        = 'button';
        btn.textContent = label;
        btn.addEventListener('click', handler);
        actionsTd.appendChild(btn);
    });

    const delBtn       = document.createElement('button');
    delBtn.className   = 'pf-v6-c-button pf-m-link ct-btn-danger-link';
    delBtn.type        = 'button';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
        showConfirmModal(
            'Delete Container Scan',
            'Delete the scan from ' + date + '? All artifacts will be permanently removed.',
            () => cockpit.spawn(['rm', '-rf', RESULTS_BASE + manifest.timestamp], { superuser: 'require' })
                .then(() => csLoadHistory())
                .catch(err => console.error('Failed to delete scan:', err.message || err))
        );
    });
    actionsTd.appendChild(delBtn);
    tr.appendChild(actionsTd);
    return tr;
}

/* ---- UI state helpers ------------------------------------- */

function csShowPrereq(title, bodyItems) {
    document.getElementById('cs-prereq-title').textContent = title;
    const bodyEl = document.getElementById('cs-prereq-body');
    bodyEl.innerHTML = '';
    bodyItems.forEach(item => {
        if (typeof item === 'string') {
            const p = document.createElement('p');
            p.textContent = item;
            bodyEl.appendChild(p);
        } else if (item.code) {
            const pre = document.createElement('pre');
            pre.className   = 'cs-prereq-cmd';
            pre.textContent = item.code;
            bodyEl.appendChild(pre);
        }
    });
    document.getElementById('cs-prereq-card').classList.remove('hidden');
    document.getElementById('cs-scan-section').classList.add('hidden');
}

function csHidePrereq() {
    document.getElementById('cs-prereq-card').classList.add('hidden');
    document.getElementById('cs-scan-section').classList.remove('hidden');
}

function csShowProgress() {
    document.getElementById('cs-scan-row').classList.add('hidden');
    document.getElementById('cs-progress').classList.remove('hidden');
    document.getElementById('cs-results').classList.add('hidden');
}

function csShowSetup() {
    document.getElementById('cs-scan-row').classList.remove('hidden');
    document.getElementById('cs-progress').classList.add('hidden');
    document.getElementById('cs-results').classList.add('hidden');
    csProc        = null;
    csBashPath    = null;
    csAnsiblePath = null;
}

function csScanError(msg) {
    csProc = null;
    csShowSetup();
    document.getElementById('cs-scan-error-message').textContent = msg;
    document.getElementById('cs-scan-error-alert').classList.remove('hidden');
}

function csClearError() {
    document.getElementById('cs-scan-error-alert').classList.add('hidden');
}

function csShowProfileDesc(title, desc) {
    document.getElementById('cs-profile-desc-title').textContent = title;
    document.getElementById('cs-profile-desc-placeholder').classList.add('hidden');
    const el       = document.getElementById('cs-profile-description');
    el.textContent = desc;
    el.classList.remove('hidden');
}

function csHideProfileDesc() {
    document.getElementById('cs-profile-desc-title').textContent = 'Profile';
    document.getElementById('cs-profile-desc-placeholder').classList.remove('hidden');
    const el = document.getElementById('cs-profile-description');
    el.classList.add('hidden');
    el.textContent = '';
}
