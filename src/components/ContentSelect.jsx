import cockpit from 'cockpit';
import React from 'react';
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { FormHelperText } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption, FormSelectOptionGroup } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";

import { sdsDisplayName } from '../lib/oscap.js';

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
 * contentList is detectContent()'s {path, source}[] shape — grouped into
 * "Detected" (source==='system') / "Uploaded" (source==='uploaded')
 * optgroup-style labels, per old main's "Uploaded Content" group precedent. */
export const ContentSelect = ({ id, ariaLabel, value, onChange, contentList, isDisabled, emptyLabel, validated }) => {
    const system = contentList.filter(c => c.source === 'system');
    const uploaded = contentList.filter(c => c.source === 'uploaded');

    if (contentList.length === 0) {
        return (
            <FormSelect id={id} aria-label={ariaLabel} value="" isDisabled>
                <FormSelectOption value="" label={emptyLabel || _("No content found")} isDisabled />
            </FormSelect>
        );
    }

    // A value that is not among the options (a typed path, deleted
    // content) must show the placeholder: a native select otherwise
    // DISPLAYS its first option, and re-picking that option fires no
    // change (S2 stuck error).
    const inList = contentList.some(c => c.path === value);
    return (
        <FormSelect
            id={id} aria-label={ariaLabel} value={inList ? value : ''} onChange={onChange}
            isDisabled={isDisabled} validated={validated}
        >
            {!inList && (
                <FormSelectOption value="" label={_("Select content…")} isPlaceholder isDisabled />
            )}
            {system.length > 0 && (
                <FormSelectOptionGroup key="system" label={_("Detected")}>
                    {system.map(c => (
                        <FormSelectOption key={c.path} value={c.path} label={sdsDisplayName(c.path, c.source)} />
                    ))}
                </FormSelectOptionGroup>
            )}
            {uploaded.length > 0 && (
                <FormSelectOptionGroup key="uploaded" label={_("Uploaded")}>
                    {uploaded.map(c => (
                        <FormSelectOption key={c.path} value={c.path} label={sdsDisplayName(c.path, c.source)} />
                    ))}
                </FormSelectOptionGroup>
            )}
        </FormSelect>
    );
};
