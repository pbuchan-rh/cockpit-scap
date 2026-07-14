import cockpit from 'cockpit';
import React, { useEffect, useRef, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Table, Thead, Tbody, Tr, Th, Td } from "@patternfly/react-table/dist/esm/components/Table/index.js";

import { detectContent, sdsDisplayName } from '../lib/oscap.js';
import { deleteTailoringFile, listTailoringFiles, readTailoringXml, saveUploadedTailoring } from '../lib/tailoring.js';
import { ContentSelect } from './ContentSelect.jsx';

const _ = cockpit.gettext;

function formatCreated(ts) {
    if (!ts) return '—';
    return ts.slice(0, 10) + ' ' + ts.slice(11).replace(/-/g, ':');
}

function downloadXml(xmlText, filename) {
    const blob = new Blob([xmlText], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// diskUsage is the du -sh total for ~/SCAP/tailoring, fetched by app.jsx —
// re-fetched there whenever onChanged() bumps refreshKey (upload/delete).
export const TailoringList = ({ refreshKey, onEdit, onChanged, diskUsage, contentRefreshKey }) => {
    const [sidecars, setSidecars] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [contentList, setContentList] = useState([]);
    const [uploadContent, setUploadContent] = useState('');
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const fileInputRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        listTailoringFiles()
                .then(list => { if (!cancelled) { setSidecars(list); setLoading(false) } })
                .catch(ex => { if (!cancelled) { setError(ex.message || String(ex)); setLoading(false) } });
        return () => { cancelled = true };
    }, [refreshKey]);

    useEffect(() => {
        let cancelled = false;
        detectContent().then(list => {
            if (cancelled) return;
            setContentList(list);
            setUploadContent(c => (c && list.some(item => item.path === c)) ? c : (list[0]?.path ?? ''));
        });
        return () => { cancelled = true };
    }, [contentRefreshKey]);

    function handleUploadClick() {
        fileInputRef.current?.click();
    }

    function handleFileChosen(e) {
        const file = e.target.files[0];
        e.target.value = '';
        if (file) handleUpload(file);
    }

    function handleUpload(file) {
        const reader = new FileReader();
        reader.onload = async ev => {
            const xmlContent = ev.target.result;
            const NS = 'http://checklists.nist.gov/xccdf/1.2';
            const doc = new DOMParser().parseFromString(xmlContent, 'application/xml');

            if (doc.getElementsByTagName('parsererror').length) {
                setUploadError(_("The uploaded file is not valid XML."));
                return;
            }
            const profileEl = doc.getElementsByTagNameNS(NS, 'Profile')[0];
            if (!profileEl) {
                setUploadError(_("The uploaded file does not appear to be a valid XCCDF tailoring file (no Profile element found)."));
                return;
            }

            const profileId = profileEl.getAttribute('id') || '';
            const extendsId = profileEl.getAttribute('extends') || '';
            const titleEl = profileEl.getElementsByTagNameNS(NS, 'title')[0];
            const name = titleEl ? titleEl.textContent.trim() : (profileId || file.name);

            setUploading(true);
            setUploadError(null);
            try {
                await saveUploadedTailoring({
                    xmlContent,
                    sdsPath: uploadContent,
                    profileId,
                    baseProfileId: extendsId,
                    baseProfileTitle: extendsId,
                    name,
                });
                const list = await listTailoringFiles();
                setSidecars(list);
                onChanged?.();
            } catch (ex) {
                setUploadError(ex.message || String(ex));
            } finally {
                setUploading(false);
            }
        };
        reader.readAsText(file);
    }

    async function handleDeleteConfirm() {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await deleteTailoringFile(deleteTarget);
            setSidecars(prev => prev.filter(sc => sc.path !== deleteTarget.path));
            setDeleteTarget(null);
            onChanged?.();
        } catch (ex) {
            setError(ex.message || String(ex));
        } finally {
            setDeleting(false);
        }
    }

    async function handleDownload(sidecar) {
        const xml = await readTailoringXml(sidecar.path);
        downloadXml(xml, sidecar.path.split('/').pop());
    }

    return (
        <Card>
            <CardHeader
                actions={{
                    actions: (
                        <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                            <FlexItem>
                                <ContentSelect
                                    ariaLabel={_("Content for uploaded file")}
                                    value={uploadContent}
                                    onChange={(_e, v) => setUploadContent(v)}
                                    contentList={contentList}
                                />
                            </FlexItem>
                            <FlexItem>
                                <Button variant="secondary" size="sm" isLoading={uploading} onClick={handleUploadClick}>
                                    {_("Upload Tailoring File")}
                                </Button>
                                <input
                                    ref={fileInputRef} type="file" accept=".xml" hidden
                                    onChange={handleFileChosen}
                                />
                            </FlexItem>
                        </Flex>
                    ),
                }}
            >
                <CardTitle>
                    <Title headingLevel="h2" size="lg">{_("Saved Tailoring Policies")}</Title>
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
                    ? <Spinner size="md" aria-label={_("Loading tailoring policies")} />
                    : sidecars.length === 0
                        ? (
                            <EmptyState titleText={_("No saved tailoring policies")} headingLevel="h3">
                                <EmptyStateBody>
                                    {_("Use the editor below to create one, or upload an existing XCCDF tailoring file.")}
                                </EmptyStateBody>
                            </EmptyState>
                        )
                        : (
                            <Table aria-label={_("Saved tailoring policies")} variant="compact">
                                <Thead>
                                    <Tr>
                                        <Th>{_("Name")}</Th>
                                        <Th>{_("Content")}</Th>
                                        <Th>{_("Base Profile")}</Th>
                                        <Th>{_("Rules Modified")}</Th>
                                        <Th>{_("Created")}</Th>
                                        <Th screenReaderText={_("Actions")} />
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {sidecars.map(sc => (
                                        <Tr key={sc.path}>
                                            <Td dataLabel={_("Name")}>{sc.name}</Td>
                                            <Td dataLabel={_("Content")}>{sdsDisplayName(sc.sds_path)}</Td>
                                            <Td dataLabel={_("Base Profile")}>{sc.base_profile_title || sc.base_profile_id}</Td>
                                            <Td dataLabel={_("Rules Modified")}>{sc.rules_modified ?? '—'}</Td>
                                            <Td dataLabel={_("Created")}>{formatCreated(sc.created)}</Td>
                                            <Td isActionCell className="ct-actions-cell">
                                                <Flex spaceItems={{ default: 'spaceItemsSm' }} flexWrap={{ default: 'nowrap' }}>
                                                    <FlexItem flex={{ default: 'flexNone' }}>
                                                        <Button variant="link" isInline onClick={() => onEdit(sc)}>{_("Edit")}</Button>
                                                    </FlexItem>
                                                    <FlexItem flex={{ default: 'flexNone' }}>
                                                        <Button variant="link" isInline onClick={() => handleDownload(sc)}>{_("Download")}</Button>
                                                    </FlexItem>
                                                    <FlexItem flex={{ default: 'flexNone' }}>
                                                        <Button variant="link" isInline className="ct-btn-danger-link" onClick={() => setDeleteTarget(sc)}>
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
                <p className="ct-disk-usage-total">{cockpit.format(_("Total disk used by tailoring policies: $0"), diskUsage ?? "—")}</p>
            </CardBody>

            {deleteTarget && (
                <Modal variant="small" isOpen onClose={() => setDeleteTarget(null)}>
                    <ModalHeader title={_("Delete Policy")} />
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
