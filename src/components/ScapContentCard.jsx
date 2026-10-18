import cockpit from 'cockpit';
import React, { useEffect, useRef, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardHeader } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Table, Thead, Tbody, Tr, Th, Td } from "@patternfly/react-table/dist/esm/components/Table/index.js";

import { ListCardTitle } from './ListCardTitle.jsx';
import {
    checkUploadSize, deleteUploadedContent, listInstalledContent, listUploadedContent, sanitizeFilename,
    statExistingContent, uploadContent,
} from '../lib/content.js';
import { formatBytes, formatTimestamp, listFooterText } from '../lib/format.js';
import { getContentVersion, sdsDisplayName } from '../lib/oscap.js';

const _ = cockpit.gettext;

async function loadContent() {
    const [included, uploaded] = await Promise.all([
        listInstalledContent(), listUploadedContent(),
    ]);
    const rows = [
        ...included.map(c => ({ ...c, source: 'system' })),
        ...uploaded.map(c => ({ ...c, source: 'uploaded' })),
    ];
    // grep -m1 per file: a few ms each, never `oscap info`.
    const versions = await Promise.all(rows.map(r => getContentVersion(r.path)));
    return rows.map((r, i) => ({ ...r, version: versions[i] }));
}

/* "SCAP Content" (G1): every datastream on the host in one table.
 * Installed rows are every datastream under /usr/share/xml/scap (the
 * scap-security-guide RPM's and any other package's, no Delete), the same
 * list the content pickers call "Installed"; Uploaded rows are the
 * user's ~/SCAP/content (Delete). Not "SSG Content": uploads can be any
 * vendor's SCAP content. Owns the Upload entry point; the content pickers'
 * "Other content" menus upload through the same lib/content.js calls and
 * their "Manage content" item brings this card into view. */
export const ScapContentCard = ({ refreshKey, onChanged }) => {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    const [pendingUpload, setPendingUpload] = useState(null); // { file, existing }
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const fileInputRef = useRef(null);

    function reload() {
        return loadContent().then(setRows);
    }

    useEffect(() => {
        let cancelled = false;
        loadContent()
                .then(rows => {
                    if (cancelled) return;
                    setRows(rows);
                    setLoading(false);
                })
                .catch(ex => { if (!cancelled) { setError(ex.message || String(ex)); setLoading(false) } });
        return () => { cancelled = true };
    }, [refreshKey]);

    function doUpload(file) {
        setUploading(true);
        setUploadError(null);
        const reader = new FileReader();
        reader.onload = async ev => {
            try {
                await uploadContent(file.name, new Uint8Array(ev.target.result));
                await reload();
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
        // Guards against two uploads racing (a stat/confirm-replace round
        // trip still in flight) writing concurrent scratch files.
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
            setRows(prev => prev.filter(i => i.path !== deleteTarget.path));
            setDeleteTarget(null);
            onChanged?.();
        } catch (ex) {
            setError(ex.message || String(ex));
        } finally {
            setDeleting(false);
        }
    }

    const totalBytes = rows.reduce((sum, r) => sum + (r.size || 0), 0);

    return (
        <Card id="ct-scap-content-card">
            <CardHeader
                actions={{
                    actions: (
                        <>
                            <Button variant="secondary" size="sm" isLoading={uploading} onClick={() => fileInputRef.current?.click()}>
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
                <ListCardTitle
                    title={_("SCAP Content")}
                    titleProps={{ className: 'ct-scap-content-title', tabIndex: -1 }}
                    count={loading ? '' : listFooterText(rows.length, totalBytes)}
                />
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

                {loading && rows.length === 0
                    ? <Spinner size="md" aria-label={_("Loading SCAP content")} />
                    : rows.length === 0
                        ? (
                            <EmptyState titleText={_("No SCAP content")} headingLevel="h3">
                                <EmptyStateBody>
                                    {_("Install scap-security-guide, or upload a vendor or custom SCAP datastream (.xml).")}
                                </EmptyStateBody>
                            </EmptyState>
                        )
                        : (
                            <Table aria-label={_("SCAP content")} variant="compact" className="ct-table-band">
                                <Thead>
                                    <Tr>
                                        <Th>{_("Name")}</Th>
                                        <Th>{_("Source")}</Th>
                                        <Th>{_("Version")}</Th>
                                        <Th className="ct-num-col">{_("Size")}</Th>
                                        <Th>{_("Added")}</Th>
                                        <Th className="ct-actions-cell">{_("Actions")}</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {rows.map(item => (
                                        <Tr key={item.path} data-ct-source={item.source}>
                                            <Td dataLabel={_("Name")}>
                                                <div>{sdsDisplayName(item.path, item.source)}</div>
                                                <div className="ct-cell-subline">{item.name}</div>
                                            </Td>
                                            <Td dataLabel={_("Source")}>
                                                {/* Plain "Installed": the Version column already
                                                    shows the scap-security-guide version (Peter 10-15, C2). */}
                                                {item.source === 'system' ? _("Installed") : _("Uploaded")}
                                            </Td>
                                            <Td dataLabel={_("Version")}>{item.version || '—'}</Td>
                                            <Td dataLabel={_("Size")} className="ct-num-col">{formatBytes(item.size)}</Td>
                                            <Td dataLabel={_("Added")}>{formatTimestamp(item.mtime)}</Td>
                                            <Td dataLabel={_("Actions")} className="ct-actions-cell">
                                                {item.source === 'uploaded' && (
                                                    <Button
                                                        variant="link" isInline className="ct-btn-danger-link"
                                                        aria-label={cockpit.format(_("Delete $0"), item.name)}
                                                        onClick={() => setDeleteTarget(item)}
                                                    >
                                                        {_("Delete")}
                                                    </Button>
                                                )}
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
                            formatTimestamp(pendingUpload.existing.mtime),
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
