// Verification for the View Report styling fix (branch fix/view-report-styling).
// Clicks the real View Report button after a real scan and confirms the
// resulting same-origin viewer.html document is actually styled — computed
// font-family should be Bootstrap's stack (not the browser default serif),
// and a screenshot is captured as evidence.
const { test, expect } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

const SHOTS = 'tests/adhoc/screenshots/';

test('View Report opens a same-origin, fully styled viewer', async ({ page, context }) => {
    // script-src is deliberately left at Cockpit's strict default (no
    // unsafe-inline) — oscap's report bundles an unaudited inline jQuery +
    // treetable plugin purely for collapse/expand UX, and the project's
    // security rules rule out loosening script-src package-wide for that.
    // Only style-src was relaxed (manifest.json), so style violations must
    // be zero; inline-script violations are expected and logged, not failed.
    const styleCspViolations = [];
    const scriptCspViolations = [];
    function trackCsp(scope) {
        return msg => {
            if (msg.text().includes('Applying inline style') && msg.text().includes('Content Security Policy'))
                styleCspViolations.push(`[${scope}] ${msg.text()}`);
            else if (msg.text().includes('Executing inline script') && msg.text().includes('Content Security Policy'))
                scriptCspViolations.push(`[${scope}] ${msg.text()}`);
        };
    }
    page.on('console', trackCsp('opener'));

    await loginToCockpit(page);
    await page.setViewportSize({ width: 1280, height: 1000 });

    const profileSelect = page.locator('#ct-scap-profile');
    await expect(profileSelect).not.toBeDisabled({ timeout: 15000 });
    await profileSelect.selectOption({ value: 'xccdf_org.ssgproject.content_profile_e8' });

    const runBtn = page.locator('button', { hasText: 'Run Scan' });
    await expect(runBtn).not.toBeDisabled({ timeout: 5000 });
    await runBtn.click();

    const newScanBtn = page.locator('button', { hasText: 'New Scan' });
    await newScanBtn.waitFor({ timeout: 600000 });

    const viewReportBtn = page.locator('button', { hasText: 'View Report' });
    await expect(viewReportBtn).toBeVisible({ timeout: 5000 });

    const [popup] = await Promise.all([
        context.waitForEvent('page'),
        viewReportBtn.click(),
    ]);
    popup.on('console', trackCsp('popup'));

    await popup.waitForLoadState('load', { timeout: 15000 });
    // viewer.js opens IndexedDB and document.write()s asynchronously; give it
    // a beat to finish before asserting on the rendered document.
    await popup.waitForFunction(() => document.querySelector('style, link[rel=stylesheet]') !== null, { timeout: 10000 });

    expect(popup.url()).toContain('/scap/viewer.html');

    const computed = await popup.evaluate(() => {
        const cs = getComputedStyle(document.body);
        return { fontFamily: cs.fontFamily, backgroundColor: cs.backgroundColor, color: cs.color };
    });
    console.log('Popup body computed style:', JSON.stringify(computed));
    expect(computed.fontFamily.toLowerCase()).not.toContain('times');
    expect(computed.fontFamily.toLowerCase()).not.toBe('serif');

    const navbarBg = await popup.evaluate(() => {
        const nav = document.querySelector('.navbar, .page-header');
        return nav ? getComputedStyle(nav).backgroundColor : null;
    });
    console.log('Popup navbar computed background-color:', navbarBg);
    expect(navbarBg).not.toBeNull();
    expect(navbarBg).not.toBe('rgba(0, 0, 0, 0)');

    console.log('Style CSP violations (must be none):', JSON.stringify(styleCspViolations));
    console.log('Script CSP violations (expected, script-src intentionally not relaxed):',
                scriptCspViolations.length);
    expect(styleCspViolations).toEqual([]);

    await popup.screenshot({ path: SHOTS + 'view-report-fix-01-popup-styled.png' });
    await page.screenshot({ path: SHOTS + 'view-report-fix-02-opener.png' });
});
