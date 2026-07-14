import cockpit from 'cockpit';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { SearchInput } from "@patternfly/react-core/dist/esm/components/SearchInput/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { ToggleGroup, ToggleGroupItem } from "@patternfly/react-core/dist/esm/components/ToggleGroup/index.js";
import { TreeView } from "@patternfly/react-core/dist/esm/components/TreeView/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import { checkUploadSize, sanitizeFilename, statExistingContent, uploadContent } from '../lib/content.js';
import { detectContent, getProfiles, sdsDisplayName } from '../lib/oscap.js';
import {
    extractProfile, flattenProfileRules, parseTailoringXml, readTailoringXml,
    saveNewTailoring, updateTailoringFile,
} from '../lib/tailoring.js';
import { ContentSelect } from './ContentSelect.jsx';
import { ProfileDescriptionPanel } from './ProfileDescriptionPanel.jsx';
import { RuleDetailsBlock } from './RuleDetails.jsx';

const _ = cockpit.gettext;

const SEVERITY_COLOR = {
    high: 'orange',
    medium: 'gold',
    low: 'blue',
    unknown: 'grey',
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2, unknown: 3 };

function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(1)} ${units[unit]}`;
}

function formatUploadDate(ts) {
    if (!ts) return '—';
    return ts.slice(0, 10) + ' ' + ts.slice(11, 19);
}

function ruleVisible(rule, filters, ruleChanges) {
    const term = filters.search.trim().toLowerCase();
    if (term && !(rule.title || rule.id).toLowerCase().includes(term)) return false;
    if (filters.severity !== 'all' && (rule.severity || 'unknown') !== filters.severity) return false;
    const isModified = rule.id in ruleChanges;
    const isEnabled = isModified ? ruleChanges[rule.id] : rule.selected;
    if (filters.status === 'disabled' && isEnabled) return false;
    if (filters.status === 'modified' && !isModified) return false;
    return true;
}

function groupHasVisible(group, filters, ruleChanges) {
    if ((group.rules || []).some(r => ruleVisible(r, filters, ruleChanges))) return true;
    return (group.groups || []).some(sg => groupHasVisible(sg, filters, ruleChanges));
}

function countRules(group) {
    let total = (group.rules || []).length;
    (group.groups || []).forEach(sg => { total += countRules(sg) });
    return total;
}

function countModified(group, ruleChanges) {
    let modified = (group.rules || []).filter(r => r.id in ruleChanges).length;
    (group.groups || []).forEach(sg => { modified += countModified(sg, ruleChanges) });
    return modified;
}

/* Rule row content rendered inside a TreeView leaf's `name`. Owns its own
 * expand state for the description/rationale block — clicking it must not
 * also toggle the row's checkbox, so it stops propagation (PatternFly's
 * TreeView wraps checkbox rows in a <label>, and browsers already suppress
 * label-forwarding for nested interactive elements like this button, but
 * stopPropagation keeps that explicit rather than relying on it silently). */
const RuleNodeLabel = ({ rule, isModified }) => {
    const [expanded, setExpanded] = useState(false);
    const hasDetails = !!(rule.description || rule.rationale);

    return (
        <div className="ct-tailor-rule-content">
            <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                <FlexItem>
                    <Label color={SEVERITY_COLOR[rule.severity] ?? 'grey'} isCompact>
                        {rule.severity}
                    </Label>
                </FlexItem>
                <FlexItem className="ct-tailor-rule-title">{rule.title || rule.id}</FlexItem>
                {isModified && (
                    <FlexItem>
                        <Label color="purple" isCompact>{_("Modified")}</Label>
                    </FlexItem>
                )}
                {hasDetails && (
                    <FlexItem>
                        <Button
                            variant="link" isInline size="sm"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded(x => !x) }}
                        >
                            {expanded ? _("Hide details") : _("Details")}
                        </Button>
                    </FlexItem>
                )}
            </Flex>
            {expanded && <RuleDetailsBlock description={rule.description} rationale={rule.rationale} />}
        </div>
    );
};

function buildRuleItem(rule, ruleChanges, ruleById) {
    ruleById.set(rule.id, rule);
    const isModified = rule.id in ruleChanges;
    const checked = isModified ? ruleChanges[rule.id] : rule.selected;
    return {
        id: rule.id,
        name: <RuleNodeLabel rule={rule} isModified={isModified} />,
        hasCheckbox: true,
        checkProps: { checked, 'aria-label': rule.title || rule.id },
    };
}

function buildGroupItem(group, filters, ruleChanges, ruleById) {
    if (!groupHasVisible(group, filters, ruleChanges)) return null;
    const children = buildTreeItems(group.groups, group.rules, filters, ruleChanges, ruleById);
    const total = countRules(group);
    const modified = countModified(group, ruleChanges);
    return {
        id: group.id,
        name: group.title || group.id,
        children,
        hasBadge: true,
        customBadgeContent: modified > 0
            ? cockpit.format(_("$0 rules · $1 modified"), total, modified)
            : cockpit.format(_("$0 rules"), total),
        badgeProps: { isRead: modified === 0 },
    };
}

function buildTreeItems(groups, rules, filters, ruleChanges, ruleById) {
    const groupItems = (groups || [])
            .map(g => buildGroupItem(g, filters, ruleChanges, ruleById))
            .filter(Boolean);
    const ruleItems = (rules || [])
            .filter(r => ruleVisible(r, filters, ruleChanges))
            .map(r => buildRuleItem(r, ruleChanges, ruleById));
    return [...groupItems, ...ruleItems];
}

/* Plain-text change summary, format matched exactly to old main's
 * exportTailorSummary() (src/tailoring.js:748) — clipboard-copy only, no
 * file write. */
function formatChangeSummaryText(name, tailorData, ruleEntries, valueEntries) {
    const base = tailorData.profile?.title || tailorData.profile?.id || 'Base Profile';
    const lines = [
        'Policy Deviations: ' + (name || 'Tailoring'),
        'Base Profile: ' + base,
        'Generated: ' + new Date().toISOString()
                .replace('T', ' ')
                .slice(0, 19),
        '',
    ];
    if (ruleEntries.length) {
        lines.push('Rules changed (' + ruleEntries.length + '):');
        ruleEntries.forEach(({ id, title, severity, enabled }) => {
            lines.push('  ' + (enabled ? '+ ENABLED ' : '- DISABLED') + ' [' + severity.toUpperCase() + '] ' + (title || id));
        });
        lines.push('');
    }
    if (valueEntries.length) {
        lines.push('Variables changed (' + valueEntries.length + '):');
        valueEntries.forEach(({ id, title, from, to }) => {
            lines.push('  ' + (title || id) + ': ' + from + ' → ' + to);
        });
    }
    return lines.join('\n');
}

const ChangeSummaryPanel = ({ name, tailorData, ruleChanges, valueChanges }) => {
    const [copied, setCopied] = useState(false);

    const ruleEntries = useMemo(() => {
        const ruleById = new Map(flattenProfileRules(tailorData).map(r => [r.id, r]));
        return Object.entries(ruleChanges)
                .map(([id, enabled]) => {
                    const rule = ruleById.get(id) || { title: id, severity: 'unknown' };
                    return { id, title: rule.title, severity: rule.severity || 'unknown', enabled };
                })
                .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3));
    }, [tailorData, ruleChanges]);

    const valueEntries = useMemo(() => {
        const valById = new Map((tailorData.values || []).map(v => [v.id, v]));
        return Object.entries(valueChanges).map(([id, newVal]) => {
            const val = valById.get(id) || { title: id, current: '?', default: '?' };
            return { id, title: val.title, from: val.current || val.default || '?', to: newVal };
        });
    }, [tailorData, valueChanges]);

    const total = ruleEntries.length + valueEntries.length;
    if (total === 0) return null;

    function handleExport() {
        const text = formatChangeSummaryText(name, tailorData, ruleEntries, valueEntries);
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        })
                .catch(() => {});
    }

    return (
        <div className="ct-tailor-summary">
            <Flex alignItems={{ default: 'alignItemsCenter' }} justifyContent={{ default: 'justifyContentSpaceBetween' }}>
                <FlexItem>
                    <Title headingLevel="h3" size="md">
                        {cockpit.format(_("Changes from base profile ($0)"), total)}
                    </Title>
                </FlexItem>
                <FlexItem>
                    <Button variant="secondary" size="sm" onClick={handleExport}>
                        {copied ? _("✓ Copied") : _("Copy Summary")}
                    </Button>
                </FlexItem>
            </Flex>
            {ruleEntries.length > 0 && (
                <div className="ct-tailor-summary-section">
                    <p className="ct-tailor-summary-section-title">
                        {cockpit.format(_("Rules changed ($0)"), ruleEntries.length)}
                    </p>
                    {ruleEntries.map(r => (
                        <div key={r.id} className="ct-tailor-sum-row">
                            <span className={r.enabled ? "ct-tailor-sum-enabled" : "ct-tailor-sum-disabled"}>
                                {r.enabled ? _("Enabled") : _("Disabled")}
                            </span>
                            <Label color={SEVERITY_COLOR[r.severity] ?? 'grey'} isCompact>{r.severity}</Label>
                            <span className="ct-tailor-sum-title">{r.title || r.id}</span>
                        </div>
                    ))}
                </div>
            )}
            {valueEntries.length > 0 && (
                <div className="ct-tailor-summary-section">
                    <p className="ct-tailor-summary-section-title">
                        {cockpit.format(_("Variables changed ($0)"), valueEntries.length)}
                    </p>
                    {valueEntries.map(v => (
                        <div key={v.id} className="ct-tailor-sum-row">
                            <span className="ct-tailor-sum-title">{v.title || v.id}</span>
                            <span className="ct-tailor-sum-val-change">{v.from} &rarr; {v.to}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export const TailoringEditor = ({ editingSidecar, onSaved, onCancelEdit, contentRefreshKey, onContentChanged }) => {
    const [contentList, setContentList] = useState([]);
    const [content, setContent] = useState('');
    const [profiles, setProfiles] = useState([]);
    const [profileId, setProfileId] = useState('');
    const [name, setName] = useState('');
    const [loadingTree, setLoadingTree] = useState(false);
    const [loadError, setLoadError] = useState(null);
    const [tailorData, setTailorData] = useState(null);
    const [ruleChanges, setRuleChanges] = useState({});
    const [valueChanges, setValueChanges] = useState({});
    const [search, setSearch] = useState('');
    const [severityFilter, setSeverityFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [defaultAllExpanded, setDefaultAllExpanded] = useState(false);
    const [treeKey, setTreeKey] = useState(0);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    const [pendingUpload, setPendingUpload] = useState(null); // { file, existing }
    const fileInputRef = useRef(null);

    const isEditing = !!editingSidecar;

    useEffect(() => {
        let cancelled = false;
        detectContent().then(list => { if (!cancelled) setContentList(list); });
        return () => { cancelled = true };
    }, [contentRefreshKey]);

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

    useEffect(() => {
        if (!editingSidecar) return;
        let cancelled = false;
        setContent(editingSidecar.sds_path);
        setProfileId(editingSidecar.base_profile_id);
        setName(editingSidecar.name);
        setLoadingTree(true);
        setLoadError(null);
        setTailorData(null);

        Promise.all([
            readTailoringXml(editingSidecar.path).then(parseTailoringXml),
            extractProfile(editingSidecar.base_profile_id, editingSidecar.sds_path),
        ])
                .then(([changes, data]) => {
                    if (cancelled) return;
                    setRuleChanges(changes.ruleChanges);
                    setValueChanges(changes.valueChanges);
                    setTailorData(data);
                    setLoadingTree(false);
                })
                .catch(ex => {
                    if (cancelled) return;
                    setLoadError(ex.message || String(ex));
                    setLoadingTree(false);
                });
        return () => { cancelled = true };
    }, [editingSidecar]);

    useEffect(() => {
        if (isEditing || !content) return;
        let cancelled = false;
        getProfiles(content).then(list => {
            if (cancelled) return;
            setProfiles(list);
            setProfileId(list[0]?.id ?? '');
        });
        return () => { cancelled = true };
    }, [content, isEditing]);

    const handleLoad = useCallback(() => {
        if (!profileId || !content) return;
        setLoadingTree(true);
        setLoadError(null);
        setRuleChanges({});
        setValueChanges({});
        extractProfile(profileId, content)
                .then(data => {
                    setTailorData(data);
                    setLoadingTree(false);
                })
                .catch(ex => {
                    setLoadError(ex.message || String(ex));
                    setLoadingTree(false);
                });
    }, [profileId, content]);

    function toggleRule(rule, checked) {
        setRuleChanges(prev => {
            const next = { ...prev };
            if (checked === rule.selected) delete next[rule.id];
            else next[rule.id] = checked;
            return next;
        });
    }

    function updateValue(value, newVal) {
        const base = value.current || value.default || '';
        setValueChanges(prev => {
            const next = { ...prev };
            if (newVal === base) delete next[value.id];
            else next[value.id] = newVal;
            return next;
        });
    }

    function resetForm() {
        setContent('');
        setProfileId('');
        setProfiles([]);
        setName('');
        setTailorData(null);
        setRuleChanges({});
        setValueChanges({});
        setSearch('');
        setSeverityFilter('all');
        setStatusFilter('all');
    }

    async function handleSave() {
        if (!name.trim()) return;
        setSaving(true);
        setSaveError(null);
        try {
            if (isEditing) {
                await updateTailoringFile(editingSidecar, { newProfileTitle: name, ruleChanges, valueChanges });
            } else {
                const baseTitle = profiles.find(p => p.id === profileId)?.title || profileId;
                await saveNewTailoring({
                    baseProfileId: profileId,
                    baseProfileTitle: baseTitle,
                    newProfileTitle: name,
                    sdsPath: content,
                    ruleChanges,
                    valueChanges,
                });
            }
            resetForm();
            onSaved();
        } catch (ex) {
            setSaveError(ex.message || String(ex));
        } finally {
            setSaving(false);
        }
    }

    async function handleSaveAsNew() {
        if (!name.trim() || !editingSidecar) return;
        setSaving(true);
        setSaveError(null);
        try {
            await saveNewTailoring({
                baseProfileId: editingSidecar.base_profile_id,
                baseProfileTitle: editingSidecar.base_profile_title,
                newProfileTitle: name,
                sdsPath: editingSidecar.sds_path,
                ruleChanges,
                valueChanges,
            });
            resetForm();
            onSaved();
        } catch (ex) {
            setSaveError(ex.message || String(ex));
        } finally {
            setSaving(false);
        }
    }

    function expandAll() { setDefaultAllExpanded(true); setTreeKey(k => k + 1) }
    function collapseAll() { setDefaultAllExpanded(false); setTreeKey(k => k + 1) }

    const filters = useMemo(() => ({ search, severity: severityFilter, status: statusFilter }), [search, severityFilter, statusFilter]);
    const allRules = useMemo(() => flattenProfileRules(tailorData), [tailorData]);
    const modifiedRuleCount = Object.keys(ruleChanges).length;
    const modifiedValueCount = Object.keys(valueChanges).length;
    const isSearching = !!search.trim();

    const { treeItems, ruleById } = useMemo(() => {
        const idMap = new Map();
        const items = tailorData
            ? buildTreeItems(tailorData.groups, tailorData.rules, filters, ruleChanges, idMap)
            : [];
        return { treeItems: items, ruleById: idMap };
    }, [tailorData, filters, ruleChanges]);

    function handleCheck(event, item) {
        const rule = ruleById.get(item.id);
        if (rule) toggleRule(rule, event.target.checked);
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <Title headingLevel="h2" size="lg">
                        {isEditing ? cockpit.format(_("Editing: $0"), editingSidecar.name) : _("New Tailoring Policy")}
                    </Title>
                </CardTitle>
            </CardHeader>
            <CardBody>
                {saveError && (
                    <Alert
                        variant="danger" title={_("Save failed")} isInline
                        actionClose={<Button variant="plain" onClick={() => setSaveError(null)}>×</Button>}
                    >
                        {saveError}
                    </Alert>
                )}
                {loadError && (
                    <Alert variant="danger" title={_("Failed to load profile")} isInline>{loadError}</Alert>
                )}

                <div className="ct-two-col-form">
                    <div className="ct-form-col">
                        <Form className="ct-tailor-form">
                            {isEditing
                                ? (
                                    <FormGroup label={_("Base profile")} fieldId="ct-tailor-base-readonly">
                                        <p>{editingSidecar.base_profile_title || editingSidecar.base_profile_id} — {sdsDisplayName(editingSidecar.sds_path)}</p>
                                        <Button variant="link" isInline onClick={() => { resetForm(); onCancelEdit() }}>
                                            {_("Cancel editing / start a new policy")}
                                        </Button>
                                    </FormGroup>
                                )
                                : (
                                    <>
                                        <FormGroup label={_("Content file")} fieldId="ct-tailor-content-select">
                                            {uploadError && (
                                                <Alert
                                                    variant="danger" title={_("Upload failed")} isInline
                                                    actionClose={<Button variant="plain" onClick={() => setUploadError(null)}>×</Button>}
                                                >
                                                    {uploadError}
                                                </Alert>
                                            )}
                                            <ContentSelect
                                                id="ct-tailor-content-select"
                                                value={content}
                                                onChange={(_e, v) => setContent(v)}
                                                contentList={contentList}
                                                emptyLabel={_("Select content…")}
                                            />
                                            <Button variant="link" isInline isLoading={uploading} onClick={handleUploadClick}>
                                                {_("Upload…")}
                                            </Button>
                                            <input
                                                ref={fileInputRef} type="file" accept=".xml" hidden
                                                onChange={handleFileChosen}
                                            />
                                        </FormGroup>
                                        <FormGroup label={_("Base profile")} fieldId="ct-tailor-profile-select">
                                            <FormSelect
                                                id="ct-tailor-profile-select" value={profileId}
                                                onChange={(_e, v) => setProfileId(v)}
                                                isDisabled={!content || profiles.length === 0}
                                            >
                                                {profiles.length === 0 && (
                                                    <FormSelectOption value="" label={_("Select content first")} isDisabled />
                                                )}
                                                {profiles.map(p => (
                                                    <FormSelectOption key={p.id} value={p.id} label={p.title || p.id} />
                                                ))}
                                            </FormSelect>
                                        </FormGroup>
                                        <Button
                                            variant="secondary" isDisabled={!profileId || !content}
                                            isLoading={loadingTree} onClick={handleLoad}
                                        >
                                            {_("Load Rules")}
                                        </Button>
                                    </>
                                )}
                        </Form>
                    </div>
                    <ProfileDescriptionPanel
                        profileId={isEditing ? editingSidecar.base_profile_id : profileId}
                        sdsPath={isEditing ? editingSidecar.sds_path : content}
                        preloaded={isEditing ? tailorData?.profile : null}
                    />
                </div>

                {loadingTree && !tailorData && (
                    <div className="ct-tailor-loading">
                        <Spinner size="md" aria-label={_("Loading profile")} />
                    </div>
                )}

                {tailorData && (
                    <>
                        <FormGroup label={_("Policy name")} fieldId="ct-tailor-name-input" className="ct-tailor-name-group">
                            <TextInput id="ct-tailor-name-input" value={name} onChange={(_e, v) => setName(v)} />
                        </FormGroup>

                        <div className="ct-tailor-filter-bar">
                            <SearchInput
                                placeholder={_("Search rules…")}
                                value={search}
                                onChange={(_e, v) => setSearch(v)}
                                onClear={() => setSearch('')}
                            />
                            <ToggleGroup aria-label={_("Filter by status")}>
                                <ToggleGroupItem text={_("All")} isSelected={statusFilter === 'all'} onChange={() => setStatusFilter('all')} />
                                <ToggleGroupItem text={_("Disabled")} isSelected={statusFilter === 'disabled'} onChange={() => setStatusFilter('disabled')} />
                                <ToggleGroupItem text={_("Modified")} isSelected={statusFilter === 'modified'} onChange={() => setStatusFilter('modified')} />
                            </ToggleGroup>
                            <ToggleGroup aria-label={_("Filter by severity")}>
                                <ToggleGroupItem text={_("All")} isSelected={severityFilter === 'all'} onChange={() => setSeverityFilter('all')} />
                                <ToggleGroupItem text={_("High")} isSelected={severityFilter === 'high'} onChange={() => setSeverityFilter('high')} />
                                <ToggleGroupItem text={_("Medium")} isSelected={severityFilter === 'medium'} onChange={() => setSeverityFilter('medium')} />
                                <ToggleGroupItem text={_("Low")} isSelected={severityFilter === 'low'} onChange={() => setSeverityFilter('low')} />
                            </ToggleGroup>
                            <Button variant="link" isInline onClick={expandAll}>{_("Expand all")}</Button>
                            <Button variant="link" isInline onClick={collapseAll}>{_("Collapse all")}</Button>
                        </div>

                        <p className="ct-tailor-summary-hint">
                            {modifiedRuleCount + modifiedValueCount === 0
                                ? _("No changes from the base profile yet.")
                                : cockpit.format(_("$0 rules, $1 variables changed from the base profile."), modifiedRuleCount, modifiedValueCount)}
                        </p>

                        <div className="ct-tailor-tree">
                            {allRules.length === 0
                                ? <p>{_("This profile has no rules.")}</p>
                                : (
                                    <TreeView
                                        key={treeKey}
                                        data={treeItems}
                                        aria-label={_("Rule tree")}
                                        hasGuides
                                        defaultAllExpanded={isSearching ? true : defaultAllExpanded}
                                        allExpanded={isSearching ? true : undefined}
                                        onCheck={handleCheck}
                                    />
                                )}
                        </div>

                        {tailorData.values && tailorData.values.length > 0 && (
                            <ExpandableSection
                                toggleText={cockpit.format(_("Variables ($0)"), tailorData.values.length)}
                                className="ct-tailor-values-section"
                            >
                                <div className="ct-tailor-values-grid">
                                    {tailorData.values.map(val => {
                                        const isModified = val.id in valueChanges;
                                        const baseValue = val.current || val.default || '';
                                        const activeValue = isModified ? valueChanges[val.id] : baseValue;
                                        return (
                                            <FormGroup
                                                key={val.id} label={val.title || val.id}
                                                fieldId={`ct-tailor-value-${val.id}`}
                                                className={isModified ? "ct-tailor-value-modified" : ""}
                                            >
                                                {val.options && val.options.length > 0
                                                    ? (
                                                        <FormSelect
                                                            id={`ct-tailor-value-${val.id}`}
                                                            value={activeValue}
                                                            onChange={(_e, v) => updateValue(val, v)}
                                                        >
                                                            {val.options.map(opt => (
                                                                <FormSelectOption key={opt.value} value={opt.value} label={opt.selector === opt.value ? opt.value : `${opt.selector}: ${opt.value}`} />
                                                            ))}
                                                        </FormSelect>
                                                    )
                                                    : (
                                                        <TextInput
                                                            id={`ct-tailor-value-${val.id}`}
                                                            value={activeValue}
                                                            onChange={(_e, v) => updateValue(val, v)}
                                                        />
                                                    )}
                                            </FormGroup>
                                        );
                                    })}
                                </div>
                            </ExpandableSection>
                        )}

                        <ChangeSummaryPanel
                            name={name}
                            tailorData={tailorData}
                            ruleChanges={ruleChanges}
                            valueChanges={valueChanges}
                        />

                        <Flex spaceItems={{ default: 'spaceItemsSm' }} className="ct-tailor-save-actions">
                            {isEditing && (
                                <FlexItem>
                                    <Button variant="primary" isLoading={saving} isDisabled={saving || !name.trim()} onClick={handleSave}>
                                        {_("Update")}
                                    </Button>
                                </FlexItem>
                            )}
                            <FlexItem>
                                <Button
                                    variant={isEditing ? "secondary" : "primary"}
                                    isLoading={saving} isDisabled={saving || !name.trim()}
                                    onClick={isEditing ? handleSaveAsNew : handleSave}
                                >
                                    {isEditing ? _("Save as New") : _("Save Policy")}
                                </Button>
                            </FlexItem>
                        </Flex>
                    </>
                )}
            </CardBody>

            {pendingUpload && (
                <Modal variant="small" isOpen onClose={() => setPendingUpload(null)}>
                    <ModalHeader title={_("Replace existing content?")} />
                    <ModalBody>
                        {cockpit.format(
                            _("\"$0\" already exists ($1, uploaded $2). Replace with the new file ($3)?"),
                            pendingUpload.file.name,
                            formatBytes(pendingUpload.existing.size),
                            formatUploadDate(pendingUpload.existing.mtime),
                            formatBytes(pendingUpload.file.size)
                        )}
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="primary" onClick={handleConfirmReplace}>{_("Replace")}</Button>
                        <Button variant="link" onClick={() => setPendingUpload(null)}>{_("Cancel")}</Button>
                    </ModalFooter>
                </Modal>
            )}
        </Card>
    );
};
