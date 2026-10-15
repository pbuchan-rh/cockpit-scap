import cockpit from 'cockpit';
import React, { useEffect, useRef, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Table, Thead, Tbody, Tr, Th, Td } from "@patternfly/react-table/dist/esm/components/Table/index.js";

import { downloadFile } from '../lib/download.js';
import { listFooterText } from '../lib/format.js';
import { detectContent, sdsDisplayName } from '../lib/oscap.js';
import {
    deleteTailoringFile, listTailoringFiles, matchBenchmarkContent, readTailoringXml, saveUploadedTailoring,
    tailoringBenchmarkHref,
} from '../lib/tailoring.js';
import { ContentSelect } from './ContentSelect.jsx';

const _ = cockpit.gettext;

function formatCreated(ts) {
    if (!ts) return '—';
    return ts.slice(0, 10) + ' ' + ts.slice(11).replace(/-/g, ':');
}

// diskUsage is the du -sh total for ~/SCAP/tailoring, fetched by app.jsx —
// re-fetched there whenever onChanged() bumps refreshKey (upload/delete).
export const TailoringList = ({ refreshKey, onEdit, onChanged, diskUsage, contentRefreshKey }) => {
    const [sidecars, setSidecars] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [contentList, setContentList] = useState([]);
    // An uploaded tailoring whose <benchmark href> matches no single
    // content: { upload, href, matches, choice } while the modal asks.
    const [pendingTailoring, setPendingTailoring] = useState(null);
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
            if (!cancelled) setContentList(list);
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
            const upload = { xmlContent, profileId, baseProfileId: extendsId, baseProfileTitle: extendsId, name };

            // F2: the file says which content it is for; ask only when
            // that names nothing here (or more than one file).
            const href = tailoringBenchmarkHref(doc);
            const matches = matchBenchmarkContent(href, contentList);
            setUploadError(null);
            if (matches.length === 1)
                saveTailoring(upload, matches[0].path);
            else
                setPendingTailoring({ upload, href, matches, choice: matches[0]?.path ?? '' });
        };
        reader.readAsText(file);
    }

    async function saveTailoring(upload, sdsPath) {
        setUploading(true);
        setUploadError(null);
        try {
            await saveUploadedTailoring({ ...upload, sdsPath });
            const list = await listTailoringFiles();
            setSidecars(list);
            onChanged?.();
        } catch (ex) {
            setUploadError(ex.message || String(ex));
        } finally {
            setUploading(false);
        }
    }

    function handleConfirmContent() {
        const { upload, choice } = pendingTailoring;
        setPendingTailoring(null);
        saveTailoring(upload, choice);
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
        setError(null);
        try {
            const xml = await readTailoringXml(sidecar.path);
            await downloadFile(xml, sidecar.path.split('/').pop());
        } catch (ex) {
            setError(ex.message || String(ex));
        }
    }

    return (
        <Card>
            <CardHeader
                actions={{
                    actions: (
                        <>
                            <Button variant="secondary" size="sm" isLoading={uploading} onClick={handleUploadClick}>
                                {_("Upload Tailoring File")}
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
                    <Title headingLevel="h2" size="lg">{_("Saved Tailoring Policies")}</Title>
                </CardTitle>
            </CardHeader>
            <Divider />
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

                {/* Spinner on the first load only; a refresh keeps the rows. */}
                {loading && sidecars.length === 0
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
                            <Table aria-label={_("Saved tailoring policies")} variant="compact" className="ct-table-band">
                                <Thead>
                                    <Tr>
                                        <Th>{_("Name")}</Th>
                                        <Th>{_("Content")}</Th>
                                        <Th>{_("Base Profile")}</Th>
                                        <Th modifier="wrap">{_("Rules Modified")}</Th>
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
            </CardBody>
            <Divider />
            <CardFooter className="ct-list-footer">{loading && sidecars.length === 0 ? '' : listFooterText(sidecars.length, diskUsage)}</CardFooter>

            {pendingTailoring && (
                <Modal variant="small" isOpen onClose={() => setPendingTailoring(null)}>
                    <ModalHeader title={_("Which content is this policy for?")} />
                    <ModalBody>
                        <p className="ct-modal-text">
                            {!pendingTailoring.href
                                ? cockpit.format(_("\"$0\" does not say which SCAP content it tailors."), pendingTailoring.upload.name)
                                : pendingTailoring.matches.length === 0
                                    ? cockpit.format(_("\"$0\" was made for $1, which is not on this host."), pendingTailoring.upload.name, pendingTailoring.href)
                                    : cockpit.format(_("\"$0\" was made for $1, which matches more than one content file here."), pendingTailoring.upload.name, pendingTailoring.href)}
                        </p>
                        <ContentSelect
                            id="ct-tailoring-upload-content"
                            ariaLabel={_("Content for the uploaded policy")}
                            value={pendingTailoring.choice}
                            onChange={(_e, v) => setPendingTailoring(p => ({ ...p, choice: v }))}
                            contentList={contentList}
                        />
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="primary" isDisabled={!pendingTailoring.choice} onClick={handleConfirmContent}>{_("Save policy")}</Button>
                        <Button variant="link" onClick={() => setPendingTailoring(null)}>{_("Cancel")}</Button>
                    </ModalFooter>
                </Modal>
            )}

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
