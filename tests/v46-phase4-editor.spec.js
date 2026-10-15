// V4.6 Phase 4, spec E: the policy editor, INSIDE the Cockpit shell
// (/scap-dev), both browser projects. Creates and edits one v46-test
// policy and deletes it.
const { test, expect } = require('@playwright/test');
const { openModuleInShell, hostSpawn } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

let page, frame, before, home;
const NAME = 'v46-test editor';

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    home = await S.homeDir(frame);
    before = await S.snapshotScans(frame);
    await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
});

test.afterAll(async () => {
    if (frame) await S.cleanupCreated(frame, before);
    await page?.close();
});

const editor = () => frame.locator('.ct-tailor-editor-card');
const bar = () => editor().locator('[data-ct-tailor-actionbar]');
const policiesCard = () => frame.locator('.pf-v6-c-card').filter({ has: frame.getByRole('heading', { name: 'Saved Tailoring Policies' }) });

async function loadNew() {
    await frame.locator('#ct-tailor-content-select').selectOption(S.DS);
    await expect(frame.locator('#ct-tailor-profile-select')).toBeEnabled({ timeout: 60000 });
    await frame.locator('#ct-tailor-profile-select').selectOption(S.PROFILE_L1);
    await editor().getByRole('button', { name: 'Load Rules' }).click();
    await expect(bar()).toBeVisible({ timeout: 120000 });
}

async function toggleFirstRule(term = 'aide') {
    const search = editor().getByRole('textbox', { name: 'Search rules' });
    await search.fill(term);
    const box = editor().locator('.ct-tailor-tree input[type=checkbox]').first();
    await box.click();
    await search.fill('');
}

async function changeFirstVariable() {
    // Polish E1: Variables may start closed.
    const toggle = editor().locator('#ct-tailor-values-title-toggle');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const ctl = editor().locator('.ct-tailor-values-grid').locator('select, input')
            .first();
    if (await ctl.evaluate(e => e.tagName) === 'SELECT') {
        const values = await ctl.locator('option').evaluateAll(os => os.map(o => o.value));
        const cur = await ctl.inputValue();
        await ctl.selectOption(values.find(v => v !== cur));
    } else {
        await ctl.fill((await ctl.inputValue()) + '1');
    }
}

test('new policy: sticky action bar, Rules / Variables / Changes sections, labeled filters', async ({ browserName }) => {
    await loadNew();
    await expect(bar().getByRole('textbox', { name: 'Policy name' })).toBeVisible();
    await expect(bar()).toContainText('No changes yet');
    await expect(bar().getByRole('button', { name: 'Save Policy' })).toHaveClass(/pf-m-primary/);
    await expect(bar().getByRole('button', { name: 'Cancel' })).toHaveClass(/pf-m-link/);
    await expect(editor().getByRole('button', { name: 'Update' })).toHaveCount(0);

    // Polish E1/E2: Rules and Variables headings are collapsible toggles
    // with their counts; each section still opens with its description.
    for (const h of [/^Rules \d+ of \d+ selected · 0 modified$/, /^Variables \d+ · 0 modified$/, /^Changes from base profile$/])
        await expect(editor().getByRole('heading', { name: h })).toBeVisible();
    await expect(editor().locator('.ct-tailor-section-desc').first()).toHaveText('Check or uncheck rules to enable or disable them.');
    await expect(editor().getByRole('heading', { name: 'Changes from base profile' }).locator('xpath=following-sibling::p[1]')).toHaveClass(/ct-tailor-section-desc/);
    await expect(editor().locator('.ct-filter-label')).toHaveText(['Show:', 'Severity:']);
    await expect(editor().getByRole('group', { name: 'Show:' })).toBeVisible();
    await expect(editor().getByRole('group', { name: 'Severity:' })).toBeVisible();
    // Variables: a collapsible section (polish E1), closed for a new policy;
    // its inputs show once opened.
    const varToggle = editor().getByRole('button', { name: /^Variables \d+ · \d+ modified$/ });
    await expect(varToggle).toHaveAttribute('aria-expanded', 'false');
    await varToggle.click();
    await expect(editor().locator('.ct-tailor-values-grid .pf-v6-c-form__group').first()).toBeVisible();
    // Sections are divided.
    expect(await editor().locator(':scope > .pf-v6-c-divider').count()).toBeGreaterThanOrEqual(3);
    await expect(editor().getByRole('button', { name: /Cancel editing/ })).toHaveCount(0);

    // Sticky: scroll the Variables section to the top of the page (well
    // past the bar's own place); the bar stays pinned above it.
    await editor().locator('#ct-tailor-values-title').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await expect.poll(() => bar().evaluate(el => Math.round(el.getBoundingClientRect().top))).toBeGreaterThanOrEqual(-1);
    expect(await bar().evaluate(el => Math.round(el.getBoundingClientRect().top))).toBeLessThanOrEqual(5);
    const scrolled = await frame.evaluate(() => document.querySelector('.pf-v6-c-page__main').scrollTop);
    expect(scrolled).toBeGreaterThan(400);
    await expect(bar()).toBeInViewport();
    await page.screenshot({ path: `tests/test-results/v46-phase4/editor-sticky-${browserName}.png` });
});

test('plurals and the two-column changes list', async ({ browserName }) => {
    await toggleFirstRule();
    await expect(bar().locator('.ct-tailor-change-count')).toHaveText('1 rule, 0 variables modified');
    await changeFirstVariable();
    await expect(bar().locator('.ct-tailor-change-count')).toHaveText('1 rule, 1 variable modified');
    const text = await editor().innerText();
    expect(text).not.toMatch(/\b1 rules\b/);
    expect(text).not.toMatch(/\b1 variables\b/);
    const summary = editor().locator('.ct-tailor-summary');
    await expect(summary.locator('.ct-tailor-summary-col')).toHaveCount(2);
    await expect(summary.locator('.ct-tailor-summary-col').nth(0)).toContainText('Rules (1)');
    await expect(summary.locator('.ct-tailor-summary-col').nth(1)).toContainText('Variables (1)');
    await expect(summary.getByRole('button', { name: 'Copy summary' })).toBeVisible();
    const border = await summary.evaluate(el => getComputedStyle(el).borderTopWidth);
    expect(border).toBe('0px');
    await summary.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `tests/test-results/v46-phase4/editor-changes-${browserName}.png` });
});

test('Cancel with unsaved changes asks; Keep editing keeps them; Discard resets', async () => {
    await bar().getByRole('button', { name: 'Cancel' }).click();
    let modal = frame.getByRole('dialog');
    await expect(modal).toContainText('Discard unsaved changes?');
    await modal.getByRole('button', { name: 'Keep editing' }).click();
    await expect(bar()).toContainText('1 rule, 1 variable modified');
    await bar().getByRole('button', { name: 'Cancel' }).click();
    modal = frame.getByRole('dialog');
    await modal.getByRole('button', { name: 'Discard changes' }).click();
    await expect(bar()).toHaveCount(0);
    await expect(editor().getByRole('heading', { name: 'New Tailoring Policy' })).toBeVisible();
});

test('Save Policy, then Edit: one-line description, Update / Save as New / Cancel', async () => {
    await loadNew();
    await bar().getByRole('textbox', { name: 'Policy name' }).fill(NAME);
    await toggleFirstRule();
    await bar().getByRole('button', { name: 'Save Policy' }).click();
    const row = policiesCard().locator('tbody tr').filter({ hasText: NAME });
    await expect(row).toHaveCount(1);
    const xml = await hostSpawn(frame, ['sh', '-c', `cat "${home}"/SCAP/tailoring/v46-test-editor-*.xml`]);
    expect(xml).toContain(`<benchmark href="${S.DS}"/>`);

    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(editor().getByRole('heading', { name: `Editing: ${NAME}` })).toBeVisible();
    await expect(bar()).toBeVisible({ timeout: 120000 });
    await expect(editor().locator('.ct-tailor-base')).toContainText('CIS Red Hat Enterprise Linux 10 Benchmark for Level 1 - Server');
    // Profile description collapsed to one line with an expander.
    const desc = editor().locator('.ct-tailor-base-desc');
    await expect(desc.getByRole('button', { name: 'Show more' })).toBeVisible();
    const lines = await desc.locator('.pf-v6-c-expandable-section__content').evaluate(el =>
        Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    expect(lines).toBeLessThanOrEqual(1);
    await expect(bar()).toContainText('1 rule, 0 variables modified');
    await expect(bar().getByRole('button', { name: 'Update' })).toHaveClass(/pf-m-primary/);
    await expect(bar().getByRole('button', { name: 'Save as New' })).toHaveClass(/pf-m-secondary/);
    // No changes: Cancel leaves edit mode without asking.
    await bar().getByRole('button', { name: 'Cancel' }).click();
    await expect(frame.getByRole('dialog')).toHaveCount(0);
    await expect(editor().getByRole('heading', { name: 'New Tailoring Policy' })).toBeVisible();
});

test('Edit, change, Update writes the policy', async () => {
    const row = policiesCard().locator('tbody tr').filter({ hasText: NAME });
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(bar()).toBeVisible({ timeout: 120000 });
    await changeFirstVariable();
    await expect(bar()).toContainText('1 rule, 1 variable modified');
    await bar().getByRole('button', { name: 'Update' }).click();
    await expect(editor().getByRole('heading', { name: 'New Tailoring Policy' })).toBeVisible();
    const xml = await hostSpawn(frame, ['sh', '-c', `cat "${home}"/SCAP/tailoring/v46-test-editor-*.xml`]);
    expect(xml).toContain('<set-value');
    expect(xml).toContain(`<benchmark href="${S.DS}"/>`);
});
