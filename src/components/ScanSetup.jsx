import cockpit from 'cockpit';
import React, { useState, useEffect } from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";

import { detectContent, getOsRelease, getProfiles } from '../lib/oscap.js';

const _ = cockpit.gettext;

function sdsDisplayName(path) {
    const name = path.split('/').pop() ?? path;
    return name.replace(/^ssg-/, '').replace(/-ds\.xml$/, '').replace(/-/g, ' ');
}

function autoSelectContent(contentList, id, versionId) {
    const major = versionId?.split('.')[0] ?? '';
    for (const path of contentList) {
        const base = path.split('/').pop();
        if (major && (base.includes(`${id}${major}`) || base.includes(`${id}-${major}`))) return path;
    }
    for (const path of contentList) {
        if (path.split('/').pop().includes(id)) return path;
    }
    return contentList[0] ?? '';
}

export const ScanSetup = ({ adminAllowed, onScan }) => {
    const [contentList, setContentList] = useState([]);
    const [content, setContent] = useState('');
    const [manualPath, setManualPath] = useState(false);
    const [profiles, setProfiles] = useState([]);
    const [profile, setProfile] = useState('');
    const [tailoringEnabled, setTailoringEnabled] = useState(false);
    const [tailoringPath, setTailoringPath] = useState('');
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
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!content) return;
        let cancelled = false;
        setLoadingProfiles(true);
        setProfileError(null);
        setProfiles([]);
        setProfile('');
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
        return () => { cancelled = true; };
    }, [content]);

    const canScan = adminAllowed && content && profile && !loadingProfiles;

    function handleSubmit(e) {
        e.preventDefault();
        if (!canScan) return;
        onScan({
            content,
            profile,
            tailoring: tailoringEnabled ? tailoringPath : null,
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
                                  </FormSelect>
                        }
                        <Button variant="link" isInline className="ct-path-toggle"
                            onClick={() => setManualPath(m => !m)}>
                            {manualPath ? _("Use auto-detected content") : _("Enter path manually")}
                        </Button>
                    </FormGroup>

                    <FormGroup label={_("Profile")} fieldId="ct-scap-profile">
                        {loadingProfiles
                            ? <Spinner size="sm" aria-label={_("Loading profiles")} />
                            : <FormSelect
                                id="ct-scap-profile"
                                value={profile}
                                onChange={(_e, v) => setProfile(v)}
                                isDisabled={!content || profiles.length === 0}
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
                              </FormSelect>
                        }
                        {profileError && <p className="ct-field-error">{profileError}</p>}
                    </FormGroup>

                    <FormGroup fieldId="ct-scap-tailoring-check">
                        <Checkbox
                            id="ct-scap-tailoring-check"
                            label={_("Use tailoring file")}
                            isChecked={tailoringEnabled}
                            onChange={(_e, v) => setTailoringEnabled(v)}
                        />
                        {tailoringEnabled && (
                            <TextInput
                                id="ct-scap-tailoring-path"
                                value={tailoringPath}
                                onChange={(_e, v) => setTailoringPath(v)}
                                placeholder="/path/to/tailoring.xml"
                                className="ct-tailoring-path-input"
                            />
                        )}
                    </FormGroup>
                </Form>
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
