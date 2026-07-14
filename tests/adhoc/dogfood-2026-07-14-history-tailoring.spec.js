// Dogfooding pass 2026-07-14: Scan History (all 3 real scans, including two
// saved BEFORE today's rule-detail fix) and Policy Tailoring tab (both real
// STIG policies + throwaway CRUD). Pre-demo sanity pass.
const { test, expect } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

const SHOT = 'tests/adhoc/screenshots/dogfood-2026-07-14';

function wireConsole(page, label) {
    page.on('console', msg => {
        if (msg.type() === 'error') console.log(`[${label}][browser:error]`, msg.text());
    });
    page.on('pageerror', err => console.log(`[${label}][pageerror]`, err.message));
}

test('Scan History: all 3 real saved scans render full detail', async ({ page }) => {
    wireConsole(page, 'history');
    await loginToCockpit(page);

    await page.locator('#ct-scap-content').waitFor({ timeout: 15000 });
    const historyCard = page.locator('.pf-v6-c-card:visible', { hasText: 'Scan History' });
    await historyCard.waitFor({ timeout: 15000 });
    await page.screenshot({ path: `${SHOT}/11-scan-history-list.png`, fullPage: true });

    const rows = historyCard.locator('tbody tr');
    const rowCount = await rows.count();
    console.log('Scan history rows:', rowCount);
    expect(rowCount).toBe(3);

    // Disk usage line
    const diskUsageText = await historyCard.locator('.ct-disk-usage-total').textContent();
    console.log('Scan history disk usage line:', diskUsageText);

    for (let i = 0; i < rowCount; i++) {
        const row = rows.nth(i);
        const rowText = await row.innerText();
        console.log(`Row ${i} summary:`, rowText.replace(/\n/g, ' | '));

        const viewBtn = row.locator('button', { hasText: 'View report' });
        await viewBtn.click();
        await page.waitForTimeout(1000);
        // Should land on results phase — score element visible
        await expect(page.locator('.ct-score-value')).toBeVisible({ timeout: 15000 });
        const scoreText = await page.locator('.ct-score-value').textContent();
        const ruleRows = page.locator('.ct-rule-row');
        const ruleCount = await ruleRows.count();
        console.log(`Row ${i} viewed — score: ${scoreText}, failing rule rows: ${ruleCount}`);

        if (ruleCount > 0) {
            const firstRowText = await ruleRows.first().innerText();
            console.log(`Row ${i} first failing rule detail:`, firstRowText.replace(/\n/g, ' | '));
            const detailsBtn = ruleRows.first().locator('button', { hasText: /^Details$/ });
            const hasDetailsBtn = await detailsBtn.isVisible({ timeout: 1500 }).catch(() => false);
            console.log(`Row ${i} first rule has expandable Details button:`, hasDetailsBtn);
            if (hasDetailsBtn) {
                await detailsBtn.click();
                await page.waitForTimeout(300);
            }
        }
        await page.screenshot({ path: `${SHOT}/12-history-scan-${i}-detail.png`, fullPage: true });

        // Return to setup/history list — button reads "Close" when viewing a saved
        // history scan (no live tmpdir) vs "New Scan" for a just-completed live scan.
        const newScanBtn = page.locator('button', { hasText: /^(New Scan|Close)$/ });
        await newScanBtn.click();
        await historyCard.waitFor({ timeout: 15000 });
    }

    // Delete confirm modal — open then Cancel, verify no data lost
    const firstRow = rows.first();
    await firstRow.locator('button', { hasText: 'Delete' }).click();
    const modal = page.locator('.pf-v6-c-modal-box', { hasText: 'Delete Scan' });
    await expect(modal).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: `${SHOT}/13-history-delete-modal.png`, fullPage: true });
    await modal.locator('button', { hasText: 'Cancel' }).click();
    await expect(modal).toBeHidden({ timeout: 5000 });
    const rowCountAfterCancel = await rows.count();
    console.log('Row count after Cancel on delete modal (should still be 3):', rowCountAfterCancel);
    expect(rowCountAfterCancel).toBe(3);
});

test('Bulk fix download with a real subset selected (via saved scan, severity groups expanded)', async ({ page }) => {
    wireConsole(page, 'bulk-subset');
    await loginToCockpit(page);
    await page.locator('#ct-scap-content').waitFor({ timeout: 15000 });

    const historyCard = page.locator('.pf-v6-c-card:visible', { hasText: 'Scan History' });
    await historyCard.waitFor({ timeout: 15000 });
    // Open the STIG-tailored scan — has the most rules across all severities.
    const stigRow = historyCard.locator('tbody tr', { hasText: 'STIG - Dev Server Exceptions' });
    await stigRow.locator('button', { hasText: 'View report' }).click();
    await expect(page.locator('.ct-score-value')).toBeVisible({ timeout: 15000 });

    // Expand every collapsed severity group so all checkboxes are visible.
    const toggles = page.locator('.pf-v6-c-card button', { hasText: /^(HIGH|MEDIUM|LOW|UNKNOWN) —/ });
    const toggleCount = await toggles.count();
    for (let i = 0; i < toggleCount; i++) {
        const t = toggles.nth(i);
        const expanded = await t.getAttribute('aria-expanded');
        if (expanded === 'false') await t.click();
    }
    await page.waitForTimeout(300);

    await page.locator('button', { hasText: 'Deselect All' }).click();
    const boxes = page.locator('.ct-rule-row .pf-v6-c-check__input');
    const n = Math.min(3, await boxes.count());
    for (let i = 0; i < n; i++) await boxes.nth(i).check();
    console.log('Checked', n, 'boxes across expanded severity groups.');

    const downloadBashBtn = page.locator('button', { hasText: 'Download Bash Fix' });
    const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
        downloadBashBtn.click(),
    ]);
    console.log('Bulk subset bash fix download:', dl ? dl.suggestedFilename() : 'NO DOWNLOAD EVENT');
    expect(dl).toBeTruthy();

    const downloadAnsibleBtn = page.locator('button', { hasText: 'Download Ansible Fix' });
    const [dl2] = await Promise.all([
        page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
        downloadAnsibleBtn.click(),
    ]);
    console.log('Bulk subset ansible fix download:', dl2 ? dl2.suggestedFilename() : 'NO DOWNLOAD EVENT');
    expect(dl2).toBeTruthy();

    await page.screenshot({ path: `${SHOT}/12b-bulk-subset-via-history.png`, fullPage: true });
});

test('Policy Tailoring: both real policies view/edit, throwaway CRUD, uploaded content', async ({ page }) => {
    wireConsole(page, 'tailoring');
    await loginToCockpit(page);

    await page.locator('.pf-v6-c-tabs__link', { hasText: 'Policy Tailoring' }).click();
    await page.waitForTimeout(500);
    const tailoringListCard = page.locator('.pf-v6-c-card:visible', { hasText: 'Saved Tailoring Policies' });
    await tailoringListCard.waitFor({ timeout: 15000 });
    await page.screenshot({ path: `${SHOT}/14-tailoring-tab.png`, fullPage: true });

    const rows = tailoringListCard.locator('tbody tr');
    const rowCount = await rows.count();
    console.log('Tailoring policy rows:', rowCount);
    expect(rowCount).toBe(2);

    for (let i = 0; i < rowCount; i++) {
        const row = tailoringListCard.locator('tbody tr').nth(i);
        const rowText = await row.innerText();
        console.log(`Tailoring row ${i}:`, rowText.replace(/\n/g, ' | '));
        await row.locator('button', { hasText: 'Edit' }).click();
        await page.waitForTimeout(1500);

        const editorCard = page.locator('.pf-v6-c-card:visible', { hasText: 'Editing:' });
        await expect(editorCard).toBeVisible({ timeout: 10000 });
        await page.screenshot({ path: `${SHOT}/15-tailoring-editor-${i}.png`, fullPage: true });

        // Expand a TreeView node if present
        const treeToggle = page.locator('.pf-v6-c-tree-view__node-toggle').first();
        if (await treeToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
            await treeToggle.click();
            await page.waitForTimeout(400);
            await page.screenshot({ path: `${SHOT}/16-tailoring-tree-expanded-${i}.png`, fullPage: true });
        }

        // Change summary panel + Copy Summary
        const copyBtn = page.locator('button', { hasText: 'Copy Summary' });
        if (await copyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await copyBtn.click();
            await page.waitForTimeout(300);
            const copyBtnText = await copyBtn.textContent();
            console.log(`Row ${i} Copy Summary button after click:`, copyBtnText);
        } else {
            console.log(`Row ${i}: Copy Summary button not visible.`);
        }

        // Cancel edit to go back to list without changing the real policy
        await page.locator('button', { hasText: 'Cancel' }).first()
                .click();
        await page.waitForTimeout(500);
    }

    // Throwaway Save-as-New: edit policy 0, change name, Save as New
    await tailoringListCard.locator('tbody tr').first()
            .locator('button', { hasText: 'Edit' })
            .click();
    await page.waitForTimeout(1000);
    const nameInput = page.locator('#ct-tailor-name-input');
    await nameInput.fill('ZZZ-TEST-DELETE-ME');
    const saveAsNewBtn = page.locator('button', { hasText: 'Save as New' });
    await expect(saveAsNewBtn).toBeVisible({ timeout: 5000 });
    await saveAsNewBtn.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SHOT}/17-tailoring-save-as-new.png`, fullPage: true });

    const rowCountAfterSaveNew = await tailoringListCard.locator('tbody tr').count();
    console.log('Tailoring rows after Save-as-New throwaway (expect 3):', rowCountAfterSaveNew);

    // Now edit the throwaway and test Update
    const throwawayRow = tailoringListCard.locator('tbody tr', { hasText: 'ZZZ-TEST-DELETE-ME' });
    await expect(throwawayRow).toBeVisible({ timeout: 5000 });
    await throwawayRow.locator('button', { hasText: 'Edit' }).click();
    await page.waitForTimeout(1000);
    const updateBtn = page.locator('button', { hasText: 'Update' });
    const hasUpdateBtn = await updateBtn.isVisible({ timeout: 5000 }).catch(() => false);
    console.log('Update button visible when editing existing policy:', hasUpdateBtn);
    if (hasUpdateBtn) {
        await updateBtn.click();
        await page.waitForTimeout(1500);
        console.log('Clicked Update on throwaway policy.');
    }
    await page.screenshot({ path: `${SHOT}/18-tailoring-update.png`, fullPage: true });

    // Delete confirm modal on throwaway — actually delete it this time (cleanup)
    const throwawayRowAgain = tailoringListCard.locator('tbody tr', { hasText: 'ZZZ-TEST-DELETE-ME' });
    await throwawayRowAgain.locator('button', { hasText: 'Delete' }).click();
    const delModal = page.locator('.pf-v6-c-modal-box', { hasText: 'Delete Policy' });
    await expect(delModal).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: `${SHOT}/19-tailoring-delete-modal.png`, fullPage: true });
    await delModal.locator('button', { hasText: 'Delete' }).click();
    await expect(delModal).toBeHidden({ timeout: 5000 });
    await page.waitForTimeout(1000);
    const finalRowCount = await tailoringListCard.locator('tbody tr').count();
    console.log('Tailoring rows after throwaway cleanup (expect back to 2):', finalRowCount);
    expect(finalRowCount).toBe(2);

    // Uploaded Content section — both real files
    const uploadedCard = page.locator('.pf-v6-c-card:visible', { hasText: 'Uploaded Content' });
    await uploadedCard.waitFor({ timeout: 10000 });
    const contentRows = uploadedCard.locator('tbody tr');
    const contentRowCount = await contentRows.count();
    console.log('Uploaded Content rows (expect 2):', contentRowCount);
    for (let i = 0; i < contentRowCount; i++) {
        console.log('Uploaded content row', i, ':', (await contentRows.nth(i).innerText()).replace(/\n/g, ' | '));
    }
    await page.screenshot({ path: `${SHOT}/20-uploaded-content.png`, fullPage: true });

    // "Manage uploaded content →" link from Host Scan
    await page.locator('.pf-v6-c-tabs__link', { hasText: 'Host Scan' }).click();
    await page.waitForTimeout(500);
    const manageLink = page.locator('button', { hasText: 'Manage uploaded content' });
    if (await manageLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await manageLink.click();
        await page.waitForTimeout(500);
        const onTailoringTab = await page.locator('.pf-v6-c-card:visible', { hasText: 'Uploaded Content' }).isVisible({ timeout: 5000 })
                .catch(() => false);
        console.log('Manage uploaded content link switched to Tailoring tab correctly:', onTailoringTab);
        await page.screenshot({ path: `${SHOT}/21-manage-content-link.png`, fullPage: true });
    } else {
        console.log('WARNING: "Manage uploaded content →" link not visible on Host Scan tab.');
    }
});
