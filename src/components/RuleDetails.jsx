import cockpit from 'cockpit';
import React from 'react';

const _ = cockpit.gettext;

/* Description + rationale block for a single rule, shown when a
 * click-to-expand toggle (owned by the caller) is open. */
export const RuleDetailsBlock = ({ description, rationale }) => {
    if (!description && !rationale) return null;
    return (
        <div className="ct-rule-details">
            {description && <p className="ct-rule-details-desc">{description}</p>}
            {rationale && rationale !== description && (
                <p className="ct-rule-details-rationale">
                    <strong>{_("Rationale: ")}</strong>{rationale}
                </p>
            )}
        </div>
    );
};
