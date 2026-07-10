// Live verification of V4.1.1 (rewrite@65145fd) against a real
// upgrade-installed RPM + refreshed dev-override on rhel10cis.
// Investigation script, not an asserting spec — console.log + screenshots,
// human reads the output to judge pass/fail.
const { test } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

const E8 = 'xccdf_org.ssgproject.content_profile_e8';
const SHOTS = 'tests/adhoc/screenshots/';

test('V4.1.1: profile description panel, TreeView, change summary, scan rule-metadata join', async ({ page, context }) => {
    page.on('pageerror', err => console.log('[pageerror]', err.message));

    await loginToCockpit(page);
    await page.locator('.pf-v6-c-card').first().waitFor({ timeout: 15000 });
    console.log('== Module loaded (direct nav) ==');

    // ---- Part A: Profile description side panel — light mode ----
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#ct-scap-content').waitFor({ timeout: 15000 });
    // Wait for auto-selection (content -> profile -> description spawn) to
    // fully resolve, not a fixed sleep. Both the heading ("Profile
    // Description") and the placeholder are also <p> tags — exclude both.
    await page.locator('.ct-profile-desc-col p:not(.ct-profile-desc-heading):not(.ct-profile-desc-placeholder)')
            .first().waitFor({ timeout: 15000 });
    await page.screenshot({ path: SHOTS + 'v411-01-scansetup-description-light.png', fullPage: true });
    const descTextLight = await page.locator('.ct-profile-desc-col').first().textContent();
    console.log('Profile description panel (light):', descTextLight?.slice(0, 200));

    // ---- Part A2: dark mode ----
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: SHOTS + 'v411-02-scansetup-description-dark.png', fullPage: true });
    console.log('== Dark mode screenshot taken ==');
    await page.emulateMedia({ colorScheme: 'light' });

    // ---- Part A3: 900px breakpoint ----
    await page.setViewportSize({ width: 880, height: 900 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: SHOTS + 'v411-03-breakpoint-880-stacked.png', fullPage: true });
    const gridCols880 = await page.locator('.ct-two-col-form').first().evaluate(el => getComputedStyle(el).gridTemplateColumns);
    console.log('grid-template-columns at 880px width:', gridCols880, '(expect single column / one value)');

    await page.setViewportSize({ width: 920, height: 900 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: SHOTS + 'v411-04-breakpoint-920-twocol.png', fullPage: true });
    const gridCols920 = await page.locator('.ct-two-col-form').first().evaluate(el => getComputedStyle(el).gridTemplateColumns);
    console.log('grid-template-columns at 920px width:', gridCols920, '(expect two columns / two values)');

    const overflowCheck = await page.locator('.ct-two-col-form').first().evaluate(el => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        overflowing: el.scrollWidth > el.clientWidth + 2,
    }));
    console.log('Overflow check at 920px:', JSON.stringify(overflowCheck));

    await page.setViewportSize({ width: 1280, height: 900 });

    // ---- Part B: TailoringEditor TreeView ----
    await page.click('button[role="tab"]:has-text("Tailoring")');
    await page.getByRole('heading', { name: 'Saved Tailoring Policies', exact: true }).waitFor({ timeout: 10000 });
    console.log('== Tailoring tab loaded ==');

    await page.selectOption('#ct-tailor-content-select', { index: 1 });
    await page.waitForTimeout(800);
    const hasE8 = await page.locator(`#ct-tailor-profile-select option[value="${E8}"]`).count();
    if (hasE8) {
        await page.selectOption('#ct-tailor-profile-select', E8);
    } else {
        await page.selectOption('#ct-tailor-profile-select', { index: 1 });
        console.log('WARNING: e8 profile not found by value, used first available profile instead');
    }
    await page.click('button:has-text("Load Rules")');
    await page.locator('.pf-v6-c-tree-view').waitFor({ timeout: 30000 });
    console.log('TreeView rendered.');
    await page.screenshot({ path: SHOTS + 'v411-05-treeview-loaded.png', fullPage: true });

    // Expand a top-level group node (TreeView toggle arrows)
    const firstToggle = page.locator('.pf-v6-c-tree-view__node-toggle').first();
    await firstToggle.waitFor({ timeout: 10000 });
    const childCountBefore = await page.locator('.pf-v6-c-tree-view__list-item').count();
    await firstToggle.click();
    await page.waitForTimeout(300);
    const childCountAfterExpand = await page.locator('.pf-v6-c-tree-view__list-item').count();
    console.log('TreeView expand: items before=', childCountBefore, 'after=', childCountAfterExpand,
        childCountAfterExpand > childCountBefore ? '(EXPANDED OK)' : '(NO CHANGE — check selector)');
    await page.screenshot({ path: SHOTS + 'v411-06-treeview-expanded.png', fullPage: true });

    await firstToggle.click();
    await page.waitForTimeout(300);
    const childCountAfterCollapse = await page.locator('.pf-v6-c-tree-view__list-item').count();
    console.log('TreeView collapse: items after collapse=', childCountAfterCollapse,
        childCountAfterCollapse < childCountAfterExpand ? '(COLLAPSED OK)' : '(NO CHANGE — check selector)');
    await page.screenshot({ path: SHOTS + 'v411-07-treeview-collapsed.png', fullPage: true });

    // Expand all via the explicit control, then find a rule row with a Details button
    await page.click('button:has-text("Expand all")');
    await page.waitForTimeout(500);
    const detailsBtn = page.locator('.ct-tailor-rule-content button:has-text("Details")').first();
    const hasDetailsBtn = await detailsBtn.count();
    console.log('Rule rows with a "Details" button found:', hasDetailsBtn);
    if (hasDetailsBtn > 0) {
        await detailsBtn.scrollIntoViewIfNeeded();
        await detailsBtn.click();
        await page.waitForTimeout(300);
        const detailsBlock = page.locator('.ct-rule-details').first();
        const detailsText = await detailsBlock.textContent().catch(() => null);
        console.log('Rule details block content:', detailsText ? detailsText.slice(0, 200) : '(NONE — blank/undefined!)');
        await page.screenshot({ path: SHOTS + 'v411-08-rule-details-expanded.png', fullPage: true });
    } else {
        console.log('WARNING: no rule row exposed a Details button — cannot verify metadata content this way.');
    }

    // Toggle a rule checkbox via the TreeView (PF6 TreeView renders <input type=checkbox> per node)
    const firstCheckbox = page.locator('.pf-v6-c-tree-view input[type="checkbox"]').first();
    await firstCheckbox.waitFor({ timeout: 10000 });
    const before = await firstCheckbox.isChecked();
    await firstCheckbox.click();
    await page.waitForTimeout(300);
    const after = await firstCheckbox.isChecked();
    console.log('TreeView checkbox toggle: before=', before, 'after=', after, before !== after ? '(TOGGLED OK)' : '(NO CHANGE — FAILURE)');

    const summaryHint = await page.locator('.ct-tailor-summary-hint').textContent();
    console.log('Summary hint after toggle:', summaryHint);

    const changeSummaryPanel = page.locator('.ct-tailor-summary');
    const hasChangeSummary = await changeSummaryPanel.count();
    console.log('Change-summary panel rendered:', hasChangeSummary > 0);
    await page.screenshot({ path: SHOTS + 'v411-09-change-summary-panel.png', fullPage: true });

    // ---- Part C: clipboard copy under Cockpit's real iframe embedding ----
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(process.env.COCKPIT_URL || 'https://rhel10cis.beastmode.localdomain:9090');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('a:has-text("SCAP Security")').first().click();
    // Cockpit names each module's iframe "cockpit1:<host>/<module>", not a bare "cockpit1".
    const frame = page.frameLocator('iframe[name$="/scap"]');
    await frame.locator('.pf-v6-c-card').first().waitFor({ timeout: 30000 });
    console.log('== Reached module via sidebar iframe (iframe[name$="/scap"]) ==');
    // A fresh top-level navigation resets the shell's admin-elevation UI state
    // even though the superuser session itself persists — re-elevate here so
    // Run Scan isn't blocked in Part D.
    const limitedAccess = page.locator('a:has-text("Administrative access"), a:has-text("Limited access")').first();
    if (await limitedAccess.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
        await limitedAccess.click();
        const pwField = page.locator('input[type="password"]').last();
        if (await pwField.isVisible({ timeout: 3000 }).catch(() => false)) {
            await pwField.fill(process.env.COCKPIT_PASS || '');
            await page.keyboard.press('Enter');
        }
        await page.waitForTimeout(1500);
        console.log('Re-elevated admin access after fresh shell navigation.');
    }

    await frame.locator('button[role="tab"]:has-text("Tailoring")').click();
    await frame.locator('#ct-tailor-content-select').waitFor({ timeout: 10000 });
    await frame.locator('#ct-tailor-content-select').selectOption({ index: 1 });
    await page.waitForTimeout(800);
    const hasE8Frame = await frame.locator(`#ct-tailor-profile-select option[value="${E8}"]`).count();
    if (hasE8Frame) {
        await frame.locator('#ct-tailor-profile-select').selectOption(E8);
    } else {
        await frame.locator('#ct-tailor-profile-select').selectOption({ index: 1 });
    }
    await frame.locator('button:has-text("Load Rules")').click();
    console.log('Clicked Load Rules inside iframe, waiting for tree...');
    await frame.locator('.ct-tailor-tree').waitFor({ timeout: 45000 });
    const spinnerStillThere = await frame.locator('.ct-tailor-loading').count();
    console.log('Loading spinner still present after .ct-tailor-tree appeared?', spinnerStillThere);
    // Top-level TreeView nodes are collapsed groups by default — no <input
    // type=checkbox> exists in the DOM until expanded (matches Part B above).
    await frame.locator('button:has-text("Expand all")').click();
    await page.waitForTimeout(500);
    const iframeCheckbox = frame.locator('.pf-v6-c-tree-view input[type="checkbox"]').first();
    await iframeCheckbox.waitFor({ timeout: 30000 });
    await iframeCheckbox.click();
    await page.waitForTimeout(300);
    console.log('Toggled a rule inside the iframe session — change summary should now be non-empty.');
    await page.screenshot({ path: SHOTS + 'v411-10-iframe-before-copy.png', fullPage: true });

    const copyBtn = frame.locator('button:has-text("Copy Summary")');
    await copyBtn.waitFor({ timeout: 10000 });
    await copyBtn.click();
    await page.waitForTimeout(500);
    const copyBtnTextAfter = await copyBtn.textContent().catch(() => null);
    console.log('Copy button text immediately after click:', copyBtnTextAfter,
        copyBtnTextAfter && copyBtnTextAfter.includes('Copied') ? '(UI SHOWS SUCCESS)' : '(UI DID NOT FLIP TO COPIED — possible silent failure)');
    await page.screenshot({ path: SHOTS + 'v411-11-iframe-after-copy-click.png', fullPage: true });

    let clipboardContent = null;
    try {
        clipboardContent = await page.evaluate(() => navigator.clipboard.readText());
    } catch (ex) {
        clipboardContent = '(clipboard read threw: ' + ex.message + ')';
    }
    console.log('Actual OS clipboard content after clicking Copy Summary inside iframe:');
    console.log(clipboardContent);
    const clipboardLooksReal = typeof clipboardContent === 'string' && clipboardContent.includes('Policy Deviations');
    console.log('RESULT: clipboard copy under iframe', clipboardLooksReal ? 'WORKS (real content present)' : 'DID NOT WORK / EMPTY / STALE');

    // ---- Part D: full real scan end-to-end, verify rule-metadata join in ScanResults ----
    await frame.locator('button[role="tab"]:has-text("Scan")').click();
    await frame.locator('#ct-scap-content').waitFor({ timeout: 15000 });
    await page.waitForTimeout(1000);

    const runBtn = frame.locator('button', { hasText: 'Run Scan' });
    await runBtn.waitFor({ timeout: 10000 });
    const isDisabled = await runBtn.isDisabled();
    console.log('Run Scan button disabled?', isDisabled, '(expect false — admin should be elevated)');
    await page.screenshot({ path: SHOTS + 'v411-12-scan-setup-before-run.png', fullPage: true });

    await runBtn.click();
    console.log('== Scan started — waiting for completion (this can take several minutes) ==');
    await page.screenshot({ path: SHOTS + 'v411-13-scan-running.png', fullPage: true });

    await frame.locator('button:has-text("Scan Complete"), h2:has-text("Scan Complete")')
            .waitFor({ timeout: 480000 });
    console.log('== Scan complete ==');
    await page.screenshot({ path: SHOTS + 'v411-14-scan-complete.png', fullPage: true });

    const failingRuleRow = frame.locator('.ct-rule-row').first();
    const failingRowCount = await frame.locator('.ct-rule-row').count();
    console.log('Failing rule rows rendered:', failingRowCount);

    if (failingRowCount > 0) {
        const ruleTitleText = await failingRuleRow.locator('.ct-rule-title').textContent();
        console.log('First failing rule title text:', JSON.stringify(ruleTitleText));
        const looksUndefined = !ruleTitleText || /undefined|null|^\s*$/.test(ruleTitleText);
        console.log('RESULT: rule-metadata title join', looksUndefined ? 'LOOKS BLANK/BROKEN' : 'SHOWS REAL CONTENT');

        const rowDetailsBtn = failingRuleRow.locator('button:has-text("Details")');
        if (await rowDetailsBtn.count() > 0) {
            await rowDetailsBtn.click();
            await page.waitForTimeout(300);
            const detailsText = await frame.locator('.ct-rule-details').first().textContent().catch(() => null);
            console.log('First failing rule details (description/rationale):', detailsText ? detailsText.slice(0, 300) : '(NONE)');
        } else {
            console.log('First failing rule has no Details button (no description/rationale in metadata for this rule).');
        }
        await page.screenshot({ path: SHOTS + 'v411-15-scan-results-rule-expanded.png', fullPage: true });
    } else {
        console.log('No failing rules in this scan run — cannot verify the metadata join visually. Re-run with a stricter profile if this happens.');
    }
});
