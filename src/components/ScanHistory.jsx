import cockpit from 'cockpit';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider/index.js";
import { Dropdown, DropdownItem, DropdownList } from "@patternfly/react-core/dist/esm/components/Dropdown/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { CaretDownIcon } from "@patternfly/react-icons/dist/esm/icons/caret-down-icon.js";
import { CaretUpIcon } from "@patternfly/react-icons/dist/esm/icons/caret-up-icon.js";
import { EllipsisVIcon } from "@patternfly/react-icons/dist/esm/icons/ellipsis-v-icon.js";
import { Table, Thead, Tbody, Tr, Th, Td } from "@patternfly/react-table/dist/esm/components/Table/index.js";

import { downloadFile } from '../lib/download.js';
import { formatTimestamp, listFooterText } from '../lib/format.js';
import { deleteScan, listScans, readSavedScanFiles } from '../lib/scanHistory.js';
import { slugify } from '../lib/rules.js';

const _ = cockpit.gettext;

// Phone width keeps a 3-column table (Date | Score | Actions), R7.
const WIDE = ['hidden', 'visibleOnMd'];

function scoreText(score) {
    return score !== null && score !== undefined ? `${score}%` : _("N/A");
}

/* Score change vs the previous (older) scan of the same profile and
 * tailoring on the same content, keyed by scan dir. Scans are newest first. */
function scoreDeltas(scans) {
    const key = sc => [sc.sds_file, sc.profile_id, sc.tailoring_path || sc.tailoring_file || ''].join('|');
    const deltas = {};
    scans.forEach((sc, i) => {
        if (typeof sc.score !== 'number') return;
        const prev = scans.slice(i + 1).find(o => key(o) === key(sc) && typeof o.score === 'number');
        if (prev) deltas[sc.dir] = Math.round((sc.score - prev.score) * 10) / 10;
    });
    return deltas;
}

const ScoreDelta = ({ delta }) => {
    if (delta === undefined) return null;
    if (delta === 0)
        return <span className="ct-score-delta ct-score-delta-same" title={_("Same as the previous scan of this profile")}>±0</span>;
    const up = delta > 0;
    return (
        <span
            className={`ct-score-delta ${up ? 'ct-score-delta-up' : 'ct-score-delta-down'}`}
            title={_("Change since the previous scan of this profile")}
        >
            {up
                ? <CaretUpIcon aria-label={_("up")} className="ct-score-delta-icon" />
                : <CaretDownIcon aria-label={_("down")} className="ct-score-delta-icon" />}
            {Math.abs(delta)}
        </span>
    );
};

const RowActions = ({ sc, busy, disabled, onView, onDownload, onDelete }) => {
    const [downloadOpen, setDownloadOpen] = useState(false);
    const [kebabOpen, setKebabOpen] = useState(false);
    const when = formatTimestamp(sc.timestamp);
    return (
        <Flex spaceItems={{ default: 'spaceItemsSm' }} flexWrap={{ default: 'nowrap' }} alignItems={{ default: 'alignItemsCenter' }}>
            <FlexItem>
                <Button variant="link" isInline isLoading={busy === 'view'} isDisabled={disabled} onClick={onView}>
                    {_("View")}
                </Button>
            </FlexItem>
            <FlexItem>
                <Dropdown
                    isOpen={downloadOpen}
                    onOpenChange={setDownloadOpen}
                    onSelect={() => setDownloadOpen(false)}
                    popperProps={{ position: 'right' }}
                    toggle={ref => (
                        <MenuToggle
                            ref={ref} variant="plainText" size="sm"
                            isDisabled={disabled}
                            isExpanded={downloadOpen}
                            onClick={() => setDownloadOpen(o => !o)}
                            aria-label={cockpit.format(_("Download scan from $0"), when)}
                        >
                            {busy === 'download' ? <Spinner size="sm" aria-label={_("Downloading")} /> : _("Download")}
                        </MenuToggle>
                    )}
                >
                    <DropdownList>
                        <DropdownItem value="html" onClick={() => onDownload('html')}>{_("HTML report")}</DropdownItem>
                        <DropdownItem value="xml" onClick={() => onDownload('xml')}>{_("Results XML")}</DropdownItem>
                        <DropdownItem
                            value="arf" onClick={() => onDownload('arf')}
                            description={_("Asset Reporting Format: results, OVAL data and asset identity")}
                        >
                            {_("ARF")}
                        </DropdownItem>
                    </DropdownList>
                </Dropdown>
            </FlexItem>
            <FlexItem>
                <Dropdown
                    isOpen={kebabOpen}
                    onOpenChange={setKebabOpen}
                    onSelect={() => setKebabOpen(false)}
                    popperProps={{ position: 'right' }}
                    toggle={ref => (
                        <MenuToggle
                            ref={ref} variant="plain" size="sm"
                            isDisabled={disabled}
                            isExpanded={kebabOpen}
                            onClick={() => setKebabOpen(o => !o)}
                            aria-label={cockpit.format(_("More actions for the scan from $0"), when)}
                            icon={<EllipsisVIcon />}
                        />
                    )}
                >
                    <DropdownList>
                        <DropdownItem value="delete" className="ct-menu-danger" onClick={onDelete}>{_("Delete")}</DropdownItem>
                    </DropdownList>
                </Dropdown>
            </FlexItem>
        </Flex>
    );
};

// props: refreshKey (bump to reload), onView(manifest) => Promise: app.jsx
// feeds the saved scan into ScanResults and scrolls to it. onChanged()
// after a delete so app.jsx refreshes the size. diskUsage: bytes used by
// ~/SCAP/scans, fetched by app.jsx.
export const ScanHistory = ({ refreshKey, onView, onChanged, diskUsage }) => {
    const [scans, setScans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null); // { dir, what: 'view' | 'download' }
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

    const deltas = useMemo(() => scoreDeltas(scans), [scans]);

    async function handleView(sc) {
        setBusy({ dir: sc.dir, what: 'view' });
        setError(null);
        try {
            await onView(sc);
        } catch (ex) {
            setError(ex.message || String(ex));
        } finally {
            setBusy(null);
        }
    }

    async function handleDownload(sc, kind) {
        setBusy({ dir: sc.dir, what: 'download' });
        setError(null);
        try {
            const files = await readSavedScanFiles(sc);
            const base = `scan-${slugify(sc.profile_title || sc.profile_id) || 'results'}-${sc.timestamp}`;
            if (kind === 'html') await downloadFile(files.reportHtml, `${base}-report.html`);
            else if (kind === 'xml') await downloadFile(files.resultsXmlGz, `scan-results-${sc.timestamp}.xml.gz`);
            else await downloadFile(files.arfXmlGz, `${base}-arf.xml.gz`);
        } catch (ex) {
            setError(ex.message || String(ex));
        } finally {
            setBusy(null);
        }
    }

    async function handleDeleteConfirm() {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await deleteScan(deleteTarget);
            setScans(prev => prev.filter(sc => sc.dir !== deleteTarget.dir));
            setDeleteTarget(null);
            onChanged?.();
        } catch (ex) {
            setError(ex.message || String(ex));
        } finally {
            setDeleting(false);
        }
    }

    return (
        <Card className="ct-history-card">
            <CardHeader>
                <CardTitle>
                    <Title headingLevel="h2" size="lg">{_("Scan History")}</Title>
                </CardTitle>
            </CardHeader>
            <Divider />
            <CardBody>
                {error && (
                    <Alert
                        variant="danger" title={_("Error")} isInline
                        actionClose={<Button variant="plain" onClick={() => setError(null)}>×</Button>}
                    >
                        {error}
                    </Alert>
                )}

                {/* Spinner on the first load only; a refresh keeps the rows. */}
                {loading && scans.length === 0
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
                            <Table aria-label={_("Scan history")} variant="compact" gridBreakPoint="" className="ct-table-band">
                                <Thead>
                                    <Tr>
                                        <Th>{_("Date")}</Th>
                                        <Th visibility={WIDE}>{_("Profile")}</Th>
                                        <Th>{_("Score")}</Th>
                                        <Th visibility={WIDE} className="ct-num-col">{_("Passed")}</Th>
                                        <Th visibility={WIDE} className="ct-num-col">{_("Failed")}</Th>
                                        <Th className="ct-actions-cell">{_("Actions")}</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {scans.map(sc => (
                                        <Tr key={sc.dir}>
                                            <Td dataLabel={_("Date")}>{formatTimestamp(sc.timestamp)}</Td>
                                            <Td dataLabel={_("Profile")} visibility={WIDE}>
                                                <div>{sc.profile_title || sc.profile_id}</div>
                                                {sc.tailoring_file && sc.tailoring_file !== sc.profile_title && (
                                                    <div className="ct-cell-subline">{sc.tailoring_file}</div>
                                                )}
                                            </Td>
                                            <Td dataLabel={_("Score")} className="ct-score-cell">
                                                {scoreText(sc.score)} <ScoreDelta delta={deltas[sc.dir]} />
                                            </Td>
                                            <Td dataLabel={_("Passed")} visibility={WIDE} className="ct-num-col">{sc.counts?.pass ?? '—'}</Td>
                                            <Td dataLabel={_("Failed")} visibility={WIDE} className="ct-num-col">{sc.counts?.fail ?? '—'}</Td>
                                            <Td dataLabel={_("Actions")} className="ct-actions-cell">
                                                <RowActions
                                                    sc={sc}
                                                    busy={busy?.dir === sc.dir ? busy.what : null}
                                                    disabled={!!busy}
                                                    onView={() => handleView(sc)}
                                                    onDownload={kind => handleDownload(sc, kind)}
                                                    onDelete={() => setDeleteTarget(sc)}
                                                />
                                            </Td>
                                        </Tr>
                                    ))}
                                </Tbody>
                            </Table>
                        )}
            </CardBody>
            <Divider />
            <CardFooter className="ct-list-footer">{loading && scans.length === 0 ? '' : listFooterText(scans.length, diskUsage)}</CardFooter>

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
