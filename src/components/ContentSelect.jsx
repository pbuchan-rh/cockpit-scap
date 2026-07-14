import cockpit from 'cockpit';
import React from 'react';
import { FormSelect, FormSelectOption, FormSelectOptionGroup } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";

import { sdsDisplayName } from '../lib/oscap.js';

const _ = cockpit.gettext;

/* Shared, presentational content picker used by ScanSetup.jsx,
 * TailoringEditor.jsx, and TailoringList.jsx's upload-target picker.
 * contentList is detectContent()'s {path, source}[] shape — grouped into
 * "Detected" (source==='system') / "Uploaded" (source==='uploaded')
 * optgroup-style labels, per old main's "Uploaded Content" group precedent. */
export const ContentSelect = ({ id, ariaLabel, value, onChange, contentList, isDisabled, emptyLabel }) => {
    const system = contentList.filter(c => c.source === 'system');
    const uploaded = contentList.filter(c => c.source === 'uploaded');

    if (contentList.length === 0) {
        return (
            <FormSelect id={id} aria-label={ariaLabel} value="" isDisabled>
                <FormSelectOption value="" label={emptyLabel || _("No content found")} isDisabled />
            </FormSelect>
        );
    }

    return (
        <FormSelect id={id} aria-label={ariaLabel} value={value} onChange={onChange} isDisabled={isDisabled}>
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
