import cockpit from 'cockpit';
import React, { useEffect, useRef } from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";

const _ = cockpit.gettext;

export const ScanProgress = ({ output, onCancel }) => {
    const logRef = useRef(null);

    useEffect(() => {
        if (logRef.current)
            logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [output]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                        <FlexItem><Spinner size="md" aria-label={_("Scan running")} /></FlexItem>
                        <FlexItem>
                            <Title headingLevel="h2" size="lg">{_("Scan in progress…")}</Title>
                        </FlexItem>
                    </Flex>
                </CardTitle>
            </CardHeader>
            <CardBody>
                <pre className="ct-scan-output" ref={logRef}>
                    {output.join('\n')}
                </pre>
            </CardBody>
            <CardFooter>
                <Button variant="secondary" onClick={onCancel}>
                    {_("Cancel")}
                </Button>
            </CardFooter>
        </Card>
    );
};
