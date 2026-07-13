import cockpit from 'cockpit';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Tab, Tabs, TabTitleText } from "@patternfly/react-core/dist/esm/components/Tabs/index.js";

import { makeTmpdir, startScan, readResults, cleanupTmpdir } from './lib/oscap.js';
import { parseResults } from './lib/results.js';
import { extractProfile, flattenProfileRules, getTailoringDiskUsage } from './lib/tailoring.js';
import { saveScan, readSavedScanFiles, getScanHistoryDiskUsage } from './lib/scanHistory.js';
import { ScanSetup } from './components/ScanSetup.jsx';
import { ScanProgress } from './components/ScanProgress.jsx';
import { ScanResults } from './components/ScanResults.jsx';
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
    const [historySaveError, setHistorySaveError] = useState(null);
    const [scanDiskUsage, setScanDiskUsage] = useState(null);
    const [tailoringDiskUsage, setTailoringDiskUsage] = useState(null);

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
        setPhase('running');

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

            const [files, extracted] = await Promise.all([
                readResults(dir),
                extractProfile(config.baseProfileId, config.content)
                        .catch(ex => {
                            console.error('Failed to load rule metadata for scan results:', ex.message || ex);
                            return null;
                        }),
            ]);
            const ruleMeta = {};
            if (extracted) {
                flattenProfileRules(extracted).forEach(r => {
                    ruleMeta[r.id] = { title: r.title, description: r.description, rationale: r.rationale, cce: r.cce, automated: r.hasFix };
                });
            }
            const parsed = parseResults(files.resultsXml);

            try {
                await saveScan({
                    profileId: config.profile,
                    profileTitle: config.tailoringName || extracted?.profile?.title || config.profile,
                    sdsPath: config.content,
                    tailoringFile: config.tailoringName || null,
                    parsed,
                    files,
                });
                setHistorySaveError(null);
            } catch (ex) {
                console.error('Failed to save scan to history:', ex.message || ex);
                setHistorySaveError(ex.message || String(ex));
            }
            setHistoryRefreshKey(k => k + 1);

            setScanResult({ ...parsed, ...files, ruleMeta });
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
        setScanResult(null);
        setError(null);
        setOutput([]);
        setPhase('setup');
    }, [tmpdir]);

    const handleViewSavedScan = useCallback(async (manifest) => {
        const files = await readSavedScanFiles(manifest);
        const parsed = parseResults(files.resultsXml);
        setError(null);
        setScanResult({ ...parsed, ...files, ruleMeta: {} });
        setTmpdir(null);
        setPhase('results');
    }, []);

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

    return (
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
                                <ScanSetup adminAllowed={adminAllowed} onScan={handleScan} tailoringRefreshKey={tailoringRefreshKey} />
                            )}

                            {phase === 'running' && (
                                <ScanProgress output={output} onCancel={handleCancel} />
                            )}

                            {phase === 'results' && (
                                <ScanResults result={scanResult} tmpdir={tmpdir} onNewScan={handleNewScan} />
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
                            />
                            <TailoringList
                                refreshKey={tailoringRefreshKey}
                                onEdit={setEditingSidecar}
                                onChanged={handleTailoringListChanged}
                                diskUsage={tailoringDiskUsage}
                            />
                        </div>
                    </Tab>
                </Tabs>
            </PageSection>
        </Page>
    );
};
