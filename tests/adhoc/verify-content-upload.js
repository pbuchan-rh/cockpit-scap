// Ad-hoc, live end-to-end verification of V4.3 content upload against a real
// deployment on rhel10cis (PLAN_V4.3_CONTENT_UPLOAD.md). Not a real spec —
// console.log narration, exits non-zero on the first failed assertion so it
// still catches real breakage during a build session.
const { chromium } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

const FIXTURES = process.env.FIXTURES_DIR || '/home/pbuchan/.claude/jobs/5b0d808b/tmp/fixtures';
const VALID_XML = `${FIXTURES}/test-cockpit-scap-upload.xml`;
const MALFORMED_XML = `${FIXTURES}/test-cockpit-scap-malformed.xml`;
const HUGE_XML = `${FIXTURES}/test-cockpit-scap-huge.xml`;

let failures = 0;
function check(label, cond) {
    if (cond) {
        console.log(`  OK: ${label}`);
    } else {
        console.log(`  FAIL: ${label}`);
        failures++;
    }
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await loginToCockpit(page);

    console.log('== Navigate to Policy Tailoring tab ==');
    await page.getByRole('tab', { name: 'Policy Tailoring' }).click();
    await page.getByRole('heading', { name: 'Uploaded Content', exact: true }).waitFor({ timeout: 10000 });

    console.log('== Upload a valid SDS ==');
    const uploadCard = page.locator('.pf-v6-c-card').filter({ has: page.getByRole('heading', { name: 'Uploaded Content', exact: true }) });
    const uploadCardInput = uploadCard.locator('input[type="file"]');
    await uploadCardInput.setInputFiles(VALID_XML);
    await page.locator('td:has-text("test-cockpit-scap-upload.xml")').waitFor({ timeout: 120000 });
    check('valid upload appears in Uploaded Content list', await page.locator('td:has-text("test-cockpit-scap-upload.xml")').isVisible());

    console.log('== Check grouping in the three pickers ==');
    // ScanSetup (Host Scan tab)
    await page.getByRole('tab', { name: 'Host Scan' }).click();
    const scanContentSelect = page.locator('#ct-scap-content');
    await scanContentSelect.waitFor({ timeout: 10000 });
    const scanHasUploadedGroup = await scanContentSelect.locator('optgroup[label="Uploaded"] option').count();
    check('ScanSetup content picker shows an Uploaded optgroup entry', scanHasUploadedGroup > 0);

    await page.getByRole('tab', { name: 'Policy Tailoring' }).click();
    const tailorContentSelect = page.locator('#ct-tailor-content-select');
    await tailorContentSelect.waitFor({ timeout: 10000 });
    const tailorHasUploadedGroup = await tailorContentSelect.locator('optgroup[label="Uploaded"] option').count();
    check('TailoringEditor content picker shows an Uploaded optgroup entry', tailorHasUploadedGroup > 0);

    const listPickerHasUploadedGroup = await page.locator('select[aria-label="Content for uploaded file"]')
            .locator('optgroup[label="Uploaded"] option').count();
    check('TailoringList upload-target picker shows an Uploaded optgroup entry', listPickerHasUploadedGroup > 0);

    console.log('== Re-upload same name -> confirm-replace modal ==');
    await uploadCardInput.setInputFiles(VALID_XML);
    await page.locator('.pf-v6-c-modal-box:has-text("Replace existing content?")').waitFor({ timeout: 10000 });
    check('confirm-replace modal appeared', await page.locator('.pf-v6-c-modal-box:has-text("Replace existing content?")').isVisible());
    await page.getByRole('button', { name: 'Replace' }).click();
    await page.locator('.pf-v6-c-modal-box:has-text("Replace existing content?")').waitFor({ state: 'hidden', timeout: 15000 });
    check('modal closed after Replace', true);
    // Modal closes as soon as the user confirms, before the async
    // write/validate/rename pipeline actually settles — wait for the
    // Upload Content button's busy spinner to clear before firing the
    // next upload (mirrors real user pacing; a real click can't outrace
    // this the way scripted setInputFiles calls can).
    await uploadCard.locator('.pf-v6-c-button__progress').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});

    console.log('== Upload malformed XML -> rejected ==');
    const beforeRowCount = await uploadCard.locator("table tbody tr").count();
    await uploadCardInput.setInputFiles(MALFORMED_XML);
    await page.locator('text=Upload failed').waitFor({ timeout: 15000 });
    check('upload-failed alert shown for malformed XML', await page.locator('text=Upload failed').isVisible());
    const afterRowCount = await uploadCard.locator("table tbody tr").count();
    check('malformed upload did not add a row', afterRowCount === beforeRowCount);

    console.log('== 100MB size cap ==');
    await uploadCardInput.setInputFiles(HUGE_XML);
    await page.locator('text=too large').waitFor({ timeout: 10000 });
    check('oversized file rejected client-side with size-cap message', await page.locator('text=too large').isVisible());

    console.log('== Delete uploaded content ==');
    const row = page.locator('tr', { has: page.locator('td:has-text("test-cockpit-scap-upload.xml")') });
    await row.getByRole('button', { name: 'Delete' }).click();
    const deleteModal = page.locator('.pf-v6-c-modal-box:has-text("Delete Content")');
    await deleteModal.waitFor({ timeout: 10000 });
    check('delete confirm modal appeared', await deleteModal.isVisible());
    await deleteModal.getByRole('button', { name: 'Delete' }).click();
    await page.locator('td:has-text("test-cockpit-scap-upload.xml")').waitFor({ state: 'hidden', timeout: 15000 });
    check('row removed after delete confirm', !(await page.locator('td:has-text("test-cockpit-scap-upload.xml")').isVisible().catch(() => false)));

    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
    await browser.close();
    process.exit(failures === 0 ? 0 : 1);
})().catch(ex => {
    console.error('Script error:', ex);
    process.exit(1);
});
