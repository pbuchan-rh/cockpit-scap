import cockpit from 'cockpit';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Tab, Tabs, TabTitleText } from "@patternfly/react-core/dist/esm/components/Tabs/index.js";

import { makeTmpdir, startScan, readResults, cleanupTmpdir } from './lib/oscap.js';
import { parseResults } from './lib/results.js';
import { ScanSetup } from './components/ScanSetup.jsx';
import { ScanProgress } from './components/ScanProgress.jsx';
import { ScanResults } from './components/ScanResults.jsx';
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

    useEffect(() => {
        if (typeof cockpit.permission !== 'function') return;
        const permission = cockpit.permission({ admin: true });
        const update = () => setAdminAllowed(permission.allowed !== false);
        update();
        permission.addEventListener('changed', update);
        return () => permission.removeEventListener('changed', update);
    }, []);

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

            const files = await readResults(dir);
            const parsed = parseResults(files.resultsXml);
            setScanResult({ ...parsed, ...files });
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

    const handleTailoringSaved = useCallback(() => {
        setTailoringRefreshKey(k => k + 1);
        setEditingSidecar(null);
    }, []);

    const handleTailoringListChanged = useCallback(() => {
        setTailoringRefreshKey(k => k + 1);
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

                {!adminAllowed && phase === 'setup' && activeTab === 'scan' && (
                    <Alert variant="info" title={_("Administrative access required")} isInline>
                        {_('Running a scan requires root. Unlock "Administrative access" above to continue.')}
                    </Alert>
                )}

                <Tabs activeKey={activeTab} onSelect={(_e, key) => setActiveTab(key)}>
                    <Tab eventKey="scan" title={<TabTitleText>{_("Scan")}</TabTitleText>}>
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
                        </div>
                    </Tab>
                    <Tab eventKey="tailoring" title={<TabTitleText>{_("Tailoring")}</TabTitleText>}>
                        <div className="ct-tab-body ct-tailoring-tab">
                            <TailoringList refreshKey={tailoringRefreshKey} onEdit={setEditingSidecar} onChanged={handleTailoringListChanged} />
                            <TailoringEditor
                                editingSidecar={editingSidecar}
                                onSaved={handleTailoringSaved}
                                onCancelEdit={() => setEditingSidecar(null)}
                            />
                        </div>
                    </Tab>
                </Tabs>
            </PageSection>
        </Page>
    );
};
