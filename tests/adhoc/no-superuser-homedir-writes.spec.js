// Adhoc verification for fix/no-superuser-homedir-writes.
//
// Bug: Tailoring save/edit/delete and Scan History view/download/delete all
// required { superuser: 'require' } even though they only ever touch
// ~/SCAP/... which the invoking user already owns. A logged-in user who has
// NOT elevated "Administrative access" got "save failed... not permitted."
//
// This script drives three real browser sessions against rhel10cis:
//   Phase A (admin)     - run one real scan so History has a saved entry to
//                          test view/download/delete against in Phase B.
//   Phase B (no admin)  - the core regression test. Never elevates. Confirms
//                          Tailoring create/edit/delete and Scan History
//                          view/download/delete all work, and confirms
//                          Run Scan is still correctly blocked without admin.
//   Phase C (admin)     - re-run the same Tailoring flow elevated, to confirm
//                          elevation still works fine (unaffected either way).
const { test, expect } = require('@playwright/test');
const { COCKPIT_URL, requestAdmin } = require('../helpers/cockpit.js');

const SHOTS = 'tests/adhoc/screenshots/';
const COCKPIT_USER = process.env.COCKPIT_USER || 'pbuchan';
const COCKPIT_PASS = process.env.COCKPIT_PASS || '';
const MODULE_PATH = '/cockpit/@localhost/scap/index.html';

// Local login helper — unlike helpers/cockpit.js's loginToCockpit, this does
// NOT call requestAdmin(). The whole point of Phase B is to never elevate.
async function loginNoAdmin(page) {
    await page.goto(COCKPIT_URL);
    await page.locator('#login-user-input').waitFor({ timeout: 10000 });
    await page.fill('#login-user-input', COCKPIT_USER);
    await page.fill('#login-password-input', COCKPIT_PASS);
    await page.click('#login-button');
    await page.waitForFunction(
        () => !document.getElementById('login-user-input'),
        { timeout: 15000 }
    );
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.goto(COCKPIT_URL + MODULE_PATH);
    await page.waitForLoadState('domcontentloaded');
}

async function loginWithAdmin(page) {
    await page.goto(COCKPIT_URL);
    await page.locator('#login-user-input').waitFor({ timeout: 10000 });
    await page.fill('#login-user-input', COCKPIT_USER);
    await page.fill('#login-password-input', COCKPIT_PASS);
    await page.click('#login-button');
    await page.waitForFunction(
        () => !document.getElementById('login-user-input'),
        { timeout: 15000 }
    );
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await requestAdmin(page);
    await page.goto(COCKPIT_URL + MODULE_PATH);
    await page.waitForLoadState('domcontentloaded');
}

// The "Limited access" indicator lives in the Cockpit *shell* chrome, which
// is only present when the module is reached through the shell's iframe —
// not when navigated to directly by URL (loginNoAdmin/loginWithAdmin above
// go straight to MODULE_PATH, no shell wrapper). So that DOM element simply
// doesn't exist on this page regardless of admin state. Ask the same source
// of truth the app itself uses instead (src/app.jsx's adminAllowed state):
// cockpit.permission({ admin: true }), exposed as window.cockpit by
// pkg/lib/cockpit.js.
//
// cockpit.permission() does a real async round-trip (a "cockpit.Superuser"
// D-Bus proxy + a channel wait) before `.allowed` settles from `null` to a
// real boolean — so a fresh Permission object read synchronously right
// after construction reads `null` almost every time, and `null !== false`
// is true. Stash one Permission object per page (module reload always
// re-creates `window.cockpit`, so this can't go stale across phases) and
// poll it, mirroring how the app itself holds one for its component
// lifetime instead of re-querying per render.
async function isAdminAllowed(page) {
    return page.evaluate(() => {
        if (typeof window.cockpit?.permission !== 'function') return true;
        if (!window.__testAdminPermission) {
            window.__testAdminPermission = window.cockpit.permission({ admin: true });
        }
        return window.__testAdminPermission.allowed;
    });
}

async function createTailoringPolicy(page, name) {
    await page.locator('.pf-v6-c-tabs__link', { hasText: 'Tailoring' }).click();
    await page.locator('#ct-tailor-content-select').waitFor({ timeout: 15000 });

    const contentSelect = page.locator('#ct-tailor-content-select');
    await expect(contentSelect).toBeEnabled({ timeout: 15000 });
    const firstRealOption = await contentSelect.locator('option:not([disabled])')
            .first()
            .getAttribute('value');
    await contentSelect.selectOption(firstRealOption);

    const profileSelect = page.locator('#ct-tailor-profile-select');
    await expect(profileSelect).not.toBeDisabled({ timeout: 15000 });

    const loadBtn = page.locator('button', { hasText: 'Load Rules' });
    await expect(loadBtn).not.toBeDisabled({ timeout: 10000 });
    await loadBtn.click();

    await page.locator('#ct-tailor-name-input').waitFor({ timeout: 20000 });
    await page.fill('#ct-tailor-name-input', name);

    // Toggle one rule so the save has an actual delta.
    const firstCheckbox = page.locator('.ct-tailor-tree input[type="checkbox"]').first();
    await firstCheckbox.waitFor({ timeout: 10000 });
    await firstCheckbox.click();

    const saveBtn = page.locator('button', { hasText: 'Save Policy' });
    await expect(saveBtn).not.toBeDisabled({ timeout: 5000 });
    await saveBtn.click();

    // No "Save failed" alert, and the editor resets (form clears) on success.
    await expect(page.locator('text=Save failed')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('#ct-tailor-name-input')).toHaveCount(0, { timeout: 10000 });
}

test('no-superuser homedir writes: tailoring + scan history, admin vs no-admin', async ({ page: initialPage, browser }) => {
    test.setTimeout(1800000);
    // `let`, not `const` — Phase B and Phase C each get a brand-new browser
    // context (see below) and reassign this, since Cockpit ties admin
    // elevation to the session/cookies, not to page navigation: reusing
    // Phase A's still-elevated `page` for Phase B would silently keep
    // testing the elevated path instead of the no-admin one.
    let page = initialPage;
    const watchErrors = p => p.on('pageerror', err => console.log('[pageerror]', err.message));
    watchErrors(page);

    // ---------------------------------------------------------------
    // Phase A (admin): run one real scan so Phase B has a saved entry
    // to test View report / Download / Delete against.
    // ---------------------------------------------------------------
    await loginWithAdmin(page);
    await page.setViewportSize({ width: 1280, height: 1200 });
    await expect.poll(() => isAdminAllowed(page), { timeout: 5000 }).toBe(true);
    console.log('Phase A: admin elevated.');

    const profileSelect = page.locator('#ct-scap-profile');
    await expect(profileSelect).not.toBeDisabled({ timeout: 15000 });
    await profileSelect.selectOption({ value: 'xccdf_org.ssgproject.content_profile_e8' });
    const runBtn = page.locator('button', { hasText: 'Run Scan' });
    await expect(runBtn).not.toBeDisabled({ timeout: 5000 });
    await runBtn.click();
    const newScanBtn = page.locator('button', { hasText: 'New Scan' });
    await newScanBtn.waitFor({ timeout: 1100000 });
    console.log('Phase A: scan complete, saved to history.');
    await newScanBtn.click();
    await expect(page.locator('#ct-scap-content')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: SHOTS + 'no-superuser-01-phaseA-scan-saved.png', fullPage: true });

    // ---------------------------------------------------------------
    // Phase B (NO admin): the core regression test. Fresh browser context —
    // see the comment above `let page` for why Phase A's context can't be
    // reused here.
    // ---------------------------------------------------------------
    const contextB = await browser.newContext({ ignoreHTTPSErrors: true });
    page = await contextB.newPage();
    watchErrors(page);
    await loginNoAdmin(page);
    await page.setViewportSize({ width: 1280, height: 1200 });
    await expect.poll(() => isAdminAllowed(page), { timeout: 10000 }).toBe(false);
    console.log('Phase B: confirmed NOT elevated (cockpit.permission admin:false).');
    await page.screenshot({ path: SHOTS + 'no-superuser-02-phaseB-limited-access.png', fullPage: true });

    // Run Scan should still correctly require admin.
    await expect(page.locator('text=Administrative access required')).toBeVisible({ timeout: 10000 });
    const runBtnNoAdmin = page.locator('button', { hasText: 'Run Scan' });
    await expect(runBtnNoAdmin).toBeDisabled({ timeout: 5000 });
    console.log('Phase B: Run Scan correctly still blocked without admin.');
    await page.screenshot({ path: SHOTS + 'no-superuser-03-phaseB-scan-still-blocked.png', fullPage: true });

    // Scan History view/download/delete without admin.
    const historyRow = page.locator('table[aria-label="Scan history"] tbody tr').first();
    await expect(historyRow).toBeVisible({ timeout: 15000 });
    await expect.poll(() => isAdminAllowed(page)).toBe(false);
    await page.screenshot({ path: SHOTS + 'no-superuser-04-phaseB-history-listed.png', fullPage: true });

    await historyRow.locator('button', { hasText: 'View report' }).click();
    const closeBtn = page.locator('button', { hasText: 'Close' });
    await expect(closeBtn).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.ct-score-value')).toBeVisible();
    await expect.poll(() => isAdminAllowed(page)).toBe(false);
    console.log('Phase B: View report (saved) works without admin.');
    await page.screenshot({ path: SHOTS + 'no-superuser-05-phaseB-view-report.png', fullPage: true });
    await closeBtn.click();
    await expect(page.locator('#ct-scap-content')).toBeVisible({ timeout: 10000 });

    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        historyRow.locator('button', { hasText: 'Download' }).click(),
    ]);
    console.log('Phase B: Download works without admin:', download.suggestedFilename());
    await expect.poll(() => isAdminAllowed(page)).toBe(false);
    await page.screenshot({ path: SHOTS + 'no-superuser-06-phaseB-download.png', fullPage: true });

    await historyRow.locator('button', { hasText: 'Delete' }).click();
    const deleteScanModal = page.locator('.pf-v6-c-modal-box', { hasText: 'Delete Scan' });
    await expect(deleteScanModal).toBeVisible({ timeout: 5000 });
    await deleteScanModal.locator('button', { hasText: 'Delete' }).click();
    await expect(deleteScanModal).toBeHidden({ timeout: 10000 });
    await expect(page.locator('text=No scan history yet')).toBeVisible({ timeout: 10000 });
    console.log('Phase B: Delete scan works without admin.');
    await expect.poll(() => isAdminAllowed(page)).toBe(false);
    await page.screenshot({ path: SHOTS + 'no-superuser-07-phaseB-scan-deleted.png', fullPage: true });

    // Tailoring: create, edit, delete, all without admin.
    const policyName = 'no-superuser-test-' + Date.now();
    await createTailoringPolicy(page, policyName);
    await expect.poll(() => isAdminAllowed(page)).toBe(false);
    console.log('Phase B: Tailoring policy created without admin:', policyName);
    await page.screenshot({ path: SHOTS + 'no-superuser-08-phaseB-tailoring-created.png', fullPage: true });

    const tailoringRow = page.locator('tr', { hasText: policyName });
    await expect(tailoringRow).toBeVisible({ timeout: 15000 });

    await tailoringRow.locator('button', { hasText: 'Edit' }).click();
    await page.locator('#ct-tailor-name-input').waitFor({ timeout: 15000 });
    const editedName = policyName + '-edited';
    await page.fill('#ct-tailor-name-input', editedName);
    const updateBtn = page.locator('button', { hasText: 'Update' });
    await expect(updateBtn).not.toBeDisabled({ timeout: 5000 });
    await updateBtn.click();
    await expect(page.locator('text=Save failed')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('#ct-tailor-name-input')).toHaveCount(0, { timeout: 10000 });
    await expect.poll(() => isAdminAllowed(page)).toBe(false);
    console.log('Phase B: Tailoring policy edited (update-in-place) without admin.');
    await page.screenshot({ path: SHOTS + 'no-superuser-09-phaseB-tailoring-edited.png', fullPage: true });

    const editedRow = page.locator('tr', { hasText: editedName });
    await expect(editedRow).toBeVisible({ timeout: 15000 });
    await editedRow.locator('button', { hasText: 'Delete' }).click();
    const deletePolicyModal = page.locator('.pf-v6-c-modal-box', { hasText: 'Delete Policy' });
    await expect(deletePolicyModal).toBeVisible({ timeout: 5000 });
    await deletePolicyModal.locator('button', { hasText: 'Delete' }).click();
    await expect(deletePolicyModal).toBeHidden({ timeout: 10000 });
    await expect(page.locator('tr', { hasText: editedName })).toHaveCount(0, { timeout: 10000 });
    await expect.poll(() => isAdminAllowed(page)).toBe(false);
    console.log('Phase B: Tailoring policy deleted without admin. All no-admin checks passed.');
    await page.screenshot({ path: SHOTS + 'no-superuser-10-phaseB-tailoring-deleted.png', fullPage: true });

    await contextB.close();

    // ---------------------------------------------------------------
    // Phase C (admin): quick regression — same Tailoring flow, elevated.
    // Fresh context again, same reasoning as Phase B.
    // ---------------------------------------------------------------
    const contextC = await browser.newContext({ ignoreHTTPSErrors: true });
    page = await contextC.newPage();
    watchErrors(page);
    await loginWithAdmin(page);
    await page.setViewportSize({ width: 1280, height: 1200 });
    await expect.poll(() => isAdminAllowed(page), { timeout: 5000 }).toBe(true);
    console.log('Phase C: admin elevated.');

    const policyNameC = 'no-superuser-test-admin-' + Date.now();
    await createTailoringPolicy(page, policyNameC);
    console.log('Phase C: Tailoring policy created with admin:', policyNameC);
    await page.screenshot({ path: SHOTS + 'no-superuser-11-phaseC-tailoring-created.png', fullPage: true });

    const tailoringRowC = page.locator('tr', { hasText: policyNameC });
    await expect(tailoringRowC).toBeVisible({ timeout: 15000 });
    await tailoringRowC.locator('button', { hasText: 'Delete' }).click();
    const deletePolicyModalC = page.locator('.pf-v6-c-modal-box', { hasText: 'Delete Policy' });
    await expect(deletePolicyModalC).toBeVisible({ timeout: 5000 });
    await deletePolicyModalC.locator('button', { hasText: 'Delete' }).click();
    await expect(deletePolicyModalC).toBeHidden({ timeout: 10000 });
    await expect(page.locator('tr', { hasText: policyNameC })).toHaveCount(0, { timeout: 10000 });
    console.log('Phase C: Tailoring create+delete still works with admin. Regression check passed.');
    await page.screenshot({ path: SHOTS + 'no-superuser-12-phaseC-cleanup-done.png', fullPage: true });
    await contextC.close();
});
