import cockpit from 'cockpit';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";

import { makeTmpdir, startScan, readResults, cleanupTmpdir } from './lib/oscap.js';
import { parseResults } from './lib/results.js';
import { ScanSetup } from './components/ScanSetup.jsx';
import { ScanProgress } from './components/ScanProgress.jsx';
import { ScanResults } from './components/ScanResults.jsx';

const _ = cockpit.gettext;

export const App = () => {
    const [phase, setPhase] = useState('setup'); // 'setup' | 'running' | 'results'
    const [adminAllowed, setAdminAllowed] = useState(true);
    const [error, setError] = useState(null);
    const [output, setOutput] = useState([]);
    const [scanProc, setScanProc] = useState(null);
    const [tmpdir, setTmpdir] = useState(null);
    const [scanResult, setScanResult] = useState(null);

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

                {!adminAllowed && phase === 'setup' && (
                    <Alert variant="info" title={_("Administrative access required")} isInline>
                        {_('Running a scan requires root. Unlock "Administrative access" above to continue.')}
                    </Alert>
                )}

                {phase === 'setup' && (
                    <ScanSetup adminAllowed={adminAllowed} onScan={handleScan} />
                )}

                {phase === 'running' && (
                    <ScanProgress output={output} onCancel={handleCancel} />
                )}

                {phase === 'results' && (
                    <ScanResults result={scanResult} tmpdir={tmpdir} onNewScan={handleNewScan} />
                )}
            </PageSection>
        </Page>
    );
};
