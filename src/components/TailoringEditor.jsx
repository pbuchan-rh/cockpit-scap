import cockpit from 'cockpit';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { SearchInput } from "@patternfly/react-core/dist/esm/components/SearchInput/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { ToggleGroup, ToggleGroupItem } from "@patternfly/react-core/dist/esm/components/ToggleGroup/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import { detectContent, getProfiles } from '../lib/oscap.js';
import {
    extractProfile, parseTailoringXml, readTailoringXml,
    saveNewTailoring, updateTailoringFile,
} from '../lib/tailoring.js';

const _ = cockpit.gettext;

const SEVERITY_COLOR = {
    high: 'orange',
    medium: 'gold',
    low: 'blue',
    unknown: 'grey',
};

function sdsDisplayName(path) {
    const name = path.split('/').pop() ?? path;
    return name.replace(/^ssg-/, '').replace(/-ds\.xml$/, '')
            .replace(/-/g, ' ');
}

function flattenRules(data) {
    const out = [];
    function walk(groups, rules) {
        (rules || []).forEach(r => out.push(r));
        (groups || []).forEach(g => walk(g.groups, g.rules));
    }
    if (data) walk(data.groups, data.rules);
    return out;
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
    (group.groups || []).forEach(sg => { total += countRules(sg).total });
    return { total };
}

const RuleRow = ({ rule, ruleChanges, onToggle }) => {
    const isModified = rule.id in ruleChanges;
    const checked = isModified ? ruleChanges[rule.id] : rule.selected;
    return (
        <div className={"ct-tailor-rule" + (isModified ? " ct-tailor-rule-modified" : "")}>
            <Checkbox
                id={`ct-tailor-rule-${rule.id}`}
                isChecked={checked}
                onChange={(_e, v) => onToggle(rule, v)}
                label={
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
                    </Flex>
                }
            />
        </div>
    );
};

const GroupNode = ({ group, filters, ruleChanges, onToggleRule }) => {
    if (!groupHasVisible(group, filters, ruleChanges)) return null;
    const { total } = countRules(group);

    return (
        <details className="ct-tailor-group">
            <summary className="ct-tailor-group-summary">
                <span className="ct-tailor-group-title">{group.title || group.id}</span>
                <span className="ct-tailor-group-count">{cockpit.format(_("$0 rules"), total)}</span>
            </summary>
            {(group.groups || []).map(sg => (
                <GroupNode key={sg.id} group={sg} filters={filters} ruleChanges={ruleChanges} onToggleRule={onToggleRule} />
            ))}
            {(group.rules || [])
                    .filter(r => ruleVisible(r, filters, ruleChanges))
                    .map(r => (
                        <RuleRow key={r.id} rule={r} ruleChanges={ruleChanges} onToggle={onToggleRule} />
                    ))}
        </details>
    );
};

export const TailoringEditor = ({ editingSidecar, onSaved, onCancelEdit }) => {
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

    const treeRef = useRef(null);
    const isEditing = !!editingSidecar;

    useEffect(() => {
        let cancelled = false;
        detectContent().then(list => { if (!cancelled) setContentList(list); });
        return () => { cancelled = true };
    }, []);

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

    useEffect(() => {
        if (!treeRef.current) return;
        const details = treeRef.current.querySelectorAll('details.ct-tailor-group');
        if (search.trim()) {
            details.forEach(d => { d.open = true });
        } else {
            details.forEach(d => { d.open = false });
        }
    }, [search, tailorData]);

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

    const filters = useMemo(() => ({ search, severity: severityFilter, status: statusFilter }), [search, severityFilter, statusFilter]);
    const allRules = useMemo(() => flattenRules(tailorData), [tailorData]);
    const modifiedRuleCount = Object.keys(ruleChanges).length;
    const modifiedValueCount = Object.keys(valueChanges).length;

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
                                    <FormSelect id="ct-tailor-content-select" value={content} onChange={(_e, v) => setContent(v)}>
                                        <FormSelectOption value="" label={_("Select content…")} isDisabled />
                                        {contentList.map(path => (
                                            <FormSelectOption key={path} value={path} label={sdsDisplayName(path)} />
                                        ))}
                                    </FormSelect>
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
                        </div>

                        <p className="ct-tailor-summary-hint">
                            {modifiedRuleCount + modifiedValueCount === 0
                                ? _("No changes from the base profile yet.")
                                : cockpit.format(_("$0 rules, $1 variables changed from the base profile."), modifiedRuleCount, modifiedValueCount)}
                        </p>

                        <div className="ct-tailor-tree" ref={treeRef}>
                            {(tailorData.groups || []).map(g => (
                                <GroupNode key={g.id} group={g} filters={filters} ruleChanges={ruleChanges} onToggleRule={toggleRule} />
                            ))}
                            {(tailorData.rules || [])
                                    .filter(r => ruleVisible(r, filters, ruleChanges))
                                    .map(r => (
                                        <RuleRow key={r.id} rule={r} ruleChanges={ruleChanges} onToggle={toggleRule} />
                                    ))}
                            {allRules.length === 0 && <p>{_("This profile has no rules.")}</p>}
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
        </Card>
    );
};
