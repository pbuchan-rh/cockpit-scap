// UAT batch 2, B2-2: in the policy editor both collapsible sections keep
// their search inside the section body, in a filter bar under the lead
// text, so a collapsed section shows only its title and counts. INSIDE the
// Cockpit shell (/scap-dev), both browser projects. The Variables search
// still filters (title or id) and its clear button restores the list.
// Screenshots light + dark: both sections collapsed, Variables expanded.
const { test, expect } = require('@playwright/test');
const { openModuleInShell } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

const SHOTS = 'tests/test-results/uat2';
const SECTIONS = [
    { name: 'Rules', id: 'ct-tailor-rules-title', search: 'Search rules' },
    { name: 'Variables', id: 'ct-tailor-values-title', search: 'Search variables' },
];
let page, frame, before;

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    before = await S.snapshotScans(frame);
    await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
    await S.pick(frame, '#ct-tailor-content-select', S.DS);
    await expect(frame.locator('#ct-tailor-profile-select')).toBeEnabled({ timeout: 60000 });
    await S.pick(frame, '#ct-tailor-profile-select', S.PROFILE_L1);
    await editor().getByRole('button', { name: 'Load Rules' })
            .click();
    await expect(bar()).toBeVisible({ timeout: 120000 });
});

test.afterAll(async () => {
    if (frame) {
        if (await bar().count()) await bar().getByRole('button', { name: 'Cancel' })
                .click();
        await S.cleanupCreated(frame, before);
    }
    await page?.close();
});

const editor = () => frame.locator('.ct-tailor-editor-card');
const bar = () => editor().locator('[data-ct-tailor-actionbar]');
const toggle = sec => editor().locator(`#${sec.id}-toggle`);
const section = sec => editor().locator(`section[aria-labelledby="${sec.id}-toggle"]`);
const searches = () => editor().locator('.ct-tailor-collapsible .ct-tailor-search input');
const varGroups = () => editor().locator('.ct-tailor-values-grid .pf-v6-c-form__group');

async function setOpen(sec, open) {
    if (await toggle(sec).getAttribute('aria-expanded') !== String(open)) await toggle(sec).click();
    await expect(toggle(sec)).toHaveAttribute('aria-expanded', String(open));
}

async function shots(name, browserName, target) {
    for (const scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForTimeout(300);
        await target.screenshot({ path: `${SHOTS}/b2-2-${name}-${scheme}-${browserName}.png` });
    }
    await page.emulateMedia({ colorScheme: 'light' });
}

test('collapsed: no search box in either section, title and counts only', async ({ browserName }) => {
    for (const sec of SECTIONS) await setOpen(sec, false);
    await expect(searches().filter({ visible: true })).toHaveCount(0);
    for (const sec of SECTIONS) {
        await expect(editor().getByRole('textbox', { name: sec.search })).toBeHidden();
        // Nothing but the toggle (title + counts) in the header row.
        await expect(section(sec).locator('.ct-tailor-section-head > *')).toHaveCount(1);
        await expect(section(sec).locator('.ct-tailor-section-head input')).toHaveCount(0);
    }
    await toggle(SECTIONS[0]).scrollIntoViewIfNeeded();
    await shots('editor-collapsed', browserName, editor());
});

test('expanded: each search sits in the section body, in a filter bar under the lead text', async () => {
    for (const sec of SECTIONS) await setOpen(sec, true);
    for (const sec of SECTIONS) {
        const box = editor().getByRole('textbox', { name: sec.search });
        await expect(box).toBeVisible();
        const where = await box.evaluate((input, id) => {
            const body = document.getElementById(`${id}-content`);
            const head = document.getElementById(`${id}-toggle`).closest('.ct-tailor-section-head');
            const bar = input.closest('.ct-tailor-filter-bar');
            const lead = body?.querySelector('.ct-tailor-section-lead');
            return {
                inBody: !!body && body.contains(input),
                inBar: !!bar,
                searchClass: !!input.closest('.ct-tailor-search'),
                belowHead: input.getBoundingClientRect().top >= head.getBoundingClientRect().bottom,
                belowLead: !!lead && !!bar && bar.getBoundingClientRect().top >= lead.getBoundingClientRect().bottom,
                placeholder: input.placeholder,
            };
        }, sec.id);
        expect(where, sec.name).toEqual({ inBody: true, inBar: true, searchClass: true, belowHead: true, belowLead: true, placeholder: `${sec.search}…` });
    }
});

test('Variables search filters and clears', async ({ browserName }) => {
    const sec = SECTIONS[1];
    const box = editor().getByRole('textbox', { name: sec.search });
    const total = await varGroups().count();
    await box.fill('password');
    await expect.poll(() => varGroups().count()).toBeLessThan(total);
    const shown = await varGroups().count();
    expect(shown).toBeGreaterThan(0);
    const hay = await varGroups().evaluateAll(gs => gs.map(g => (g.innerText + ' ' + (g.querySelector('.ct-select-toggle, input')?.id || '')).toLowerCase()));
    for (const h of hay) expect(h).toContain('password');
    await expect(toggle(sec)).toHaveAttribute('aria-expanded', 'true');
    await section(sec).getByRole('button', { name: 'Reset' })
            .click();
    await expect(box).toHaveValue('');
    await expect(varGroups()).toHaveCount(total);
    // Variables expanded (Rules collapsed), for the screenshot.
    await setOpen(SECTIONS[0], false);
    // The section (scroll-margin 6rem) clears the sticky action bar.
    await section(sec).evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await shots('editor-variables-expanded', browserName, page);
});
