import cockpit from 'cockpit';
import React, { useState, useEffect, useMemo } from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";

import { detectContent, getOsRelease, getProfiles } from '../lib/oscap.js';
import { listTailoringFiles } from '../lib/tailoring.js';
import { ProfileDescriptionPanel } from './ProfileDescriptionPanel.jsx';

const _ = cockpit.gettext;

function sdsDisplayName(path) {
    const name = path.split('/').pop() ?? path;
    return name.replace(/^ssg-/, '').replace(/-ds\.xml$/, '')
            .replace(/-/g, ' ');
}

function autoSelectContent(contentList, id, versionId) {
    const major = versionId?.split('.')[0] ?? '';
    for (const path of contentList) {
        const base = path.split('/').pop();
        if (major && (base.includes(`${id}${major}`) || base.includes(`${id}-${major}`))) return path;
    }
    for (const path of contentList) {
        if (path.split('/').pop()
                .includes(id)) return path;
    }
    return contentList[0] ?? '';
}

export const ScanSetup = ({ adminAllowed, onScan, tailoringRefreshKey }) => {
    const [contentList, setContentList] = useState([]);
    const [content, setContent] = useState('');
    const [manualPath, setManualPath] = useState(false);
    const [profiles, setProfiles] = useState([]);
    const [profile, setProfile] = useState('');
    const [tailoringFiles, setTailoringFiles] = useState([]);
    const [tailoringSelection, setTailoringSelection] = useState('');
    const [loadingContent, setLoadingContent] = useState(true);
    const [loadingProfiles, setLoadingProfiles] = useState(false);
    const [profileError, setProfileError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        Promise.all([detectContent(), getOsRelease()])
                .then(([list, { id, versionId }]) => {
                    if (cancelled) return;
                    setContentList(list);
                    const selected = autoSelectContent(list, id, versionId);
                    setContent(selected);
                    setLoadingContent(false);
                })
                .catch(() => {
                    if (!cancelled) setLoadingContent(false);
                });
        return () => { cancelled = true };
    }, []);

    useEffect(() => {
        if (!content) return;
        let cancelled = false;
        setLoadingProfiles(true);
        setProfileError(null);
        setProfiles([]);
        setProfile('');
        setTailoringSelection('');
        getProfiles(content)
                .then(list => {
                    if (cancelled) return;
                    setProfiles(list);
                    setProfile(list[0]?.id ?? '');
                    setLoadingProfiles(false);
                })
                .catch(ex => {
                    if (cancelled) return;
                    setProfileError(ex.message);
                    setLoadingProfiles(false);
                });
        return () => { cancelled = true };
    }, [content]);

    useEffect(() => {
        let cancelled = false;
        listTailoringFiles().then(list => { if (!cancelled) setTailoringFiles(list); });
        return () => { cancelled = true };
    }, [tailoringRefreshKey]);

    const tailoringForContent = useMemo(
        () => tailoringFiles.filter(sc => sc.sds_path === content),
        [tailoringFiles, content]
    );
    const selectedTailoring = tailoringForContent.find(sc => sc.path === tailoringSelection) ?? null;

    const canScan = adminAllowed && content && (selectedTailoring || profile) && !loadingProfiles;

    function handleSubmit(e) {
        e.preventDefault();
        if (!canScan) return;
        onScan({
            content,
            profile: selectedTailoring ? selectedTailoring.profile_id : profile,
            tailoring: selectedTailoring ? selectedTailoring.path : null,
            baseProfileId: selectedTailoring ? selectedTailoring.base_profile_id : profile,
        });
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <Title headingLevel="h2" size="lg">{_("SCAP Security Scan")}</Title>
                </CardTitle>
            </CardHeader>
            <CardBody>
                <div className="ct-two-col-form">
                    <div className="ct-form-col">
                        <Form onSubmit={handleSubmit} className="ct-scan-form">
                            <FormGroup label={_("Content file")} fieldId="ct-scap-content">
                                {loadingContent
                                    ? <Spinner size="sm" aria-label={_("Loading content")} />
                                    : manualPath
                                        ? <TextInput
                                            id="ct-scap-content"
                                            value={content}
                                            onChange={(_e, v) => setContent(v)}
                                            placeholder="/usr/share/xml/scap/ssg/content/ssg-rhel10-ds.xml"
                                        />
                                        : <FormSelect
                                            id="ct-scap-content"
                                            value={content}
                                            onChange={(_e, v) => setContent(v)}
                                        >
                                            {contentList.length === 0 && (
                                                <FormSelectOption value="" label={_("No content found in /usr/share/xml/scap/ssg/content/")} isDisabled />
                                            )}
                                            {contentList.map(path => (
                                                <FormSelectOption key={path} value={path} label={sdsDisplayName(path)} />
                                            ))}
                                        </FormSelect>}
                                <Button
                                    variant="link" isInline className="ct-path-toggle"
                                    onClick={() => setManualPath(m => !m)}
                                >
                                    {manualPath ? _("Use auto-detected content") : _("Enter path manually")}
                                </Button>
                            </FormGroup>

                            <FormGroup label={_("Profile")} fieldId="ct-scap-profile">
                                {loadingProfiles
                                    ? <Spinner size="sm" aria-label={_("Loading profiles")} />
                                    : <FormSelect
                                        id="ct-scap-profile"
                                        value={selectedTailoring ? selectedTailoring.base_profile_id : profile}
                                        onChange={(_e, v) => setProfile(v)}
                                        isDisabled={!content || profiles.length === 0 || !!selectedTailoring}
                                    >
                                        {profiles.length === 0 && (
                                            <FormSelectOption
                                                value=""
                                                label={profileError ? _("Failed to load profiles") : _("No profiles found")}
                                                isDisabled
                                            />
                                        )}
                                        {profiles.map(p => (
                                            <FormSelectOption key={p.id} value={p.id} label={p.title || p.id} />
                                        ))}
                                    </FormSelect>}
                                {profileError && <p className="ct-field-error">{profileError}</p>}
                            </FormGroup>

                            <FormGroup label={_("Tailoring policy")} fieldId="ct-scap-tailoring-select">
                                <FormSelect
                                    id="ct-scap-tailoring-select"
                                    value={tailoringSelection}
                                    onChange={(_e, v) => setTailoringSelection(v)}
                                >
                                    <FormSelectOption value="" label={_("(No tailoring — use full profile)")} />
                                    {tailoringForContent.map(sc => (
                                        <FormSelectOption key={sc.path} value={sc.path} label={sc.name} />
                                    ))}
                                </FormSelect>
                            </FormGroup>
                        </Form>
                    </div>
                    <ProfileDescriptionPanel
                        profileId={selectedTailoring ? selectedTailoring.base_profile_id : profile}
                        sdsPath={content}
                    />
                </div>
            </CardBody>
            <CardFooter>
                <Button
                    variant="primary"
                    isDisabled={!canScan}
                    onClick={handleSubmit}
                >
                    {_("Run Scan")}
                </Button>
            </CardFooter>
        </Card>
    );
};
