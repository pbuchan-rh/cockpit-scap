import React, { useState } from 'react';
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider/index.js";
import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle/index.js";
import { Select, SelectGroup, SelectList, SelectOption } from "@patternfly/react-core/dist/esm/components/Select/index.js";

/* PF6 Select in place of a native <select> (U2): the open list is a PF
 * menu (Red Hat Text, PF group titles, the PF selected checkmark) like the
 * module's other menus, not one drawn by the browser. Every picker in the
 * module uses it.
 *
 * - options: [{ value, label, description?, isDisabled?, key? }], or groups:
 *   [{ key, label, options }] (a SelectGroup each, empty ones left out).
 * - value not among the options: the toggle shows `placeholder`, muted.
 * - label: the field's name; the toggle reads "<label>: <selection>" to
 *   assistive technology (the visible FormGroup label points at it too).
 * - validated="error": the toggle's danger status, like a FormSelect's.
 * The toggle carries the selected value as data-ct-value. */
export const SelectField = ({
    id, label, value, onChange, options, groups, placeholder = '', isDisabled = false, validated,
    ariaDescribedBy, className,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const shownGroups = groups ? groups.filter(g => g.options.length > 0) : null;
    const all = shownGroups ? shownGroups.flatMap(g => g.options) : options;
    const selected = all.find(o => o.value === value);
    const text = selected ? selected.label : placeholder;

    const renderOption = o => (
        <SelectOption
            key={o.key ?? o.value} value={o.value} description={o.description} isDisabled={o.isDisabled}
            data-ct-value={o.value}
        >
            {o.label}
        </SelectOption>
    );

    const toggle = ref => (
        <MenuToggle
            ref={ref} id={id} isFullWidth
            className={className ? `ct-select-toggle ${className}` : 'ct-select-toggle'}
            isExpanded={isOpen} isDisabled={isDisabled}
            isPlaceholder={!selected}
            status={validated === 'error' ? 'danger' : undefined}
            aria-label={label ? (text ? `${label}: ${text}` : label) : undefined}
            aria-describedby={ariaDescribedBy}
            data-ct-value={selected ? selected.value : ''}
            onClick={() => setIsOpen(o => !o)}
        >
            {text}
        </MenuToggle>
    );

    return (
        <Select
            isOpen={isOpen}
            selected={value}
            onSelect={(_e, v) => {
                setIsOpen(false);
                if (v !== undefined && v !== value) onChange(v);
            }}
            onOpenChange={setIsOpen}
            toggle={toggle}
            shouldFocusToggleOnSelect
            shouldFocusFirstItemOnOpen
            popperProps={{ width: 'trigger' }}
            maxMenuHeight="20rem"
            isScrollable
        >
            {shownGroups
                ? shownGroups.map((g, i) => (
                    <React.Fragment key={g.key}>
                        {i > 0 && <Divider />}
                        <SelectGroup label={g.label} labelHeadingLevel="h3">
                            <SelectList aria-label={g.label}>{g.options.map(renderOption)}</SelectList>
                        </SelectGroup>
                    </React.Fragment>
                ))
                : <SelectList aria-label={label}>{options.map(renderOption)}</SelectList>}
        </Select>
    );
};
