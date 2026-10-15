import React from 'react';
import { CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";

/* Card title for the module's lists, with "N items · size" beside it in
 * subtle text (Peter 2026-10-15: a separate footer row cost ~60 px per
 * table). `count` is empty while the first load runs. */
export const ListCardTitle = ({ title, count, titleProps = {} }) => (
    <CardTitle>
        <span className="ct-list-title">
            <Title headingLevel="h2" size="lg" {...titleProps}>{title}</Title>
            {count && <span className="ct-list-count">{count}</span>}
        </span>
    </CardTitle>
);
