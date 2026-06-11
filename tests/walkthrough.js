/**
 * Full UI walkthrough — captures screenshots of every major section
 * for UX review. Read-only, no destructive actions.
 */
const { chromium, expect } = require('@playwright/test');
require('dotenv').config({ path: __dirname + '/../tests/.env' });

const URL  = process.env.COCKPIT_URL;
const USER = process.env.COCKPIT_USER;
const PASS = process.env.COCKPIT_PASS;
const OUT  = __dirname + '/screenshots/walkthrough';
const fs   = require('fs');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

async function shot(page, name) {
    await page.screenshot({ path: OUT + '/' + name + '.png', fullPage: false });
    console.log('  ✓ ' + name);
}

async function login(page) {
    await page.goto(URL);
    await page.waitForSelector('#login-user-input');
    await page.fill('#login-user-input', USER);
    await page.fill('#login-password-input', PASS);
    await page.click('#login-button');
    await page.waitForFunction(() => !document.getElementById('login-user-input'), { timeout: 15000 });
    try {
        const u = page.locator('button:has-text("Limited access"), button:has-text("Turn on administrative access")').first();
        await u.waitFor({ timeout: 5000 });
        await u.click();
        const p = page.locator('#account-password-input, input[type="password"]').first();
        await p.waitFor({ timeout: 5000 });
        await p.fill(PASS);
        await page.locator('button:has-text("Authenticate"), button[type="submit"]').first().click();
        await page.waitForTimeout(2000);
    } catch(e) {}
    await page.goto(URL + '/cockpit/@localhost/cockpit-scap/index.html');
    await page.waitForSelector('.pf-v6-c-tabs', { timeout: 30000 });
    await page.waitForTimeout(1500);
}

async function tab(page, id) {
    await page.locator('button#' + id).click();
    await page.waitForTimeout(1000);
}

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    console.log('\n=== cockpit-scap Full UI Walkthrough ===\n');

    await login(page);

    // ── Host Scan tab ──────────────────────────────────────────────
    console.log('Host Scan tab:');
    await shot(page, '01-host-scan-default');

    // Select content — if only one option it's already selected; otherwise pick first real one
    await page.locator('#ct-content-select').waitFor({ state: 'visible' });
    const contentOptCount = await page.locator('#ct-content-select option').count();
    if (contentOptCount > 1) {
        const contentVal = await page.locator('#ct-content-select option').nth(1).getAttribute('value');
        if (contentVal) await page.locator('#ct-content-select').selectOption({ value: contentVal });
    }
    // If only one option it's pre-selected — trigger the change event so profiles load
    if (contentOptCount === 1) {
        const contentVal = await page.locator('#ct-content-select option').first().getAttribute('value');
        if (contentVal) await page.locator('#ct-content-select').selectOption({ value: contentVal });
    }
    await page.waitForTimeout(2000);
    await shot(page, '02-host-scan-content-selected');

    // Select PCI-DSS profile
    const profileSel = page.locator('#ct-profile-select');
    await profileSel.waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
    try {
        await profileSel.selectOption({ label: /PCI-DSS/i });
    } catch(e) {
        await profileSel.selectOption({ index: 1 });
    }
    await page.waitForTimeout(1000);
    await shot(page, '03-host-scan-profile-selected');

    // Expand oscap command preview
    const cmdDetails = page.locator('#ct-scan-cmd-details');
    if (await cmdDetails.isVisible()) {
        await cmdDetails.locator('summary').click();
        await page.waitForTimeout(500);
        await shot(page, '04-host-scan-dryrun-preview');
        await cmdDetails.locator('summary').click();
    }

    // Profile remediation buttons state
    await shot(page, '05-profile-rem-buttons');

    // Load history result
    const viewBtn = page.locator('#ct-history-tbody tr:first-child button:has-text("View Scan")').first();
    if (await viewBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await viewBtn.click();
        await page.locator('#ct-results').waitFor({ state: 'visible', timeout: 10000 });
        await page.waitForTimeout(2000);
        await shot(page, '06-results-panel');

        // Action board close-up
        await page.locator('#ct-action-board').waitFor({ state: 'visible', timeout: 10000 });
        await shot(page, '07-action-board');

        // Failing rules summary
        await page.locator('#ct-failing-summary-groups').waitFor({ state: 'visible', timeout: 20000 });
        await shot(page, '08-failing-rules-summary');

        // Failing rules search
        const search = page.locator('#ct-failing-search');
        if (await search.isVisible()) {
            await search.fill('RPM');
            await page.waitForTimeout(600);
            await shot(page, '09-failing-search-filtered');
            await search.fill('');
        }

        // Export dropdown
        await page.locator('#ct-export-toggle').click();
        await page.waitForTimeout(400);
        await shot(page, '10-export-dropdown-open');
        await page.locator('#ct-results h2').click();

        // Open remediation drawer
        try {
            const reviewBtn = page.locator('#ct-review-all-btn');
            if (await reviewBtn.isVisible()) {
                await reviewBtn.click();
                await page.waitForTimeout(800);
                await shot(page, '11-remediation-drawer');
                const remSearch = page.locator('#ct-rem-search');
                if (await remSearch.isVisible()) {
                    await remSearch.fill('ownership');
                    await page.waitForTimeout(500);
                    await shot(page, '12-rem-drawer-searched');
                    await remSearch.fill('');
                }
                await page.keyboard.press('Escape');
                await page.waitForTimeout(500);
            }
        } catch(e) { console.log('  ! Remediation drawer: ' + e.message.split('\n')[0]); }

        // Quick Fix drawer
        try {
            const qfBtn = page.locator('#ct-quick-fix-btn');
            if (await qfBtn.isVisible() && !await qfBtn.isDisabled()) {
                await qfBtn.click();
                await page.waitForTimeout(800);
                await shot(page, '13-quick-fix-drawer');
                await page.keyboard.press('Escape');
                await page.waitForTimeout(400);
            }
        } catch(e) { console.log('  ! Quick Fix drawer: ' + e.message.split('\n')[0]); }
    }

    // ── Policy Tailoring tab ──────────────────────────────────────
    console.log('Policy Tailoring tab:');
    await tab(page, 'tab-btn-tailoring');
    await shot(page, '20-tailoring-default');

    // Load a profile
    try {
        await expect(page.locator('#ct-tailor-content-select option').nth(1)).not.toHaveText('', { timeout: 10000 });
        const tcVal = await page.locator('#ct-tailor-content-select option').nth(1).getAttribute('value');
        if (tcVal) await page.locator('#ct-tailor-content-select').selectOption({ value: tcVal });
        await page.waitForTimeout(1000);
        await expect(page.locator('#ct-tailor-profile-select option').nth(1)).toBeAttached({ timeout: 15000 });
        const tpVal = await page.locator('#ct-tailor-profile-select option').nth(1).getAttribute('value');
        if (tpVal) await page.locator('#ct-tailor-profile-select').selectOption({ value: tpVal });
        await page.waitForTimeout(500);
        await page.locator('#ct-tailor-name').fill('walkthrough-test');
        await page.locator('#ct-tailor-load-btn').click();
        await page.locator('#ct-tailor-editor').waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(2000);
        await shot(page, '21-tailoring-editor');

        // Search in rule tree
        const taSearch = page.locator('#ct-tailor-search');
        if (await taSearch.isVisible()) {
            await taSearch.fill('audit');
            await page.waitForTimeout(600);
            await shot(page, '22-tailoring-search');
            await taSearch.fill('');
        }
    } catch(e) { console.log('  ! Tailoring load skipped: ' + e.message); }

    // ── Settings tab ─────────────────────────────────────────────
    console.log('Settings tab:');
    await tab(page, 'tab-btn-settings');
    await page.waitForTimeout(1500);
    await shot(page, '30-settings-overview');

    // ── Dashboard tab ─────────────────────────────────────────────
    console.log('Dashboard tab:');
    try {
        await tab(page, 'tab-btn-dashboard');
        await page.locator('#db-content .db-score-block, #db-content .db-empty-body')
            .first().waitFor({ state: 'visible', timeout: 20000 });
        await page.waitForTimeout(2000);
        await shot(page, '40-dashboard-overview');

        // Critical findings
        const critical = page.locator('#db-host-critical');
        if (await critical.isVisible()) {
            await page.waitForTimeout(3000);
            await shot(page, '41-dashboard-critical');

            // Click a HIGH rule to open rule detail drawer
            const highRule = critical.locator('.db-critical-rule').first();
            if (await highRule.isVisible().catch(() => false)) {
                await highRule.click();
                await page.waitForTimeout(800);
                await shot(page, '42-rule-detail-drawer');
                await page.keyboard.press('Escape');
                await page.waitForTimeout(400);
            }
        }
    } catch(e) { console.log('  ! Dashboard skipped: ' + e.message); }

    // ── Activity Log tab ──────────────────────────────────────────
    console.log('Activity Log tab:');
    await tab(page, 'tab-btn-activity');
    await page.waitForTimeout(1000);
    await shot(page, '50-activity-log');

    // ── Dark mode ─────────────────────────────────────────────────
    console.log('Dark mode:');
    await tab(page, 'tab-btn-scan');
    await page.evaluate(() => document.documentElement.classList.toggle('pf-v6-theme-dark'));
    await page.waitForTimeout(500);
    await shot(page, '60-host-scan-dark');
    await page.evaluate(() => document.documentElement.classList.remove('pf-v6-theme-dark'));

    // ── Narrow viewport ───────────────────────────────────────────
    console.log('Narrow viewport (900px):');
    await page.setViewportSize({ width: 900, height: 900 });
    await tab(page, 'tab-btn-scan');
    await page.waitForTimeout(500);
    await shot(page, '70-narrow-viewport');
    const nvBtn = page.locator('#ct-history-tbody tr:first-child button:has-text("View Scan")').first();
    if (await nvBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await nvBtn.click();
        await page.locator('#ct-results').waitFor({ state: 'visible', timeout: 10000 });
        await page.waitForTimeout(500);
        await shot(page, '71-narrow-results');
    }

    await browser.close();
    console.log('\nWalkthrough complete. Screenshots in tests/screenshots/walkthrough/\n');
})();
