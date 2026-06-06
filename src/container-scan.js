'use strict';

/* ============================================================
   Container Scan — all logic contained here.
   Entry point: initContainerScan()
   Removal: delete this file + remove initContainerScan() call
            in index.js + remove panel-container-scan from HTML
            + remove Container Scan tab button from HTML
            + delete CSS block in style.css
   ============================================================ */

/* PY_PARSE_RESULTS and PY_SDS_VERSION are defined in index.js (shared global scope) */

let csProc           = null;
let currentCsHistory = [];
let csScanTimer      = null;
let csScanStart      = null;
let csTimestamp   = null;
let csResultsDir  = null;
let csBashPath    = null;
let csAnsiblePath = null;
let csCancelled   = false;
let csSdsPath     = null;
let csTailoringMap = {};
let csImageName      = null;
let csImageId        = null;
let csVersionBlocked = false;
let csRemDir         = null;
let csRemRules       = [];
let csPendingQuickFix = false;
let csEagerRemRules        = null;
let csSdsVersion           = null;
let csRemediationGenerating = false;

function openCsRemDrawer() {
    document.getElementById('cs-remediation-panel').classList.add('ct-drawer-open');
    document.getElementById('ct-drawer-backdrop').classList.add('open');
}

function closeCsRemDrawer() {
    document.getElementById('cs-remediation-panel').classList.remove('ct-drawer-open');
    document.getElementById('ct-drawer-backdrop').classList.remove('open');
}
let csCurrentManifest = null;

function initContainerScan() {
    document.getElementById('cs-image-select')
        .addEventListener('change', onCsImageChange);
    document.getElementById('cs-content-select')
        .addEventListener('change', onCsContentChange);
    document.getElementById('cs-profile-select')
        .addEventListener('change', onCsProfileChange);
    document.getElementById('cs-tailor-file-select')
        .addEventListener('change', onCsTailorFileChange);
    document.getElementById('cs-scan-btn')
        .addEventListener('click', onCsScanClick);
    document.getElementById('cs-guide-btn')
        .addEventListener('click', onCsViewGuideClick);
    document.getElementById('cs-export-csv-btn')
        .addEventListener('click', exportCsHistoryCSV);
    document.getElementById('cs-history-empty-scan-btn')
        .addEventListener('click', () => {
            document.getElementById('cs-image-input').scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.getElementById('cs-image-input').focus();
        });
    document.getElementById('cs-cancel-btn')
        .addEventListener('click', onCsCancelClick);
    document.getElementById('cs-view-report-btn')
        .addEventListener('click', () => viewReportFromPath(csResultsDir + 'results.xml'));
    document.getElementById('cs-download-report-btn')
        .addEventListener('click', e => {
            const btn = e.currentTarget;
            const orig = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Generating…';
            generateReport(csResultsDir + 'results.xml')
                .then(html => {
                    const blob = new Blob([html], { type: 'text/html' });
                    const url  = URL.createObjectURL(blob);
                    const a    = document.createElement('a');
                    a.href = url; a.download = 'container-report-' + csTimestamp + '.html';
                    document.body.appendChild(a); a.click();
                    document.body.removeChild(a); URL.revokeObjectURL(url);
                    btn.textContent = '✓ Downloaded';
                    setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 2000);
                })
                .catch(() => { btn.disabled = false; btn.textContent = orig; });
        });
    document.getElementById('cs-download-xml-btn')
        .addEventListener('click', e => downloadArtifact(
            csResultsDir + 'results.xml',
            'container-results-' + csTimestamp + '.xml',
            'application/xml',
            e.currentTarget
        ));
    document.getElementById('cs-download-arf-btn')
        .addEventListener('click', e => {
            const btn    = e.currentTarget;
            const gzPath = csResultsDir + 'results.arf.gz';
            cockpit.spawn(['test', '-f', gzPath])
                .then(() => downloadArtifact(gzPath, 'container-results-arf-' + csTimestamp + '.xml.gz', 'application/gzip', btn))
                .catch(() => downloadArtifact(csResultsDir + 'results.arf', 'container-results-arf-' + csTimestamp + '.xml', 'application/xml', btn));
        });
    document.getElementById('cs-export-report-default')
        .addEventListener('click', e => {
            const btn = e.currentTarget;
            const orig = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Generating…';
            generateReport(csResultsDir + 'results.xml')
                .then(html => {
                    const blob = new Blob([html], { type: 'text/html' });
                    const url  = URL.createObjectURL(blob);
                    const a    = document.createElement('a');
                    a.href = url; a.download = 'container-report-' + csTimestamp + '.html';
                    document.body.appendChild(a); a.click();
                    document.body.removeChild(a); URL.revokeObjectURL(url);
                    btn.textContent = '✓ Downloaded';
                    setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 2000);
                })
                .catch(() => { btn.disabled = false; btn.textContent = orig; });
        });
    document.getElementById('cs-export-toggle')
        .addEventListener('click', e => {
            e.stopPropagation();
            const menu = document.getElementById('cs-export-menu');
            const open = menu.classList.toggle('hidden') === false;
            e.currentTarget.setAttribute('aria-expanded', String(open));
        });
    document.getElementById('cs-export-menu')
        .addEventListener('click', () => {
            document.getElementById('cs-export-menu').classList.add('hidden');
            document.getElementById('cs-export-toggle').setAttribute('aria-expanded', 'false');
        });
    document.addEventListener('click', e => {
        const menu = document.getElementById('cs-export-menu');
        if (menu && !menu.classList.contains('hidden') &&
            !e.target.closest('#cs-export-toggle') && !e.target.closest('#cs-export-menu')) {
            menu.classList.add('hidden');
            document.getElementById('cs-export-toggle').setAttribute('aria-expanded', 'false');
        }
    });
    document.getElementById('cs-quick-fix-btn')
        .addEventListener('click', () => { csPendingQuickFix = true; openCsRemPanel(csResultsDir); });
    document.getElementById('cs-review-all-btn')
        .addEventListener('click', () => openCsRemPanel(csResultsDir));
    document.getElementById('cs-rem-close-btn')
        .addEventListener('click', () => {
            closeCsRemDrawer();
        });
    document.getElementById('cs-rem-bash-btn')
        .addEventListener('click', () => generateCsSelectiveFix('bash'));
    document.getElementById('cs-rem-ansible-btn')
        .addEventListener('click', () => generateCsSelectiveFix('ansible'));
    document.getElementById('cs-rem-search')
        .addEventListener('input', onCsRemSearch);
    document.getElementById('cs-failing-search')
        .addEventListener('input', () => onFailingSummarySearch('cs-failing-summary-groups', 'cs-failing-search'));
    document.getElementById('cs-expand-all')
        .addEventListener('click', () =>
            document.querySelectorAll('#cs-failing-summary-groups details.ct-failing-group')
                .forEach(d => { d.open = true; }));
    document.getElementById('cs-collapse-all')
        .addEventListener('click', () =>
            document.querySelectorAll('#cs-failing-summary-groups details.ct-failing-group')
                .forEach(d => { d.open = false; }));
    document.getElementById('cs-rem-select-all-btn')
        .addEventListener('click', () => {
            document.querySelectorAll('#cs-remediation-rules .ct-rem-rule-item:not([style*="none"]) .ct-rem-checkbox')
                .forEach(c => { c.checked = true; });
            updateCsRemCount();
        });
    document.getElementById('cs-rem-deselect-all-btn')
        .addEventListener('click', () => {
            document.querySelectorAll('#cs-remediation-rules .ct-rem-rule-item:not([style*="none"]) .ct-rem-checkbox')
                .forEach(c => { c.checked = false; });
            updateCsRemCount();
        });
    document.getElementById('cs-new-scan-btn')
        .addEventListener('click', () => {
            if (csCurrentManifest) csRerunScan(csCurrentManifest);
            else csShowSetup();
        });
    document.getElementById('cs-results-close-btn')
        .addEventListener('click', () => {
            if (csProc) {
                document.getElementById('cs-results').classList.add('hidden');
            } else {
                csShowSetup();
            }
        });
    document.getElementById('cs-scan-error-close')
        .addEventListener('click', csClearError);
    document.getElementById('cs-profile-rem-toggle')
        .addEventListener('click', e => {
            e.stopPropagation();
            const menu = document.getElementById('cs-profile-rem-menu');
            const open = menu.classList.toggle('hidden') === false;
            e.currentTarget.setAttribute('aria-expanded', String(open));
        });
    document.getElementById('cs-profile-rem-menu')
        .addEventListener('click', e => {
            const item = e.target.closest('[data-fix-type]');
            if (!item) return;
            const toggle = document.getElementById('cs-profile-rem-toggle');
            document.getElementById('cs-profile-rem-menu').classList.add('hidden');
            toggle.setAttribute('aria-expanded', 'false');
            downloadCsProfileRemediation(item.dataset.fixType, toggle);
        });
    document.addEventListener('click', e => {
        const menu = document.getElementById('cs-profile-rem-menu');
        if (menu && !menu.classList.contains('hidden') &&
            !e.target.closest('#cs-profile-rem-toggle') && !e.target.closest('#cs-profile-rem-menu')) {
            menu.classList.add('hidden');
            document.getElementById('cs-profile-rem-toggle').setAttribute('aria-expanded', 'false');
        }
    });
    document.getElementById('cs-scan-cmd-copy')
        .addEventListener('click', () => {
            const cmd = document.getElementById('cs-scan-cmd').textContent;
            navigator.clipboard.writeText(cmd).then(() => {
                const btn = document.getElementById('cs-scan-cmd-copy');
                const orig = btn.textContent;
                btn.textContent = '✓ Copied';
                setTimeout(() => { btn.textContent = orig; }, 2000);
            }).catch(() => {});
        });

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
            csLoadHistory();
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
        const msg = (err && err.message) || '';
        const isPermission = /not permitted|permission denied|access denied/i.test(msg);
        if (isPermission) {
            csShowPrereq('Administrative access required', [
                'Listing container images requires root access to the system Podman store.',
                'Click "Administrative access" in the page header, then reload this tab.',
            ]);
        } else {
            csShowPrereq('Failed to enumerate images', [msg || 'Unknown error']);
        }
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
                    cockpit.file(TAILORING_BASE + f, { superuser: 'try' }).read()
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

function onCsTailorFileChange() {
    const tailoringPath = document.getElementById('cs-tailor-file-select').value;
    if (tailoringPath && csTailoringMap[tailoringPath]) {
        const sidecar = csTailoringMap[tailoringPath];
        if (sidecar.base_profile_id) {
            const profileSelect = document.getElementById('cs-profile-select');
            const opt = Array.from(profileSelect.options).find(o => o.value === sidecar.base_profile_id);
            if (opt) profileSelect.value = sidecar.base_profile_id;
        }
    }
    csUpdateScanBtn();
}

function remFixMeta(fixType) {
    if (fixType === 'bash')       return { ext: '.sh',              mime: 'text/x-shellscript' };
    if (fixType === 'puppet')     return { ext: '.pp',              mime: 'text/plain' };
    if (fixType === 'ansible')    return { ext: '-ansible.yml',     mime: 'text/yaml' };
    return { ext: '.txt', mime: 'text/plain' };
}

function downloadCsProfileRemediation(fixType, btnEl) {
    const tailorSelect  = document.getElementById('cs-tailor-file-select');
    const tailoringPath = tailorSelect ? tailorSelect.value : '';
    let profileId;
    if (tailoringPath && csTailoringMap[tailoringPath]) {
        profileId = csTailoringMap[tailoringPath].profile_id;
    } else {
        profileId = (document.getElementById('cs-profile-select') || {}).value || '';
    }
    if (!csSdsPath || !profileId) return;

    const args = ['oscap', 'xccdf', 'generate', 'fix', '--fix-type', fixType,
                  '--profile', profileId];
    if (tailoringPath) args.push('--tailoring-file', tailoringPath);
    args.push(csSdsPath);

    const { ext, mime } = remFixMeta(fixType);
    const profileSel  = document.getElementById('cs-profile-select');
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
            appendActivityLog({ type: 'profile_rem_download', tab: 'container',
                fix_type: fixType, profile_id: profileId });
        })
        .catch(() => {
            btnEl.textContent = 'Failed';
            setTimeout(() => { btnEl.disabled = false; btnEl.textContent = origText; }, 2000);
        });
}

function csUpdateScanBtn() {
    const imageVal     = document.getElementById('cs-image-select').value;
    const profileId    = document.getElementById('cs-profile-select').value;
    const tailoring    = document.getElementById('cs-tailor-file-select').value;
    const adminAllowed = !adminPermission || adminPermission.allowed !== false;
    const csRemEnabled = !!csSdsPath && !!(profileId || tailoring);
    document.getElementById('cs-scan-btn').disabled =
        !imageVal || (!profileId && !tailoring) || csVersionBlocked || !adminAllowed;
    document.getElementById('cs-guide-btn').disabled          = !csRemEnabled;
    document.getElementById('cs-profile-rem-toggle').disabled = !csRemEnabled;
    updateCsScanCmd();
}

function updateCsScanCmd() {
    const imageVal      = document.getElementById('cs-image-select').value;
    const profileSelect = document.getElementById('cs-profile-select');
    const tailoring     = document.getElementById('cs-tailor-file-select').value;
    const details       = document.getElementById('cs-scan-cmd-details');
    const cmdEl         = document.getElementById('cs-scan-cmd');

    let profileId;
    if (tailoring && csTailoringMap && csTailoringMap[tailoring]) {
        profileId = csTailoringMap[tailoring].profile_id;
    } else {
        profileId = profileSelect.value;
    }

    if (!csSdsPath || !profileId || !imageVal) {
        details.classList.add('hidden');
        return;
    }

    let cmd = 'oscap-podman ' + imageVal + ' xccdf eval --profile ' + profileId;
    if (tailoring) cmd += ' --tailoring-file ' + tailoring;
    cmd += ' --results /var/lib/cockpit-scap/results/<timestamp>/results.xml';
    // report.html is generated on demand — not passed to oscap at scan time
    cmd += ' --results-arf /var/lib/cockpit-scap/results/<timestamp>/results.arf';
    cmd += ' ' + csSdsPath;

    cmdEl.textContent = cmd;
    details.classList.remove('hidden');
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
            const imageArg = csImageId || csImageName;
            if (!imageArg || imageArg.startsWith('--')) {
                csScanError('Invalid image identifier');
                return;
            }
            const args = ['oscap-podman', imageArg, 'xccdf', 'eval'];
            if (tailoringPath) args.push('--tailoring-file', tailoringPath);
            args.push(
                '--progress',
                '--profile',      profileId,
                '--results',      resultsXmlPath,
                '--results-arf',  csResultsDir + 'results.arf',
                csSdsPath
            );

            let csScanOutput = '';
            let _csRuleBuf = '';
            let _csPass = 0, _csFail = 0, _csError = 0;
            const _csRecent = [];
            const csPassEl  = document.getElementById('cs-live-pass');
            const csFailEl  = document.getElementById('cs-live-fail');
            const csErrorEl = document.getElementById('cs-live-error');
            const csListEl  = document.getElementById('cs-rule-feed-list');
            const CS_RULE_RE = /^(xccdf_\S+):(pass|fail|error|notchecked|notapplicable|informational|fixed)$/;

            csProc = cockpit.spawn(args, { superuser: 'require', err: 'out' });
            csProc.stream(data => {
                csScanOutput += data;
                _csRuleBuf += data;
                const lines = _csRuleBuf.split('\n');
                _csRuleBuf = lines.pop();
                for (const line of lines) {
                    const m = line.trim().match(CS_RULE_RE);
                    if (!m) continue;
                    const [, ruleId, result] = m;
                    if (result === 'pass' || result === 'fixed') _csPass++;
                    else if (result === 'fail') _csFail++;
                    else if (result === 'error') _csError++;
                    const name = ruleId.replace(/^.*content_rule_/, '').replace(/_/g, ' ');
                    _csRecent.unshift({ name, result });
                    if (_csRecent.length > 5) _csRecent.pop();
                    csPassEl.textContent  = _csPass;
                    csFailEl.textContent  = _csFail;
                    csErrorEl.textContent = _csError;
                    csListEl.innerHTML = _csRecent.map(r =>
                        '<div class="ct-rule-feed-item">' +
                        '<span class="ct-rule-feed-dot ' + r.result + '"></span>' +
                        '<span class="ct-rule-feed-name">' + r.name + '</span>' +
                        '</div>'
                    ).join('');
                }
            });
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
                        csScanError(err.message || String(err), csScanOutput);
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
                timestamp:        csTimestamp,
                scan_type:        'container',
                image_name:       csImageName,
                image_id:         csImageId,
                sds_file:         csSdsPath,
                profile_id:       profileId,
                profile_title:    profileTitle,
                tailoring_file:   tailoringPath || null,
                result_id:        parsed.result_id,
                counts:           parsed.counts,
                severity_counts:  parsed.sev,
                score:            parsed.score,
                scan_duration_s:  Math.round((Date.now() - csScanStart) / 1000),
                scan_id:          generateScanId(),
                has_arf:          true,
                sds_version:      csSdsVersion || null,
            };
            return cockpit.file(csResultsDir + 'manifest.json', { superuser: 'require' })
                .replace(JSON.stringify(manifest, null, 2))
                .then(() => manifest);
        })
        .then(manifest => {
            return cockpit.spawn(
                ['chmod', '644', resultsXmlPath, csResultsDir + 'manifest.json'],
                { superuser: 'require' }
            ).catch(() => {}).then(() => manifest);
        })
        .then(manifest => {
            appendActivityLog({ type: 'scan_complete', tab: 'container',
                content: manifest.sds_file.split('/').pop(), profile: manifest.profile_title,
                image: manifest.image_name, score: manifest.score.toFixed(1),
                pass: manifest.counts.pass, fail: manifest.counts.fail });
            pruneHistoryByType('container').then(() => csShowResults(manifest));

            /* Remediation generation runs in the background so results display immediately */
            csRemediationGenerating = true;
            updateCsRemGeneratingStatus();
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
                .catch(err => { console.error('Container bash remediation failed:', err.message || err); csBashPath = null; });
            const genAnsible = genFix('ansible', csAnsiblePath)
                .catch(err => { console.error('Container ansible remediation failed:', err.message || err); csAnsiblePath = null; });

            Promise.all([genBash, genAnsible])
                .finally(() => {
                    csRemediationGenerating = false;
                    updateCsRemGeneratingStatus();
                    csRefreshActionBoardAutomatable(manifest);
                    cockpit.spawn(['gzip', csResultsDir + 'results.arf'], { superuser: 'require' }).catch(() => {});
                    cockpit.spawn(
                        ['chmod', '755', csResultsDir],
                        { superuser: 'require' }
                    ).then(() => cockpit.spawn(
                        ['find', csResultsDir, '-maxdepth', '1', '-type', 'f', '-exec', 'chmod', '644', '{}', '+'],
                        { superuser: 'require' }
                    )).catch(err => console.error('chmod failed:', err.message || err));
                });
        })
        .catch(err => csScanError('Failed to process results: ' + (err.message || String(err))));
}

/* ---- Results display -------------------------------------- */

const CS_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;

function csLoadScanFromHistory(manifest) {
    if (!CS_TIMESTAMP_RE.test(manifest.timestamp)) return;
    const dir = RESULTS_BASE + manifest.timestamp + '/';
    csTimestamp   = manifest.timestamp;
    csResultsDir  = dir;
    csBashPath    = dir + 'remediation.sh';
    csAnsiblePath = dir + 'remediation.yml';
    csImageName   = manifest.image_name || null;
    csImageId     = manifest.image_id   || null;
    csRemediationGenerating = false;
    csHidePrereq();
    document.getElementById('cs-scan-row').classList.add('hidden');
    csShowResults(manifest);
    document.getElementById('cs-results').scrollIntoView({ behavior: 'smooth' });
}

function updateCsRemGeneratingStatus() {
    const status = document.getElementById('cs-rem-generating-status');
    if (status) status.classList.toggle('hidden', !csRemediationGenerating);
}

function csRefreshActionBoardAutomatable(manifest) {
    if (!csBashPath || !manifest) return;
    const sev      = manifest.severity_counts || {};
    const totalFail = (manifest.counts || {}).fail || 0;
    cockpit.spawn(['python3', '-c', PY_EXTRACT_FAILING_RULES,
                   csResultsDir + 'results.xml', csBashPath],
                  { err: 'message', superuser: 'try' })
        .then(output => {
            const d = JSON.parse(output); csEagerRemRules = d.fails || d;
            const recCount = csEagerRemRules.filter(r => ['high','critical'].includes(r.severity) && r.automated).length;
            updateCsActionBoard(sev, totalFail, recCount);
        })
        .catch(() => updateCsActionBoard(sev, totalFail, 0));
}

function updateCsActionBoard(sev, totalFail, autoCount) {
    const board = document.getElementById('cs-action-board');
    const sevEl = document.getElementById('cs-action-board-sev');
    sevEl.innerHTML = '';
    [['high','ct-sev-high','High'],['medium','ct-sev-medium','Medium'],['low','ct-sev-low','Low']].forEach(([k, cls, label]) => {
        const n = sev[k] || 0;
        const span = document.createElement('span');
        span.className = 'ct-sev-badge ' + (n ? cls : 'ct-sev-zero');
        span.textContent = label + ': ' + n;
        sevEl.appendChild(span);
    });

    const autoEl = document.getElementById('cs-action-board-auto');
    const qBtn   = document.getElementById('cs-quick-fix-btn');
    const rBtn   = document.getElementById('cs-review-all-btn');

    if (autoCount === null) {
        autoEl.textContent = 'Checking for auto-remediable rules…';
        qBtn.disabled = true;
        qBtn.textContent = 'Critical Rules';
        qBtn.title = '';
    } else if (autoCount === 0) {
        autoEl.textContent = 'No automated fixes available for critical/high failures';
        qBtn.disabled = true;
        qBtn.textContent = 'Critical Rules';
        qBtn.title = '';
    } else {
        autoEl.textContent = autoCount + ' critical/high rule' + (autoCount !== 1 ? 's' : '') + ' can be auto-remediated';
        qBtn.disabled = false;
        qBtn.textContent = 'Critical Rules (' + autoCount + ')';
        qBtn.title = 'Pre-selects the ' + autoCount + ' automatable high/critical rule' +
            (autoCount !== 1 ? 's' : '') + '. Review and confirm before anything is applied.';
    }

    rBtn.textContent = 'All Failures (' + totalFail + ')';
    rBtn.disabled = totalFail === 0;
    board.classList.remove('hidden');
}

function csShowResults(manifest) {
    clearInterval(csScanTimer);
    csScanTimer = null;
    csCurrentManifest = manifest;
    const { counts, score, profile_title, image_name, timestamp } = manifest;

    document.getElementById('cs-results-profile-title').textContent =
        profile_title + ' — ' + (image_name || 'container');
    document.getElementById('cs-results-timestamp').textContent = timestamp
        ? timestamp.replace('T', ' ').replace(/-(\d{2})-(\d{2})$/, ':$1:$2')
        : '';
    const csDurEl = document.getElementById('cs-results-duration');
    if (manifest.scan_duration_s != null) {
        csDurEl.textContent = 'Completed in ' + formatDuration(manifest.scan_duration_s);
        csDurEl.classList.remove('hidden');
    } else {
        csDurEl.classList.add('hidden');
    }
    const csIdEl = document.getElementById('cs-results-scan-id');
    if (manifest.scan_id) {
        csIdEl.textContent = manifest.scan_id;
        csIdEl.classList.remove('hidden');
    } else {
        csIdEl.classList.add('hidden');
    }
    const csVerEl = document.getElementById('cs-results-version-container');
    if (manifest.sds_version) {
        csVerEl.textContent = 'SSG ' + manifest.sds_version;
        csVerEl.classList.remove('hidden');
    } else {
        csVerEl.classList.add('hidden');
    }
    const csUploadedWarn = document.getElementById('cs-uploaded-content-warning');
    if (manifest.sds_file && manifest.sds_file.startsWith(CONTENT_BASE)) {
        csUploadedWarn.classList.remove('hidden');
    } else {
        csUploadedWarn.classList.add('hidden');
    }
    updateCsRemGeneratingStatus();

    const badges = document.getElementById('cs-result-badges');
    badges.innerHTML = '';
    const csBadgeDefs = [
        ['Pass',        counts.pass,       'ct-badge-pass'],
        ['Fail',        counts.fail,       'ct-badge-fail'],
        ['Error',       counts.error,      'ct-badge-error'],
        ['Not checked', counts.notchecked, 'ct-badge-neutral'],
    ];
    if ((counts.notapplicable || 0) > 0) {
        csBadgeDefs.splice(3, 0, ['Not applicable', counts.notapplicable, 'ct-badge-na']);
    }
    csBadgeDefs.forEach(([label, count, cls], i) => {
        if (i === 3) {
            const spacer = document.createElement('span');
            spacer.className = 'ct-badge-group-gap';
            badges.appendChild(spacer);
        }
        const span = document.createElement('span');
        span.className = 'ct-result-badge ' + cls;
        const numEl = document.createElement('span');
        numEl.className = 'ct-result-badge-num';
        numEl.textContent = count;
        const lblEl = document.createElement('span');
        lblEl.className = 'ct-result-badge-label';
        lblEl.textContent = label;
        span.appendChild(numEl);
        span.appendChild(lblEl);
        badges.appendChild(span);
    });

    const csArfBtn = document.getElementById('cs-download-arf-btn');
    csArfBtn.disabled = !manifest.has_arf;
    if (!manifest.has_arf) csArfBtn.title = 'ARF not available — rescan to generate';

    const scoreEl    = document.getElementById('cs-result-score');
    const csThresh   = manifest.compliance_threshold != null ? manifest.compliance_threshold : 90;
    scoreEl.innerHTML = '';
    scoreEl.appendChild(buildScoreDonut(score, csThresh, true));

    const csTargetEl = document.getElementById('cs-results-target');
    if (manifest.compliance_threshold != null) {
        csTargetEl.textContent = 'Policy target: ' + manifest.compliance_threshold + '%';
        csTargetEl.classList.remove('hidden');
    } else {
        csTargetEl.classList.add('hidden');
    }

    const csPrev = currentCsHistory.find(m =>
        m.timestamp  <  manifest.timestamp &&
        m.profile_id === manifest.profile_id &&
        m.sds_file   === manifest.sds_file &&
        m.image_id   === manifest.image_id
    ) || null;
    const csDeltaEl = document.getElementById('cs-result-score-delta');
    if (csPrev) {
        const scoreDiff = score - csPrev.score;
        if (Math.abs(scoreDiff) >= 0.05) {
            const sign = scoreDiff > 0 ? '+' : '';
            csDeltaEl.textContent = sign + scoreDiff.toFixed(1) + ' pts vs. last scan';
            csDeltaEl.className = 'ct-result-score-delta ' +
                (scoreDiff > 0 ? 'ct-delta-up' : 'ct-delta-down');
        } else {
            csDeltaEl.className = 'ct-result-score-delta hidden';
        }
    } else {
        csDeltaEl.className = 'ct-result-score-delta hidden';
    }
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
        document.getElementById('cs-diff-btn').addEventListener('click',
            () => loadScanDiff(csResultsDir + 'results.xml', prevXml, 'cs-scan-diff'), { once: true });
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
        document.getElementById('cs-diff-btn-reg').addEventListener('click',
            () => loadScanDiff(csResultsDir + 'results.xml', prevXml, 'cs-scan-diff'), { once: true });
    } else {
        csImprovementAlert.classList.add('hidden');
        csRegressionAlert.classList.add('hidden');
    }


    if (!csProc) document.getElementById('cs-progress').classList.add('hidden');
    document.getElementById('cs-results').classList.remove('hidden');
    renderFailingSummary(csResultsDir + 'results.xml',
                         'cs-failing-summary-groups', 'cs-failing-summary-loading',
                         csBashPath || null, 'cs-failing-search');
    csLoadHistory();

    const csSev = Object.assign({ high: 0, medium: 0, low: 0 }, manifest.severity_counts || {});
    csEagerRemRules = null;
    updateCsActionBoard(csSev, counts.fail, null);
    const csEagerArgs = [csResultsDir + 'results.xml'];
    if (csBashPath) csEagerArgs.push(csBashPath);
    cockpit.spawn(['python3', '-c', PY_EXTRACT_FAILING_RULES, ...csEagerArgs],
        { err: 'message' })
        .then(output => {
            const d = JSON.parse(output); csEagerRemRules = d.fails || d;
            const recCount = csEagerRemRules.filter(r => ['high','critical'].includes(r.severity) && r.automated).length;
            updateCsActionBoard(csSev, counts.fail, recCount);
        })
        .catch(() => updateCsActionBoard(csSev, counts.fail, 0));
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
                    cockpit.file(RESULTS_BASE + dir + '/manifest.json', { superuser: 'try' }).read()
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
    updateAdminControls();
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

    const target       = csShortImageName(manifest.image_name || manifest.image_id);
    const profileTitle = manifest.profile_title || '—';
    const csScore      = manifest.score || 0;
    const scoreText    = csScore.toFixed(1) + '%';
    const csThreshold  = manifest.compliance_threshold != null ? manifest.compliance_threshold : 90;
    const scoreCls     = csScore >= csThreshold ? 'ct-score-high' : 'ct-score-low';
    const scoreTitle   = csScore >= csThreshold ? 'Compliant (target: ' + csThreshold + '%)' : 'Non-compliant (target: ' + csThreshold + '%)';

    [
        { text: date,         cls: 'ct-history-date-cell' },
        { text: target,       cls: 'ct-history-target-cell', title: manifest.image_name || target },
        { text: profileTitle, cls: 'ct-history-profile-cell', title: profileTitle },
        { text: String(manifest.counts.pass), cls: 'ct-history-num-cell' },
        { text: String(manifest.counts.fail), cls: 'ct-history-num-cell' },
        { text: scoreText,    cls: 'ct-history-num-cell ' + scoreCls, title: scoreTitle },
    ].forEach(({ text, cls, title }) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (cls)   td.className = cls;
        if (title) td.title     = title;
        tr.appendChild(td);
    });

    const actionsTd = document.createElement('td');
    actionsTd.className = 'ct-history-actions';

    const rerunBtn = document.createElement('button');
    rerunBtn.className   = 'pf-v6-c-button pf-m-link cs-history-rerun-btn ct-requires-admin';
    rerunBtn.type        = 'button';
    rerunBtn.textContent = 'Run Again';
    rerunBtn.disabled    = !!csProc;
    rerunBtn.addEventListener('click', () => csRerunScan(manifest));
    actionsTd.appendChild(rerunBtn);

    [
        ['View Scan',  () => csLoadScanFromHistory(manifest), false],
        ['Remediate',  () => { csLoadScanFromHistory(manifest); openCsRemPanel(dir); }, false],
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
    delBtn.className   = 'pf-v6-c-button pf-m-link ct-btn-danger-link ct-requires-admin';
    delBtn.type        = 'button';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => {
        showConfirmModal(
            'Delete Container Scan',
            'Delete the scan from ' + date + '? All artifacts will be permanently removed.',
            () => {
                if (!CS_TIMESTAMP_RE.test(manifest.timestamp)) return;
                cockpit.spawn(['rm', '-rf', RESULTS_BASE + manifest.timestamp], { superuser: 'require' })
                .then(() => {
                    appendActivityLog({ type: 'scan_delete', tab: 'container', content: manifest.sds_file, profile: manifest.profile_id, image: manifest.image_name });
                    csLoadHistory();
                })
                .catch(err => console.error('Failed to delete scan:', err.message || err));
            }
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
            appendActivityLog({ type: 'guide', tab: 'container', profile: profileId });
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

function csRerunScan(manifest, autoStart = false) {
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
        if (autoStart) document.getElementById('cs-scan-btn').click();
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
    csScanStart = Date.now();
    const csFillEl  = document.getElementById('cs-scan-progress-fill');
    const csLabelEl = document.getElementById('cs-scan-elapsed');
    csFillEl.style.width = '0%';
    csFillEl.classList.remove('ct-indeterminate');
    csLabelEl.textContent = '';
    document.getElementById('cs-live-pass').textContent  = '0';
    document.getElementById('cs-live-fail').textContent  = '0';
    document.getElementById('cs-live-error').textContent = '0';
    document.getElementById('cs-rule-feed-list').innerHTML =
        '<div class="ct-rule-feed-item ct-rule-feed-waiting">' +
        '<span class="ct-rule-feed-name">Waiting for first rule…</span></div>';
    const _csSdsEl  = document.getElementById('cs-content-select');
    const _csProfEl = document.getElementById('cs-profile-select');
    const _csTailEl = document.getElementById('cs-tailor-file-select');
    document.getElementById('cs-scan-ctx-content').textContent =
        _csSdsEl.options[_csSdsEl.selectedIndex]?.text || '—';
    document.getElementById('cs-scan-ctx-profile').textContent =
        _csProfEl.options[_csProfEl.selectedIndex]?.text || '—';
    document.getElementById('cs-scan-ctx-policy').textContent =
        _csTailEl.value ? (_csTailEl.options[_csTailEl.selectedIndex]?.text || '—') : '—';
    document.getElementById('cs-scan-ctx-image').textContent = csImageName || '—';
    csSdsVersion = null;
    document.getElementById('cs-scan-ctx-version').textContent = '—';
    if (csSdsPath) {
        cockpit.spawn(['python3', '-c', PY_SDS_VERSION, csSdsPath], { err: 'ignore' })
            .then(out => {
                csSdsVersion = (out.trim().split(' ')[1]) || null;
                document.getElementById('cs-scan-ctx-version').textContent = csSdsVersion || '—';
            }).catch(() => {});
    }
    const _csProfileId = (document.getElementById('cs-profile-select') || {}).value || null;
    const _csPrevScan  = currentCsHistory.find(m =>
        m.profile_id === _csProfileId && m.sds_file === csSdsPath &&
        m.image_id   === csImageId    && m.scan_duration_s != null
    );
    const _csEstSecs = _csPrevScan ? _csPrevScan.scan_duration_s : null;
    if (!_csEstSecs) csFillEl.classList.add('ct-indeterminate');
    csScanTimer = setInterval(() => {
        const s = Math.floor((Date.now() - csScanStart) / 1000);
        if (_csEstSecs) {
            csFillEl.style.width = Math.min(100, Math.round((s / _csEstSecs) * 100)) + '%';
            if (s >= _csEstSecs * 1.5) {
                const m = Math.floor(s / 60);
                csLabelEl.textContent = m > 0 ? m + 'm ' + (s % 60) + 's' : s + 's';
            } else {
                const rem = Math.max(0, _csEstSecs - s);
                const rm  = Math.floor(rem / 60);
                const rs  = rem % 60;
                csLabelEl.textContent = rem === 0 ? 'finishing…'
                    : rm > 0 ? '~' + rm + 'm ' + String(rs).padStart(2, '0') + 's remaining'
                    : '~' + rs + 's remaining';
            }
        } else {
            const m = Math.floor(s / 60);
            csLabelEl.textContent = m > 0 ? m + 'm ' + (s % 60) + 's' : s + 's';
        }
    }, 1000);
    csLoadHistory();
}

function csShowSetup() {
    clearInterval(csScanTimer);
    csScanTimer = null;
    const adminAllowed = !adminPermission || adminPermission.allowed !== false;
    if (!adminAllowed) {
        csShowPrereq('Administrative access required', [
            'Listing container images requires root access to the system Podman store.',
            'Click "Administrative access" in the page header, then reload this tab.',
        ]);
        return;
    }
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

function csScanError(msg, output) {
    csProc = null;
    appendActivityLog({ type: 'scan_error', tab: 'container', message: msg });
    csShowSetup();
    document.getElementById('cs-scan-error-message').textContent = msg;
    const detailsEl = document.getElementById('cs-scan-error-details');
    const outputEl  = document.getElementById('cs-scan-error-output');
    if (output && output.trim()) {
        outputEl.textContent = output.trim();
        detailsEl.classList.remove('hidden');
    } else {
        detailsEl.classList.add('hidden');
    }
    document.getElementById('cs-scan-error-alert').classList.remove('hidden');
}

function csClearError() {
    document.getElementById('cs-scan-error-alert').classList.add('hidden');
    document.getElementById('cs-scan-error-details').classList.add('hidden');
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
        'Profile Title', 'Policy',
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

    document.getElementById('cs-rem-search').value = '';
    csHidePrereq();

    openCsRemDrawer();

    document.getElementById('cs-remediation-loading').classList.remove('hidden');
    document.getElementById('cs-remediation-content').classList.add('hidden');
    document.getElementById('cs-remediation-error').classList.add('hidden');
    document.getElementById('cs-rem-context').classList.add('hidden');

    cockpit.file(resultsDir + 'manifest.json', { superuser: 'try' }).read()
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

    if (csEagerRemRules && resultsDir === csResultsDir) {
        const reused = csEagerRemRules;
        csEagerRemRules = null;
        csRemRules = reused;
        document.getElementById('cs-remediation-loading').classList.add('hidden');
        renderCsRemRules(reused);
        document.getElementById('cs-remediation-content').classList.remove('hidden');
        return;
    }

    const csLazyArgs = [resultsDir + 'results.xml'];
    const csBashForDir = resultsDir === csResultsDir ? csBashPath : resultsDir + 'remediation.sh';
    if (csBashForDir) csLazyArgs.push(csBashForDir);
    cockpit.spawn(['python3', '-c', PY_EXTRACT_FAILING_RULES, ...csLazyArgs],
                  { err: 'message' })
        .then(output => {
            const d = JSON.parse(output); csRemRules = d.fails || d;
            document.getElementById('cs-remediation-loading').classList.add('hidden');
            renderCsRemRules(csRemRules);
            document.getElementById('cs-remediation-content').classList.remove('hidden');
        })
        .catch(err => {
            csPendingQuickFix = false;
            document.getElementById('cs-remediation-loading').classList.add('hidden');
            document.getElementById('cs-remediation-error-msg').textContent =
                'Failed to load failing rules: ' + (err.message || String(err));
            document.getElementById('cs-remediation-error').classList.remove('hidden');
        });
}

function renderCsRemRules(rules) {
    buildRemPanelDOM(
        document.getElementById('cs-remediation-rules'),
        rules,
        updateCsRemCount,
        csBashPath
    );

    if (csPendingQuickFix) {
        csPendingQuickFix = false;
        const recIds = new Set(rules
            .filter(r => ['high', 'critical'].includes(r.severity) && r.automated)
            .map(r => r.id));
        document.querySelectorAll('#cs-remediation-rules .ct-rem-checkbox').forEach(cb => {
            cb.checked = recIds.has(cb.dataset.id);
        });
        updateCsRemCount();
    }
}

function onCsRemSearch() {
    const term = document.getElementById('cs-rem-search').value.toLowerCase();
    document.querySelectorAll('#cs-remediation-rules .ct-rem-rule-item').forEach(item => {
        const match = !term ||
            item.dataset.title.includes(term) ||
            item.dataset.ruleid.includes(term);
        item.style.display = match ? '' : 'none';
    });
    document.querySelectorAll('#cs-remediation-rules .ct-rem-group').forEach(group => {
        const hasVisible = Array.from(group.querySelectorAll('.ct-rem-rule-item'))
            .some(i => i.style.display !== 'none');
        group.style.display = hasVisible ? '' : 'none';
        if (hasVisible && term) group.open = true;
    });
    const anyVisible = Array.from(
        document.querySelectorAll('#cs-remediation-rules .ct-rem-rule-item')
    ).some(i => i.style.display !== 'none');
    let noResults = document.getElementById('cs-rem-no-results');
    if (!noResults) {
        noResults = document.createElement('p');
        noResults.id = 'cs-rem-no-results';
        noResults.className = 'ct-rem-no-results';
        noResults.textContent = 'No matching rules.';
        document.getElementById('cs-remediation-rules').after(noResults);
    }
    noResults.classList.toggle('hidden', !term || anyVisible);
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

function generateCsSelectiveFix(fixType, selectedIds, btnEl) {
    const selected = selectedIds ||
        Array.from(document.querySelectorAll('#cs-remediation-rules .ct-rem-checkbox'))
            .filter(c => c.checked).map(c => c.dataset.id);
    if (!selected.length) return;

    const remFile = csRemDir + (fixType === 'bash' ? 'remediation.sh' : 'remediation.yml');
    const ext     = fixType === 'bash' ? '.sh' : '.yml';
    const mime    = fixType === 'bash' ? 'text/x-shellscript' : 'text/yaml';
    const ts      = csRemDir.replace(/\/$/, '').split('/').pop();
    const fname   = 'container-selective-remediation-' + ts + ext;
    const btn     = btnEl || document.getElementById(fixType === 'bash' ? 'cs-rem-bash-btn' : 'cs-rem-ansible-btn');

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
        appendActivityLog({ type: 'remediate_download', tab: 'container',
            fix_type: fixType, rules_selected: selected.length });
    })
    .catch(err => console.error('Container selective remediation failed:', err.message || err));
}

