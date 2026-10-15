import cockpit from 'cockpit';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Drawer, DrawerContent, DrawerContentBody } from "@patternfly/react-core/dist/esm/components/Drawer/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Tab, Tabs, TabTitleText } from "@patternfly/react-core/dist/esm/components/Tabs/index.js";

import { makeTmpdir, startScan, readResults, cleanupTmpdir } from './lib/oscap.js';
import { groupReferences, parseResults } from './lib/results.js';
import { extractProfile, flattenProfileRules, getTailoringDiskUsage, parseTailoringXml, readTailoringXml } from './lib/tailoring.js';
import { saveScan, readSavedScanFiles, getScanHistoryDiskUsage } from './lib/scanHistory.js';
import { ScanSetup } from './components/ScanSetup.jsx';
import { ScanProgress } from './components/ScanProgress.jsx';
import { ScanResults } from './components/ScanResults.jsx';
import { RemediationBuilder } from './components/RemediationBuilder.jsx';
import { ScapContentCard } from './components/ScapContentCard.jsx';
import { ScanHistory } from './components/ScanHistory.jsx';
import { TailoringEditor } from './components/TailoringEditor.jsx';
import { TailoringList } from './components/TailoringList.jsx';

const _ = cockpit.gettext;

export const App = () => {
    const [activeTab, setActiveTab] = useState('scan');
    const [phase, setPhase] = useState('setup'); // 'setup' | 'running' | 'results'
    const [adminAllowed, setAdminAllowed] = useState(true);
    const [error, setError] = useState(null);
    const [output, setOutput] = useState([]);
    const [scanProc, setScanProc] = useState(null);
    const [tmpdir, setTmpdir] = useState(null);
    const [scanResult, setScanResult] = useState(null);
    const [tailoringRefreshKey, setTailoringRefreshKey] = useState(0);
    const [editingSidecar, setEditingSidecar] = useState(null);
    const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
    const [contentRefreshKey, setContentRefreshKey] = useState(0);
    const [historySaveError, setHistorySaveError] = useState(null);
    const [scanDiskUsage, setScanDiskUsage] = useState(null);
    const [tailoringDiskUsage, setTailoringDiskUsage] = useState(null);
    // Remediation Builder drawer: null when closed, else { preset, key }
    // (key remounts it so each open starts from its preset selection).
    const [builder, setBuilder] = useState(null);
    // Running view: { config, startedAt, total, titles } for the scan in
    // flight. total (rules the profile/tailoring selects) and titles arrive
    // a moment after the scan starts, from the same extractProfile() call
    // the results' rule metadata uses.
    const [scanInfo, setScanInfo] = useState(null);
    // Bumped by history "View": scroll to and focus the results (R3).
    const [resultsFocusKey, setResultsFocusKey] = useState(0);

    useEffect(() => {
        if (typeof cockpit.permission !== 'function') return;
        const permission = cockpit.permission({ admin: true });
        const update = () => setAdminAllowed(permission.allowed !== false);
        update();
        permission.addEventListener('changed', update);
        return () => permission.removeEventListener('changed', update);
    }, []);

    // Re-fetched (not polled) whenever the respective refreshKey bumps —
    // i.e. after a scan/tailoring save or delete — so each total stays
    // accurate without a continuous background poll.
    useEffect(() => {
        getScanHistoryDiskUsage().then(setScanDiskUsage)
                .catch(() => {});
    }, [historyRefreshKey]);

    useEffect(() => {
        getTailoringDiskUsage().then(setTailoringDiskUsage)
                .catch(() => {});
    }, [tailoringRefreshKey]);

    const handleScan = useCallback(async (config) => {
        setError(null);
        setOutput([]);
        const startedAt = Date.now();
        setScanInfo({ config, startedAt, total: null, titles: null });
        setPhase('running');

        // Started alongside the scan: gives the running view its total and
        // rule titles, and the results their rule metadata.
        const extractedPromise = extractProfile(config.baseProfileId, config.content)
                .catch(ex => {
                    console.error('Failed to load rule metadata for scan results:', ex.message || ex);
                    return null;
                });
        const tailoringChanges = config.tailoring
            ? readTailoringXml(config.tailoring).then(parseTailoringXml)
                    .catch(() => null)
            : Promise.resolve(null);
        Promise.all([extractedPromise, tailoringChanges]).then(([extracted, changes]) => {
            if (!extracted) return;
            const rules = flattenProfileRules(extracted);
            const ruleChanges = changes?.ruleChanges || {};
            const total = rules.filter(r => (r.id in ruleChanges ? ruleChanges[r.id] : r.selected)).length;
            const titles = Object.fromEntries(rules.map(r => [r.id, r.title]));
            setScanInfo(s => (s && s.startedAt === startedAt ? { ...s, total: total || null, titles } : s));
        });

        let dir = null;
        try {
            dir = await makeTmpdir();
            setTmpdir(dir);

            const proc = startScan(config, dir, line => setOutput(o => [...o, line]));
            setScanProc(proc);

            let hasFindings = false;
            try {
                await proc;
            } catch (ex) {
                if (ex.exit_status === 2) {
                    hasFindings = true; // oscap exits 2 when rules fail — not an error
                } else if (ex.problem === 'cancelled') {
                    setPhase('setup');
                    setScanProc(null);
                    cleanupTmpdir(dir).catch(() => {});
                    setTmpdir(null);
                    return;
                } else {
                    throw ex;
                }
            }

            setScanProc(null);
            console.debug('Scan finished, hasFindings:', hasFindings);

            const [files, extracted] = await Promise.all([readResults(dir), extractedPromise]);
            const ruleMeta = {};
            if (extracted) {
                flattenProfileRules(extracted).forEach(r => {
                    ruleMeta[r.id] = {
                        title: r.title,
                        description: r.description,
                        rationale: r.rationale,
                        cce: r.cce,
                        automated: r.hasFix,
                        refs: groupReferences(r.refs || []),
                    };
                });
            }
            const parsed = parseResults(files.resultsXml);

            try {
                await saveScan({
                    profileId: config.profile,
                    profileTitle: config.tailoringName || extracted?.profile?.title || config.profile,
                    baseProfileId: config.baseProfileId,
                    sdsPath: config.content,
                    tailoringFile: config.tailoringName || null,
                    tailoringPath: config.tailoring,
                    parsed,
                    files,
                    ruleMeta,
                });
                setHistorySaveError(null);
            } catch (ex) {
                console.error('Failed to save scan to history:', ex.message || ex);
                setHistorySaveError(ex.message || String(ex));
            }
            setHistoryRefreshKey(k => k + 1);

            setBuilder(null);
            setScanResult({
                ...parsed,
                ...files,
                ruleMeta,
                profileId: config.baseProfileId,
                scanProfileId: config.profile,
                sdsPath: config.content,
                tailoringPath: config.tailoring,
                profileTitle: config.tailoringName || extracted?.profile?.title || config.profile,
                tailoringName: config.tailoringName || null,
            });
            setPhase('results');
        } catch (ex) {
            setError(ex.message || String(ex));
            setPhase('setup');
            setScanProc(null);
            if (dir) {
                cleanupTmpdir(dir).catch(() => {});
                setTmpdir(null);
            }
        }
    }, []);

    const handleCancel = useCallback(() => {
        if (scanProc) scanProc.close('cancelled');
    }, [scanProc]);

    const handleNewScan = useCallback(() => {
        if (tmpdir) {
            cleanupTmpdir(tmpdir).catch(() => {});
            setTmpdir(null);
        }
        setBuilder(null);
        setScanResult(null);
        setError(null);
        setOutput([]);
        setPhase('setup');
    }, [tmpdir]);

    const handleViewSavedScan = useCallback(async (manifest) => {
        const files = await readSavedScanFiles(manifest);
        const parsed = parseResults(files.resultsXml);
        setError(null);
        setScanResult({
            ...parsed,
            ...files,
            // rule_meta didn't exist in manifests saved before this fix —
            // degrade to {} (FailingRuleRow already renders fine with no meta).
            ruleMeta: manifest.rule_meta || {},
            profileId: manifest.base_profile_id || manifest.profile_id,
            // The profile actually evaluated (tailored id for a tailored
            // scan); falls back to what the results file itself says.
            scanProfileId: manifest.profile_id || parsed.header.testedProfileId,
            sdsPath: manifest.sds_file,
            tailoringPath: manifest.tailoring_path || null,
            profileTitle: manifest.profile_title || manifest.profile_id,
            tailoringName: manifest.tailoring_file || null,
        });
        setBuilder(null);
        setTmpdir(null);
        setPhase('results');
        setResultsFocusKey(k => k + 1);
    }, []);

    useEffect(() => {
        if (!resultsFocusKey) return;
        const heading = document.querySelector('[data-ct-results] .ct-results-profile');
        if (!heading) return;
        heading.closest('[data-ct-results]').scrollIntoView({ block: 'start', behavior: 'smooth' });
        heading.focus({ preventScroll: true });
    }, [resultsFocusKey]);

    const handleTailoringSaved = useCallback(() => {
        setTailoringRefreshKey(k => k + 1);
        setEditingSidecar(null);
    }, []);

    const handleTailoringListChanged = useCallback(() => {
        setTailoringRefreshKey(k => k + 1);
    }, []);

    const handleHistoryChanged = useCallback(() => {
        setHistoryRefreshKey(k => k + 1);
    }, []);

    const handleContentChanged = useCallback(() => {
        setContentRefreshKey(k => k + 1);
    }, []);

    // "Other content ▾" → Manage content: the SCAP Content card on the
    // Policy Tailoring tab, scrolled into view and focused.
    const [contentFocusKey, setContentFocusKey] = useState(0);
    const handleManageContent = useCallback(() => {
        setActiveTab('tailoring');
        setContentFocusKey(k => k + 1);
    }, []);

    useEffect(() => {
        if (!contentFocusKey) return;
        const title = document.querySelector('#ct-scap-content-card .ct-scap-content-title');
        if (!title) return;
        document.getElementById('ct-scap-content-card').scrollIntoView({ block: 'start', behavior: 'smooth' });
        title.focus({ preventScroll: true });
    }, [contentFocusKey]);

    const handleOpenBuilder = useCallback(preset => {
        setBuilder(b => ({ preset, key: (b?.key ?? 0) + 1 }));
    }, []);

    const builderPanel = builder && scanResult && phase === 'results'
        ? <RemediationBuilder key={builder.key} result={scanResult} preset={builder.preset} onClose={() => setBuilder(null)} />
        : null;

    return (
        <Drawer
            isExpanded={!!builderPanel}
            className="ct-builder-drawer-root"
            onExpand={() => document.querySelector('.ct-builder-title')?.focus()}
        >
            <DrawerContent panelContent={builderPanel ?? <span />}>
                <DrawerContentBody className="ct-drawer-main">
                    <Page className="pf-m-no-sidebar">
                        <PageSection>
                            {error && (
                                <Alert
                        variant="danger"
                        title={_("Scan failed")}
                        isInline
                        actionClose={
                            <Button variant="plain" onClick={() => setError(null)}>×</Button>
                        }
                                >
                                    {error}
                                </Alert>
                            )}

                            {historySaveError && (
                                <Alert
                        variant="warning"
                        title={_("Scan completed, but couldn't be saved to history")}
                        isInline
                        actionClose={
                            <Button variant="plain" onClick={() => setHistorySaveError(null)}>×</Button>
                        }
                                >
                                    {historySaveError}
                                </Alert>
                            )}

                            {!adminAllowed && phase === 'setup' && activeTab === 'scan' && (
                                <Alert variant="info" title={_("Administrative access required")} isInline>
                                    {_('Running a scan requires root. Unlock "Administrative access" above to continue.')}
                                </Alert>
                            )}

                            <Tabs activeKey={activeTab} onSelect={(_e, key) => setActiveTab(key)}>
                                <Tab eventKey="scan" title={<TabTitleText>{_("Host Scan")}</TabTitleText>}>
                                    <div className="ct-tab-body">
                                        {phase === 'setup' && (
                                            <ScanSetup
                                    adminAllowed={adminAllowed} onScan={handleScan}
                                    tailoringRefreshKey={tailoringRefreshKey}
                                    contentRefreshKey={contentRefreshKey}
                                    onContentChanged={handleContentChanged}
                                    onManageContent={handleManageContent}
                                            />
                                        )}

                                        {phase === 'running' && (
                                            <ScanProgress output={output} info={scanInfo} onCancel={handleCancel} />
                                        )}

                                        {phase === 'results' && (
                                            <ScanResults
                                    key={scanResult?.header?.startTime ?? 'results'}
                                    result={scanResult}
                                    onClose={handleNewScan}
                                    onOpenBuilder={handleOpenBuilder}
                                            />
                                        )}

                                        <ScanHistory
                                refreshKey={historyRefreshKey}
                                onView={handleViewSavedScan}
                                onChanged={handleHistoryChanged}
                                diskUsage={scanDiskUsage}
                                        />
                                    </div>
                                </Tab>
                                <Tab eventKey="tailoring" title={<TabTitleText>{_("Policy Tailoring")}</TabTitleText>}>
                                    <div className="ct-tab-body ct-tailoring-tab">
                                        <TailoringEditor
                                editingSidecar={editingSidecar}
                                onSaved={handleTailoringSaved}
                                onCancelEdit={() => setEditingSidecar(null)}
                                contentRefreshKey={contentRefreshKey}
                                onContentChanged={handleContentChanged}
                                onManageContent={handleManageContent}
                                        />
                                        <TailoringList
                                refreshKey={tailoringRefreshKey}
                                onEdit={setEditingSidecar}
                                onChanged={handleTailoringListChanged}
                                diskUsage={tailoringDiskUsage}
                                contentRefreshKey={contentRefreshKey}
                                        />
                                        <ScapContentCard
                                refreshKey={contentRefreshKey}
                                onChanged={handleContentChanged}
                                        />
                                    </div>
                                </Tab>
                            </Tabs>
                        </PageSection>
                    </Page>
                </DrawerContentBody>
            </DrawerContent>
        </Drawer>
    );
};
