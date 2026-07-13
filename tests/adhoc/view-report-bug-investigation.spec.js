// Investigation script for the "View Report opens unstyled" bug
// (PLAN_V4.2_SCAN_HISTORY.md "Related bug" section, 2026-07-13).
// Not an asserting spec — clicks the real View Report button after a real
// scan, captures console output from BOTH the opener page and the popup,
// dumps the popup's actual CSP-relevant response headers and computed
// styles, and screenshots the result. Human/agent reads the output.
const { test, expect } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

const SHOTS = 'tests/adhoc/screenshots/';

test('View Report bug investigation: capture console + computed styles', async ({ page, context }) => {
    page.on('console', msg => console.log(`[opener:${msg.type()}]`, msg.text()));
    page.on('pageerror', err => console.log('[opener:pageerror]', err.message));

    await loginToCockpit(page);
    await page.setViewportSize({ width: 1280, height: 1000 });

    const contentSelect = page.locator('#ct-scap-content');
    await contentSelect.waitFor({ timeout: 15000 });
    const profileSelect = page.locator('#ct-scap-profile');
    await expect(profileSelect).not.toBeDisabled({ timeout: 15000 });
    await profileSelect.selectOption({ value: 'xccdf_org.ssgproject.content_profile_e8' });

    const runBtn = page.locator('button', { hasText: 'Run Scan' });
    await expect(runBtn).not.toBeDisabled({ timeout: 5000 });
    await runBtn.click();
    console.log('Scan started.');

    const newScanBtn = page.locator('button', { hasText: 'New Scan' });
    await newScanBtn.waitFor({ timeout: 600000 });
    console.log('Scan complete.');

    const viewReportBtn = page.locator('button', { hasText: 'View Report' });
    await expect(viewReportBtn).toBeVisible({ timeout: 5000 });

    const [popup] = await Promise.all([
        context.waitForEvent('page'),
        viewReportBtn.click(),
    ]);
    popup.on('console', msg => console.log(`[popup:${msg.type()}]`, msg.text()));
    popup.on('pageerror', err => console.log('[popup:pageerror]', err.message));
    popup.on('requestfailed', req => console.log('[popup:requestfailed]', req.url(), req.failure()?.errorText));

    await popup.waitForLoadState('load', { timeout: 15000 }).catch(e => console.log('[popup] load wait error:', e.message));
    await popup.waitForTimeout(1000);

    const popupUrl = popup.url();
    console.log('Popup URL:', popupUrl);

    // Dump response headers on the popup navigation itself, if any were recorded
    // (blob: URLs won't have real HTTP headers, but log what we can see).
    const bodyHTML = await popup.evaluate(() => document.documentElement.outerHTML.slice(0, 500));
    console.log('Popup document start:', bodyHTML);

    const hasStyleTag = await popup.evaluate(() => !!document.querySelector('style'));
    const styleTagLength = await popup.evaluate(() => document.querySelector('style')?.textContent?.length || 0);
    console.log('Popup has <style> tag:', hasStyleTag, 'length:', styleTagLength);

    const computed = await popup.evaluate(() => {
        const body = document.body;
        const cs = getComputedStyle(body);
        return {
            fontFamily: cs.fontFamily,
            backgroundColor: cs.backgroundColor,
            color: cs.color,
        };
    });
    console.log('Popup body computed style:', JSON.stringify(computed));

    // Check for a navbar element that oscap's report template always renders
    // with a bootstrap navbar-inverse class + background color, if styled.
    const navbarBg = await popup.evaluate(() => {
        const nav = document.querySelector('.navbar, .page-header, h1');
        return nav ? getComputedStyle(nav).backgroundColor : null;
    });
    console.log('Popup navbar/header computed background-color:', navbarBg);

    await popup.screenshot({ path: SHOTS + 'view-report-bug-investigation-popup.png', fullPage: true });
    await page.screenshot({ path: SHOTS + 'view-report-bug-investigation-opener.png', fullPage: true });

    console.log('Investigation complete.');
});
