import cockpit from 'cockpit';
import React, { useEffect, useRef, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Table, Thead, Tbody, Tr, Th, Td } from "@patternfly/react-table/dist/esm/components/Table/index.js";

import { checkUploadSize, deleteUploadedContent, listUploadedContent, sanitizeFilename, statExistingContent, uploadContent } from '../lib/content.js';

const _ = cockpit.gettext;

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

function formatDate(ts) {
    if (!ts) return '—';
    return ts.slice(0, 10) + ' ' + ts.slice(11, 19);
}

// Minimal "Uploaded Content" management surface (Decision 2 in
// PLAN_V4.3_CONTENT_UPLOAD.md) — Name/Size/Uploaded date/Delete only, no
// validate-on-demand, no disk-usage meter. Owns the primary Upload entry
// point; ScanSetup.jsx and TailoringEditor.jsx each get their own inline
// Upload button calling the same lib/content.js functions, so upload works
// from any of the three entry points without duplicating upload logic.
export const ContentUploadCard = ({ refreshKey, onChanged }) => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    const [pendingUpload, setPendingUpload] = useState(null); // { file, existing }
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const fileInputRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        listUploadedContent()
                .then(list => { if (!cancelled) { setItems(list); setLoading(false) } })
                .catch(ex => { if (!cancelled) { setError(ex.message || String(ex)); setLoading(false) } });
        return () => { cancelled = true };
    }, [refreshKey]);

    function handleUploadClick() {
        fileInputRef.current?.click();
    }

    function doUpload(file) {
        setUploading(true);
        setUploadError(null);
        const reader = new FileReader();
        reader.onload = async ev => {
            try {
                await uploadContent(file.name, new Uint8Array(ev.target.result));
                const list = await listUploadedContent();
                setItems(list);
                onChanged?.();
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

    async function handleDeleteConfirm() {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await deleteUploadedContent(deleteTarget.path);
            setItems(prev => prev.filter(i => i.path !== deleteTarget.path));
            setDeleteTarget(null);
            onChanged?.();
        } catch (ex) {
            setError(ex.message || String(ex));
        } finally {
            setDeleting(false);
        }
    }

    return (
        <Card>
            <CardHeader
                actions={{
                    actions: (
                        <>
                            <Button variant="secondary" size="sm" isLoading={uploading} onClick={handleUploadClick}>
                                {_("Upload Content")}
                            </Button>
                            <input
                                ref={fileInputRef} type="file" accept=".xml" hidden
                                onChange={handleFileChosen}
                            />
                        </>
                    ),
                }}
            >
                <CardTitle>
                    <Title headingLevel="h2" size="lg">{_("Uploaded Content")}</Title>
                </CardTitle>
            </CardHeader>
            <CardBody>
                {error && <Alert variant="danger" title={_("Error")} isInline>{error}</Alert>}
                {uploadError && (
                    <Alert
                        variant="danger" title={_("Upload failed")} isInline
                        actionClose={<Button variant="plain" onClick={() => setUploadError(null)}>×</Button>}
                    >
                        {uploadError}
                    </Alert>
                )}

                {loading
                    ? <Spinner size="md" aria-label={_("Loading uploaded content")} />
                    : items.length === 0
                        ? (
                            <EmptyState titleText={_("No uploaded content")} headingLevel="h3">
                                <EmptyStateBody>
                                    {_("Upload a vendor or custom SCAP datastream (.xml) to make it available in the content pickers.")}
                                </EmptyStateBody>
                            </EmptyState>
                        )
                        : (
                            <Table aria-label={_("Uploaded content")} variant="compact">
                                <Thead>
                                    <Tr>
                                        <Th>{_("Name")}</Th>
                                        <Th>{_("Size")}</Th>
                                        <Th>{_("Uploaded")}</Th>
                                        <Th screenReaderText={_("Actions")} />
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {items.map(item => (
                                        <Tr key={item.path}>
                                            <Td dataLabel={_("Name")}>{item.name}</Td>
                                            <Td dataLabel={_("Size")}>{formatBytes(item.size)}</Td>
                                            <Td dataLabel={_("Uploaded")}>{formatDate(item.mtime)}</Td>
                                            <Td isActionCell className="ct-actions-cell">
                                                <Button
                                                    variant="link" isInline className="ct-btn-danger-link"
                                                    onClick={() => setDeleteTarget(item)}
                                                >
                                                    {_("Delete")}
                                                </Button>
                                            </Td>
                                        </Tr>
                                    ))}
                                </Tbody>
                            </Table>
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
                            formatDate(pendingUpload.existing.mtime),
                            formatBytes(pendingUpload.file.size)
                        )}
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="primary" onClick={handleConfirmReplace}>{_("Replace")}</Button>
                        <Button variant="link" onClick={() => setPendingUpload(null)}>{_("Cancel")}</Button>
                    </ModalFooter>
                </Modal>
            )}

            {deleteTarget && (
                <Modal variant="small" isOpen onClose={() => setDeleteTarget(null)}>
                    <ModalHeader title={_("Delete Content")} />
                    <ModalBody>
                        {cockpit.format(_("Delete \"$0\"? This cannot be undone."), deleteTarget.name)}
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
