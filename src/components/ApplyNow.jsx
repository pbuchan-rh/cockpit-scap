import cockpit from 'cockpit';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, AlertActionCloseButton, AlertActionLink } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";

import { downloadFile } from '../lib/download.js';
import { formatAge } from '../lib/format.js';
import { generateScopedFix, isEmptyFix } from '../lib/oscap.js';
import {
    collectRunResult, followOutput, getRunState, listRemediationRuns, readRunLog, readRunMeta, startRemediation,
} from '../lib/remediate.js';
import { SEVERITY_COLOR, SEVERITY_LABEL } from '../lib/rules.js';
import { formatClock } from './ScanProgress.jsx';

const _ = cockpit.gettext;

// Output kept for display; a fix that prints more keeps only the end.
const MAX_OUTPUT = 2 * 1024 * 1024;
// Pixels from the bottom that still count as "following" the output.
const FOLLOW_SLACK = 8;

function formatTime(ms) {
    return new Date(ms).toLocaleTimeString(undefined, { timeStyle: 'short' });
}

/* "Scan of Oct 14, 6:04 PM (1 day ago)" */
export function scanAgeText(startTime, now = Date.now()) {
    if (!startTime) return _("Scan of unknown date");
    const d = new Date(startTime);
    if (isNaN(d)) return _("Scan of unknown date");
    const when = d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    return cockpit.format(_("Scan of $0 ($1)"), when, formatAge(d, now));
}

/* The one remediation run this page knows about, if any:
 * { meta, status: 'running'|'done', output, limited, exitCode, logWritten,
 * finishedAt }. Finds a run already in progress when the page loads (or
 * becomes visible again), follows its output and notices when it ends.
 * A run found without admin access is `limited` (its meta is root-only);
 * when `adminAllowed` turns on while it runs, it is attached fully (L2). */
export function useRemediationRun(adminAllowed) {
    const [run, setRun] = useState(null);
    const runRef = useRef(null);
    const followRef = useRef(null);
    runRef.current = run;

    const stopFollowing = () => {
        if (followRef.current) followRef.current.close();
        followRef.current = null;
    };

    const attach = useCallback((meta, limited) => {
        stopFollowing();
        setRun({ meta, status: 'running', output: '', limited });
        if (limited) return;
        followRef.current = followOutput(meta.dir, chunk => setRun(r => {
            if (!r || r.meta.unit !== meta.unit || r.status !== 'running') return r;
            const output = r.output + chunk;
            return { ...r, output: output.length > MAX_OUTPUT ? output.slice(-MAX_OUTPUT) : output };
        }));
    }, []);

    // A full run needs nothing more; a limited one is upgraded once its
    // meta can be read.
    const settled = () => runRef.current?.status === 'running' && !runRef.current.limited;

    const discover = useCallback(async () => {
        if (settled()) return;
        let runs = [];
        try {
            runs = await listRemediationRuns();
        } catch (ex) {
            console.warn('Could not list remediation units:', ex.message || ex);
            return;
        }
        const active = runs.find(r => r.running);
        if (!active || (runRef.current?.meta.unit === active.unit && !runRef.current.limited)) return;
        let meta = null;
        if (active.dir) {
            try {
                meta = await readRunMeta(active.dir);
            } catch {
                meta = null; // limited access, or another session's run that already ended
            }
        }
        if (settled()) return;
        if (meta) attach(meta, false);
        else if (runRef.current?.meta.unit !== active.unit)
            attach({ unit: active.unit, startedAt: active.startedAt || Date.now(), rules: [] }, true);
    }, [attach]);

    useEffect(() => {
        discover();
        const onVisible = () => { if (!document.hidden) discover(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            stopFollowing();
        };
    }, [discover]);

    // Admin turned on (not the first render: the mount effect above has
    // already looked): a limited run can now be followed.
    const adminRef = useRef(adminAllowed);
    useEffect(() => {
        const was = adminRef.current;
        adminRef.current = adminAllowed;
        if (adminAllowed && !was && runRef.current?.limited && runRef.current.status === 'running') discover();
    }, [adminAllowed, discover]);

    const status = run?.status;
    const unit = run?.meta.unit;
    const limited = run?.limited;
    useEffect(() => {
        if (status !== 'running') return;
        const meta = runRef.current.meta;
        let stopped = false;
        let checking = false;
        const timer = setInterval(async () => {
            if (stopped || checking) return;
            checking = true;
            try {
                const state = await getRunState(meta.unit);
                if (stopped) return;
                if (state.running) {
                    // Admin is on but the upgrade's meta read failed (e.g.
                    // the superuser bridge was not ready yet): try again.
                    if (limited && adminRef.current) discover();
                    return;
                }
                stopped = true;
                clearInterval(timer);
                const result = meta.logPath
                    ? await collectRunResult(meta)
                    : { exitCode: null, output: '', finishedAt: Date.now(), logWritten: false };
                stopFollowing();
                setRun(r => (r && r.meta.unit === meta.unit
                    ? { ...r, ...result, output: result.output || r.output, status: 'done' }
                    : r));
            } catch (ex) {
                console.warn('Could not check the remediation unit:', ex.message || ex);
            } finally {
                checking = false;
            }
        }, 2000);
        return () => {
            stopped = true;
            clearInterval(timer);
        };
    }, [status, unit, limited, discover]);

    const start = useCallback(async (source, script) => {
        const meta = await startRemediation(source, script);
        attach(meta, false);
        return meta;
    }, [attach]);

    const dismiss = useCallback(() => {
        stopFollowing();
        setRun(null);
    }, []);

    return { run, start, dismiss };
}

/* Inline alert while a run continues with its dialog closed (also after a
 * page reload), and once it ends until dismissed. */
export const RemediationAlert = ({ run, onView, onDismiss }) => {
    if (!run) return null;
    const view = <AlertActionLink onClick={onView}>{_("View output")}</AlertActionLink>;
    if (run.status === 'running') {
        return (
            <Alert
                variant="info" isInline className="ct-remediation-alert"
                title={cockpit.format(_("A remediation is running on this host (started $0)"), formatTime(run.meta.startedAt))}
                actionLinks={run.limited ? undefined : view}
            >
                {run.limited ? _("Turn on administrative access to follow its output.") : null}
            </Alert>
        );
    }
    const ok = run.exitCode === 0;
    return (
        <Alert
            variant={ok ? 'success' : 'danger'} isInline className="ct-remediation-alert"
            title={run.exitCode === null
                ? _("The remediation has finished")
                : ok
                    ? _("The remediation finished (exit code 0)")
                    : cockpit.format(_("The remediation failed (exit code $0)"), run.exitCode)}
            actionLinks={view}
            actionClose={<AlertActionCloseButton onClose={onDismiss} />}
        />
    );
};

const RuleList = ({ rules }) => (
    <ul className="ct-apply-rules">
        {rules.map(r => (
            <li key={r.id} className="ct-apply-rule">
                <Label isCompact color={SEVERITY_COLOR[r.severity] ?? SEVERITY_COLOR.unknown}>
                    {SEVERITY_LABEL[r.severity] ?? SEVERITY_LABEL.unknown}
                </Label>
                <span className="ct-apply-rule-title">{r.title}</span>
            </li>
        ))}
    </ul>
);

/* Confirm step: generates the script when it opens, so what the user can
 * inspect under "View script" is exactly what runs. */
const ConfirmBody = ({ request, script, genError, empty, startError }) => {
    const [showScript, setShowScript] = useState(false);
    const { source } = request;
    return (
        <>
            <Alert variant="danger" isInline className="ct-apply-warning" title={_("These fixes run as root and change this host")}>
                <p>
                    {_("Some fixes (bootloader, SELinux, kernel arguments, mount options) only take effect after a reboot. Fixes are not undone automatically.")}
                </p>
                <p>
                    {_("A remediation cannot be cancelled once it starts. Closing this dialog or the page does not stop it.")}
                </p>
            </Alert>
            <DescriptionList isCompact isHorizontal className="ct-apply-context">
                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Host")}</DescriptionListTerm>
                    <DescriptionListDescription className="ct-apply-host">{source.host || _("Local host")}</DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Source")}</DescriptionListTerm>
                    <DescriptionListDescription className="ct-apply-scan">{scanAgeText(source.scanStartTime)}</DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Profile")}</DescriptionListTerm>
                    <DescriptionListDescription>{source.profileTitle}</DescriptionListDescription>
                </DescriptionListGroup>
            </DescriptionList>
            <p className="ct-apply-rules-heading">
                {cockpit.format(cockpit.ngettext("$0 rule", "$0 rules", source.rules.length), source.rules.length)}
            </p>
            <RuleList rules={source.rules} />
            {script === null && !genError && (
                <p className="ct-apply-generating"><Spinner size="md" /> {_("Generating the remediation script…")}</p>
            )}
            {genError && (
                <Alert variant="danger" isInline title={_("Fix generation failed")}>{genError}</Alert>
            )}
            {empty && (
                <Alert variant="warning" isInline title={_("Empty remediation")}>
                    {_("None of the selected rules has a Bash remediation, so there is nothing to apply.")}
                </Alert>
            )}
            {script !== null && !empty && (
                <ExpandableSection
                    className="ct-apply-script-toggle"
                    toggleText={showScript ? _("Hide script") : _("View script")}
                    isExpanded={showScript}
                    onToggle={(_e, open) => setShowScript(open)}
                >
                    <pre className="ct-apply-pre ct-apply-script">{script}</pre>
                </ExpandableSection>
            )}
            {startError && (
                <Alert variant="danger" isInline title={_("The remediation could not be started")}>{startError}</Alert>
            )}
        </>
    );
};

const ProgressBody = ({ run }) => {
    const preRef = useRef(null);
    const followRef = useRef(true);
    const [now, setNow] = useState(Date.now());
    const running = run.status === 'running';
    const { meta } = run;

    useEffect(() => {
        if (!running) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [running]);

    useLayoutEffect(() => {
        const el = preRef.current;
        if (el && followRef.current) el.scrollTop = el.scrollHeight;
    }, [run.output]);

    const onScroll = () => {
        const el = preRef.current;
        if (el) followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK;
    };

    const end = running ? now : (run.finishedAt || now);
    const elapsed = Math.max(0, Math.floor((end - meta.startedAt) / 1000));
    const nRules = meta.rules?.length ?? 0;

    return (
        <>
            {!running && (
                run.exitCode === 0
                    ? (
                        <Alert variant="success" isInline title={_("The remediation finished (exit code 0)")}>
                            {_("Rescan to verify that the rules now pass. Some fixes only take effect after a reboot.")}
                        </Alert>
                    )
                    : (
                        <Alert
                            variant="danger" isInline
                            title={run.exitCode === null
                                ? _("The remediation ended, but its exit code is unknown")
                                : cockpit.format(_("The remediation failed (exit code $0)"), run.exitCode)}
                        >
                            {_("Some fixes may have been applied. Check the output, then rescan to see what changed.")}
                        </Alert>
                    )
            )}
            {!running && meta.logPath && !run.logWritten && run.exitCode !== undefined && (
                <Alert variant="warning" isInline title={_("The remediation log could not be written")}>
                    {meta.logPath}
                </Alert>
            )}
            <p className="ct-apply-status">
                {running && <Spinner size="md" className="ct-apply-status-spinner" />}
                {running
                    ? cockpit.format(_("Started $0 · Elapsed $1"), formatTime(meta.startedAt), formatClock(elapsed))
                    : cockpit.format(_("Started $0 · Took $1"), formatTime(meta.startedAt), formatClock(elapsed))}
                {nRules > 0 && ` · ${cockpit.format(cockpit.ngettext("$0 rule", "$0 rules", nRules), nRules)}`}
            </p>
            {running && (
                <p className="ct-apply-note">
                    {_("This cannot be cancelled. You can close this dialog; the fixes keep running and the page shows when they finish.")}
                </p>
            )}
            {run.limited
                ? <p className="ct-apply-note">{_("Turn on administrative access to follow the output.")}</p>
                : (
                    <pre ref={preRef} onScroll={onScroll} className="ct-apply-pre ct-apply-output" tabIndex={0} aria-label={_("Remediation output")}>
                        {run.output || (running ? _("Waiting for output…") : _("No output."))}
                    </pre>
                )}
            {!running && meta.logPath && run.logWritten && (
                <p className="ct-apply-note ct-apply-log-path">{cockpit.format(_("Log: $0"), meta.logPath)}</p>
            )}
        </>
    );
};

/* The ONE Apply now dialog (amendments item 2 and 5): confirm, then the
 * same dialog shows the run. `request` = { source } while confirming;
 * `run` = useRemediationRun()'s run once started. */
export const ApplyNowDialog = ({ request, run, adminAllowed, scanRunning, onStart, onClose, onRescan }) => {
    const [script, setScript] = useState(null);
    const [genError, setGenError] = useState(null);
    const [starting, setStarting] = useState(false);
    const [startError, setStartError] = useState(null);
    const [logError, setLogError] = useState(null);
    const [downloading, setDownloading] = useState(false);
    const confirming = !!request && !run;
    const source = request?.source;

    useEffect(() => {
        if (!source) return;
        let cancelled = false;
        setScript(null);
        setGenError(null);
        generateScopedFix(source.scope, source.rules.map(r => r.id), 'bash')
                .then(text => { if (!cancelled) setScript(text); })
                .catch(ex => { if (!cancelled) setGenError(ex.message || String(ex)); });
        return () => { cancelled = true };
    }, [source]);

    const empty = script !== null && isEmptyFix(script, 'bash');

    async function apply() {
        setStarting(true);
        setStartError(null);
        try {
            const { scope, ...rest } = source;
            await onStart(rest, script);
        } catch (ex) {
            setStartError(ex.message || String(ex));
        } finally {
            setStarting(false);
        }
    }

    async function downloadLog() {
        setDownloading(true);
        setLogError(null);
        try {
            const text = await readRunLog(run.meta.logPath);
            await downloadFile(text, run.meta.logPath.split('/').pop());
        } catch (ex) {
            setLogError(ex.message || String(ex));
        } finally {
            setDownloading(false);
        }
    }

    let title;
    let icon;
    if (confirming) {
        title = _("Apply fixes to this host?");
        icon = 'danger';
    } else if (run.status === 'running') {
        title = _("Applying fixes");
        icon = 'info';
    } else if (run.exitCode === 0) {
        title = _("Fixes applied");
        icon = 'success';
    } else {
        title = _("Remediation failed");
        icon = 'danger';
    }

    const done = run?.status === 'done';
    return (
        <Modal
            variant="medium" isOpen onClose={onClose} className="ct-apply-modal"
            aria-labelledby="ct-apply-title" aria-describedby="ct-apply-body"
        >
            <ModalHeader title={title} titleIconVariant={icon} labelId="ct-apply-title" />
            <ModalBody id="ct-apply-body">
                {confirming
                    ? <ConfirmBody request={request} script={script} genError={genError} empty={empty} startError={startError} />
                    : <ProgressBody run={run} />}
                {logError && <Alert variant="danger" isInline title={_("Could not download the log")}>{logError}</Alert>}
            </ModalBody>
            <ModalFooter>
                {confirming && !empty && !genError && (
                    <Button variant="danger" isDisabled={script === null || starting} isLoading={starting} onClick={apply}>
                        {_("Apply")}
                    </Button>
                )}
                {done && run.meta.scanProfileId && (
                    <Button variant="primary" isDisabled={!adminAllowed || scanRunning} onClick={() => onRescan(run.meta)}>
                        {_("Rescan to verify")}
                    </Button>
                )}
                {done && run.logWritten && (
                    <Button variant="secondary" isLoading={downloading} isDisabled={downloading} onClick={downloadLog}>
                        {_("Download log")}
                    </Button>
                )}
                <Button variant="link" onClick={onClose}>{confirming ? _("Cancel") : _("Close")}</Button>
            </ModalFooter>
        </Modal>
    );
};
