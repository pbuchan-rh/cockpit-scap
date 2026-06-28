import cockpit from 'cockpit';
import React, { useMemo, useState } from 'react';
import { Badge } from "@patternfly/react-core/dist/esm/components/Badge/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";

import { generateFix } from '../lib/oscap.js';

const _ = cockpit.gettext;

const SEVERITY_COLOR = {
    critical: 'red',
    high: 'orange',
    medium: 'gold',
    low: 'blue',
    unknown: 'grey',
};

function downloadBlob(data, filename, mimeType) {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function ruleShortId(fullId) {
    return fullId.replace(/^xccdf_[^_]+_rule_/, '');
}

export const ScanResults = ({ result, tmpdir, onNewScan }) => {
    const { scorePercent, pass, fail, error: errorCount, failingRules, reportHtml, resultsXmlGz, arfXmlGz } = result;

    const allSeverities = useMemo(
        () => [...new Set(failingRules.map(r => r.severity))],
        [failingRules]
    );

    const [severityFilter, setSeverityFilter] = useState(
        () => new Set(['critical', 'high', 'medium', 'low', 'unknown'])
    );
    const [selectedRuleIds, setSelectedRuleIds] = useState(
        () => new Set(failingRules.map(r => r.id))
    );
    const [busy, setBusy] = useState(null); // 'bash' | 'ansible'

    const visibleRules = useMemo(
        () => failingRules.filter(r => severityFilter.has(r.severity)),
        [failingRules, severityFilter]
    );

    function handleViewReport() {
        const blob = new Blob([reportHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
    }

    function handleDownloadResultsXml() {
        downloadBlob(resultsXmlGz, 'scan-results.xml.gz', 'application/gzip');
    }

    function handleDownloadArf() {
        downloadBlob(arfXmlGz, 'scan-arf.xml.gz', 'application/gzip');
    }

    async function handleDownloadFix(template) {
        const isBash = template === 'urn:xccdf:fix:script:sh';
        const busyKey = isBash ? 'bash' : 'ansible';
        const filename = isBash ? 'remediation.sh' : 'remediation.yml';
        setBusy(busyKey);
        try {
            const script = await generateFix(tmpdir, [...selectedRuleIds], template);
            downloadBlob(script, filename, 'text/plain');
        } catch (ex) {
            console.error('Fix generation failed:', ex.message);
        } finally {
            setBusy(null);
        }
    }

    function toggleSeverity(sev) {
        setSeverityFilter(prev => {
            const next = new Set(prev);
            if (next.has(sev)) next.delete(sev); else next.add(sev);
            return next;
        });
    }

    function toggleRule(id) {
        setSelectedRuleIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    const scoreColor = scorePercent === null ? 'grey'
        : scorePercent >= 80 ? 'green'
            : scorePercent >= 60 ? 'gold'
                : 'red';

    return (
        <>
            <Card>
                <CardHeader
                    actions={{
                        actions: (
                            <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                                <FlexItem>
                                    <Button variant="secondary" size="sm" onClick={handleViewReport}>
                                        {_("View Report")}
                                    </Button>
                                </FlexItem>
                                <FlexItem>
                                    <Button variant="secondary" size="sm" onClick={handleDownloadResultsXml}>
                                        {_("Results XML")}
                                    </Button>
                                </FlexItem>
                                <FlexItem>
                                    <Button variant="secondary" size="sm" onClick={handleDownloadArf}>
                                        {_("ARF")}
                                    </Button>
                                </FlexItem>
                                <FlexItem>
                                    <Button variant="primary" size="sm" onClick={onNewScan}>
                                        {_("New Scan")}
                                    </Button>
                                </FlexItem>
                            </Flex>
                        ),
                    }}
                >
                    <CardTitle>
                        <Title headingLevel="h2" size="lg">{_("Scan Complete")}</Title>
                    </CardTitle>
                </CardHeader>
                <CardBody>
                    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsLg' }}>
                        <FlexItem>
                            <span className={`ct-score-value ct-score-${scoreColor}`}>
                                {scorePercent !== null ? `${scorePercent}%` : _("N/A")}
                            </span>
                        </FlexItem>
                        <FlexItem>
                            <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                                <FlexItem>
                                    <Label color="green" isCompact>{_("Pass")}: {pass}</Label>
                                </FlexItem>
                                <FlexItem>
                                    <Label color="red" isCompact>{_("Fail")}: {fail}</Label>
                                </FlexItem>
                                {errorCount > 0 && (
                                    <FlexItem>
                                        <Label color="orange" isCompact>{_("Error")}: {errorCount}</Label>
                                    </FlexItem>
                                )}
                            </Flex>
                        </FlexItem>
                    </Flex>
                </CardBody>
            </Card>

            {failingRules.length === 0
                ? (
                    <Card>
                        <CardBody>
                            <EmptyState titleText={_("All rules passed")} headingLevel="h3">
                                <EmptyStateBody>
                                    {_("No failing or error rules found in this scan.")}
                                </EmptyStateBody>
                            </EmptyState>
                        </CardBody>
                    </Card>
                )
                : (
                    <Card>
                        <CardHeader
                            actions={{
                                actions: (
                                    <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                                        <FlexItem>
                                            <Button
                                                variant="secondary" size="sm"
                                                isLoading={busy === 'bash'}
                                                isDisabled={!!busy || selectedRuleIds.size === 0}
                                                onClick={() => handleDownloadFix('urn:xccdf:fix:script:sh')}
                                            >
                                                {_("Download Bash Fix")}
                                            </Button>
                                        </FlexItem>
                                        <FlexItem>
                                            <Button
                                                variant="secondary" size="sm"
                                                isLoading={busy === 'ansible'}
                                                isDisabled={!!busy || selectedRuleIds.size === 0}
                                                onClick={() => handleDownloadFix('urn:xccdf:fix:script:ansible')}
                                            >
                                                {_("Download Ansible Fix")}
                                            </Button>
                                        </FlexItem>
                                    </Flex>
                                ),
                            }}
                        >
                            <CardTitle>
                                <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                                    <FlexItem>
                                        <Title headingLevel="h3" size="md">{_("Failing Rules")}</Title>
                                    </FlexItem>
                                    <FlexItem>
                                        <Badge isRead>{failingRules.length}</Badge>
                                    </FlexItem>
                                    {allSeverities.length > 0 && (
                                        <FlexItem>
                                            <Flex spaceItems={{ default: 'spaceItemsXs' }}>
                                                {['critical', 'high', 'medium', 'low', 'unknown']
                                                    .filter(s => allSeverities.includes(s))
                                                    .map(sev => (
                                                        <FlexItem key={sev}>
                                                            <Label
                                                                color={SEVERITY_COLOR[sev] ?? 'grey'}
                                                                isCompact
                                                                onClick={() => toggleSeverity(sev)}
                                                                className={`ct-sev-filter ${severityFilter.has(sev) ? '' : 'ct-sev-inactive'}`}
                                                            >
                                                                {sev}
                                                            </Label>
                                                        </FlexItem>
                                                    ))
                                                }
                                            </Flex>
                                        </FlexItem>
                                    )}
                                </Flex>
                            </CardTitle>
                        </CardHeader>
                        <CardBody>
                            {visibleRules.length === 0
                                ? <p>{_("No rules match the current severity filter.")}</p>
                                : (
                                    <div className="ct-rules-list">
                                        <div className="ct-rules-controls">
                                            <Button variant="link" isInline
                                                onClick={() => setSelectedRuleIds(new Set(visibleRules.map(r => r.id)))}>
                                                {_("Select All")}
                                            </Button>
                                            {' · '}
                                            <Button variant="link" isInline
                                                onClick={() => setSelectedRuleIds(new Set())}>
                                                {_("Deselect All")}
                                            </Button>
                                            <span className="ct-selected-count">
                                                {cockpit.format(_(" ($0 selected)"), selectedRuleIds.size)}
                                            </span>
                                        </div>
                                        {visibleRules.map(rule => (
                                            <div key={rule.id} className="ct-rule-row">
                                                <Checkbox
                                                    id={`ct-rule-${rule.id}`}
                                                    isChecked={selectedRuleIds.has(rule.id)}
                                                    onChange={() => toggleRule(rule.id)}
                                                    label={
                                                        <Flex alignItems={{ default: 'alignItemsCenter' }}
                                                            spaceItems={{ default: 'spaceItemsSm' }}>
                                                            <FlexItem>
                                                                <Label
                                                                    color={SEVERITY_COLOR[rule.severity] ?? 'grey'}
                                                                    isCompact
                                                                >
                                                                    {rule.severity}
                                                                </Label>
                                                            </FlexItem>
                                                            <FlexItem>
                                                                <code className="ct-rule-id">
                                                                    {ruleShortId(rule.id)}
                                                                </code>
                                                            </FlexItem>
                                                        </Flex>
                                                    }
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )
                            }
                        </CardBody>
                        <CardFooter>
                            <span className="ct-fix-hint">
                                {_("Select rules above to include in the fix scripts.")}
                            </span>
                        </CardFooter>
                    </Card>
                )
            }
        </>
    );
};
