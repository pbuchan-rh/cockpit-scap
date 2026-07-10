import cockpit from 'cockpit';
import React, { useEffect, useState } from 'react';
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";

import { extractProfile } from '../lib/tailoring.js';

const _ = cockpit.gettext;

/* Right-hand description column for a profile picker. Fetches the profile's
 * own <description> (distinct from any single rule's) via extractProfile()
 * unless the caller already has it loaded (`preloaded`), in which case no
 * extra spawn is made. */
export const ProfileDescriptionPanel = ({ profileId, sdsPath, preloaded }) => {
    const [fetched, setFetched] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (preloaded || !profileId || !sdsPath) return;
        let cancelled = false;
        setLoading(true);
        extractProfile(profileId, sdsPath)
                .then(data => { if (!cancelled) setFetched(data.profile || null); })
                .catch(() => { if (!cancelled) setFetched(null); })
                .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true };
    }, [profileId, sdsPath, preloaded]);

    const profile = preloaded || fetched;

    return (
        <div className="ct-profile-desc-col">
            <p className="ct-profile-desc-heading">{_("Profile Description")}</p>
            {loading
                ? <Spinner size="sm" aria-label={_("Loading profile description")} />
                : profile?.description
                    ? <p>{profile.description}</p>
                    : (
                        <p className="ct-profile-desc-placeholder">
                            {profileId
                                ? _("No description available for this profile.")
                                : _("Select a profile to see its description.")}
                        </p>
                    )}
        </div>
    );
};
