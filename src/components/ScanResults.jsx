import cockpit from 'cockpit';
import React, { useMemo, useState } from 'react';
import { Alert, AlertActionCloseButton } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardFooter, CardHeader } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider/index.js";
import { Dropdown, DropdownItem, DropdownList } from "@patternfly/react-core/dist/esm/components/Dropdown/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { Label, LabelGroup } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle/index.js";
import { SearchInput } from "@patternfly/react-core/dist/esm/components/SearchInput/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { AngleDownIcon } from "@patternfly/react-icons/dist/esm/icons/angle-down-icon.js";
import { AngleRightIcon } from "@patternfly/react-icons/dist/esm/icons/angle-right-icon.js";

import { downloadFile } from '../lib/download.js';
import { generateScopedFix, isEmptyFix, sdsDisplayName } from '../lib/oscap.js';
import { openReportViewer } from '../lib/reportViewer.js';
import {
    SEVERITY_COLOR, SEVERITY_LABEL, SEVERITY_ORDER, isCriticalOrHigh, ruleInfo, ruleShortId, slugify,
} from '../lib/rules.js';
import { RichText } from './RichText.jsx';

const _ = cockpit.gettext;

function formatDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDuration(startIso, endIso) {
    const ms = new Date(endIso) - new Date(startIso);
    if (!startIso || !endIso || isNaN(ms) || ms < 0) return '';
    const s = Math.round(ms / 1000);
    if (s < 60) return cockpit.format(_("$0 s"), s);
    const m = Math.floor(s / 60);
    return s % 60 ? cockpit.format(_("$0 min $1 s"), m, s % 60) : cockpit.format(_("$0 min"), m);
}

/* Per-rule remediation script preview + .sh/.yml download, behind its own
 * "Remediation script" disclosure inside the expanded rule. */
const RuleRemediation = ({ rule, info, scope }) => {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [busy, setBusy] = useState(null);
    const idSuffix = info.cce || ruleShortId(rule.id);

    async function toggle(_e, isOpen) {
        setOpen(isOpen);
        if (!isOpen || text !== null || loading || !info.fixTypes.includes('bash')) return;
        setLoading(true);
        setError(null);
        try {
            setText(await generateScopedFix(scope, [rule.id], 'bash'));
        } catch (ex) {
            setError(ex.message || String(ex));
        } finally {
            setLoading(false);
        }
    }

    async function download(fixType) {
        setBusy(fixType);
        setError(null);
        setNotice(null);
        try {
            const script = fixType === 'bash' && text !== null ? text : await generateScopedFix(scope, [rule.id], fixType);
            if (isEmptyFix(script, fixType)) {
                setNotice(fixType === 'bash' ? _("This rule has no Bash remediation.") : _("This rule has no Ansible remediation."));
                return;
            }
            await downloadFile(script, `fix-${idSuffix}${fixType === 'bash' ? '.sh' : '.yml'}`);
        } catch (ex) {
            setError(ex.message || String(ex));
        } finally {
            setBusy(null);
        }
    }

    return (
        <ExpandableSection
            className="ct-rule-rem"
            toggleText={_("Remediation script")}
            isExpanded={open}
            onToggle={toggle}
        >
            {loading && <p className="ct-rule-rem-loading">{_("Generating remediation preview…")}</p>}
            {error && <Alert variant="danger" isInline isPlain title={_("Fix generation failed")}>{error}</Alert>}
            {notice && <Alert variant="warning" isInline isPlain title={notice} />}
            {!info.fixTypes.includes('bash') && (
                <p className="ct-rule-rem-loading">{_("This rule has no Bash remediation.")}</p>
            )}
            {text !== null && <pre className="ct-rule-rem-pre">{text}</pre>}
            <div className="ct-rule-rem-dl-row">
                {info.fixTypes.includes('bash') && (
                    <Button
                        variant="link" isInline size="sm" isLoading={busy === 'bash'} isDisabled={!!busy}
                        onClick={() => download('bash')}
                    >
                        {_("Download .sh")}
                    </Button>
                )}
                {info.fixTypes.includes('ansible') && (
                    <Button
                        variant="link" isInline size="sm" isLoading={busy === 'ansible'} isDisabled={!!busy}
                        onClick={() => download('ansible')}
                    >
                        {_("Download .yml")}
                    </Button>
                )}
            </div>
        </ExpandableSection>
    );
};

const RuleRow = ({ rule, info, scope, showFix }) => {
    const [expanded, setExpanded] = useState(false);
    const panelId = `ct-rule-panel-${rule.id}`;
    return (
        <div className="ct-rule-item" data-rule-id={rule.id}>
            <button
                type="button" className="ct-rule-row" aria-expanded={expanded} aria-controls={panelId}
                onClick={() => setExpanded(x => !x)}
            >
                <span className="ct-rule-toggle-icon" aria-hidden="true">
                    {expanded ? <AngleDownIcon /> : <AngleRightIcon />}
                </span>
                <span className="ct-rule-text-col">
                    <span className="ct-rule-title">{info.title}</span>
                    {info.cce && <span className="ct-rule-cce">{info.cce}</span>}
                </span>
                {showFix && (
                    <span className={info.automated ? 'ct-rule-tag ct-rule-tag-auto' : 'ct-rule-tag'}>
                        {info.automated ? _("Automated") : _("Manual")}
                    </span>
                )}
            </button>
            {expanded && (
                <div className="ct-rule-detail ct-surface-tint" id={panelId}>
                    <code className="ct-rule-id">{ruleShortId(rule.id)}</code>
                    <RichText className="ct-rule-detail-desc" segments={info.description} />
                    {info.rationale.length > 0 && (
                        <>
                            <p className="ct-rule-detail-label">{_("Rationale")}</p>
                            <RichText className="ct-rule-detail-rat" segments={info.rationale} />
                        </>
                    )}
                    {info.refs.length > 0 && (
                        <LabelGroup className="ct-rule-refs" numLabels={info.refs.length} aria-label={_("Framework references")}>
                            {info.refs.map(ref => (
                                <Label key={ref.label} variant="outline" isCompact>
                                    <strong>{ref.label}</strong>{': '}
                                    {ref.values.slice(0, 3).join(', ')}
                                    {ref.values.length > 3 && cockpit.format(_(" +$0 more"), ref.values.length - 3)}
                                </Label>
                            ))}
                        </LabelGroup>
                    )}
                    {showFix && scope.sdsPath && <RuleRemediation rule={rule} info={info} scope={scope} />}
                </div>
            )}
        </div>
    );
};

const RuleGroup = ({ group, isExpanded, onToggle, scope, details, ruleMeta, visibleIds }) => {
    const rules = visibleIds ? group.rules.filter(r => visibleIds.has(r.id)) : group.rules;
    return (
        <ExpandableSection
            className={`ct-failing-group ct-failing-group-${group.key}`}
            isExpanded={isExpanded}
            onToggle={onToggle}
            toggleContent={
                <span className="ct-sev-group-toggle">
                    <span className="ct-sev-group-name">{group.label}</span>
                    <Label isCompact color={group.color}>
                        {visibleIds && rules.length !== group.rules.length
                            ? cockpit.format(_("$0 of $1"), rules.length, group.rules.length)
                            : group.countText}
                    </Label>
                </span>
            }
        >
            {isExpanded && rules.map((rule, i) => (
                <React.Fragment key={rule.id}>
                    {i > 0 && <Divider className="ct-rule-divider" />}
                    <RuleRow rule={rule} info={ruleInfo(rule.id, details, ruleMeta)} scope={scope} showFix={group.isFailing} />
                </React.Fragment>
            ))}
        </ExpandableSection>
    );
};

export const ScanResults = ({ result, onClose, onOpenBuilder }) => {
    const {
        scorePercent, pass, fail, error: errorCount, notapplicable, notchecked, failingRules, otherRules,
        reportHtml, resultsXmlGz, arfXmlGz, ruleMeta, details, header, sdsPath, tailoringPath, scanProfileId,
        allRuleIds, profileTitle, tailoringName,
    } = result;
    const scope = useMemo(
        () => ({ sdsPath, profileId: scanProfileId, tailoringPath, allRuleIds }),
        [sdsPath, scanProfileId, tailoringPath, allRuleIds]
    );

    const [search, setSearch] = useState('');
    const [actionError, setActionError] = useState(null);
    const [isDownloadOpen, setIsDownloadOpen] = useState(false);

    const groups = useMemo(() => {
        const fails = failingRules.filter(r => r.result === 'fail');
        const errors = failingRules.filter(r => r.result === 'error');
        const out = SEVERITY_ORDER.map(sev => ({
            key: sev,
            label: SEVERITY_LABEL[sev],
            color: SEVERITY_COLOR[sev],
            rules: fails.filter(r => (SEVERITY_ORDER.includes(r.severity) ? r.severity : 'unknown') === sev),
            isFailing: true,
        })).filter(g => g.rules.length > 0);
        for (const g of out) g.countText = cockpit.format(_("$0 failing"), g.rules.length);
        if (errors.length)
            out.push({ key: 'error', label: _("Errors"), color: 'orange', rules: errors, isFailing: true, countText: cockpit.format(cockpit.ngettext("$0 rule", "$0 rules", errors.length), errors.length) });
        for (const [key, label] of [['notapplicable', _("Not applicable")], ['notchecked', _("Not checked")]]) {
            const rules = otherRules?.[key] ?? [];
            if (rules.length)
                out.push({ key, label, color: 'grey', rules, isFailing: false, countText: cockpit.format(cockpit.ngettext("$0 rule", "$0 rules", rules.length), rules.length) });
        }
        return out;
    }, [failingRules, otherRules]);

    // Critical/high expanded by default (Peter); with none of those, the
    // first failing group, as v3 did. Not applicable / Not checked start
    // collapsed.
    const defaultExpanded = useMemo(() => {
        const ch = groups.filter(g => g.isFailing && isCriticalOrHigh(g.key)).map(g => g.key);
        if (ch.length) return new Set(ch);
        const first = groups.find(g => g.isFailing);
        return new Set(first ? [first.key] : []);
    }, [groups]);
    const [expanded, setExpanded] = useState(defaultExpanded);

    // Search (v3): matching groups open, groups with no match are hidden;
    // clearing it restores the default open groups.
    const term = search.trim().toLowerCase();
    const visibleIds = useMemo(() => {
        if (!term) return null;
        const ids = new Set();
        for (const g of groups)
            for (const r of g.rules)
                if (ruleInfo(r.id, details, ruleMeta).searchText.includes(term)) ids.add(r.id);
        return ids;
    }, [term, groups, details, ruleMeta]);

    function onSearch(value) {
        setSearch(value);
        if (!value.trim()) setExpanded(defaultExpanded);
    }

    function toggleGroup(key) {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    }

    const fails = failingRules.filter(r => r.result === 'fail');
    const sevCounts = SEVERITY_ORDER.map(sev => [sev, fails.filter(r => r.severity === sev).length]).filter(([, n]) => n > 0);
    const autoCritHigh = fails.filter(r => isCriticalOrHigh(r.severity) && ruleInfo(r.id, details, ruleMeta).automated).length;

    function handleViewReport() {
        setActionError(null);
        if (!openReportViewer(Promise.resolve(reportHtml)))
            setActionError(_("Your browser blocked the report from opening in a new tab. Allow pop-ups for this site and try again."));
    }

    async function handleDownload(kind) {
        setIsDownloadOpen(false);
        setActionError(null);
        const base = `scan-${slugify(profileTitle) || 'results'}`;
        try {
            if (kind === 'html') await downloadFile(reportHtml, `${base}-report.html`);
            else if (kind === 'xml') await downloadFile(resultsXmlGz, `${base}-results.xml.gz`);
            else await downloadFile(arfXmlGz, `${base}-arf.xml.gz`);
        } catch (ex) {
            setActionError(ex.message || String(ex));
        }
    }

    const nothingEvaluated = pass === 0 && fail === 0;
    const duration = formatDuration(header?.startTime, header?.endTime);
    const contentLine = [sdsPath && sdsDisplayName(sdsPath), header?.contentVersion && cockpit.format(_("SSG $0"), header.contentVersion)]
            .filter(Boolean)
            .join(' · ');

    return (
        <Card data-ct-results className="ct-results-card">
            <CardHeader className="ct-results-header">
                <div className="ct-results-heading">
                    <p className="ct-results-label">{_("Host scan results")}</p>
                    <Title headingLevel="h2" size="xl" className="ct-results-profile">{profileTitle}</Title>
                    {tailoringName && profileTitle !== tailoringName && (
                        <p className="ct-results-sub">{cockpit.format(_("Tailoring: $0"), tailoringName)}</p>
                    )}
                    {header?.startTime && <p className="ct-results-sub">{formatDateTime(header.startTime)}</p>}
                </div>
                <div className="ct-results-meta">
                    {duration && <span>{cockpit.format(_("Duration $0"), duration)}</span>}
                    {contentLine && <span>{contentLine}</span>}
                </div>
            </CardHeader>
            <Divider />
            <CardBody>
                {actionError && (
                    <Alert
                        variant="danger" isInline title={_("Action failed")}
                        actionClose={<AlertActionCloseButton onClose={() => setActionError(null)} />}
                    >
                        {actionError}
                    </Alert>
                )}
                <div className="ct-results-zones">
                    <div className="ct-results-zone ct-results-zone-score">
                        {/* Neutral on purpose (Amendment 2): no good/bad color by value. */}
                        <span className="ct-score-tile ct-surface-tint">
                            <span className="ct-score-value">
                                {scorePercent !== null ? `${scorePercent}%` : _("N/A")}
                            </span>
                            <span className="ct-score-caption">{_("Score")}</span>
                        </span>
                    </div>
                    <Divider orientation={{ default: 'horizontal', lg: 'vertical' }} className="ct-results-zone-divider" />
                    <div className="ct-results-zone ct-results-zone-summary">
                        <p className="ct-results-summary-line">
                            {cockpit.format(_("$0 passed · $1 failed · $2 n/a · $3 errors"), pass, fail, notapplicable, errorCount)}
                        </p>
                        {notchecked > 0 && (
                            <p className="ct-results-sub">{cockpit.format(cockpit.ngettext("$0 rule not checked", "$0 rules not checked", notchecked), notchecked)}</p>
                        )}
                    </div>
                    <Divider orientation={{ default: 'horizontal', lg: 'vertical' }} className="ct-results-zone-divider" />
                    <div className="ct-results-zone ct-builder-panel ct-surface-tint ct-surface-accent">
                        <Title headingLevel="h3" size="lg">{_("Remediation Builder")}</Title>
                        {sevCounts.length > 0 && (
                            <LabelGroup numLabels={5} aria-label={_("Failing rules by severity")}>
                                {sevCounts.map(([sev, n]) => (
                                    <Label key={sev} isCompact color={SEVERITY_COLOR[sev]}>
                                        {cockpit.format("$0: $1", SEVERITY_LABEL[sev], n)}
                                    </Label>
                                ))}
                            </LabelGroup>
                        )}
                        <p className="ct-results-sub">
                            {fails.length === 0
                                ? _("No failing rules to remediate.")
                                : cockpit.format(cockpit.ngettext("$0 critical/high rule can be auto-remediated", "$0 critical/high rules can be auto-remediated", autoCritHigh), autoCritHigh)}
                        </p>
                        <div className="ct-builder-actions">
                            <Button
                                variant="primary" isDisabled={!sdsPath || autoCritHigh === 0}
                                onClick={() => onOpenBuilder('critical')}
                            >
                                {cockpit.format(_("Critical & high ($0)"), autoCritHigh)}
                            </Button>
                            <Button
                                variant="secondary" isDisabled={!sdsPath || fails.length === 0}
                                onClick={() => onOpenBuilder('all')}
                            >
                                {cockpit.format(_("All failures ($0)"), fails.length)}
                            </Button>
                        </div>
                    </div>
                </div>
            </CardBody>
            <Divider />
            <CardBody className="ct-rules-section">
                {groups.length === 0 || nothingEvaluated
                    ? (
                        nothingEvaluated
                            ? (
                                <EmptyState titleText={_("No rules were evaluated")} headingLevel="h3" status="warning">
                                    <EmptyStateBody>
                                        {_("Nothing passed or failed: no rule in this profile applied to this host. This usually means the content is for a different operating system.")}
                                    </EmptyStateBody>
                                </EmptyState>
                            )
                            : (
                                <EmptyState titleText={_("All rules passed")} headingLevel="h3">
                                    <EmptyStateBody>{_("No failing or error rules found in this scan.")}</EmptyStateBody>
                                </EmptyState>
                            )
                    )
                    : (
                        <>
                            <div className="ct-rules-search-row">
                                <SearchInput
                                    className="ct-rules-search"
                                    placeholder={_("Search rules by title, CCE or ID")}
                                    value={search}
                                    onChange={(_e, v) => onSearch(v)}
                                    onClear={() => onSearch('')}
                                    resultsCount={visibleIds ? visibleIds.size : undefined}
                                    aria-label={_("Search rules")}
                                />
                            </div>
                            <Divider />
                            {visibleIds && visibleIds.size === 0 && (
                                <p className="ct-results-sub ct-no-match">{_("No rules match the search.")}</p>
                            )}
                            {groups.filter(g => !visibleIds || g.rules.some(r => visibleIds.has(r.id))).map((g, i) => (
                                <React.Fragment key={g.key}>
                                    {i > 0 && <Divider />}
                                    <RuleGroup
                                        group={g}
                                        isExpanded={visibleIds ? true : expanded.has(g.key)}
                                        onToggle={() => toggleGroup(g.key)}
                                        scope={scope}
                                        details={details}
                                        ruleMeta={ruleMeta}
                                        visibleIds={visibleIds}
                                    />
                                </React.Fragment>
                            ))}
                        </>
                    )}
            </CardBody>
            <Divider />
            <CardFooter className="ct-results-footer">
                <Button variant="secondary" onClick={handleViewReport}>{_("View report")}</Button>
                <Dropdown
                    isOpen={isDownloadOpen}
                    onOpenChange={setIsDownloadOpen}
                    toggle={ref => (
                        <MenuToggle ref={ref} variant="secondary" isExpanded={isDownloadOpen} onClick={() => setIsDownloadOpen(o => !o)}>
                            {_("Download")}
                        </MenuToggle>
                    )}
                >
                    <DropdownList>
                        <DropdownItem value="html" onClick={() => handleDownload('html')}>{_("HTML report")}</DropdownItem>
                        <DropdownItem value="xml" onClick={() => handleDownload('xml')}>{_("Results XML")}</DropdownItem>
                        <DropdownItem
                            value="arf" onClick={() => handleDownload('arf')}
                            description={_("Asset Reporting Format: results, OVAL data and asset identity")}
                        >
                            {_("ARF")}
                        </DropdownItem>
                    </DropdownList>
                </Dropdown>
                <Button variant="secondary" className="ct-results-close" onClick={onClose}>{_("Close")}</Button>
            </CardFooter>
        </Card>
    );
};
