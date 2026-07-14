// Dogfooding pass 2026-07-14: remediation buttons matrix (untailored profile
// + STIG tailoring, all 3 formats), ContentSelect Detected/Uploaded grouping
// consistency across all 3 surfaces, and a visual/dark-mode/width pass.
const { test, expect } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

const SHOT = 'tests/adhoc/screenshots/dogfood-2026-07-14';

function wireConsole(page, label) {
    page.on('console', msg => {
        if (msg.type() === 'error') console.log(`[${label}][browser:error]`, msg.text());
    });
    page.on('pageerror', err => console.log(`[${label}][pageerror]`, err.message));
}

async function exerciseRemediation(page, label) {
    const guideBtn = page.locator('button', { hasText: 'View Compliance Guide' });
    await expect(guideBtn).toBeEnabled({ timeout: 10000 });
    const [popup] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 15000 }),
        guideBtn.click(),
    ]);
    await popup.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const bodyLen = await popup.locator('body').innerText()
            .then(t => t.length)
            .catch(() => -1);
    console.log(`[${label}] Guide popup body length:`, bodyLen);
    await popup.close();

    const dlToggle = page.locator('#ct-download-remediation-primary');
    await expect(dlToggle).toBeEnabled({ timeout: 5000 });
    const [bashDl] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
        dlToggle.click(),
    ]);
    console.log(`[${label}] Bash download:`, bashDl ? bashDl.suggestedFilename() : 'NO DOWNLOAD EVENT');

    const caret = page.locator('button[aria-label="Select remediation format"]');
    await caret.click();
    const [ansibleDl] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
        page.locator('.pf-v6-c-menu__item', { hasText: 'Ansible' }).click(),
    ]);
    console.log(`[${label}] Ansible download:`, ansibleDl ? ansibleDl.suggestedFilename() : 'NO DOWNLOAD EVENT');

    await caret.click();
    const [puppetDl] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
        page.locator('.pf-v6-c-menu__item', { hasText: 'Puppet' }).click(),
    ]);
    console.log(`[${label}] Puppet download:`, puppetDl ? puppetDl.suggestedFilename() : 'NO DOWNLOAD EVENT');
}

test('Remediation buttons: untailored profile (no tailoring)', async ({ page }) => {
    wireConsole(page, 'remed-untailored');
    await loginToCockpit(page);
    await page.locator('#ct-scap-content').waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await exerciseRemediation(page, 'untailored-e8-default');
    await page.screenshot({ path: `${SHOT}/22-remediation-untailored.png`, fullPage: true });
});

test('Remediation buttons: with STIG tailoring policy selected', async ({ page }) => {
    wireConsole(page, 'remed-tailored');
    await loginToCockpit(page);
    await page.locator('#ct-scap-content').waitFor({ timeout: 15000 });
    const tailoringSelect = page.locator('#ct-scap-tailoring-select');
    await tailoringSelect.waitFor({ timeout: 10000 });
    const options = await tailoringSelect.locator('option').allTextContents();
    const opt = options.find(o => o.includes('STIG - Dev Server Exceptions') && !o.includes('Extended'));
    if (opt) await tailoringSelect.selectOption({ label: opt });
    await page.waitForTimeout(1000);
    await exerciseRemediation(page, 'stig-tailored');
    await page.screenshot({ path: `${SHOT}/23-remediation-tailored.png`, fullPage: true });
});

test('ContentSelect consistency: Detected/Uploaded grouping across 3 surfaces', async ({ page }) => {
    wireConsole(page, 'contentselect');
    await loginToCockpit(page);

    // Surface 1: Host Scan
    const scanSelect = page.locator('#ct-scap-content');
    await scanSelect.waitFor({ timeout: 15000 });
    const scanGroups = await scanSelect.locator('optgroup').evaluateAll(
        els => els.map(el => ({ label: el.label, options: [...el.children].map(o => o.textContent) }))
    );
    console.log('Host Scan ContentSelect groups:', JSON.stringify(scanGroups));

    // Surface 2: Tailoring Editor
    await page.locator('.pf-v6-c-tabs__link', { hasText: 'Policy Tailoring' }).click();
    await page.waitForTimeout(800);
    const editorSelect = page.locator('#ct-tailor-content-select');
    await editorSelect.waitFor({ timeout: 10000 });
    const editorGroups = await editorSelect.locator('optgroup').evaluateAll(
        els => els.map(el => ({ label: el.label, options: [...el.children].map(o => o.textContent) }))
    );
    console.log('Tailoring Editor ContentSelect groups:', JSON.stringify(editorGroups));

    // Surface 3: TailoringList upload-target picker
    const uploadTargetSelect = page.locator('[aria-label="Content for uploaded file"]');
    await uploadTargetSelect.waitFor({ timeout: 10000 });
    const uploadGroups = await uploadTargetSelect.locator('optgroup').evaluateAll(
        els => els.map(el => ({ label: el.label, options: [...el.children].map(o => o.textContent) }))
    );
    console.log('TailoringList upload-target ContentSelect groups:', JSON.stringify(uploadGroups));

    // Consistency check: all 3 should have the same Detected set and same Uploaded set
    const scanDetected = scanGroups.find(g => g.label === 'Detected')?.options ?? [];
    const editorDetected = editorGroups.find(g => g.label === 'Detected')?.options ?? [];
    const uploadDetected = uploadGroups.find(g => g.label === 'Detected')?.options ?? [];
    console.log('Detected consistent across surfaces:',
                JSON.stringify(scanDetected) === JSON.stringify(editorDetected) &&
        JSON.stringify(editorDetected) === JSON.stringify(uploadDetected));

    const scanUploaded = scanGroups.find(g => g.label === 'Uploaded')?.options ?? [];
    const editorUploaded = editorGroups.find(g => g.label === 'Uploaded')?.options ?? [];
    const uploadUploaded = uploadGroups.find(g => g.label === 'Uploaded')?.options ?? [];
    console.log('Uploaded consistent across surfaces:',
                JSON.stringify(scanUploaded) === JSON.stringify(editorUploaded) &&
        JSON.stringify(editorUploaded) === JSON.stringify(uploadUploaded));
    console.log('Uploaded group contents (expect ssg-rhel8-ds.xml + ssg-rhel9-ds.xml):', JSON.stringify(scanUploaded));

    await page.screenshot({ path: `${SHOT}/24-contentselect-tailoring-tab.png`, fullPage: true });
});

test('Visual pass: light mode, both tabs, 1280px', async ({ page }) => {
    wireConsole(page, 'visual-light');
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginToCockpit(page);
    await page.locator('#ct-scap-content').waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOT}/25-light-hostscan-1280.png`, fullPage: true });
    await page.locator('.pf-v6-c-tabs__link', { hasText: 'Policy Tailoring' }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOT}/26-light-tailoring-1280.png`, fullPage: true });
});

test('Visual pass: dark mode, both tabs, 1280px', async ({ page }) => {
    wireConsole(page, 'visual-dark');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginToCockpit(page);
    await page.locator('#ct-scap-content').waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOT}/27-dark-hostscan-1280.png`, fullPage: true });
    await page.locator('.pf-v6-c-tabs__link', { hasText: 'Policy Tailoring' }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOT}/28-dark-tailoring-1280.png`, fullPage: true });
});

test('Visual pass: 900px breakpoint, light mode, both tabs', async ({ page }) => {
    wireConsole(page, 'visual-900');
    await page.setViewportSize({ width: 900, height: 900 });
    await loginToCockpit(page);
    await page.locator('#ct-scap-content').waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOT}/29-light-hostscan-900.png`, fullPage: true });
    await page.locator('.pf-v6-c-tabs__link', { hasText: 'Policy Tailoring' }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOT}/30-light-tailoring-900.png`, fullPage: true });
});

test('Visual pass: dark mode, both tabs, 900px breakpoint', async ({ page }) => {
    wireConsole(page, 'visual-dark-900');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 900, height: 900 });
    await loginToCockpit(page);
    await page.locator('#ct-scap-content').waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOT}/32-dark-hostscan-900.png`, fullPage: true });
    await page.locator('.pf-v6-c-tabs__link', { hasText: 'Policy Tailoring' }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOT}/33-dark-tailoring-900.png`, fullPage: true });
});

test('Visual pass: narrow width (800px) below breakpoint', async ({ page }) => {
    wireConsole(page, 'visual-800');
    await page.setViewportSize({ width: 800, height: 900 });
    await loginToCockpit(page);
    await page.locator('#ct-scap-content').waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOT}/31-light-hostscan-800.png`, fullPage: true });
});
