import cockpit from 'cockpit';
import React, { useMemo, useState } from 'react';
import { Alert, AlertActionCloseButton } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider/index.js";
import {
    DrawerActions, DrawerCloseButton, DrawerHead, DrawerPanelBody, DrawerPanelContent,
} from "@patternfly/react-core/dist/esm/components/Drawer/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { SearchInput } from "@patternfly/react-core/dist/esm/components/SearchInput/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";

import { downloadFile } from '../lib/download.js';
import { generateScopedFix, isEmptyFix, sdsDisplayName } from '../lib/oscap.js';
import {
    SEVERITY_COLOR, SEVERITY_LABEL, SEVERITY_ORDER, isCriticalOrHigh, ruleInfo, ruleShortId, slugify,
} from '../lib/rules.js';
import { RichText } from './RichText.jsx';

const _ = cockpit.gettext;

/* Initial selection for the two Results-page presets (v3 remediation.js):
 * "critical" = automated critical/high failures, "all" = every failure. */
export function presetSelection(result, preset) {
    const fails = result.failingRules.filter(r => r.result === 'fail');
    if (preset === 'critical')
        return new Set(fails.filter(r => isCriticalOrHigh(r.severity) && ruleInfo(r.id, result.details, result.ruleMeta).automated).map(r => r.id));
    return new Set(fails.map(r => r.id));
}

const BuilderRule = ({ rule, info, checked, onToggle }) => {
    const [open, setOpen] = useState(false);
    const hasDetails = info.description.length > 0 || info.rationale.length > 0;
    return (
        <div className="ct-builder-rule" data-rule-id={rule.id}>
            <div className="ct-builder-rule-row">
                <Checkbox
                    id={`ct-builder-${rule.id}`}
                    isChecked={checked}
                    onChange={() => onToggle(rule.id)}
                    label={info.title}
                    description={<code className="ct-rule-id">{ruleShortId(rule.id)}</code>}
                />
                {hasDetails && (
                    <Button variant="link" isInline size="sm" className="ct-builder-details-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
                        {open ? _("Hide details") : _("Details")}
                    </Button>
                )}
            </div>
            {open && (
                <div className="ct-rule-detail ct-surface-tint">
                    <RichText className="ct-rule-detail-desc" segments={info.description} />
                    {info.rationale.length > 0 && (
                        <>
                            <p className="ct-rule-detail-label">{_("Rationale")}</p>
                            <RichText className="ct-rule-detail-rat" segments={info.rationale} />
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

/* The Remediation Builder (v3's "Selective Remediation" drawer), opened
 * from the Results page with a preset selection. Fixes are generated on
 * click from the saved scan (lib/oscap.js generateScopedFix, with the
 * scanned profile's values), never pre-generated, so every saved scan can
 * be remediated (C§1d). */
export const RemediationBuilder = ({ result, preset, onClose, adminAllowed, remediationRunning, onApplyNow }) => {
    const { failingRules, details, ruleMeta, sdsPath, tailoringPath, scanProfileId, allRuleIds, profileTitle, scorePercent, fail, header } = result;
    const fails = useMemo(() => failingRules.filter(r => r.result === 'fail'), [failingRules]);
    const infos = useMemo(() => Object.fromEntries(fails.map(r => [r.id, ruleInfo(r.id, details, ruleMeta)])), [fails, details, ruleMeta]);
    const [selected, setSelected] = useState(() => presetSelection(result, preset));
    const [search, setSearch] = useState('');
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);

    const groups = useMemo(() => SEVERITY_ORDER.map(sev => ({
        key: sev,
        rules: fails.filter(r => (SEVERITY_ORDER.includes(r.severity) ? r.severity : 'unknown') === sev),
    })).filter(g => g.rules.length > 0), [fails]);

    // Critical/high groups start open (as on the Results page); the rest
    // start collapsed with their "n of m selected" count, as in v3.
    const [expanded, setExpanded] = useState(() => new Set(groups.filter(g => isCriticalOrHigh(g.key)).map(g => g.key)));
    const term = search.trim().toLowerCase();
    const matches = r => !term || infos[r.id].searchText.includes(term);

    function toggleRule(id) {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    function setMany(ids, on) {
        setSelected(prev => {
            const next = new Set(prev);
            for (const id of ids) { if (on) next.add(id); else next.delete(id); }
            return next;
        });
    }

    function toggleGroup(key) {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    }

    async function download(fixType) {
        setBusy(fixType);
        setError(null);
        setNotice(null);
        try {
            const ids = fails.filter(r => selected.has(r.id)).map(r => r.id);
            const script = await generateScopedFix({ sdsPath, profileId: scanProfileId, profileTitle, tailoringPath, allRuleIds }, ids, fixType);
            if (isEmptyFix(script, fixType)) {
                setNotice(fixType === 'bash'
                    ? _("None of the selected rules has a Bash remediation, so there is nothing to download.")
                    : _("None of the selected rules has an Ansible remediation, so there is nothing to download."));
                return;
            }
            const name = `remediation-${slugify(profileTitle) || 'scan'}-${ids.length}-rules${fixType === 'bash' ? '.sh' : '.yml'}`;
            await downloadFile(script, name);
        } catch (ex) {
            setError(ex.message || String(ex));
        } finally {
            setBusy(null);
        }
    }

    /* Apply now (PLAN_V4.5_APPLY_NOW.md amendments): hands the selection
     * to app.jsx, which opens the one confirm dialog (ApplyNow.jsx). */
    function applyNow() {
        const ids = fails.filter(r => selected.has(r.id)).map(r => r.id);
        onApplyNow({
            scope: { sdsPath, profileId: scanProfileId, profileTitle, tailoringPath, allRuleIds },
            rules: ids.map(id => ({ id, title: infos[id].title, severity: fails.find(r => r.id === id).severity })),
            scanDir: result.scanDir,
            scanId: result.scanId,
            scanStartTime: header?.startTime ?? null,
            sdsPath,
            scanProfileId,
            baseProfileId: result.profileId,
            profileTitle,
            tailoringPath: tailoringPath || null,
            tailoringName: result.tailoringName || null,
        });
    }

    // Why Apply now is unavailable, shown as its tooltip (the Run Scan
    // pattern, e8f4051); null when only the selection or a busy download
    // keeps it disabled.
    let applyBlocked = null;
    if (!adminAllowed) applyBlocked = _('Turn on "Administrative access" at the top of the page to apply fixes');
    else if (remediationRunning) applyBlocked = _("A remediation is already running on this host");
    else if (!result.scanDir) applyBlocked = _("This scan is not in Scan History, so the remediation log would have nowhere to go");

    const scanned = header?.startTime ? new Date(header.startTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

    return (
        <DrawerPanelContent className="ct-builder-drawer" widths={{ default: 'width_100', lg: 'width_50', '2xl': 'width_33' }} minSize="28rem">
            <DrawerHead>
                <Title headingLevel="h2" size="xl" tabIndex={-1} className="ct-builder-title">{_("Remediation Builder")}</Title>
                <DrawerActions>
                    <DrawerCloseButton onClick={onClose} aria-label={_("Close Remediation Builder")} />
                </DrawerActions>
            </DrawerHead>
            <DrawerPanelBody className="ct-builder-context">
                <DescriptionList isCompact isHorizontal isFluid columnModifier={{ default: '1Col', md: '2Col' }}>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Profile")}</DescriptionListTerm>
                        <DescriptionListDescription>{profileTitle}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Score")}</DescriptionListTerm>
                        <DescriptionListDescription>{scorePercent !== null ? `${scorePercent}%` : _("N/A")}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Failing")}</DescriptionListTerm>
                        <DescriptionListDescription>{fail}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Content")}</DescriptionListTerm>
                        <DescriptionListDescription>{sdsDisplayName(sdsPath)}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Scanned")}</DescriptionListTerm>
                        <DescriptionListDescription>{scanned}</DescriptionListDescription>
                    </DescriptionListGroup>
                </DescriptionList>
            </DrawerPanelBody>
            <Divider />
            <DrawerPanelBody className="ct-builder-body">
                <div className="ct-builder-toolbar">
                    <span className="ct-builder-count">
                        {cockpit.format(_("$0 of $1 rules selected"), selected.size, fails.length)}
                    </span>
                    <Button variant="link" isInline onClick={() => setMany(fails.map(r => r.id), true)}>{_("Select all")}</Button>
                    <Button variant="link" isInline onClick={() => setSelected(new Set())}>{_("Deselect all")}</Button>
                </div>
                <SearchInput
                    className="ct-builder-search"
                    placeholder={_("Search rules")}
                    value={search}
                    onChange={(_e, v) => setSearch(v)}
                    onClear={() => setSearch('')}
                    aria-label={_("Search rules in the Remediation Builder")}
                />
                {groups.map(g => {
                    const shown = g.rules.filter(matches);
                    if (shown.length === 0) return null;
                    const nSel = g.rules.filter(r => selected.has(r.id)).length;
                    const all = nSel === g.rules.length;
                    return (
                        <React.Fragment key={g.key}>
                            <Divider />
                            <div className={`ct-builder-group ct-builder-group-${g.key}`}>
                                <div className="ct-builder-group-head">
                                    <ExpandableSection
                                        className="ct-builder-group-toggle"
                                        isExpanded={!!term || expanded.has(g.key)}
                                        onToggle={() => toggleGroup(g.key)}
                                        toggleContent={
                                            <span className="ct-sev-group-toggle">
                                                <Label isCompact color={SEVERITY_COLOR[g.key]}>{SEVERITY_LABEL[g.key]}</Label>
                                                <span className="ct-builder-group-count">
                                                    {cockpit.format(_("$0 of $1 selected"), nSel, g.rules.length)}
                                                </span>
                                            </span>
                                        }
                                    >
                                        {shown.map(r => (
                                            <BuilderRule key={r.id} rule={r} info={infos[r.id]} checked={selected.has(r.id)} onToggle={toggleRule} />
                                        ))}
                                    </ExpandableSection>
                                    <Button
                                        variant="link" isInline size="sm" className="ct-builder-group-select"
                                        onClick={() => setMany(g.rules.map(r => r.id), !all)}
                                    >
                                        {all ? _("Deselect all") : _("Select all")}
                                    </Button>
                                </div>
                            </div>
                        </React.Fragment>
                    );
                })}
                {term && groups.every(g => !g.rules.some(matches)) && (
                    <p className="ct-results-sub">{_("No rules match the search.")}</p>
                )}
            </DrawerPanelBody>
            <Divider />
            <DrawerPanelBody className="ct-builder-footer">
                {error && (
                    <Alert
                        variant="danger" isInline title={_("Fix generation failed")}
                        actionClose={<AlertActionCloseButton onClose={() => setError(null)} />}
                    >
                        {error}
                    </Alert>
                )}
                {notice && (
                    <Alert
                        variant="warning" isInline title={_("Empty remediation")}
                        actionClose={<AlertActionCloseButton onClose={() => setNotice(null)} />}
                    >
                        {notice}
                    </Alert>
                )}
                <div className="ct-builder-actions">
                    {applyBlocked
                        ? (
                            <Tooltip content={applyBlocked}>
                                <Button variant="danger" isAriaDisabled className="ct-builder-apply">
                                    {_("Apply now")}
                                </Button>
                            </Tooltip>
                        )
                        : (
                            <Button
                                variant="danger" className="ct-builder-apply" isDisabled={!!busy || selected.size === 0}
                                onClick={applyNow}
                            >
                                {_("Apply now")}
                            </Button>
                        )}
                    <Button
                        variant="secondary" isLoading={busy === 'bash'} isDisabled={!!busy || selected.size === 0}
                        onClick={() => download('bash')}
                    >
                        {_("Download Bash script")}
                    </Button>
                    <Button
                        variant="secondary" isLoading={busy === 'ansible'} isDisabled={!!busy || selected.size === 0}
                        onClick={() => download('ansible')}
                    >
                        {_("Download Ansible playbook")}
                    </Button>
                </div>
            </DrawerPanelBody>
        </DrawerPanelContent>
    );
};
