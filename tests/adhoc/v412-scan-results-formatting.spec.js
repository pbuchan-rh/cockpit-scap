// Live verification of V4.1.2 (feature/v4.1.2-scan-results-formatting) against
// a real upgrade-installed RPM + refreshed dev-override on rhel10cis.
// Investigation script, not an asserting spec — console.log + screenshots,
// human/agent reads the output to judge pass/fail.
//
// Covers the 4 restored Scan Results gaps:
//  1. Severity-grouped collapsible Failing Rules sections
//  2. CCE identifier tag next to rule title
//  3. Automated/Manual badge
//  4. Inline per-rule fix preview + single-rule download
const { test, expect } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

const SHOTS = 'tests/adhoc/screenshots/';

test('V4.1.2: severity groups, CCE tag, Automated/Manual badge, per-rule fix preview', async ({ page }) => {
    page.on('console', msg => console.log(`[browser:${msg.type()}]`, msg.text()));
    page.on('pageerror', err => console.log('[pageerror]', err.message));

    await loginToCockpit(page);
    await page.setViewportSize({ width: 1280, height: 1000 });

    // --- Setup phase: pick Essential Eight (small ruleset, fast real scan) ---
    const contentSelect = page.locator('#ct-scap-content');
    await contentSelect.waitFor({ timeout: 15000 });
    const profileSelect = page.locator('#ct-scap-profile');
    await expect(profileSelect).not.toBeDisabled({ timeout: 15000 });
    await profileSelect.selectOption({ value: 'xccdf_org.ssgproject.content_profile_e8' });
    console.log('Selected profile:', await profileSelect.inputValue());

    const runBtn = page.locator('button', { hasText: 'Run Scan' });
    await expect(runBtn).not.toBeDisabled({ timeout: 5000 });
    await runBtn.click();
    console.log('Scan started.');

    const newScanBtn = page.locator('button', { hasText: 'New Scan' });
    await newScanBtn.waitFor({ timeout: 600000 });
    console.log('Scan complete.');

    const scoreText = await page.locator('.ct-score-value').textContent();
    console.log('Score:', scoreText);

    // ---- Gap 1: severity-grouped collapsible sections ----
    const groups = page.locator('.ct-failing-group');
    const groupCount = await groups.count();
    console.log('Failing-rule groups rendered:', groupCount);
    expect(groupCount).toBeGreaterThan(0);

    for (let i = 0; i < groupCount; i++) {
        const g = groups.nth(i);
        const cls = await g.getAttribute('class');
        const toggleTxt = await g.locator('.pf-v6-c-expandable-section__toggle .pf-v6-c-button__text').textContent();
        const expandedAttr = await g.locator('.pf-v6-c-expandable-section__toggle button').getAttribute('aria-expanded');
        console.log(`Group ${i}: class="${cls}" toggle="${toggleTxt}" aria-expanded=${expandedAttr}`);
    }
    await page.screenshot({ path: SHOTS + 'v412-01-results-grouped-light.png', fullPage: true });

    // Expand every group so gap 2/3/4 checks below can see all rows
    for (let i = 0; i < groupCount; i++) {
        const g = groups.nth(i);
        const btn = g.locator('.pf-v6-c-expandable-section__toggle button');
        const expandedAttr = await btn.getAttribute('aria-expanded');
        if (expandedAttr !== 'true') await btn.click();
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: SHOTS + 'v412-02-results-all-groups-expanded-light.png', fullPage: true });

    // ---- Gap 2: CCE tag ----
    const cceTags = page.locator('.ct-rule-cce');
    const cceCount = await cceTags.count();
    console.log('Rules with a rendered CCE tag:', cceCount);
    if (cceCount > 0) {
        console.log('Sample CCE text:', await cceTags.first().textContent());
    }

    // ---- Gap 3: Automated/Manual badge ----
    const ruleRows = page.locator('.ct-rule-row');
    const rowCount = await ruleRows.count();
    console.log('Total failing rule rows rendered:', rowCount);
    const automatedBadges = page.locator('.ct-rule-row .pf-v6-c-label', { hasText: 'Automated' });
    const manualBadges = page.locator('.ct-rule-row .pf-v6-c-label', { hasText: 'Manual' });
    console.log('Automated badges:', await automatedBadges.count(), ' Manual badges:', await manualBadges.count());
    expect((await automatedBadges.count()) + (await manualBadges.count())).toBeGreaterThan(0);

    // ---- Gap 4: inline per-rule fix preview + single-rule download ----
    const fixToggle = page.locator('.ct-rule-row button', { hasText: /^Fix$/ }).first();
    const hasFixToggle = await fixToggle.isVisible({ timeout: 2000 }).catch(() => false);
    console.log('An Automated rule with a Fix toggle is visible:', hasFixToggle);
    if (hasFixToggle) {
        await fixToggle.click();
        const pre = page.locator('.ct-rule-rem-pre').first();
        await pre.waitFor({ timeout: 30000 });
        const fixText = await pre.textContent();
        console.log('Fix preview length:', fixText?.length, 'first 120 chars:', fixText?.slice(0, 120));
        expect(fixText?.length).toBeGreaterThan(0);

        await page.screenshot({ path: SHOTS + 'v412-03-fix-preview-expanded-light.png', fullPage: true });

        // Single-rule download
        const dlShBtn = page.locator('.ct-rule-rem-dl-row button', { hasText: 'Download .sh' }).first();
        let sawDownload = false;
        let downloadedName = null;
        page.once('download', d => { sawDownload = true; downloadedName = d.suggestedFilename(); });
        await dlShBtn.click();
        await page.waitForTimeout(1500);
        console.log('Single-rule .sh download event seen:', sawDownload, 'filename:', downloadedName);
    } else {
        console.log('WARNING: no Automated rule with a fix toggle found in this scan result — gap 4 not exercised.');
    }

    // ---- Dark mode screenshots ----
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: SHOTS + 'v412-04-results-dark.png', fullPage: true });
    await page.emulateMedia({ colorScheme: 'light' });

    console.log('V4.1.2 live verification complete.');
});
