import cockpit from 'cockpit';
import React, { useEffect, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Table, Thead, Tbody, Tr, Th, Td } from "@patternfly/react-table/dist/esm/components/Table/index.js";

import { deleteScan, listScans, readSavedScanFiles } from '../lib/scanHistory.js';

const _ = cockpit.gettext;

function formatTimestamp(ts) {
    if (!ts) return '—';
    return ts.slice(0, 10) + ' ' + ts.slice(11).replace(/-/g, ':');
}

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

// props: refreshKey (bump to reload), onView(manifest) => Promise, called
// when the user clicks "View report" — the caller (app.jsx) is responsible
// for feeding the saved scan's files into ScanResults.
export const ScanHistory = ({ refreshKey, onView }) => {
    const [scans, setScans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [busyDir, setBusyDir] = useState(null); // dir of the row with an in-flight view/download
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        listScans()
                .then(list => { if (!cancelled) { setScans(list); setLoading(false) } })
                .catch(ex => { if (!cancelled) { setError(ex.message || String(ex)); setLoading(false) } });
        return () => { cancelled = true };
    }, [refreshKey]);

    async function handleView(sc) {
        setBusyDir(sc.dir);
        setError(null);
        try {
            await onView(sc);
        } catch (ex) {
            setError(ex.message || String(ex));
        } finally {
            setBusyDir(null);
        }
    }

    async function handleDownload(sc) {
        setBusyDir(sc.dir);
        setError(null);
        try {
            const files = await readSavedScanFiles(sc);
            downloadBlob(files.resultsXmlGz, `scan-results-${sc.timestamp}.xml.gz`, 'application/gzip');
        } catch (ex) {
            setError(ex.message || String(ex));
        } finally {
            setBusyDir(null);
        }
    }

    async function handleDeleteConfirm() {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await deleteScan(deleteTarget);
            setScans(prev => prev.filter(sc => sc.dir !== deleteTarget.dir));
            setDeleteTarget(null);
        } catch (ex) {
            setError(ex.message || String(ex));
        } finally {
            setDeleting(false);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <Title headingLevel="h2" size="lg">{_("Scan History")}</Title>
                </CardTitle>
            </CardHeader>
            <CardBody>
                {error && (
                    <Alert
                        variant="danger" title={_("Error")} isInline
                        actionClose={<Button variant="plain" onClick={() => setError(null)}>×</Button>}
                    >
                        {error}
                    </Alert>
                )}

                {loading
                    ? <Spinner size="md" aria-label={_("Loading scan history")} />
                    : scans.length === 0
                        ? (
                            <EmptyState titleText={_("No scan history yet")} headingLevel="h3">
                                <EmptyStateBody>
                                    {_("Completed scans are saved here automatically.")}
                                </EmptyStateBody>
                            </EmptyState>
                        )
                        : (
                            <Table aria-label={_("Scan history")} variant="compact">
                                <Thead>
                                    <Tr>
                                        <Th>{_("Date")}</Th>
                                        <Th>{_("Profile")}</Th>
                                        <Th>{_("Score")}</Th>
                                        <Th>{_("Pass/Fail")}</Th>
                                        <Th>{_("Tailoring")}</Th>
                                        <Th screenReaderText={_("Actions")} />
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {scans.map(sc => (
                                        <Tr key={sc.dir}>
                                            <Td dataLabel={_("Date")}>{formatTimestamp(sc.timestamp)}</Td>
                                            <Td dataLabel={_("Profile")}>{sc.profile_title || sc.profile_id}</Td>
                                            <Td dataLabel={_("Score")}>
                                                {sc.score !== null && sc.score !== undefined ? `${sc.score}%` : _("N/A")}
                                            </Td>
                                            <Td dataLabel={_("Pass/Fail")}>
                                                <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                                                    <FlexItem>
                                                        <Label color="green" isCompact>{sc.counts?.pass ?? '—'}</Label>
                                                    </FlexItem>
                                                    <FlexItem>
                                                        <Label color="red" isCompact>{sc.counts?.fail ?? '—'}</Label>
                                                    </FlexItem>
                                                </Flex>
                                            </Td>
                                            <Td dataLabel={_("Tailoring")}>{sc.tailoring_file || '—'}</Td>
                                            <Td isActionCell className="ct-actions-cell">
                                                <Flex spaceItems={{ default: 'spaceItemsSm' }} flexWrap={{ default: 'nowrap' }}>
                                                    <FlexItem flex={{ default: 'flexNone' }}>
                                                        <Button
                                                            variant="link" isInline
                                                            isLoading={busyDir === sc.dir}
                                                            isDisabled={!!busyDir}
                                                            onClick={() => handleView(sc)}
                                                        >
                                                            {_("View report")}
                                                        </Button>
                                                    </FlexItem>
                                                    <FlexItem flex={{ default: 'flexNone' }}>
                                                        <Button
                                                            variant="link" isInline
                                                            isDisabled={!!busyDir}
                                                            onClick={() => handleDownload(sc)}
                                                        >
                                                            {_("Download")}
                                                        </Button>
                                                    </FlexItem>
                                                    <FlexItem flex={{ default: 'flexNone' }}>
                                                        <Button
                                                            variant="link" isInline className="ct-btn-danger-link"
                                                            isDisabled={!!busyDir}
                                                            onClick={() => setDeleteTarget(sc)}
                                                        >
                                                            {_("Delete")}
                                                        </Button>
                                                    </FlexItem>
                                                </Flex>
                                            </Td>
                                        </Tr>
                                    ))}
                                </Tbody>
                            </Table>
                        )}
            </CardBody>

            {deleteTarget && (
                <Modal variant="small" isOpen onClose={() => setDeleteTarget(null)}>
                    <ModalHeader title={_("Delete Scan")} />
                    <ModalBody>
                        {cockpit.format(_("Delete the scan from $0? This cannot be undone."), formatTimestamp(deleteTarget.timestamp))}
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="danger" isLoading={deleting} onClick={handleDeleteConfirm}>{_("Delete")}</Button>
                        <Button variant="link" onClick={() => setDeleteTarget(null)}>{_("Cancel")}</Button>
                    </ModalFooter>
                </Modal>
            )}
        </Card>
    );
};
