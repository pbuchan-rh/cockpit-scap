// Full live verification of V4.1 tailoring/policy editor against a real
// upgrade-installed RPM on rhel10cis. Investigation script, not an asserting
// spec — console.log + screenshots, human reads the output to judge pass/fail.
const { test } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

const E8 = 'xccdf_org.ssgproject.content_profile_e8';
const UPLOAD_FIXTURE = '/tmp/v41-upload-test-tailoring.xml';

test('V4.1 tailoring: full save/update/save-as-new/delete/upload/scan-integration flow', async ({ page }) => {
    page.on('pageerror', err => console.log('[pageerror]', err.message));

    await loginToCockpit(page);
    await page.locator('.pf-v6-c-card').first().waitFor({ timeout: 15000 });
    await page.click('button[role="tab"]:has-text("Tailoring")');
    await page.getByRole('heading', { name: 'Saved Tailoring Policies', exact: true }).waitFor({ timeout: 10000 });
    console.log('== Tailoring tab loaded ==');

    // ---- Step 1: New policy — load rules for the e8 profile ----
    await page.selectOption('#ct-tailor-content-select', { index: 1 });
    await page.waitForTimeout(800);
    const profileOptions = await page.locator('#ct-tailor-profile-select option').allTextContents();
    console.log('Available base profiles:', profileOptions.length);
    const hasE8 = await page.locator(`#ct-tailor-profile-select option[value="${E8}"]`).count();
    if (hasE8) {
        await page.selectOption('#ct-tailor-profile-select', E8);
    } else {
        await page.selectOption('#ct-tailor-profile-select', { index: 1 });
        console.log('WARNING: e8 profile not found by value, used first available profile instead');
    }
    await page.click('button:has-text("Load Rules")');
    await page.locator('.ct-tailor-tree').waitFor({ timeout: 30000 });
    console.log('Rule tree loaded.');
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41f-01-tree-loaded.png', fullPage: true });

    await page.evaluate(() => {
        document.querySelectorAll('details.ct-tailor-group').forEach(d => { d.open = true });
    });

    // Toggle a rule
    const firstCheckbox = page.locator('.ct-tailor-tree input[type="checkbox"]').first();
    await firstCheckbox.waitFor({ timeout: 10000 });
    const cbId1 = await firstCheckbox.getAttribute('id');
    const before1 = await firstCheckbox.isChecked();
    await page.locator(`label[for="${cbId1}"]`).click();
    console.log('Toggled rule', cbId1, 'from', before1, 'to', await firstCheckbox.isChecked());

    // Edit a value, if this profile has any Variables
    const varsToggle = page.getByText(/^Variables \(\d+\)$/);
    let editedValueLabel = null;
    if (await varsToggle.count() > 0) {
        await varsToggle.first().click();
        const firstValueInput = page.locator('.ct-tailor-values-grid input[type="text"], .ct-tailor-values-grid select').first();
        await firstValueInput.waitFor({ timeout: 5000 });
        const tag = await firstValueInput.evaluate(el => el.tagName);
        editedValueLabel = await firstValueInput.evaluate(el => el.closest('.pf-v6-c-form__group')?.querySelector('label')?.textContent);
        if (tag === 'SELECT') {
            const opts = await firstValueInput.locator('option').allTextContents();
            if (opts.length > 1) await firstValueInput.selectOption({ index: 1 });
        } else {
            await firstValueInput.fill('99');
        }
        console.log('Edited value:', editedValueLabel);
    } else {
        console.log('No Variables section for this profile — value-edit step skipped (profile has no tailorable values).');
    }

    const policyA = 'v41-verify-A-' + Date.now();
    await page.fill('#ct-tailor-name-input', policyA);
    const summaryBeforeSave = await page.locator('.ct-tailor-summary-hint').textContent();
    console.log('Summary before save:', summaryBeforeSave);
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41f-02-before-save-A.png', fullPage: true });

    await page.click('button:has-text("Save Policy")');
    await page.locator('td', { hasText: policyA }).first().waitFor({ timeout: 15000 });
    console.log('== Policy A saved and appears in Saved Tailoring Policies list ==');
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41f-03-policyA-in-list.png', fullPage: true });

    // ---- Step 2: Update in place ----
    let row = page.locator('tr', { hasText: policyA });
    await row.locator('button:has-text("Edit")').click();
    await page.locator('.ct-tailor-tree').waitFor({ timeout: 20000 });
    const summaryOnEdit = await page.locator('.ct-tailor-summary-hint').textContent();
    console.log('Summary on re-opening edit (should reflect saved changes):', summaryOnEdit);

    await page.evaluate(() => {
        document.querySelectorAll('details.ct-tailor-group').forEach(d => { d.open = true });
    });
    const secondCheckbox = page.locator('.ct-tailor-tree input[type="checkbox"]').nth(1);
    const cbId2 = await secondCheckbox.getAttribute('id');
    const before2 = await secondCheckbox.isChecked();
    await page.locator(`label[for="${cbId2}"]`).click();
    console.log('Toggled second rule', cbId2, 'from', before2, 'to', await secondCheckbox.isChecked());

    const updatedName = policyA + '-updated';
    await page.fill('#ct-tailor-name-input', updatedName);
    await page.click('button:has-text("Update")');
    await page.waitForTimeout(1500);
    await page.locator('td', { hasText: updatedName }).first().waitFor({ timeout: 10000 });
    console.log('== Update-in-place: name changed and row reflects it ==');
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41f-04-after-update.png', fullPage: true });

    // Confirm persistence: re-open edit, check the second toggle survived
    row = page.locator('tr', { hasText: updatedName });
    await row.locator('button:has-text("Edit")').click();
    await page.locator('.ct-tailor-tree').waitFor({ timeout: 20000 });
    await page.evaluate(() => {
        document.querySelectorAll('details.ct-tailor-group').forEach(d => { d.open = true });
    });
    // Rule IDs contain dots (xccdf_org.ssgproject...) which CSS parses as class
    // selectors when interpolated into a raw #id locator — use [id="..."] instead.
    const reloadedCheckbox = page.locator(`[id="${cbId2}"]`);
    const persistedState = await reloadedCheckbox.isChecked();
    console.log('PERSISTENCE CHECK: rule', cbId2, 'expected', await secondCheckbox.isChecked() ? 'toggled' : '?', '- reloaded state is', persistedState, persistedState !== before2 ? '(PERSISTED CORRECTLY)' : '(MISMATCH — did not persist!)');
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41f-05-persistence-check.png', fullPage: true });

    // ---- Step 3: Save-as-new from this edited copy ----
    const policyB = 'v41-verify-B-' + Date.now();
    await page.fill('#ct-tailor-name-input', policyB);
    await page.click('button:has-text("Save as New")');
    await page.locator('td', { hasText: policyB }).first().waitFor({ timeout: 15000 });
    console.log('== Save-as-New: Policy B created ==');

    const countA = await page.locator('td', { hasText: updatedName }).count();
    const countB = await page.locator('td', { hasText: policyB }).count();
    console.log(`TWO INDEPENDENT POLICIES CHECK: Policy A rows=${countA}, Policy B rows=${countB}`, (countA > 0 && countB > 0) ? '(BOTH PRESENT)' : '(FAILURE)');
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41f-06-two-policies.png', fullPage: true });

    // ---- Step 4: Delete Policy B ----
    let rowB = page.locator('tr', { hasText: policyB });
    await rowB.locator('button:has-text("Delete")').click();
    await page.locator('.pf-v6-c-modal-box button:has-text("Delete")').click();
    await page.locator('td', { hasText: policyB }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    const remainingB = await page.locator('td', { hasText: policyB }).count();
    console.log('DELETE CHECK: Policy B rows remaining after delete:', remainingB, remainingB === 0 ? '(DELETED OK)' : '(STILL PRESENT — FAILURE)');
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41f-07-after-delete-B.png', fullPage: true });

    // ---- Step 5: Upload external tailoring XML ----
    const contentSelectForUpload = page.locator('select[aria-label="Content for uploaded file"]');
    await contentSelectForUpload.waitFor({ timeout: 5000 });
    await contentSelectForUpload.selectOption({ index: 0 });
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(UPLOAD_FIXTURE);
    await page.locator('td', { hasText: 'v41-upload-check' }).first().waitFor({ timeout: 15000 });
    console.log('== Uploaded external tailoring XML appears in Saved Tailoring Policies list ==');
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41f-08-uploaded.png', fullPage: true });

    // ---- Step 6: Scan-tab integration ----
    await page.click('button[role="tab"]:has-text("Scan")');
    await page.locator('#ct-scap-tailoring-select').waitFor({ timeout: 10000 });
    const scanOptions = await page.locator('#ct-scap-tailoring-select option').allTextContents();
    console.log('Scan-tab tailoring dropdown options:', scanOptions);
    const scanHasA = scanOptions.some(t => t.includes(updatedName));
    const scanHasUploaded = scanOptions.some(t => t.includes('v41-upload-check'));
    console.log('FILTER CHECK: dropdown shows policy A?', scanHasA, '| shows uploaded policy?', scanHasUploaded, '(both match current content, both expected present)');

    await page.selectOption('#ct-scap-tailoring-select', { label: updatedName });
    console.log('Selected', updatedName, 'as the active tailoring for the scan.');
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41f-09-scan-tailoring-selected.png', fullPage: true });

    const runBtn = page.locator('button', { hasText: 'Run Scan' });
    await runBtn.click();
    await page.locator('button', { hasText: 'Cancel' }).waitFor({ timeout: 10000 });
    console.log('Scan started with tailoring selected — checking live process args via ps on host next (external ssh check).');
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41f-10-scan-running.png', fullPage: true });

    // Give oscap a moment to actually spawn before the external ps check runs
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'tests/adhoc/screenshots/v41f-11-scan-running-for-ps-check.png', fullPage: true });

    // Cancel — we only need to prove --tailoring-file was on the command line,
    // not run the full multi-minute e8 scan to completion (already proven end-to-end in v4.0 verification).
    await page.click('button:has-text("Cancel")');
    await page.locator('#ct-scap-content').waitFor({ timeout: 15000 });
    console.log('Scan cancelled after confirming process launch.');

    // ---- Cleanup ----
    await page.click('button[role="tab"]:has-text("Tailoring")');
    for (const name of [updatedName, 'v41-upload-check']) {
        const r = page.locator('tr', { hasText: name });
        if (await r.count() > 0) {
            await r.first().locator('button:has-text("Delete")').click();
            await page.locator('.pf-v6-c-modal-box button:has-text("Delete")').click();
            await page.locator('td', { hasText: name }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
        }
    }
    console.log('Cleanup done — test policies removed.');
});
