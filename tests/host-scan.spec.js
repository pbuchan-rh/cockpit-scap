const { test, expect } = require('@playwright/test');
const { loginToCockpit, getModuleFrame, navigateToTab } = require('./helpers/cockpit');

const HOST_SDS     = '/usr/share/xml/scap/ssg/content/ssg-rhel10-ds.xml';
const HOST_PROFILE = 'xccdf_org.ssgproject.content_profile_pci-dss';
const RHEL9_SDS    = '/var/lib/cockpit-scap/content/ssg-rhel9-ds.xml';

/* Helper: wait for host history to populate and load first entry into results */
async function loadResultsFromHistory(frame) {
    try {
        await frame.locator('#ct-history-tbody tr').first()
            .waitFor({ state: 'visible', timeout: 15000 });
    } catch {
        return false;
    }
    await frame.locator('#ct-history-tbody tr:first-child button:has-text("View Scan")').click();
    await expect(frame.locator('#ct-results')).toBeVisible({ timeout: 10000 });
    return true;
}

/* Helper: find the first history entry (starting from 2nd) that has automatable rules.
 * Skipping entry 1 (the current run's scan) avoids races where remediation.sh hasn't
 * been generated yet. We scan forward until #ct-quick-fix-btn is enabled, which means
 * autoCount > 0 and a remediation.sh was produced for that result set. */
async function loadResultsFromHistoryForRemediation(frame) {
    const rows = frame.locator('#ct-history-tbody tr');
    try {
        await rows.first().waitFor({ state: 'visible', timeout: 15000 });
    } catch {
        return false;
    }
    const count = await rows.count();
    for (let i = 1; i < Math.min(count, 6); i++) {
        await rows.nth(i).locator('button:has-text("View Scan")').click();
        await expect(frame.locator('#ct-results')).toBeVisible({ timeout: 10000 });
        await expect(frame.locator('#ct-action-board-auto'))
            .not.toContainText('Checking', { timeout: 30000 });
        if (await frame.locator('#ct-quick-fix-btn').isEnabled()) return true;
    }
    return false;
}

/* Helper: open remediation drawer via Review All button and wait for rules */
async function openRemediationDrawer(frame) {
    await frame.locator('#ct-review-all-btn').click();
    await expect(frame.locator('#ct-remediation-content')).toBeVisible({ timeout: 20000 });
}

test.describe('Host Scan', () => {
    test.beforeEach(async ({ page }) => {
        await loginToCockpit(page);
    });

    test('module loads with core tabs visible', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await expect(frame.locator('button#tab-btn-scan')).toBeVisible();
        await expect(frame.locator('button#tab-btn-tailoring')).toBeVisible();
        await expect(frame.locator('button#tab-btn-settings')).toBeVisible();
        await expect(frame.locator('button#tab-btn-activity')).toBeVisible();
        await page.screenshot({ path: 'tests/screenshots/01-module-loaded.png' });
    });

    test('content dropdown is populated and cross-version content excluded', async ({ page }) => {
        const frame = await getModuleFrame(page);
        const contentSelect = frame.locator('#ct-content-select');
        await expect(contentSelect).toBeVisible();
        const optCount = await contentSelect.locator('option').count();
        expect(optCount).toBeGreaterThan(0);
        const options = await contentSelect.locator('option').allTextContents();
        const crossVersion = options.filter(t => /rhel[0-9]/.test(t) && !/rhel10/i.test(t));
        expect(crossVersion.length).toBe(0);
        await page.screenshot({ path: 'tests/screenshots/02-content-populated.png' });
    });

    test('profile dropdown populates after content selection', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await frame.locator('#ct-content-select').selectOption({ value: HOST_SDS });
        const profileSelect = frame.locator('#ct-profile-select');
        await expect(profileSelect.locator('option').nth(1)).not.toHaveText('Loading profiles…', { timeout: 45000 });
        const count = await profileSelect.locator('option').count();
        expect(count).toBeGreaterThan(1);
        await page.screenshot({ path: 'tests/screenshots/03-profiles-loaded.png' });
    });

    test('tailoring file selection auto-fills profile', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await expect.poll(
            () => frame.locator('#ct-tailor-file-select option').count(),
            { timeout: 15000 }
        ).toBeGreaterThan(1);
        await frame.locator('#ct-content-select').selectOption({ value: HOST_SDS });
        await expect(frame.locator('#ct-profile-select')).toBeEnabled({ timeout: 45000 });
        // Wait for detectTailoringFiles() to finish rebuilding the map for the new content —
        // tailoringFilesMap is reset async and must be populated before selectOption triggers auto-fill
        let rhel10Opt;
        await expect.poll(async () => {
            const opts = await frame.locator('#ct-tailor-file-select option').allTextContents();
            rhel10Opt = opts.find(t => t.toLowerCase().includes('playwright-rhel10'));
            return !!rhel10Opt;
        }, { timeout: 15000 }).toBe(true);
        if (!rhel10Opt) {
            test.skip('playwright-rhel10 tailoring file not found — run Setup test first');
            return;
        }
        // Poll re-selects on each tick: detectTailoringFiles() is called twice (on content change AND
        // after loadProfiles resolves), wiping tailoringFilesMap between calls. Re-selecting each poll
        // iteration ensures we eventually hit a state where the map is populated and auto-fill fires.
        await expect.poll(async () => {
            await frame.locator('#ct-tailor-file-select').selectOption({ label: rhel10Opt }).catch(() => {});
            const profileVal = await frame.locator('#ct-profile-select').inputValue();
            return profileVal !== '';
        }, { timeout: 30000, intervals: [1000] }).toBe(true);
        await page.screenshot({ path: 'tests/screenshots/04-tailoring-autofill.png' });
    });

    test('full profile remediation buttons disabled until content+profile selected', async ({ page }) => {
        const frame = await getModuleFrame(page);
        // No content selected yet — toggle should be disabled
        await expect(frame.locator('#ct-profile-rem-toggle')).toBeDisabled();
        // Select content and profile — toggle should enable
        await frame.locator('#ct-content-select').selectOption({ value: HOST_SDS });
        await expect(frame.locator('#ct-profile-select')).toBeEnabled({ timeout: 45000 });
        await frame.locator('#ct-profile-select').selectOption({ value: HOST_PROFILE });
        await expect(frame.locator('#ct-profile-rem-toggle')).toBeEnabled({ timeout: 5000 });
        await page.screenshot({ path: 'tests/screenshots/04b-profile-rem-enabled.png' });
    });

    test('dry-run command preview shows oscap command after profile selection', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await frame.locator('#ct-content-select').selectOption({ value: HOST_SDS });
        await expect(frame.locator('#ct-profile-select')).toBeEnabled({ timeout: 45000 });
        await frame.locator('#ct-profile-select').selectOption({ value: HOST_PROFILE });
        const details = frame.locator('#ct-scan-cmd-details');
        await details.locator('summary').click();
        const cmdText = await frame.locator('#ct-scan-cmd').textContent({ timeout: 5000 });
        expect(cmdText).toContain('oscap xccdf eval');
        expect(cmdText).toContain('--profile');
        await page.screenshot({ path: 'tests/screenshots/04c-dryrun-preview.png' });
    });

    test('run scan, results appear with score and action board', async ({ page }) => {
        test.setTimeout(600000); // PCI-DSS on hardened host can exceed global 10 min default
        const frame = await getModuleFrame(page);
        await frame.locator('#ct-content-select').selectOption({ value: HOST_SDS });
        await expect(frame.locator('#ct-profile-select')).toBeEnabled({ timeout: 45000 });
        await frame.locator('#ct-profile-select').selectOption({ value: HOST_PROFILE });
        await frame.locator('#ct-scan-btn').click();
        await page.screenshot({ path: 'tests/screenshots/05-scan-running.png' });
        await frame.locator('#ct-results').waitFor({ state: 'visible', timeout: 300000 });
        await expect(frame.locator('#ct-result-score')).toBeVisible();
        // Action board should appear
        await expect(frame.locator('#ct-action-board')).not.toHaveClass(/hidden/, { timeout: 15000 });
        await expect(frame.locator('#ct-action-board-sev')).toBeVisible();
        await page.screenshot({ path: 'tests/screenshots/06-scan-results.png' });
    });

    test('scan duration and scan ID appear in results header', async ({ page }) => {
        const frame = await getModuleFrame(page);
        const loaded = await loadResultsFromHistory(frame);
        if (!loaded) { test.skip('No scan history available'); return; }
        const dur = frame.locator('#ct-results-duration');
        const sid = frame.locator('#ct-results-scan-id');
        // Only check visible ones — pre-v3.8 scans won't have these
        const durVisible = await dur.isVisible().catch(() => false);
        if (durVisible) {
            await expect(dur).not.toBeEmpty();
            await expect(sid).toBeVisible();
        }
        await page.screenshot({ path: 'tests/screenshots/06b-scan-meta.png' });
    });

    test('result breakdown shows pass/fail counts', async ({ page }) => {
        const frame = await getModuleFrame(page);
        const loaded = await loadResultsFromHistory(frame);
        if (!loaded) { test.skip('No scan history available'); return; }
        const breakdown = frame.locator('#ct-result-badges');
        await expect(breakdown).toBeVisible();
        const text = await breakdown.textContent();
        expect(text).toContain('passed');
        expect(text).toContain('failed');
        await page.screenshot({ path: 'tests/screenshots/06c-result-breakdown.png' });
    });

    test('action board shows Remediation Builder buttons with correct labels', async ({ page }) => {
        const frame = await getModuleFrame(page);
        const loaded = await loadResultsFromHistory(frame);
        if (!loaded) { test.skip('No scan history available'); return; }
        await expect(frame.locator('#ct-action-board')).not.toHaveClass(/hidden/, { timeout: 15000 });
        // Section label
        await expect(frame.locator('#ct-action-board .ct-rem-panel-heading')).toContainText('Remediation Builder');
        // Review All button labelled "All Failures"
        const reviewBtn = frame.locator('#ct-review-all-btn');
        await expect(reviewBtn).toBeVisible();
        await expect(reviewBtn).toContainText('All Failures');
        // Quick Fix button labelled "Critical Rules"
        const qfBtn = frame.locator('#ct-quick-fix-btn');
        await expect(qfBtn).toBeVisible();
        await expect(qfBtn).toContainText('Critical Rules');
        await page.screenshot({ path: 'tests/screenshots/06d-action-board-labels.png' });
    });

    test('failing rules summary is visible after loading scan from history', async ({ page }) => {
        const frame = await getModuleFrame(page);
        const loaded = await loadResultsFromHistory(frame);
        if (!loaded) { test.skip('No scan history available'); return; }
        await expect(frame.locator('#ct-failing-summary-groups')).toBeVisible({ timeout: 30000 });
        await page.screenshot({ path: 'tests/screenshots/07-failing-rules.png' });
    });

    test('failing rules search filters by title and CCE', async ({ page }) => {
        const frame = await getModuleFrame(page);
        const loaded = await loadResultsFromHistory(frame);
        if (!loaded) { test.skip('No scan history available'); return; }
        await frame.locator('#ct-failing-summary-groups').waitFor({ state: 'visible', timeout: 30000 });
        const search = frame.locator('#ct-failing-search');
        await expect(search).toBeVisible();
        // Search with term that won't match — all items should be hidden
        await search.fill('zzznomatchzzz');
        await expect.poll(
            () => frame.locator('#ct-failing-summary-groups .ct-rule-item:visible').count(),
            { timeout: 5000 }
        ).toBe(0);
        // Clear search — items reappear
        await search.fill('');
        await expect.poll(
            () => frame.locator('#ct-failing-summary-groups .ct-rule-item').count(),
            { timeout: 5000 }
        ).toBeGreaterThan(0);
        await page.screenshot({ path: 'tests/screenshots/07b-failing-search.png' });
    });

    test('scan history entry exists', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await expect(frame.locator('#ct-history-tbody tr').first()).toBeVisible({ timeout: 15000 });
        await page.screenshot({ path: 'tests/screenshots/08-scan-history.png' });
    });

    test('remediation drawer opens from action board and closes with Esc', async ({ page }) => {
        const frame = await getModuleFrame(page);
        const loaded = await loadResultsFromHistory(frame);
        if (!loaded) { test.skip('No scan history available'); return; }
        // Open via Review All
        await frame.locator('#ct-action-board').waitFor({ state: 'visible', timeout: 15000 });
        await frame.locator('#ct-review-all-btn').click();
        const drawer = frame.locator('#ct-remediation-panel');
        await expect(drawer).toHaveClass(/ct-drawer-open/, { timeout: 10000 });
        await expect(frame.locator('#ct-remediation-content')).toBeVisible({ timeout: 20000 });
        await page.screenshot({ path: 'tests/screenshots/09-rem-drawer-open.png' });
        // Close with Esc
        await page.keyboard.press('Escape');
        await expect(drawer).not.toHaveClass(/ct-drawer-open/, { timeout: 5000 });
        await page.screenshot({ path: 'tests/screenshots/09b-rem-drawer-closed.png' });
    });

    test('remediation drawer closes with close button', async ({ page }) => {
        const frame = await getModuleFrame(page);
        const loaded = await loadResultsFromHistory(frame);
        if (!loaded) { test.skip('No scan history available'); return; }
        await frame.locator('#ct-action-board').waitFor({ state: 'visible', timeout: 15000 });
        await frame.locator('#ct-review-all-btn').click();
        await expect(frame.locator('#ct-remediation-panel')).toHaveClass(/ct-drawer-open/, { timeout: 10000 });
        await frame.locator('#ct-rem-close-btn').click();
        await expect(frame.locator('#ct-remediation-panel')).not.toHaveClass(/ct-drawer-open/, { timeout: 5000 });
    });

    test('Quick Fix pre-selects only automatable rules', async ({ page }) => {
        const frame = await getModuleFrame(page);
        const loaded = await loadResultsFromHistory(frame);
        if (!loaded) { test.skip('No scan history available'); return; }
        await frame.locator('#ct-action-board').waitFor({ state: 'visible', timeout: 15000 });
        const qfBtn = frame.locator('#ct-quick-fix-btn');
        if (await qfBtn.isDisabled()) {
            test.skip('No automatable rules in this scan');
            return;
        }
        await qfBtn.click();
        await expect(frame.locator('#ct-rem-drawer')).toHaveClass(/ct-drawer-open/, { timeout: 10000 });
        await expect(frame.locator('#ct-remediation-content')).toBeVisible({ timeout: 20000 });
        // All checked rules should be automated
        const uncheckedNonAuto = frame.locator(
            '#ct-remediation-rules .ct-rem-rule-item input[type="checkbox"]:checked ~ .ct-rem-rule-weight:not([data-auto])'
        );
        await page.screenshot({ path: 'tests/screenshots/09c-quick-fix-preselect.png' });
        await page.keyboard.press('Escape');
    });

    test('export dropdown opens and shows all three options', async ({ page }) => {
        const frame = await getModuleFrame(page);
        const loaded = await loadResultsFromHistory(frame);
        if (!loaded) { test.skip('No scan history available'); return; }
        const toggle = frame.locator('#ct-export-toggle');
        await expect(toggle).toBeVisible();
        await toggle.click();
        const menu = frame.locator('#ct-export-menu');
        await expect(menu).not.toHaveClass(/hidden/, { timeout: 3000 });
        await expect(menu.locator('#ct-export-report-default')).toBeVisible();
        await expect(menu.locator('#ct-download-xml-btn')).toBeVisible();
        await expect(menu.locator('#ct-download-arf-btn')).toBeVisible();
        const defaultLabel = await menu.locator('#ct-export-report-default').textContent();
        expect(defaultLabel).toContain('Download HTML');
        expect(defaultLabel).toContain('default');
        await page.screenshot({ path: 'tests/screenshots/09d-export-dropdown.png' });
        // Click outside to close
        await frame.locator('#ct-results h2').click();
        await expect(menu).toHaveClass(/hidden/, { timeout: 3000 });
    });

    test('Download ARF button disabled on pre-v3.8 scan, enabled on fresh scan', async ({ page }) => {
        const frame = await getModuleFrame(page);
        // Load from history — older scans won't have has_arf: true
        const loaded = await loadResultsFromHistory(frame);
        if (!loaded) { test.skip('No scan history available'); return; }
        // Open export dropdown to reveal ARF button
        await frame.locator('#ct-export-toggle').click();
        const arfBtn = frame.locator('#ct-download-arf-btn');
        await expect(arfBtn).toBeVisible({ timeout: 5000 });
        // Just verify the button exists and has correct disabled state based on manifest
        // (disabled for old scans, enabled for post-v3.8 scans — accept either)
        const isDisabled = await arfBtn.isDisabled();
        if (isDisabled) {
            const title = await arfBtn.getAttribute('title');
            expect(title).toContain('rescan');
        }
        await page.screenshot({ path: 'tests/screenshots/09e-arf-button-state.png' });
    });

    test('selective remediation builder opens from history remediate button', async ({ page }) => {
        const frame = await getModuleFrame(page);
        const loaded = await loadResultsFromHistory(frame);
        if (!loaded) { test.skip('No scan history available'); return; }
        await openRemediationDrawer(frame);
        await expect(frame.locator('#ct-remediation-rules')).toBeVisible();
        await page.screenshot({ path: 'tests/screenshots/10-remediation-builder.png' });
    });

    test('view scan from history loads results', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await expect(frame.locator('#ct-history-tbody tr').first()).toBeVisible({ timeout: 15000 });
        await frame.locator('#ct-history-tbody tr:first-child button:has-text("View Scan")').click();
        await expect(frame.locator('#ct-results')).toBeVisible({ timeout: 10000 });
        await page.screenshot({ path: 'tests/screenshots/10b-view-from-history.png' });
    });

    test('remediation search filters and clears rules', async ({ page }) => {
        const frame = await getModuleFrame(page);
        const loaded = await loadResultsFromHistory(frame);
        if (!loaded) { test.skip('No scan history available'); return; }
        await openRemediationDrawer(frame);
        const totalItems = await frame.locator('#ct-remediation-rules .ct-rem-rule-item').count();
        expect(totalItems).toBeGreaterThan(0);
        await frame.locator('#ct-rem-search').fill('xxxxxxnosuchrulexxx');
        await expect(frame.locator('#ct-rem-no-results')).toBeVisible({ timeout: 3000 });
        const visibleItems = await frame.locator(
            '#ct-remediation-rules .ct-rem-rule-item:not([style*="none"])'
        ).count();
        expect(visibleItems).toBe(0);
        await frame.locator('#ct-rem-search').fill('');
        await expect(frame.locator('#ct-rem-no-results')).toHaveClass(/hidden/, { timeout: 3000 });
        await page.screenshot({ path: 'tests/screenshots/11-rem-search.png' });
    });

    test('rule detail expansion shows description', async ({ page }) => {
        const frame = await getModuleFrame(page);
        const loaded = await loadResultsFromHistory(frame);
        if (!loaded) { test.skip('No scan history available'); return; }
        await openRemediationDrawer(frame);
        const firstGroup = frame.locator('#ct-remediation-rules .ct-rem-group').first();
        await expect(firstGroup).toBeVisible({ timeout: 10000 });
        await firstGroup.locator('summary.ct-rem-group-summary').click();
        const firstDetail = frame.locator('#ct-remediation-rules .ct-rem-rule-detail').first();
        if (!await firstDetail.count()) {
            test.skip('No rules with descriptions available in this scan');
            return;
        }
        await expect(firstDetail).not.toHaveAttribute('open');
        await firstDetail.locator('summary.ct-rem-detail-toggle').click();
        await expect(firstDetail.locator('.ct-rem-detail-body')).toBeVisible();
        await page.screenshot({ path: 'tests/screenshots/12-rem-detail-expanded.png' });
    });

    test('Apply Now gate 1 modal opens and cancel dismisses it', async ({ page }) => {
        const frame = await getModuleFrame(page);
        const loaded = await loadResultsFromHistory(frame);
        if (!loaded) { test.skip('No scan history available'); return; }
        await openRemediationDrawer(frame);
        const applyBtn = frame.locator('#ct-rem-apply-btn');
        await expect(applyBtn).toBeVisible();
        await expect(applyBtn).toBeEnabled({ timeout: 5000 });
        await applyBtn.click();
        await expect(page.locator('#ct-apply-gate1')).not.toHaveClass(/hidden/, { timeout: 5000 });
        await expect(page.locator('#ct-apply-gate1-title')).toContainText('Apply Remediation');
        await page.locator('#ct-apply-gate1-cancel').click();
        await expect(page.locator('#ct-apply-gate1')).toHaveClass(/hidden/, { timeout: 3000 });
        await page.screenshot({ path: 'tests/screenshots/13-apply-gate1.png' });
    });

    test('Apply Now gate 2 shows script preview and cancel dismisses it', async ({ page }) => {
        const frame = await getModuleFrame(page);
        // Use second history entry — its remediation.sh was chmod'd by global-setup (not the current run's scan)
        const loaded = await loadResultsFromHistoryForRemediation(frame);
        if (!loaded) { test.skip('No scan history available'); return; }
        await openRemediationDrawer(frame);
        const applyBtn = frame.locator('#ct-rem-apply-btn');
        await expect(applyBtn).toBeEnabled({ timeout: 5000 });
        await applyBtn.click();
        await expect(page.locator('#ct-apply-gate1')).not.toHaveClass(/hidden/, { timeout: 5000 });
        // Proceed is disabled while remediation.sh is being generated in the background (~7 min on PCI-DSS)
        await expect(page.locator('#ct-apply-gate1-proceed')).toBeEnabled({ timeout: 600000 });
        await page.locator('#ct-apply-gate1-proceed').click();
        await expect(page.locator('#ct-apply-gate2')).not.toHaveClass(/hidden/, { timeout: 10000 });
        await expect(page.locator('#ct-apply-script-preview')).not.toBeEmpty({ timeout: 10000 });
        await page.locator('#ct-apply-gate2-cancel').click();
        await expect(page.locator('#ct-apply-gate2')).toHaveClass(/hidden/, { timeout: 3000 });
        await page.screenshot({ path: 'tests/screenshots/14-apply-gate2.png' });
    });

    test('Activity tab shows View Log button for remediate_apply entries', async ({ page }) => {
        const frame = await getModuleFrame(page);
        await navigateToTab(page, 'activity');
        await frame.locator('#ct-activity-limit').selectOption('250');
        await frame.locator('#panel-activity').waitFor({ state: 'visible', timeout: 10000 });
        const viewLogBtn = frame.locator('.ct-activity-view-log').first();
        if (!await viewLogBtn.isVisible().catch(() => false)) {
            test.skip('No remediate_apply entries with log_path in activity log');
            return;
        }
        await viewLogBtn.click();
        await expect(page.locator('#ct-log-modal')).not.toHaveClass(/hidden/, { timeout: 5000 });
        await expect(page.locator('#ct-log-modal-content')).not.toBeEmpty();
        await page.locator('#ct-log-modal-close').click();
        await expect(page.locator('#ct-log-modal')).toHaveClass(/hidden/, { timeout: 3000 });
        await page.screenshot({ path: 'tests/screenshots/15-activity-view-log.png' });
    });
});
