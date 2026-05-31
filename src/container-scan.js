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
let currentCsHistory = [];
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
let csRemDir       = null;
let csRemRules     = [];
let csCurrentManifest = null;

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
    document.getElementById('cs-guide-btn')
        .addEventListener('click', onCsViewGuideClick);
    document.getElementById('cs-export-csv-btn')
        .addEventListener('click', exportCsHistoryCSV);
    document.getElementById('cs-cancel-btn')
        .addEventListener('click', onCsCancelClick);
    document.getElementById('cs-view-report-btn')
        .addEventListener('click', () => viewReportFromPath(csReportPath));
    document.getElementById('cs-download-report-btn')
        .addEventListener('click', () => downloadArtifact(
            csReportPath,
            'container-report-' + csTimestamp + '.html',
            'text/html'));
    document.getElementById('cs-download-xml-btn')
        .addEventListener('click', () => downloadArtifact(
            csResultsDir + 'results.xml',
            'container-results-' + csTimestamp + '.xml',
            'application/xml'
        ));
    document.getElementById('cs-selective-rem-btn')
        .addEventListener('click', () => openCsRemPanel(csResultsDir));
    document.getElementById('cs-rem-close-btn')
        .addEventListener('click', () => {
            document.getElementById('cs-remediation-panel').classList.add('hidden');
        });
    document.getElementById('cs-rem-bash-btn')
        .addEventListener('click', () => generateCsSelectiveFix('bash'));
    document.getElementById('cs-rem-ansible-btn')
        .addEventListener('click', () => generateCsSelectiveFix('ansible'));
    document.getElementById('cs-rem-select-all-btn')
        .addEventListener('click', () => {
            document.querySelectorAll('#cs-remediation-rules .ct-rem-checkbox').forEach(c => { c.checked = true; });
            updateCsRemCount();
        });
    document.getElementById('cs-rem-deselect-all-btn')
        .addEventListener('click', () => {
            document.querySelectorAll('#cs-remediation-rules .ct-rem-checkbox').forEach(c => { c.checked = false; });
            updateCsRemCount();
        });
    document.getElementById('cs-new-scan-btn')
        .addEventListener('click', () => {
            if (csCurrentManifest) csRerunScan(csCurrentManifest);
            else csShowSetup();
        });
    document.getElementById('cs-results-close-btn')
        .addEventListener('click', csShowSetup);
    document.getElementById('cs-scan-error-close')
        .addEventListener('click', csClearError);

    /* Run the two non-superuser checks eagerly on init in parallel.
     * The superuser podman images check is deferred until first tab click
     * to avoid a privilege prompt before the user navigates here. */
    const csPrereqEager = Promise.all([
        cockpit.spawn(['which', 'oscap-podman'], { err: 'message' })
            .then(() => null)
            .catch(() => ({ step: 'oscap-podman' })),
        cockpit.spawn(['podman', '--version'], { err: 'message' })
            .then(() => null)
            .catch(() => ({ step: 'podman' })),
    ]);

    let prereqChecked = false;
    document.getElementById('tab-btn-container-scan')
        .addEventListener('click', () => {
            if (prereqChecked) return;
            prereqChecked = true;
            csPrereqEager.then(([oscapErr, podmanErr]) => {
                if (oscapErr) { csCheckPrereqFail(oscapErr.step); return; }
                if (podmanErr) { csCheckPrereqFail(podmanErr.step); return; }
                csCheckImages();
            });
        });
}

/* ---- Prereq check ----------------------------------------- */

function csCheckImages() {
    csShowPrereq('Checking prerequisites…', []);

    cockpit.spawn(
            ['podman', 'images', '--format', 'json'],
            { superuser: 'require', err: 'message' })
        .catch(err => Promise.reject({ step: 'images', err }))

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
                csShowPrereq('Initialization error', [
                    'An unexpected error occurred while loading the container scan interface.',
                    'Reload the page to try again.',
                ]);
                return;
            }
            csCheckPrereqFail(reason.step, reason.err);
        });
}

function csCheckPrereqFail(step, err) {
    if (step === 'oscap-podman') {
        csShowPrereq('oscap-podman not found', [
            'Install openscap-utils to enable container scanning:',
            { code: 'sudo dnf install openscap-utils' },
        ]);
    } else if (step === 'podman') {
        csShowPrereq('Podman not installed', [
            'Install Podman to enable container scanning:',
            { code: 'sudo dnf install podman' },
            'Then pull images into the system store:',
            { code: 'sudo podman pull <image>' },
        ]);
    } else {
        csShowPrereq('Failed to enumerate images', [
            (err && err.message) || 'Unknown error',
        ]);
    }
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

    return cockpit.spawn(['ls', TAILORING_BASE], { err: 'message' })
        .then(output => {
            const files = output.trim().split('\n').filter(f => f && f.endsWith('.json'));
            if (!files.length) { return; }

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
    document.getElementById('cs-tailor-file-select').value = '';
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
    document.getElementById('cs-guide-btn').disabled =
        !csSdsPath || (!profileId && !tailoring);
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
    appendActivityLog({ type: 'scan_start', tab: 'container',
        content: csSdsPath.split('/').pop(), profile: profileTitle, image: csImageName,
        tailoring: tailoringPath ? tailoringPath.split('/').pop() : null });

    cockpit.spawn(['mkdir', '-p', csResultsDir], { superuser: 'require' })
        .then(() => {
            const args = ['oscap-podman', csImageId || csImageName, 'xccdf', 'eval'];
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
                        appendActivityLog({ type: 'scan_cancel', tab: 'container' });
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
                timestamp:      csTimestamp,
                scan_type:      'container',
                image_name:     csImageName,
                image_id:       csImageId,
                sds_file:       csSdsPath,
                profile_id:     profileId,
                profile_title:  profileTitle,
                tailoring_file: tailoringPath || null,
                result_id:      parsed.result_id,
                counts:         parsed.counts,
                score:          parsed.score,
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

            const genBash    = genFix('bash', csBashPath)
                .catch(err => {
                    console.error('Container bash remediation failed:', err.message || err);
                    csBashPath = null;
                });
            const genAnsible = genFix('ansible', csAnsiblePath)
                .catch(err => {
                    console.error('Container ansible remediation failed:', err.message || err);
                    csAnsiblePath = null;
                });
            return Promise.all([genBash, genAnsible]).then(() => manifest);
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
        .then(manifest => {
            appendActivityLog({ type: 'scan_complete', tab: 'container',
                content: manifest.sds_file.split('/').pop(), profile: manifest.profile_title,
                image: manifest.image_name, score: manifest.score.toFixed(1),
                pass: manifest.counts.pass, fail: manifest.counts.fail });
            pruneHistoryByType('container');
            csShowResults(manifest);
        })
        .catch(err => csScanError('Failed to process results: ' + (err.message || String(err))));
}

/* ---- Results display -------------------------------------- */

function csLoadScanFromHistory(manifest) {
    if (csProc) return;
    const dir = RESULTS_BASE + manifest.timestamp + '/';
    csTimestamp   = manifest.timestamp;
    csResultsDir  = dir;
    csReportPath  = dir + 'report.html';
    csBashPath    = dir + 'remediation.sh';
    csAnsiblePath = dir + 'remediation.yml';
    csImageName   = manifest.image_name || null;
    csImageId     = manifest.image_id   || null;
    document.getElementById('cs-scan-row').classList.add('hidden');
    csShowResults(manifest);
    document.getElementById('cs-results').scrollIntoView({ behavior: 'smooth' });
}

function csShowResults(manifest) {
    csCurrentManifest = manifest;
    const { counts, score, profile_title, image_name, timestamp } = manifest;

    document.getElementById('cs-results-profile-title').textContent =
        profile_title + ' — ' + (image_name || 'container');
    document.getElementById('cs-results-timestamp').textContent = timestamp
        ? timestamp.replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2')
        : '';

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

    const scoreEl = document.getElementById('cs-result-score');
    scoreEl.innerHTML = '';
    scoreEl.appendChild(buildScoreDonut(score, counts.fail));

    const csPrev = currentCsHistory.find(m =>
        m.timestamp  <  manifest.timestamp &&
        m.profile_id === manifest.profile_id &&
        m.sds_file   === manifest.sds_file &&
        m.image_id   === manifest.image_id
    ) || null;
    const csImprovementAlert = document.getElementById('cs-improvement-alert');
    const csRegressionAlert  = document.getElementById('cs-regression-alert');
    const csDiffContainer    = document.getElementById('cs-scan-diff');
    csDiffContainer.innerHTML = '';
    csDiffContainer.classList.add('hidden');

    if (csPrev && counts.fail < csPrev.counts.fail) {
        const delta    = csPrev.counts.fail - counts.fail;
        const prevDate = csPrev.timestamp.replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
        document.getElementById('cs-improvement-msg').textContent =
            delta + ' fewer failing rule' + (delta === 1 ? '' : 's') +
            ' than your previous scan on ' + prevDate +
            ' (' + csPrev.counts.fail + ' → ' + counts.fail + ')';
        csImprovementAlert.classList.remove('hidden');
        csRegressionAlert.classList.add('hidden');
        const prevXml = RESULTS_BASE + csPrev.timestamp + '/results.xml';
        document.getElementById('cs-diff-btn').onclick =
            () => loadScanDiff(csResultsDir + 'results.xml', prevXml, 'cs-scan-diff');
    } else if (csPrev && counts.fail > csPrev.counts.fail) {
        const delta    = counts.fail - csPrev.counts.fail;
        const prevDate = csPrev.timestamp.replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
        document.getElementById('cs-regression-msg').textContent =
            delta + ' more failing rule' + (delta === 1 ? '' : 's') +
            ' than your previous scan on ' + prevDate +
            ' (' + csPrev.counts.fail + ' → ' + counts.fail + ')';
        csRegressionAlert.classList.remove('hidden');
        csImprovementAlert.classList.add('hidden');
        const prevXml = RESULTS_BASE + csPrev.timestamp + '/results.xml';
        document.getElementById('cs-diff-btn-reg').onclick =
            () => loadScanDiff(csResultsDir + 'results.xml', prevXml, 'cs-scan-diff');
    } else {
        csImprovementAlert.classList.add('hidden');
        csRegressionAlert.classList.add('hidden');
    }

    const remFailed = !csBashPath;
    const remBtn = document.getElementById('cs-selective-rem-btn');
    remBtn.disabled = remFailed;
    remBtn.title    = remFailed ? 'Remediation generation failed' : '';

    document.getElementById('cs-progress').classList.add('hidden');
    document.getElementById('cs-results').classList.remove('hidden');
    renderFailingSummary(csResultsDir + 'results.xml',
                         'cs-failing-summary-groups', 'cs-failing-summary-loading',
                         csBashPath || null);
    csLoadHistory();
    dbInvalidate();
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

    currentCsHistory = manifests;
    document.getElementById('cs-export-csv-btn').disabled = !manifests.length;

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
        td.textContent = text;
        if (i === 3) {
            td.className = 'ct-history-profile-cell';
            td.title     = text;
        }
        tr.appendChild(td);
    });

    const actionsTd = document.createElement('td');
    actionsTd.className = 'ct-history-actions';

    const rerunBtn = document.createElement('button');
    rerunBtn.className   = 'pf-v6-c-button pf-m-link cs-history-rerun-btn';
    rerunBtn.type        = 'button';
    rerunBtn.textContent = 'Run Again';
    rerunBtn.disabled    = !!csProc;
    rerunBtn.addEventListener('click', () => csRerunScan(manifest));
    actionsTd.appendChild(rerunBtn);

    [
        ['View Scan',  () => csLoadScanFromHistory(manifest), !!csProc],
        ['Remediate',  () => openCsRemPanel(dir),             false],
    ].forEach(([label, handler, disabled]) => {
        const btn       = document.createElement('button');
        btn.className   = 'pf-v6-c-button pf-m-link';
        btn.type        = 'button';
        btn.textContent = label;
        btn.disabled    = disabled;
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
                .then(() => {
                    appendActivityLog({ type: 'scan_delete', tab: 'container', content: manifest.content_file, profile: manifest.profile_id, image: manifest.image_name });
                    csLoadHistory();
                })
                .catch(err => console.error('Failed to delete scan:', err.message || err))
        );
    });
    actionsTd.appendChild(delBtn);
    tr.appendChild(actionsTd);
    return tr;
}

function onCsViewGuideClick() {
    const btn       = document.getElementById('cs-guide-btn');
    const profileId = document.getElementById('cs-profile-select').value;
    const tailoring = document.getElementById('cs-tailor-file-select').value;

    const args = ['oscap', 'xccdf', 'generate', 'guide'];
    if (tailoring && csTailoringMap[tailoring]) {
        args.push('--tailoring-file', tailoring,
                  '--profile', csTailoringMap[tailoring].profile_id);
    } else {
        args.push('--profile', profileId);
    }
    args.push(csSdsPath);

    btn.disabled    = true;
    btn.textContent = 'Generating…';

    const win = window.open('about:blank', '_blank');
    cockpit.spawn(args, { err: 'message' })
        .then(html => storeReportInDB(html))
        .then(() => {
            appendActivityLog({ type: 'guide', tab: 'container', profile: profileId });
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

function csRerunScan(manifest) {
    if (csProc) return;
    csShowSetup();
    document.getElementById('tab-btn-container-scan').click();

    const imageSelect = document.getElementById('cs-image-select');
    imageSelect.value = manifest.image_name;
    csImageName = imageSelect.value || null;
    csImageId   = (imageSelect.options[imageSelect.selectedIndex] || {}).dataset.id || csImageName;

    const contentSelect = document.getElementById('cs-content-select');
    contentSelect.value = manifest.sds_file;
    if (contentSelect.value !== manifest.sds_file) {
        csCheckVersionMatch();
        csUpdateScanBtn();
        return;
    }
    csSdsPath = manifest.sds_file;

    const profileSelect = document.getElementById('cs-profile-select');
    profileSelect.innerHTML = '';
    appendOption(profileSelect, '', 'Loading…');
    profileSelect.disabled = true;
    csHideProfileDesc();
    csTailoringMap = {};
    document.getElementById('cs-tailor-file-select').value = '';
    csCheckVersionMatch();
    csUpdateScanBtn();

    Promise.all([
        loadProfiles(manifest.sds_file, 'cs-profile-select'),
        csDetectTailoringFiles(),
    ]).then(() => {
        if (manifest.tailoring_file) {
            const sidecar = csTailoringMap[manifest.tailoring_file];
            const baseId  = sidecar ? sidecar.base_profile_id : null;
            if (baseId) {
                profileSelect.value = baseId;
                if (profileSelect.value) profileSelect.dispatchEvent(new Event('change'));
            }
            document.getElementById('cs-tailor-file-select').value = manifest.tailoring_file;
        } else {
            profileSelect.value = manifest.profile_id;
            if (profileSelect.value) profileSelect.dispatchEvent(new Event('change'));
        }
        csUpdateScanBtn();
    });
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
    csLoadHistory();
}

function csShowSetup() {
    document.getElementById('cs-scan-row').classList.remove('hidden');
    document.getElementById('cs-progress').classList.add('hidden');
    document.getElementById('cs-results').classList.add('hidden');
    document.getElementById('cs-failing-summary-groups').innerHTML = '';
    document.getElementById('cs-failing-summary-loading').classList.add('hidden');
    document.getElementById('cs-improvement-alert').classList.add('hidden');
    document.getElementById('cs-regression-alert').classList.add('hidden');
    const csd = document.getElementById('cs-scan-diff');
    csd.innerHTML = ''; csd.classList.add('hidden');
    csProc        = null;
    csBashPath    = null;
    csAnsiblePath = null;
}

function csScanError(msg) {
    csProc = null;
    appendActivityLog({ type: 'scan_error', tab: 'container', message: msg });
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

function exportCsHistoryCSV() {
    const headers = [
        'Timestamp', 'Date', 'Image', 'Image ID', 'SDS File',
        'Profile Title', 'Tailoring File',
        'Pass', 'Fail', 'Error', 'Not Checked', 'Not Applicable', 'Score %',
    ];
    const rows = currentCsHistory.map(m => [
        m.timestamp,
        m.timestamp.replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2'),
        m.image_name       || '',
        m.image_id         || '',
        m.sds_file         || '',
        m.profile_title    || '',
        m.tailoring_file   || '',
        m.counts.pass,
        m.counts.fail,
        m.counts.error         || 0,
        m.counts.notchecked    || 0,
        m.counts.notapplicable || 0,
        (m.score || 0).toFixed(1),
    ]);
    downloadCSV('container-scan-history.csv', [headers, ...rows]);
}

/* ---- Selective Remediation -------------------------------- */

function openCsRemPanel(resultsDir) {
    csRemDir   = resultsDir;
    csRemRules = [];

    const panel = document.getElementById('cs-remediation-panel');
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    document.getElementById('cs-remediation-loading').classList.remove('hidden');
    document.getElementById('cs-remediation-content').classList.add('hidden');
    document.getElementById('cs-remediation-error').classList.add('hidden');
    document.getElementById('cs-rem-context').classList.add('hidden');

    cockpit.file(resultsDir + 'manifest.json').read()
        .then(content => {
            const m = JSON.parse(content);
            const ts      = (m.timestamp || '').replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
            const profile = m.profile_title || m.profile_id || '—';
            const sds     = m.sds_file ? m.sds_file.split('/').pop() : '—';
            const score   = m.score != null ? parseFloat(m.score).toFixed(1) + '%' : '—';
            const fail    = m.counts && m.counts.fail != null ? m.counts.fail : '—';
            const image   = m.image_name ? m.image_name.split('/').pop() : '—';
            const ctx = document.getElementById('cs-rem-context');
            ctx.innerHTML =
                '<span class="ct-rem-ctx-item"><strong>Image:</strong> ' + escHtmlRem(image) + '</span>' +
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
            csRemRules = JSON.parse(output);
            document.getElementById('cs-remediation-loading').classList.add('hidden');
            renderCsRemRules(csRemRules);
            document.getElementById('cs-remediation-content').classList.remove('hidden');
        })
        .catch(err => {
            document.getElementById('cs-remediation-loading').classList.add('hidden');
            document.getElementById('cs-remediation-error-msg').textContent =
                'Failed to load failing rules: ' + (err.message || String(err));
            document.getElementById('cs-remediation-error').classList.remove('hidden');
        });
}

function renderCsRemRules(rules) {
    const groups = { high: [], medium: [], low: [], unknown: [] };
    rules.forEach(r => (groups[r.severity] || groups.unknown).push(r));

    const container = document.getElementById('cs-remediation-rules');
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
            const group = btn.closest('details');
            const groupChecks = group.querySelectorAll('.ct-rem-checkbox');
            const allChecked = Array.from(groupChecks).every(c => c.checked);
            groupChecks.forEach(c => { c.checked = !allChecked; });
            updateCsRemCount();
        });
    });

    container.removeEventListener('change', updateCsRemCount);
    container.addEventListener('change', updateCsRemCount);
    updateCsRemCount();
}

function updateCsRemCount() {
    const all     = document.querySelectorAll('#cs-remediation-rules .ct-rem-checkbox');
    const checked = Array.from(all).filter(c => c.checked).length;
    document.getElementById('cs-remediation-count').textContent =
        checked + ' of ' + all.length + ' rules selected';
    const disabled = checked === 0;
    document.getElementById('cs-rem-bash-btn').disabled    = disabled;
    document.getElementById('cs-rem-ansible-btn').disabled = disabled;

    document.querySelectorAll('#cs-remediation-rules .ct-rem-group').forEach(group => {
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

function generateCsSelectiveFix(fixType) {
    const all = document.querySelectorAll('#cs-remediation-rules .ct-rem-checkbox');
    const selected = Array.from(all).filter(c => c.checked).map(c => c.dataset.id);
    if (!selected.length) return;

    const remFile = csRemDir + (fixType === 'bash' ? 'remediation.sh' : 'remediation.yml');
    const ext     = fixType === 'bash' ? '.sh' : '.yml';
    const mime    = fixType === 'bash' ? 'text/x-shellscript' : 'text/yaml';
    const ts      = csRemDir.replace(/\/$/, '').split('/').pop();
    const fname   = 'container-selective-remediation-' + ts + ext;

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
        appendActivityLog({ type: 'remediate_download', tab: 'container',
            fix_type: fixType, rules_selected: selected.length });
    })
    .catch(err => console.error('Container selective remediation failed:', err.message || err));
}

