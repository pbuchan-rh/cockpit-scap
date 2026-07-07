// Adhoc verification for V4.1: drives a real save -> scan-tab visibility ->
// edit -> update -> delete flow against a live rhel10cis dev deploy.
// Investigation script, not an asserting spec — console.log + screenshots.
const { test } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

test('tailoring editor: save, appears in scan tab, edit, update, delete', async ({ page }) => {
    await loginToCockpit(page);
    await page.locator('.pf-v6-c-card').first().waitFor({ timeout: 15000 });

    await page.click('button[role="tab"]:has-text("Tailoring")');
    await page.getByRole('heading', { name: 'Saved Tailoring Policies', exact: true }).waitFor({ timeout: 10000 });
    console.log('Tailoring tab loaded.');

    // ---- New policy: pick content + profile, load rules ----
    await page.selectOption('#ct-tailor-content-select', { index: 1 });
    await page.waitForTimeout(500);
    await page.selectOption('#ct-tailor-profile-select', { index: 1 });
    await page.click('button:has-text("Load Rules")');
    await page.locator('.ct-tailor-tree').waitFor({ timeout: 20000 });
    console.log('Profile rules loaded into tree.');
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41-01-tree-loaded.png', fullPage: true });

    // Expand every nested group (checkboxes inside still-closed <details> are
    // not "visible" to Playwright) then toggle the first real rule checkbox.
    await page.evaluate(() => {
        document.querySelectorAll('details.ct-tailor-group').forEach(d => { d.open = true });
    });
    const firstCheckbox = page.locator('.ct-tailor-tree input[type="checkbox"]').first();
    await firstCheckbox.waitFor({ timeout: 10000 });
    const wasChecked = await firstCheckbox.isChecked();
    const checkboxId = await firstCheckbox.getAttribute('id');
    await page.locator(`label[for="${checkboxId}"]`).click();
    const nowChecked = await firstCheckbox.isChecked();
    console.log('Toggled first rule (via label click)', checkboxId, 'from', wasChecked, 'to', nowChecked);
    await page.locator('.ct-tailor-summary-hint').waitFor({ timeout: 5000 });
    const summaryText = await page.locator('.ct-tailor-summary-hint').textContent();
    console.log('Summary hint after toggle:', summaryText);

    const policyName = 'v41-adhoc-check-' + Date.now();
    await page.fill('#ct-tailor-name-input', policyName);
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41-02-before-save.png', fullPage: true });

    await page.click('button:has-text("Save Policy")');
    await page.locator('td', { hasText: policyName }).first().waitFor({ timeout: 15000 });
    console.log('Saved policy appears in Saved Tailoring Policies list.');
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41-03-saved-in-list.png', fullPage: true });

    // ---- Scan tab: confirm it's selectable ----
    await page.click('button[role="tab"]:has-text("Scan")');
    await page.locator('#ct-scap-tailoring-select').waitFor({ timeout: 10000 });
    const optionTexts = await page.locator('#ct-scap-tailoring-select option').allTextContents();
    console.log('Scan-tab tailoring options:', optionTexts);
    if (!optionTexts.some(t => t.includes(policyName))) {
        console.log('WARNING: saved policy not found in scan-tab dropdown — check sds_path match / filter logic.');
    } else {
        await page.selectOption('#ct-scap-tailoring-select', { label: policyName });
        console.log('Selected saved tailoring policy in Scan tab.');
    }
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41-04-scan-tab-dropdown.png', fullPage: true });

    // ---- Back to Tailoring tab: edit, verify prior change loaded, update ----
    await page.click('button[role="tab"]:has-text("Tailoring")');
    await page.locator('td', { hasText: policyName }).first().waitFor({ timeout: 10000 });
    const row = page.locator('tr', { hasText: policyName });
    await row.locator('button:has-text("Edit")').click();
    await page.locator('.ct-tailor-tree').waitFor({ timeout: 20000 });
    console.log('Edit mode loaded tree for existing policy.');
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41-05-edit-loaded.png', fullPage: true });

    await page.click('button:has-text("Update")');
    await page.waitForTimeout(2000);
    console.log('Clicked Update.');
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41-06-after-update.png', fullPage: true });

    // ---- Cleanup: delete the adhoc policy ----
    await page.locator('td', { hasText: policyName }).first().waitFor({ timeout: 10000 });
    const rowAfter = page.locator('tr', { hasText: policyName });
    await rowAfter.locator('button:has-text("Delete")').click();
    await page.locator('button:has-text("Delete")').last().click();
    await page.locator('td', { hasText: policyName }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    console.log('Deleted adhoc test policy — cleanup done.');
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41-07-after-delete.png', fullPage: true });
});
