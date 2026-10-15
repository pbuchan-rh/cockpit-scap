import cockpit from 'cockpit';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import {
    DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm,
} from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { Progress, ProgressMeasureLocation } from "@patternfly/react-core/dist/esm/components/Progress/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { ArrowDownIcon } from "@patternfly/react-icons/dist/esm/icons/arrow-down-icon.js";
import { BanIcon } from "@patternfly/react-icons/dist/esm/icons/ban-icon.js";
import { CheckCircleIcon } from "@patternfly/react-icons/dist/esm/icons/check-circle-icon.js";
import { ExclamationCircleIcon } from "@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon.js";
import { ExclamationTriangleIcon } from "@patternfly/react-icons/dist/esm/icons/exclamation-triangle-icon.js";

import { getContentVersion, parseProgressLine, sdsDisplayName } from '../lib/oscap.js';
import { ruleShortId } from '../lib/rules.js';

const _ = cockpit.gettext;

const RESULT_LABEL = {
    pass: _("Pass"),
    fixed: _("Fixed"),
    fail: _("Fail"),
    error: _("Error"),
    unknown: _("Unknown"),
    notapplicable: _("N/A"),
    notchecked: _("Not checked"),
    notselected: _("Not selected"),
    informational: _("Info"),
};

const ResultIcon = ({ result }) => {
    if (result === 'pass' || result === 'fixed')
        return <CheckCircleIcon className="ct-feed-icon ct-feed-icon-pass" />;
    if (result === 'fail')
        return <ExclamationCircleIcon className="ct-feed-icon ct-feed-icon-fail" />;
    if (result === 'error' || result === 'unknown')
        return <ExclamationTriangleIcon className="ct-feed-icon ct-feed-icon-error" />;
    return <BanIcon className="ct-feed-icon ct-feed-icon-other" />;
};

function formatClock(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    // ${n}: a bare "$0s" would be read as a placeholder named "0s".
    return m > 0 ? cockpit.format(_("${0}m ${1}s"), m, String(s).padStart(2, '0')) : cockpit.format(_("${0}s"), s);
}

// Pixels from the bottom that still count as "at the newest rule".
const FOLLOW_SLACK = 8;

/* Running view (spec A, v3 host-scan.js): context block, progress bar with
 * ETA, live PASSED / FAILED / ERRORS tiles, and a scrollable feed of the
 * evaluated rules that follows the newest until the user scrolls up.
 * Everything is derived from oscap's --progress lines (`output`); `info`
 * is app.jsx's { config, startedAt, total, titles }. */
export const ScanProgress = ({ output, info, onCancel }) => {
    const [now, setNow] = useState(Date.now());
    const [hostname, setHostname] = useState('');
    const [contentVersion, setContentVersion] = useState(null);
    const [failedOnly, setFailedOnly] = useState(false);
    const [follow, setFollow] = useState(true);
    const [showOutput, setShowOutput] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const feedRef = useRef(null);
    const config = info?.config || {};

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        let cancelled = false;
        cockpit.spawn(['hostname'], { err: 'ignore' })
                .then(out => { if (!cancelled) setHostname(out.trim()) })
                .catch(() => {});
        if (config.content) {
            getContentVersion(config.content).then(v => { if (!cancelled) setContentVersion(v) });
        }
        return () => { cancelled = true };
    }, [config.content]);

    const results = useMemo(() => output.map(parseProgressLine).filter(Boolean), [output]);
    const counts = useMemo(() => {
        const c = { pass: 0, fail: 0, error: 0 };
        for (const r of results) {
            if (r.result === 'pass' || r.result === 'fixed') c.pass++;
            else if (r.result === 'fail') c.fail++;
            else if (r.result === 'error' || r.result === 'unknown') c.error++;
        }
        return c;
    }, [results]);
    const feed = failedOnly ? results.filter(r => r.result === 'fail') : results;

    const done = results.length;
    const total = info?.total ? Math.max(info.total, done) : null;
    const elapsed = Math.max(0, Math.floor((now - (info?.startedAt ?? now)) / 1000));
    let eta = null;
    if (total && done >= 5 && elapsed >= 3) {
        const remaining = Math.round(elapsed / done * (total - done));
        eta = remaining <= 0
            ? _("Finishing…")
            : cockpit.format(_("about $0 remaining"), formatClock(remaining));
    }

    // Follow the newest rule unless the user scrolled up to read.
    useLayoutEffect(() => {
        const el = feedRef.current;
        if (el && follow) el.scrollTop = el.scrollHeight;
    }, [feed.length, follow, failedOnly]);

    function handleFeedScroll() {
        const el = feedRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK;
        if (atBottom !== follow) setFollow(atBottom);
    }

    function handleCancel() {
        setCancelling(true);
        onCancel();
    }

    const title = id => info?.titles?.[id] || ruleShortId(id).replace(/_/g, ' ');

    return (
        <Card className="ct-scan-progress" data-ct-running="">
            <CardHeader
                actions={{
                    actions: (
                        <Button variant="secondary" isLoading={cancelling} isDisabled={cancelling} onClick={handleCancel}>
                            {_("Cancel")}
                        </Button>
                    ),
                    hasNoOffset: true,
                }}
            >
                <CardTitle>
                    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                        <FlexItem><Spinner size="md" aria-label={_("Scan running")} /></FlexItem>
                        <FlexItem>
                            <Title headingLevel="h2" size="lg">{_("Scan in progress…")}</Title>
                        </FlexItem>
                    </Flex>
                </CardTitle>
            </CardHeader>
            <Divider />
            <CardBody>
                <Progress
                    className="ct-scan-progress-bar"
                    value={total ? Math.round(done / total * 100) : 0}
                    title={total
                        ? cockpit.format(_("$0 of $1 rules evaluated"), done, total)
                        : cockpit.format(cockpit.ngettext("$0 rule evaluated", "$0 rules evaluated", done), done)}
                    measureLocation={total ? ProgressMeasureLocation.outside : ProgressMeasureLocation.none}
                    helperText={
                        <span className="ct-scan-eta">
                            {cockpit.format(_("Elapsed $0"), formatClock(elapsed))}
                            {eta && <> · {eta}</>}
                        </span>
                    }
                    aria-label={_("Scan progress")}
                />
            </CardBody>
            <Divider />
            <CardBody>
                <div className="ct-scan-lower">
                    <DescriptionList isHorizontal isCompact className="ct-scan-context">
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Content")}</DescriptionListTerm>
                            <DescriptionListDescription>{sdsDisplayName(config.content)}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Version")}</DescriptionListTerm>
                            <DescriptionListDescription>{contentVersion || '—'}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Profile")}</DescriptionListTerm>
                            <DescriptionListDescription>{config.baseProfileTitle || config.baseProfileId || '—'}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Policy")}</DescriptionListTerm>
                            <DescriptionListDescription>{config.tailoringName || '—'}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Target")}</DescriptionListTerm>
                            <DescriptionListDescription>{hostname || _("Local host")}</DescriptionListDescription>
                        </DescriptionListGroup>
                    </DescriptionList>
                    <Divider orientation={{ default: 'horizontal', md: 'vertical' }} className="ct-scan-lower-divider" />
                    <div className="ct-live-tiles" aria-live="polite">
                        <div className="ct-live-tile ct-live-tile-pass">
                            <span className="ct-live-tile-num" data-ct-live="pass">{counts.pass}</span>
                            <span className="ct-live-tile-label">{_("Passed")}</span>
                        </div>
                        <div className="ct-live-tile ct-live-tile-fail">
                            <span className="ct-live-tile-num" data-ct-live="fail">{counts.fail}</span>
                            <span className="ct-live-tile-label">{_("Failed")}</span>
                        </div>
                        <div className="ct-live-tile ct-live-tile-error">
                            <span className="ct-live-tile-num" data-ct-live="error">{counts.error}</span>
                            <span className="ct-live-tile-label">{_("Errors")}</span>
                        </div>
                    </div>
                </div>
            </CardBody>
            <Divider />
            <CardBody>
                <Flex
                    className="ct-feed-toolbar"
                    alignItems={{ default: 'alignItemsCenter' }}
                    justifyContent={{ default: 'justifyContentSpaceBetween' }}
                    flexWrap={{ default: 'wrap' }}
                >
                    <FlexItem>
                        <Title headingLevel="h3" size="md">{_("Evaluated rules")}</Title>
                    </FlexItem>
                    <FlexItem>
                        <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsMd' }}>
                            {!follow && (
                                <FlexItem>
                                    <Button
                                        variant="link" isInline icon={<ArrowDownIcon />}
                                        onClick={() => setFollow(true)}
                                    >
                                        {_("Jump to latest")}
                                    </Button>
                                </FlexItem>
                            )}
                            <FlexItem>
                                <Switch
                                    id="ct-feed-failed-only"
                                    label={_("Failed only")}
                                    isChecked={failedOnly}
                                    onChange={(_e, checked) => { setFailedOnly(checked); setFollow(true) }}
                                />
                            </FlexItem>
                        </Flex>
                    </FlexItem>
                </Flex>
                <div
                    className="ct-rule-feed"
                    ref={feedRef}
                    onScroll={handleFeedScroll}
                    tabIndex={0}
                    role="log"
                    aria-label={_("Evaluated rules")}
                >
                    {feed.length === 0
                        ? (
                            <div className="ct-rule-feed-empty">
                                {failedOnly && done > 0 ? _("No failed rules yet.") : _("Waiting for the first rule…")}
                            </div>
                        )
                        : feed.map((r, i) => (
                            <div key={i} className={`ct-rule-feed-row ct-rule-feed-${r.result}`}>
                                <ResultIcon result={r.result} />
                                <span className="ct-rule-feed-name">{title(r.id)}</span>
                                <span className="ct-rule-feed-result">{RESULT_LABEL[r.result] || r.result}</span>
                            </div>
                        ))}
                </div>
                <ExpandableSection
                    className="ct-scan-output-section"
                    toggleText={showOutput ? _("Hide oscap output") : _("Show oscap output")}
                    isExpanded={showOutput}
                    onToggle={(_e, v) => setShowOutput(v)}
                >
                    <pre className="ct-scan-output">{output.join('\n')}</pre>
                </ExpandableSection>
            </CardBody>
        </Card>
    );
};
