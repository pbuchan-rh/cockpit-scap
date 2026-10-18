// V4.6 polish batch 1, E1-E3: the policy editor's Rules and Variables
// sections are collapsible (heading = toggle with counts), INSIDE the
// Cockpit shell (/scap-dev), both browser projects. Variables is closed for
// a policy without variable changes and open for one with them (this
// spec's own v46-test tailoring); its search stays in the header, opens the
// section and filters. Rules starts open. The sticky name + actions bar
// stays pinned after scrolling past both sections.
const { test, expect } = require('@playwright/test');
const { openModuleInShell } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

const SHOTS = 'tests/test-results/v46-polish';
let page, frame, before;

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    before = await S.snapshotScans(frame);
    await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
});

test.afterAll(async () => {
    if (frame) await S.cleanupCreated(frame, before);
    await page?.close();
});

const editor = () => frame.locator('.ct-tailor-editor-card');
const bar = () => editor().locator('[data-ct-tailor-actionbar]');
const rulesToggle = () => editor().locator('#ct-tailor-rules-title-toggle');
const varsToggle = () => editor().locator('#ct-tailor-values-title-toggle');
const varsSearch = () => editor().getByRole('textbox', { name: 'Search variables' });
const varGroups = () => editor().locator('.ct-tailor-values-grid .pf-v6-c-form__group');

async function loadNew() {
    await S.pick(frame, '#ct-tailor-content-select', S.DS);
    await expect(frame.locator('#ct-tailor-profile-select')).toBeEnabled({ timeout: 60000 });
    await S.pick(frame, '#ct-tailor-profile-select', S.PROFILE_L1);
    await editor().getByRole('button', { name: 'Load Rules' })
            .click();
    await expect(bar()).toBeVisible({ timeout: 120000 });
}

test('new policy: Variables closed, Rules open, headings carry the counts', async ({ browserName }) => {
    await loadNew();
    await expect(editor().getByRole('heading', { name: /^Variables \d+ · 0 modified$/ })).toBeVisible();
    await expect(varsToggle()).toHaveText(/^Variables \d+ · 0 modified$/);
    await expect(varsToggle()).toHaveAttribute('aria-expanded', 'false');
    await expect(varGroups().first()).toBeHidden();
    await expect(varsSearch()).toBeVisible();
    await expect(rulesToggle()).toHaveText(/^Rules \d+ of \d+ selected · 0 modified$/);
    await expect(rulesToggle()).toHaveAttribute('aria-expanded', 'true');
    await expect(editor().locator('.ct-tailor-tree')).toBeVisible();
    // Chevron: the same PF toggle icon as the collapsible groups elsewhere.
    await expect(varsToggle().locator('.pf-v6-c-expandable-section__toggle-icon')).toHaveCount(1);
    // Heading look: regular text color, not a blue link.
    const colors = await varsToggle().evaluate(b => ({ btn: getComputedStyle(b).color, body: getComputedStyle(document.body).color }));
    expect(colors.btn).toBe(colors.body);
    await varsToggle().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/editor-variables-closed-${browserName}.png` });
});

test('E1: Variables header toggles; the 28rem scroll box when open', async () => {
    await varsToggle().click();
    await expect(varsToggle()).toHaveAttribute('aria-expanded', 'true');
    await expect(varGroups().first()).toBeVisible();
    const box = await editor().locator('.ct-tailor-values-box')
            .evaluate(el => ({
                max: parseFloat(getComputedStyle(el).maxHeight), rem: parseFloat(getComputedStyle(document.documentElement).fontSize), oy: getComputedStyle(el).overflowY,
            }));
    expect(box.max).toBeCloseTo(28 * box.rem, 0);
    expect(box.oy).toBe('auto');
    await varsToggle().click();
    await expect(varsToggle()).toHaveAttribute('aria-expanded', 'false');
    await expect(varGroups().first()).toBeHidden();
});

test('E1: typing in Search variables opens the section and filters', async ({ browserName }) => {
    await expect(varsToggle()).toHaveAttribute('aria-expanded', 'false');
    const total = await varGroups().count();
    await varsSearch().fill('password');
    await expect(varsToggle()).toHaveAttribute('aria-expanded', 'true');
    await expect(varGroups().first()).toBeVisible();
    const shown = await varGroups().count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(total);
    // The filter matches the title or the variable id (as before).
    const hay = await varGroups().evaluateAll(gs => gs.map(g => (g.innerText + ' ' + (g.querySelector('.ct-select-toggle, input')?.id || '')).toLowerCase()));
    for (const h of hay) expect(h).toContain('password');
    await varsToggle().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/editor-variables-open-${browserName}.png` });
    await varsSearch().fill('');
    await expect(varGroups()).toHaveCount(total);
});

test('E2: Rules header toggles; Expand all / Collapse all act on the groups', async ({ browserName }) => {
    const tree = editor().locator('.ct-tailor-tree');
    const nodes = () => tree.locator('.pf-v6-c-tree-view__node:visible').count();
    const collapsed = await nodes();
    await editor().getByRole('button', { name: 'Expand all' })
            .click();
    await expect.poll(nodes).toBeGreaterThan(collapsed);
    await editor().getByRole('button', { name: 'Collapse all' })
            .click();
    await expect.poll(nodes).toBe(collapsed);

    await rulesToggle().click();
    await expect(rulesToggle()).toHaveAttribute('aria-expanded', 'false');
    await expect(tree).toBeHidden();
    await expect(editor().getByRole('textbox', { name: 'Search rules' })).toBeHidden();
    await rulesToggle().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/editor-rules-collapsed-${browserName}.png` });
    await rulesToggle().click();
    await expect(rulesToggle()).toHaveAttribute('aria-expanded', 'true');
    await expect(tree).toBeVisible();
    await expect(editor().getByRole('group', { name: 'Show:' })).toBeVisible();
});

test('E3: action bar stays sticky after scrolling past both sections', async () => {
    // Still open from the search above (clearing the search keeps it open).
    if (await varsToggle().getAttribute('aria-expanded') !== 'true') await varsToggle().click();
    await expect(varsToggle()).toHaveAttribute('aria-expanded', 'true');
    await editor().getByRole('heading', { name: 'Changes from base profile' })
            .evaluate(el => el.scrollIntoView({ block: 'start' }));
    const pos = await frame.evaluate(() => {
        const r = s => document.querySelector(s).getBoundingClientRect();
        return { bar: r('[data-ct-tailor-actionbar]').top, vars: r('.ct-tailor-values-box').bottom, scrolled: document.querySelector('.pf-v6-c-page__main').scrollTop };
    });
    expect(pos.scrolled).toBeGreaterThan(600);
    expect(pos.vars, 'scrolled past the Variables box').toBeLessThan(150);
    expect(Math.round(pos.bar)).toBeGreaterThanOrEqual(-1);
    expect(Math.round(pos.bar)).toBeLessThanOrEqual(5);
    await expect(bar()).toBeInViewport();
    await bar().getByRole('button', { name: 'Cancel' })
            .click();
    await expect(bar()).toHaveCount(0);
});

test('E1: editing a policy that changes variables opens Variables', async () => {
    await S.createTestTailoring(frame);
    await page.reload();
    frame = await (await page.locator('iframe[name^="cockpit1:localhost/scap-dev"]').elementHandle()).contentFrame();
    await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
    const row = frame.locator('.pf-v6-c-card').filter({ has: frame.getByRole('heading', { name: 'Saved Tailoring Policies' }) })
            .locator('tbody tr')
            .filter({ hasText: S.TEST_TAILORING_NAME });
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(bar()).toBeVisible({ timeout: 120000 });
    const n = Object.keys(S.SET_VALUES).length;
    await expect(varsToggle()).toHaveText(new RegExp(`^Variables \\d+ · ${n} modified$`));
    await expect(varsToggle()).toHaveAttribute('aria-expanded', 'true');
    await expect(varGroups().first()).toBeVisible();
    await expect(editor().locator('.ct-tailor-value-modified')).toHaveCount(n);
    await expect(rulesToggle()).toHaveText(new RegExp(`^Rules \\d+ of \\d+ selected · ${S.DESELECTED.length} modified$`));
    await expect(rulesToggle()).toHaveAttribute('aria-expanded', 'true');
    await bar().getByRole('button', { name: 'Cancel' })
            .click();
    await expect(bar()).toHaveCount(0);
});
