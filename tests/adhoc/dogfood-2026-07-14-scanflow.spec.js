// Dogfooding pass 2026-07-14: full Host Scan flow, untailored + STIG-tailored,
// exercising every element of the Scan Complete screen. Pre-demo sanity pass.
const { test, expect } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

const SHOT = 'tests/adhoc/screenshots/dogfood-2026-07-14';

function wireConsole(page, label) {
    page.on('console', msg => {
        if (msg.type() === 'error') console.log(`[${label}][browser:error]`, msg.text());
    });
    page.on('pageerror', err => console.log(`[${label}][pageerror]`, err.message));
}

test('untailored scan: e8 profile, full results interaction', async ({ page }) => {
    wireConsole(page, 'untailored');
    await loginToCockpit(page);

    await page.locator('#ct-scap-content').waitFor({ timeout: 15000 });
    const contentValue = await page.locator('#ct-scap-content').inputValue();
    console.log('Auto-selected content:', contentValue);
    await page.screenshot({ path: `${SHOT}/01-setup-elevated.png`, fullPage: true });

    const profileSelect = page.locator('#ct-scap-profile');
    await expect(profileSelect).not.toBeDisabled({ timeout: 15000 });
    await profileSelect.selectOption({ value: 'xccdf_org.ssgproject.content_profile_e8' });
    console.log('Selected profile:', await profileSelect.inputValue());

    const runBtn = page.locator('button', { hasText: 'Run Scan' });
    await expect(runBtn).toBeEnabled({ timeout: 5000 });
    await runBtn.click();

    await expect(page.locator('button', { hasText: 'Cancel' })).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `${SHOT}/02-running.png`, fullPage: true });

    const newScanBtn = page.locator('button', { hasText: 'New Scan' });
    await newScanBtn.waitFor({ timeout: 600000 });
    console.log('Untailored scan complete.');
    await page.screenshot({ path: `${SHOT}/03-results-untailored.png`, fullPage: true });

    // Score / pass-fail
    const scoreText = await page.locator('.ct-score-value').textContent();
    console.log('Score:', scoreText);

    // Severity-grouped failing rules, CCE tags, Automated/Manual badges
    const ruleRows = page.locator('.ct-rule-row');
    const ruleCount = await ruleRows.count();
    console.log('Failing rule rows:', ruleCount);
    if (ruleCount > 0) {
        const first = ruleRows.first();
        await first.scrollIntoViewIfNeeded();
        const rowText = await first.innerText();
        console.log('First failing rule row text:', rowText.replace(/\n/g, ' | '));

        // Expand Details on first 2 rules
        for (let i = 0; i < Math.min(2, ruleCount); i++) {
            const row = ruleRows.nth(i);
            const detailsBtn = row.locator('button', { hasText: /^Details$/ });
            if (await detailsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await detailsBtn.click();
                await page.waitForTimeout(300);
            }
            const fixBtn = row.locator('button', { hasText: /^Fix$/ });
            if (await fixBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await fixBtn.click();
                await page.waitForTimeout(1500);
            }
        }
        await page.screenshot({ path: `${SHOT}/04-rules-expanded.png`, fullPage: true });

        // Try a per-rule Download .sh / .yml if a fix panel rendered
        const dlSh = page.locator('button', { hasText: 'Download .sh' }).first();
        if (await dlSh.isVisible({ timeout: 2000 }).catch(() => false)) {
            const [dl] = await Promise.all([
                page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
                dlSh.click(),
            ]);
            console.log('Per-rule .sh fix download:', dl ? dl.suggestedFilename() : 'NO DOWNLOAD EVENT');
        }
        const dlYml = page.locator('button', { hasText: 'Download .yml' }).first();
        if (await dlYml.isVisible({ timeout: 2000 }).catch(() => false)) {
            const [dl] = await Promise.all([
                page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
                dlYml.click(),
            ]);
            console.log('Per-rule .yml fix download:', dl ? dl.suggestedFilename() : 'NO DOWNLOAD EVENT');
        }
    } else {
        console.log('No failing rules on this scan (unexpected but not necessarily a bug).');
    }

    // Bulk Download Bash Fix with a real subset selected
    const downloadBashBtn = page.locator('button', { hasText: 'Download Bash Fix' });
    if (await downloadBashBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await page.locator('button', { hasText: 'Deselect All' }).click();
        const boxes = page.locator('.ct-rule-row .pf-v6-c-check__input');
        const n = Math.min(3, await boxes.count());
        for (let i = 0; i < n; i++) await boxes.nth(i).check();
        const [dl] = await Promise.all([
            page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
            downloadBashBtn.click(),
        ]);
        console.log('Bulk bash fix (subset of', n, ') download:', dl ? dl.suggestedFilename() : 'NO DOWNLOAD EVENT');
        await page.screenshot({ path: `${SHOT}/05-bulk-fix-subset.png`, fullPage: true });

        const downloadAnsibleBtn = page.locator('button', { hasText: 'Download Ansible Fix' });
        if (await downloadAnsibleBtn.isVisible().catch(() => false)) {
            const [dl2] = await Promise.all([
                page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
                downloadAnsibleBtn.click(),
            ]);
            console.log('Bulk ansible fix download:', dl2 ? dl2.suggestedFilename() : 'NO DOWNLOAD EVENT');
        }
    }

    // View Report
    const [reportTab] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 30000 }),
        page.locator('button', { hasText: 'View Report' }).click(),
    ]);
    await reportTab.waitForLoadState('domcontentloaded', { timeout: 15000 });
    console.log('View Report tab URL scheme:', reportTab.url().split(':')[0]);
    await reportTab.screenshot({ path: `${SHOT}/06-view-report.png`, fullPage: false });
    await reportTab.close();

    // Results XML / ARF download buttons
    for (const label of ['Results XML', 'ARF']) {
        const btn = page.locator('button', { hasText: label });
        if (await btn.first().isVisible({ timeout: 1500 })
                .catch(() => false)) {
            const [dl] = await Promise.all([
                page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
                btn.first().click(),
            ]);
            console.log(`${label} download:`, dl ? dl.suggestedFilename() : 'NO DOWNLOAD EVENT');
        }
    }

    await page.screenshot({ path: `${SHOT}/07-results-final-untailored.png`, fullPage: true });
});

test('STIG-tailored scan: real tailoring policy, full results interaction', async ({ page }) => {
    wireConsole(page, 'tailored');
    await loginToCockpit(page);

    await page.locator('#ct-scap-content').waitFor({ timeout: 15000 });

    // Select tailoring policy
    const tailoringSelect = page.locator('#ct-scap-tailoring-select');
    const hasTailoringSelect = await tailoringSelect.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasTailoringSelect) {
        const options = await tailoringSelect.locator('option').allTextContents();
        console.log('Tailoring options:', options);
        const opt = options.find(o => o.includes('STIG - Dev Server Exceptions') && !o.includes('Extended'));
        console.log('Matched option:', opt);
        if (opt) await tailoringSelect.selectOption({ label: opt });
        console.log('Selected tailoring value:', await tailoringSelect.inputValue());
    } else {
        console.log('WARNING: no visible tailoring select found with expected selectors — screenshotting setup for inspection.');
    }
    await page.screenshot({ path: `${SHOT}/08-setup-tailoring-selected.png`, fullPage: true });

    const runBtn = page.locator('button', { hasText: 'Run Scan' });
    await expect(runBtn).toBeEnabled({ timeout: 5000 });
    await runBtn.click();
    await expect(page.locator('button', { hasText: 'Cancel' })).toBeVisible({ timeout: 10000 });
    console.log('STIG-tailored scan started — this is a large rule set, may take several minutes.');

    const newScanBtn = page.locator('button', { hasText: 'New Scan' });
    await newScanBtn.waitFor({ timeout: 600000 });
    console.log('Tailored scan complete.');
    await page.screenshot({ path: `${SHOT}/09-results-tailored.png`, fullPage: true });

    const scoreText = await page.locator('.ct-score-value').textContent();
    console.log('Tailored scan score:', scoreText);

    // Check CCE tags and Automated/Manual badges appear in at least one row
    const ruleRows = page.locator('.ct-rule-row');
    const ruleCount = await ruleRows.count();
    console.log('Tailored scan failing rule rows:', ruleCount);
    if (ruleCount > 0) {
        const firstText = await ruleRows.first().innerText();
        console.log('First tailored failing rule text:', firstText.replace(/\n/g, ' | '));
        const hasCCE = firstText.includes('CCE');
        console.log('CCE tag visible on first row:', hasCCE);
    }
    await page.screenshot({ path: `${SHOT}/10-results-tailored-detail.png`, fullPage: true });
});
