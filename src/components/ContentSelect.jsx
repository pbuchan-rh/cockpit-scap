import cockpit from 'cockpit';
import React from 'react';
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { FormHelperText } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";

import { sdsDisplayName } from '../lib/oscap.js';
import { SelectField } from './SelectField.jsx';

const _ = cockpit.gettext;

/* The content field's own error: a plain-words message, plus oscap's text
 * (source locations stripped) behind a collapsed "Details". Shared by
 * ScanSetup.jsx and TailoringEditor.jsx. */
export const ContentFieldError = ({ id, error }) => (
    <FormHelperText>
        <HelperText>
            <HelperTextItem variant="error" id={id}>{error.message}</HelperTextItem>
        </HelperText>
        {error.details && (
            <ExpandableSection toggleText={_("Details")} className="ct-content-error-details">
                <pre className="ct-content-error-text">{error.details}</pre>
            </ExpandableSection>
        )}
    </FormHelperText>
);

/* Shared, presentational content picker used by ScanSetup.jsx,
 * TailoringEditor.jsx, and TailoringList.jsx's upload-target picker.
 * contentList is detectContent()'s {path, source}[] shape, grouped into
 * "Installed" (source==='system', the SCAP Content card's word for it) and
 * "Uploaded" (source==='uploaded'). A value that is not among the options
 * (deleted content) shows the placeholder. */
export const ContentSelect = ({ id, ariaLabel, value, onChange, contentList, isDisabled, emptyLabel, validated, ariaDescribedBy }) => {
    const option = c => ({ value: c.path, label: sdsDisplayName(c.path, c.source) });
    const empty = contentList.length === 0;
    return (
        <SelectField
            id={id} label={ariaLabel || _("Content file")}
            value={empty ? '' : value} onChange={onChange}
            groups={[
                { key: 'system', label: _("Installed"), options: contentList.filter(c => c.source === 'system').map(option) },
                { key: 'uploaded', label: _("Uploaded"), options: contentList.filter(c => c.source === 'uploaded').map(option) },
            ]}
            placeholder={empty ? (emptyLabel || _("No content found")) : _("Select content…")}
            isDisabled={isDisabled || empty} validated={validated} ariaDescribedBy={ariaDescribedBy}
        />
    );
};
