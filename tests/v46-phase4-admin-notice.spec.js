// V4.6 admin notice (Peter 2026-10-15): without administrative access the
// "Administrative access required" notice sits in the SCAP Security Scan
// card header, right of the title, not as a page banner above the tabs.
// Run Scan is aria-disabled with a tooltip; turning admin on removes both.
const { test, expect } = require('@playwright/test');
const { requestAdmin, COCKPIT_URL } = require('./helpers/cockpit');

const USER = process.env.COCKPIT_USER || 'pbuchan';
const PASS = process.env.COCKPIT_PASS || '';
const SHELL_PATH = process.env.SCAP_SHELL_PATH || '/scap-dev';
const NOTICE = 'Administrative access required to run a scan';

// Log in WITHOUT elevating, then open the module inside the shell.
async function openLimited(page) {
    await page.goto(COCKPIT_URL);
    await page.locator('#login-user-input').waitFor({ timeout: 15000 });
    await page.fill('#login-user-input', USER);
    await page.fill('#login-password-input', PASS);
    await page.click('#login-button');
    await page.waitForFunction(() => !document.getElementById('login-user-input'), null, { timeout: 20000 });
    await page.goto(COCKPIT_URL + SHELL_PATH);
    const iframe = page.locator(`iframe[name="cockpit1:localhost${SHELL_PATH}"]`);
    await iframe.waitFor({ state: 'attached', timeout: 30000 });
    const frame = await (await iframe.elementHandle()).contentFrame();
    await frame.locator('.pf-v6-c-card').first().waitFor({ timeout: 30000 });
    return frame;
}

test('limited: notice in the scan card header, no banner, Run Scan disabled with tooltip; admin on clears it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const frame = await openLimited(page);
    await expect(page.locator('a:has-text("Limited access"), button:has-text("Limited access")').first()).toBeVisible({ timeout: 15000 });

    const header = frame.locator('.pf-v6-c-card__header', { hasText: 'SCAP Security Scan' });
    const notice = header.locator('.ct-admin-needed');
    await expect(notice).toHaveText(NOTICE, { timeout: 15000 });
    // Same row as the title, to its right.
    const t = await header.locator('.pf-v6-c-card__title').boundingBox();
    const n = await notice.boundingBox();
    expect(n.x).toBeGreaterThan(t.x + t.width - 1);
    expect(Math.abs((n.y + n.height / 2) - (t.y + t.height / 2))).toBeLessThan(16);

    // The old page banner is gone.
    await expect(frame.locator('.pf-v6-c-alert', { hasText: 'Administrative access required' })).toHaveCount(0);

    const run = frame.getByRole('button', { name: 'Run Scan' });
    await expect(run).toHaveAttribute('aria-disabled', 'true');
    await run.hover();
    await expect(frame.getByRole('tooltip')).toContainText('Administrative access');

    // Policy Tailoring tab has no notice (it works without root).
    await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
    await expect(frame.locator('.ct-admin-needed:visible')).toHaveCount(0);
    await frame.getByRole('tab', { name: 'Host Scan' }).click();

    await requestAdmin(page);
    await expect(frame.locator('.ct-admin-needed:visible')).toHaveCount(0, { timeout: 15000 });
    await expect(frame.getByRole('button', { name: 'Run Scan' })).toBeEnabled({ timeout: 30000 });
});

test('limited at phone width (375 px): notice fits the card, no horizontal scroll', async ({ page }, info) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const frame = await openLimited(page);
    const header = frame.locator('.pf-v6-c-card__header', { hasText: 'SCAP Security Scan' });
    const notice = header.locator('.ct-admin-needed');
    await expect(notice).toBeVisible({ timeout: 15000 });
    const card = await frame.locator('.pf-v6-c-card', { has: header }).boundingBox();
    const n = await notice.boundingBox();
    expect(n.x).toBeGreaterThanOrEqual(card.x - 1);
    expect(n.x + n.width).toBeLessThanOrEqual(card.x + card.width + 1);
    const overflow = await frame.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `tests/test-results/v46-phase4/admin-notice-phone-${info.project.name}.png` });
});

test('limited at desktop: screenshot', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const frame = await openLimited(page);
    await expect(frame.locator('.ct-admin-needed')).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: `tests/test-results/v46-phase4/admin-notice-desktop-${info.project.name}.png` });
});
