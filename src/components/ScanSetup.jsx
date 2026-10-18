import cockpit from 'cockpit';
import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider/index.js";
import { Dropdown } from "@patternfly/react-core/dist/esm/components/Dropdown/Dropdown.js";
import { DropdownItem } from "@patternfly/react-core/dist/esm/components/Dropdown/DropdownItem.js";
import { DropdownList } from "@patternfly/react-core/dist/esm/components/Dropdown/DropdownList.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle/MenuToggle.js";
import { MenuToggleAction } from "@patternfly/react-core/dist/esm/components/MenuToggle/MenuToggleAction.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { LockIcon } from "@patternfly/react-icons/dist/esm/icons/lock-icon.js";

import { formatBytes, formatTimestamp } from '../lib/format.js';
import { checkUploadSize, sanitizeFilename, statExistingContent, uploadContent } from '../lib/content.js';
import { downloadFile } from '../lib/download.js';
import {
    autoSelectContent, cpeDisplayName, detectContent, generateGuide, generateProfileFix, getContentPlatform,
    getOsRelease, getProfiles, isEmptyFix, isPlatformMismatch, stripOscapNoise,
} from '../lib/oscap.js';
import { listScans } from '../lib/scanHistory.js';
import { listTailoringFiles } from '../lib/tailoring.js';
import { openReportViewer } from '../lib/reportViewer.js';
import { ContentFieldError, ContentSelect } from './ContentSelect.jsx';
import { CONTENT_PACKAGES, MissingPackagesCard } from './MissingPackages.jsx';
import { OtherContentMenu } from './OtherContentMenu.jsx';
import { ProfileDescriptionPanel } from './ProfileDescriptionPanel.jsx';
import { SelectField } from './SelectField.jsx';

const _ = cockpit.gettext;

const FIX_TYPES = [
    { key: 'bash', label: _("Bash"), ext: '.sh', mimeType: 'text/x-shellscript', tooltip: _("Shell script for direct execution on RHEL/Fedora systems") },
    { key: 'ansible', label: _("Ansible"), ext: '.yml', mimeType: 'text/yaml', tooltip: _("Ansible playbook for automated configuration management") },
    { key: 'puppet', label: _("Puppet"), ext: '.pp', mimeType: 'text/plain', tooltip: _("Puppet manifest for Puppet-managed infrastructure") },
];


function slugify(text) {
    return text.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
}

export const ScanSetup = ({
    adminAllowed, remediationRunning, onScan, tailoringRefreshKey, contentRefreshKey, onContentChanged,
    onManageContent, onPackagesInstalled,
}) => {
    const [contentList, setContentList] = useState([]);
    const [content, setContent] = useState('');
    // { message, details? } shown on the Content file field when oscap
    // cannot read the chosen content.
    const [contentError, setContentError] = useState(null);
    const [profiles, setProfiles] = useState([]);
    const [profile, setProfile] = useState('');
    const [tailoringFiles, setTailoringFiles] = useState([]);
    const [tailoringSelection, setTailoringSelection] = useState('');
    const [loadingContent, setLoadingContent] = useState(true);
    const [loadingProfiles, setLoadingProfiles] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    const [pendingUpload, setPendingUpload] = useState(null); // { file, existing }
    const fileInputRef = useRef(null);
    const [guideBusy, setGuideBusy] = useState(false);
    const [guideError, setGuideError] = useState(null);
    const [fixBusy, setFixBusy] = useState(null); // 'bash' | 'ansible' | 'puppet'
    const [fixError, setFixError] = useState(null);
    const [fixWarning, setFixWarning] = useState(null);
    const [isFixMenuOpen, setIsFixMenuOpen] = useState(false);
    const [host, setHost] = useState({ cpe: '', prettyName: '' });
    const [contentCpe, setContentCpe] = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoadingContent(true);
        Promise.all([detectContent(), getOsRelease()])
                .then(([list, { id, versionId, cpe, prettyName }]) => {
                    if (cancelled) return;
                    setContentList(list);
                    setHost({ cpe, prettyName });
                    // Only re-pick a default on first load or if the previously
                    // selected content vanished (e.g. deleted elsewhere) — an
                    // unrelated refresh (upload from another picker) must not
                    // clobber the user's own pick.
                    setContent(prev => (prev && list.some(c => c.path === prev)) ? prev : autoSelectContent(list, id, versionId));
                    setLoadingContent(false);
                })
                .catch(() => {
                    if (!cancelled) setLoadingContent(false);
                });
        return () => { cancelled = true };
    }, [contentRefreshKey]);

    useEffect(() => {
        setProfiles([]);
        setProfile('');
        setTailoringSelection('');
        setContentCpe(null);
        if (!content) {
            setLoadingProfiles(false);
            return;
        }
        let cancelled = false;
        setLoadingProfiles(true);
        setContentError(null);
        getContentPlatform(content).then(cpe => { if (!cancelled) setContentCpe(cpe); });
        // No silent default (R4): preselect only the profile of the newest
        // saved scan of this same content (Amendment 1: derived from
        // ~/SCAP/scans, no new storage), else "Select a profile…".
        Promise.all([getProfiles(content), listScans().catch(() => [])])
                .then(([list, scans]) => {
                    if (cancelled) return;
                    setProfiles(list);
                    const last = scans.find(sc => sc.sds_file === content); // listScans is newest first
                    const lastId = last && (last.base_profile_id || last.profile_id);
                    setProfile(list.some(p => p.id === lastId) ? lastId : '');
                    setLoadingProfiles(false);
                })
                .catch(ex => {
                    if (cancelled) return;
                    // The content is at fault, not the profile: the error
                    // goes on the Content file field.
                    setContentError({
                        message: _("This file isn't SCAP content that OpenSCAP can read."),
                        details: stripOscapNoise(ex.message || String(ex)),
                    });
                    setLoadingProfiles(false);
                });
        return () => { cancelled = true };
    }, [content]);

    function handleSelectContent(path) {
        setContentError(null);
        setContent(path);
    }

    useEffect(() => {
        let cancelled = false;
        listTailoringFiles().then(list => { if (!cancelled) setTailoringFiles(list); });
        return () => { cancelled = true };
    }, [tailoringRefreshKey]);

    const tailoringForContent = useMemo(
        () => tailoringFiles.filter(sc => sc.sds_path === content),
        [tailoringFiles, content]
    );
    const selectedTailoring = tailoringForContent.find(sc => sc.path === tailoringSelection) ?? null;

    const contentReady = !!content && !contentError;
    const canScan = adminAllowed && !remediationRunning && contentReady && (selectedTailoring || profile) && !loadingProfiles;
    // View Compliance Guide / Download Remediation read only world-readable
    // static SCAP content (and, optionally, the user's own tailoring file) —
    // neither needs superuser, so unlike canScan above, this is deliberately
    // NOT gated behind adminAllowed.
    const canGenerate = contentReady && (selectedTailoring || profile) && !loadingProfiles;

    // The TAILORED profile id with the tailoring file — the base id would
    // make oscap ignore the tailoring (C§1c-2).
    const activeProfileId = selectedTailoring ? selectedTailoring.profile_id : profile;
    const platformMismatch = isPlatformMismatch(contentCpe, host.cpe);
    const activeTailoringPath = selectedTailoring ? selectedTailoring.path : null;
    const activeProfileTitle = selectedTailoring
        ? selectedTailoring.name
        : (profiles.find(p => p.id === profile)?.title || profile);

    // Nothing to scan with: an EmptyState instead of the form.
    const noContent = !loadingContent && contentList.length === 0;

    function handleSubmit(e) {
        e.preventDefault();
        if (!canScan) return;
        onScan({
            content,
            profile: selectedTailoring ? selectedTailoring.profile_id : profile,
            tailoring: selectedTailoring ? selectedTailoring.path : null,
            tailoringName: selectedTailoring ? selectedTailoring.name : null,
            baseProfileId: selectedTailoring ? selectedTailoring.base_profile_id : profile,
            baseProfileTitle: (selectedTailoring
                ? (profiles.find(p => p.id === selectedTailoring.base_profile_id)?.title || selectedTailoring.base_profile_title)
                : profiles.find(p => p.id === profile)?.title) || null,
        });
    }

    function handleUploadClick() {
        fileInputRef.current?.click();
    }

    function doUpload(file) {
        setUploading(true);
        setUploadError(null);
        const reader = new FileReader();
        reader.onload = async ev => {
            try {
                const uploaded = await uploadContent(file.name, new Uint8Array(ev.target.result));
                setContentError(null);
                setContent(uploaded.path);
                onContentChanged?.();
            } catch (ex) {
                setUploadError(ex.message || String(ex));
            } finally {
                setUploading(false);
            }
        };
        reader.onerror = () => {
            setUploadError(_("Failed to read the selected file."));
            setUploading(false);
        };
        reader.readAsArrayBuffer(file);
    }

    async function handleFileChosen(e) {
        const file = e.target.files[0];
        e.target.value = '';
        // Guards against two uploads racing (e.g. a stat/confirm-replace
        // round trip still in flight) writing concurrent scratch files —
        // the modal closes as soon as the user confirms, before the actual
        // write/validate/rename pipeline below has settled.
        if (!file || uploading) return;

        try {
            sanitizeFilename(file.name);
            checkUploadSize(file.size);
        } catch (ex) {
            setUploadError(ex.message || String(ex));
            return;
        }

        const existing = await statExistingContent(file.name);
        if (existing) {
            setPendingUpload({ file, existing });
        } else {
            doUpload(file);
        }
    }

    function handleConfirmReplace() {
        const { file } = pendingUpload;
        setPendingUpload(null);
        doUpload(file);
    }

    function handleViewGuide() {
        if (!canGenerate || guideBusy) return;
        setGuideBusy(true);
        setGuideError(null);
        const htmlPromise = generateGuide(content, activeProfileId, activeTailoringPath);
        const popupOpened = openReportViewer(htmlPromise);
        htmlPromise
                .then(() => {
                    setGuideBusy(false);
                    if (!popupOpened) {
                        setGuideError(_("Your browser blocked the compliance guide from opening in a new tab. Allow pop-ups for this site and try again."));
                    }
                })
                .catch(ex => {
                    setGuideBusy(false);
                    setGuideError(ex.message || String(ex));
                });
    }

    async function handleDownloadFix(fixType) {
        setIsFixMenuOpen(false);
        if (!canGenerate || fixBusy) return;
        setFixBusy(fixType);
        setFixError(null);
        setFixWarning(null);
        try {
            const script = await generateProfileFix(content, activeProfileId, activeTailoringPath, fixType);
            const { ext, label } = FIX_TYPES.find(f => f.key === fixType);
            if (isEmptyFix(script, fixType)) {
                setFixWarning(cockpit.format(_("No rule in \"$0\" has a $1 remediation, so there is nothing to download."), activeProfileTitle, label));
                return;
            }
            await downloadFile(script, `profile-remediation-${slugify(activeProfileTitle)}${ext}`);
        } catch (ex) {
            setFixError(ex.message || String(ex));
        } finally {
            setFixBusy(null);
        }
    }

    return (
        <>
            {guideError && (
                <Alert
                    variant="danger"
                    title={_("Failed to generate compliance guide")}
                    isInline
                    actionClose={
                        <Button variant="plain" onClick={() => setGuideError(null)}>×</Button>
                    }
                >
                    {guideError}
                </Alert>
            )}
            {fixError && (
                <Alert
                    variant="danger"
                    title={_("Failed to generate remediation")}
                    isInline
                    actionClose={
                        <Button variant="plain" onClick={() => setFixError(null)}>×</Button>
                    }
                >
                    {fixError}
                </Alert>
            )}
            {fixWarning && (
                <Alert
                    variant="warning"
                    title={_("Empty remediation")}
                    isInline
                    actionClose={
                        <Button variant="plain" onClick={() => setFixWarning(null)}>×</Button>
                    }
                >
                    {fixWarning}
                </Alert>
            )}
            {noContent && (
                <MissingPackagesCard
                    id="ct-scan-no-content"
                    cardTitle={_("SCAP Security Scan")}
                    emptyTitle={_("No SCAP content installed")}
                    description={_("OpenSCAP is installed, but there is no SCAP content to scan with. Install the SCAP Security Guide (scap-security-guide), or upload a SCAP datastream (.xml).")}
                    packages={CONTENT_PACKAGES}
                    installLabel={_("Install scap-security-guide")}
                    adminAllowed={adminAllowed}
                    onInstalled={onPackagesInstalled}
                    extraActions={
                        <Button variant="secondary" onClick={handleUploadClick} isLoading={uploading} isDisabled={uploading}>
                            {_("Upload content")}
                        </Button>
                    }
                >
                    {uploadError && (
                        <Alert
                            variant="danger" title={_("Upload failed")} isInline
                            actionClose={<Button variant="plain" onClick={() => setUploadError(null)}>×</Button>}
                        >
                            {uploadError}
                        </Alert>
                    )}
                </MissingPackagesCard>
            )}
            {!noContent && <Card>
                {/* Admin notice sits with the scan it gates (Peter 10-15), not
                    as a page banner above the tabs. Browsing, the guide and
                    remediation downloads still work without root. */}
                <CardHeader
                    actions={adminAllowed
                        ? undefined
                        : {
                            hasNoOffset: true,
                            actions: (
                                <span className="ct-admin-needed">
                                    <LockIcon className="ct-admin-needed-icon" />
                                    {_("Administrative access required to run a scan")}
                                </span>
                            ),
                        }}
                >
                    <CardTitle>
                        <Title headingLevel="h2" size="lg">{_("SCAP Security Scan")}</Title>
                    </CardTitle>
                </CardHeader>
                <Divider />
                <CardBody>
                    <div className="ct-two-col-form">
                        <div className="ct-form-col">
                            <Form onSubmit={handleSubmit} className="ct-scan-form">
                                <FormGroup label={_("Content file")} fieldId="ct-scap-content">
                                    {uploadError && (
                                        <Alert
                                            variant="danger" title={_("Upload failed")} isInline
                                            actionClose={<Button variant="plain" onClick={() => setUploadError(null)}>×</Button>}
                                        >
                                            {uploadError}
                                        </Alert>
                                    )}
                                    {loadingContent
                                        ? <Spinner size="sm" aria-label={_("Loading content")} />
                                        : <ContentSelect
                                            id="ct-scap-content"
                                            value={content}
                                            onChange={handleSelectContent}
                                            contentList={contentList}
                                            validated={contentError ? 'error' : 'default'}
                                            ariaDescribedBy={contentError ? 'ct-scap-content-error' : undefined}
                                            emptyLabel={_("No content found — upload a datastream to get started")}
                                        />}
                                    {contentError && <ContentFieldError id="ct-scap-content-error" error={contentError} />}
                                    <OtherContentMenu
                                        id="ct-scan-other-content"
                                        onUpload={handleUploadClick}
                                        uploading={uploading}
                                        onManage={onManageContent}
                                    />
                                    {platformMismatch && (
                                        <Alert
                                            variant="warning" isInline isPlain className="ct-content-mismatch"
                                            title={cockpit.format(
                                                _("This content is for $0, but this host runs $1"),
                                                cpeDisplayName(contentCpe), host.prettyName || cpeDisplayName(host.cpe)
                                            )}
                                        />
                                    )}
                                </FormGroup>

                                <FormGroup label={_("Profile")} fieldId="ct-scap-profile">
                                    {loadingProfiles
                                        ? <Spinner size="sm" aria-label={_("Loading profiles")} />
                                        : <SelectField
                                            id="ct-scap-profile"
                                            label={_("Profile")}
                                            value={selectedTailoring ? selectedTailoring.base_profile_id : profile}
                                            onChange={setProfile}
                                            options={profiles.map(p => ({ value: p.id, label: p.title || p.id }))}
                                            placeholder={profiles.length > 0
                                                ? _("Select a profile…")
                                                : contentReady ? _("No profiles found") : _("Select content first")}
                                            isDisabled={!contentReady || profiles.length === 0 || !!selectedTailoring}
                                        />}
                                </FormGroup>

                                <FormGroup label={_("Tailoring policy")} fieldId="ct-scap-tailoring-select">
                                    <SelectField
                                        id="ct-scap-tailoring-select"
                                        label={_("Tailoring policy")}
                                        value={tailoringSelection}
                                        onChange={setTailoringSelection}
                                        options={[
                                            { value: '', label: _("(No tailoring — use full profile)") },
                                            ...tailoringForContent.map(sc => ({ value: sc.path, label: sc.name })),
                                        ]}
                                    />
                                </FormGroup>
                            </Form>
                        </div>
                        <ProfileDescriptionPanel
                            profileId={selectedTailoring ? selectedTailoring.base_profile_id : profile}
                            sdsPath={contentReady ? content : ''}
                        />
                    </div>
                </CardBody>
                <Divider />
                <CardFooter className="ct-setup-footer">
                    <Flex flexWrap={{ default: 'wrap' }} spaceItems={{ default: 'spaceItemsSm' }}>
                        <FlexItem>
                            {adminAllowed && !remediationRunning
                                ? (
                                    <Button variant="primary" isDisabled={!canScan} onClick={handleSubmit}>
                                        {_("Run Scan")}
                                    </Button>
                                )
                                : (
                                    <Tooltip
                                        content={adminAllowed
                                            ? _("A remediation is running on this host. Scan when it has finished.")
                                            : _('Turn on "Administrative access" at the top of the page to run a scan')}
                                    >
                                        <Button variant="primary" isAriaDisabled>
                                            {_("Run Scan")}
                                        </Button>
                                    </Tooltip>
                                )}
                        </FlexItem>
                        <FlexItem>
                            <Tooltip content={_("Generate and view the full oscap security guide for the selected profile")}>
                                <Button
                                    variant="secondary"
                                    isDisabled={!canGenerate}
                                    isLoading={guideBusy}
                                    onClick={handleViewGuide}
                                >
                                    {_("View Compliance Guide")}
                                </Button>
                            </Tooltip>
                        </FlexItem>
                        <FlexItem>
                            <Dropdown
                                isOpen={isFixMenuOpen}
                                onOpenChange={setIsFixMenuOpen}
                                onSelect={() => setIsFixMenuOpen(false)}
                                toggle={toggleRef => (
                                    <>
                                        <MenuToggle
                                            ref={toggleRef}
                                            variant="secondary"
                                            isExpanded={isFixMenuOpen}
                                            isDisabled={!canGenerate || !!fixBusy}
                                            splitButtonItems={[
                                                <MenuToggleAction
                                                    key="download-remediation-primary"
                                                    id="ct-download-remediation-primary"
                                                    aria-label={_("Download Bash remediation")}
                                                    isDisabled={!canGenerate || !!fixBusy}
                                                    onClick={() => handleDownloadFix('bash')}
                                                >
                                                    {fixBusy === 'bash' ? <Spinner size="sm" aria-label={_("Generating…")} /> : _("Download Remediation")}
                                                </MenuToggleAction>,
                                            ]}
                                            onClick={() => setIsFixMenuOpen(o => !o)}
                                            aria-label={_("Select remediation format")}
                                        />
                                        {/* triggerRef (not child-wrapping) — this toggle's ref is already
                                            owned by Dropdown, and Tooltip's usual clone-child-and-inject-ref
                                            approach would collide with it. triggerRef attaches native
                                            mouseenter/focus listeners straight to the DOM node instead, so
                                            it can't interfere with MenuToggle/MenuToggleAction's own click
                                            handling — verified live below. */}
                                        <Tooltip
                                            content={_("Generate and download a remediation script for all rules in the selected profile — no scan required")}
                                            triggerRef={toggleRef}
                                        />
                                    </>
                                )}
                            >
                                <DropdownList>
                                    {FIX_TYPES.map(f => (
                                        <Tooltip key={f.key} content={f.tooltip}>
                                            <DropdownItem
                                                value={f.key}
                                                isDisabled={!canGenerate || !!fixBusy}
                                                onClick={() => handleDownloadFix(f.key)}
                                            >
                                                {cockpit.format(_("Download $0 ($1)"), f.label, f.ext)}
                                            </DropdownItem>
                                        </Tooltip>
                                    ))}
                                </DropdownList>
                            </Dropdown>
                        </FlexItem>
                    </Flex>
                </CardFooter>

            </Card>}
            <input
                ref={fileInputRef} type="file" accept=".xml" hidden
                onChange={handleFileChosen}
            />
            {pendingUpload && (
                <Modal variant="small" isOpen onClose={() => setPendingUpload(null)}>
                    <ModalHeader title={_("Replace existing content?")} />
                    <ModalBody>
                        {cockpit.format(
                            _("\"$0\" already exists ($1, uploaded $2). Replace with the new file ($3)?"),
                            pendingUpload.file.name,
                            formatBytes(pendingUpload.existing.size),
                            formatTimestamp(pendingUpload.existing.mtime),
                            formatBytes(pendingUpload.file.size)
                        )}
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="primary" onClick={handleConfirmReplace}>{_("Replace")}</Button>
                        <Button variant="link" onClick={() => setPendingUpload(null)}>{_("Cancel")}</Button>
                    </ModalFooter>
                </Modal>
            )}
        </>
    );
};
