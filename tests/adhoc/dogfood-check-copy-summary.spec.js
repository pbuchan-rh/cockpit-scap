const { test, expect } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

test('Copy Summary works with clipboard-write permission granted', async ({ page, context, baseURL }) => {
    await context.grantPermissions(['clipboard-write', 'clipboard-read'], { origin: baseURL });
    await loginToCockpit(page);
    await page.locator('.pf-v6-c-tabs__link', { hasText: 'Policy Tailoring' }).click();
    await page.waitForTimeout(800);
    await page.locator('.pf-v6-c-card', { hasText: 'Saved Tailoring Policies' })
            .locator('tbody tr')
            .first()
            .locator('button', { hasText: 'Edit' })
            .click();
    await page.waitForTimeout(1500);

    const copyBtn = page.locator('button', { hasText: /Copy Summary|Copied/ });
    await expect(copyBtn).toBeVisible({ timeout: 5000 });
    await copyBtn.click();

    let sawCopied = false;
    for (let i = 0; i < 20; i++) {
        const t = await copyBtn.textContent();
        if (t.includes('Copied')) { sawCopied = true; console.log(`Saw "Copied" at poll ${i} (~${i * 100}ms)`); break }
        await page.waitForTimeout(100);
    }
    console.log('Ever saw "✓ Copied" state within 2s of polling:', sawCopied);
    const finalText = await copyBtn.textContent();
    console.log('Button text at end of poll window:', finalText);

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText()).catch(e => `ERROR: ${e.message}`);
    console.log('Clipboard contents after click:', JSON.stringify(clipboardText).slice(0, 200));
});
