import cockpit from 'cockpit';
import React, { useState } from 'react';
import { Dropdown, DropdownItem, DropdownList } from "@patternfly/react-core/dist/esm/components/Dropdown/index.js";
import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";

const _ = cockpit.gettext;

/* "Other content ▾" under a content picker (F4, cheap version): one menu
 * instead of a row of blue links. Items appear only when their handler is
 * given: Upload content…, Enter a path / Use detected content (manual
 * toggle), Manage content (brings the SCAP Content card into view). */
export const OtherContentMenu = ({ id, onUpload, uploading, manualPath, onToggleManual, onManage }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <Dropdown
            isOpen={isOpen}
            onOpenChange={setIsOpen}
            onSelect={() => setIsOpen(false)}
            toggle={ref => (
                <MenuToggle
                    ref={ref} id={id} variant="plainText" size="sm" className="ct-other-content-toggle"
                    isExpanded={isOpen}
                    onClick={() => setIsOpen(o => !o)}
                >
                    {uploading ? <><Spinner size="sm" aria-label={_("Uploading")} /> {_("Uploading…")}</> : _("Other content")}
                </MenuToggle>
            )}
        >
            <DropdownList>
                {onUpload && (
                    <DropdownItem
                        value="upload" isDisabled={uploading} onClick={onUpload}
                        description={_("Add a SCAP datastream (.xml) from this computer")}
                    >
                        {_("Upload content…")}
                    </DropdownItem>
                )}
                {onToggleManual && (
                    <DropdownItem value="manual" onClick={onToggleManual}>
                        {manualPath ? _("Use detected content") : _("Enter a path…")}
                    </DropdownItem>
                )}
                {onManage && (
                    <DropdownItem value="manage" onClick={onManage}>
                        {_("Manage content")}
                    </DropdownItem>
                )}
            </DropdownList>
        </Dropdown>
    );
};
