import cockpit from 'cockpit';
import React, { useEffect, useState } from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { ClipboardCopy } from "@patternfly/react-core/dist/esm/components/ClipboardCopy/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider/index.js";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Tooltip } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";
import { CubesIcon } from "@patternfly/react-icons/dist/esm/icons/cubes-icon.js";
import { LockIcon } from "@patternfly/react-icons/dist/esm/icons/lock-icon.js";

import { install_dialog } from "cockpit-components-install-dialog.jsx";
import { getPackageManager } from "packagemanager";

const _ = cockpit.gettext;

export const SCANNER_PACKAGES = ['openscap-scanner', 'scap-security-guide'];
export const CONTENT_PACKAGES = ['scap-security-guide'];

/* Whether Cockpit can install packages here (PackageKit or dnf5daemon).
 * null while checking. */
function usePackageManagerAvailable() {
    const [available, setAvailable] = useState(null);
    useEffect(() => {
        let cancelled = false;
        getPackageManager()
                .then(() => { if (!cancelled) setAvailable(true) })
                .catch(() => { if (!cancelled) setAvailable(false) });
        return () => { cancelled = true };
    }, []);
    return available;
}

/* A card that stands in for a form whose prerequisites are missing ("not
 * set up": EmptyState, PATTERNS.md). The install action sits in the card
 * header like every other call to action; it uses Cockpit's own install
 * dialog and appears only when a package manager is available. The dnf
 * command is always shown, so the page also works without one. */
export const MissingPackagesCard = ({
    id, cardTitle, emptyTitle, description, packages, installLabel,
    adminAllowed, onInstalled, extraActions, children,
}) => {
    const pmAvailable = usePackageManagerAvailable();
    const command = `sudo dnf install ${packages.join(' ')}`;

    function handleInstall() {
        // Resolves after a successful install; rejects when cancelled (the
        // dialog shows its own errors).
        install_dialog(packages).then(() => onInstalled?.(), () => {});
    }

    const installButton = pmAvailable && (adminAllowed
        ? <Button variant="primary" className="ct-install-packages" onClick={handleInstall}>{installLabel}</Button>
        : (
            <Tooltip content={_('Turn on "Administrative access" at the top of the page to install packages')}>
                <Button variant="primary" className="ct-install-packages" isAriaDisabled>{installLabel}</Button>
            </Tooltip>
        ));

    const actions = (installButton || extraActions)
        ? {
            hasNoOffset: true,
            actions: (
                <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                    {installButton && !adminAllowed && (
                        <FlexItem>
                            <span className="ct-admin-needed">
                                <LockIcon className="ct-admin-needed-icon" />
                                {_("Administrative access required to install")}
                            </span>
                        </FlexItem>
                    )}
                    {extraActions && <FlexItem>{extraActions}</FlexItem>}
                    {installButton && <FlexItem>{installButton}</FlexItem>}
                </Flex>
            ),
        }
        : undefined;

    return (
        <Card id={id} className="ct-missing-packages">
            <CardHeader actions={actions}>
                <CardTitle>
                    <Title headingLevel="h2" size="lg">{cardTitle}</Title>
                </CardTitle>
            </CardHeader>
            <Divider />
            <CardBody>
                {children}
                <EmptyState titleText={emptyTitle} headingLevel="h3" icon={CubesIcon} variant="sm">
                    <EmptyStateBody>
                        <Content component="p">{description}</Content>
                        <Content component="p">
                            {pmAvailable
                                ? _("Use Install above, or run this command on the host:")
                                : _("To install, run this command on the host:")}
                        </Content>
                        <ClipboardCopy
                            isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")}
                            className="ct-install-command"
                        >
                            {command}
                        </ClipboardCopy>
                    </EmptyStateBody>
                </EmptyState>
            </CardBody>
        </Card>
    );
};

/* Host Scan and Policy Tailoring without the scanner. */
export const OscapMissingCard = ({ id, cardTitle, adminAllowed, onInstalled }) => (
    <MissingPackagesCard
        id={id} cardTitle={cardTitle}
        emptyTitle={_("OpenSCAP is not installed")}
        description={_("Scanning and policy tailoring need the OpenSCAP scanner (openscap-scanner) and the SCAP Security Guide content (scap-security-guide). Saved scans, policies and content below are still available.")}
        packages={SCANNER_PACKAGES}
        installLabel={_("Install")}
        adminAllowed={adminAllowed}
        onInstalled={onInstalled}
    />
);
