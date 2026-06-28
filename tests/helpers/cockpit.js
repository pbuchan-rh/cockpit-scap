require('dotenv').config({ path: __dirname + '/../.env' });

const COCKPIT_URL  = process.env.COCKPIT_URL  || 'https://your-host:9090';
const COCKPIT_USER = process.env.COCKPIT_USER || 'pbuchan';
const COCKPIT_PASS = process.env.COCKPIT_PASS || '';

const MODULE_PATH = '/cockpit/@localhost/scap/index.html';

async function loginToCockpit(page) {
    await page.goto(COCKPIT_URL);
    await page.locator('#login-user-input').waitFor({ timeout: 10000 });
    await page.fill('#login-user-input', COCKPIT_USER);
    await page.fill('#login-password-input', COCKPIT_PASS);
    await page.click('#login-button');
    // Wait for Cockpit overview to load
    await page.waitForFunction(
        () => !document.getElementById('login-user-input'),
        { timeout: 15000 }
    );
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    // Elevate admin on the Cockpit shell page BEFORE navigating to the module
    await requestAdmin(page);
    // Navigate to the SCAP module
    await page.goto(COCKPIT_URL + MODULE_PATH);
    await page.waitForLoadState('domcontentloaded');
}

async function getModuleFrame(page) {
    // Module loads directly on the page when navigated by URL — no iframe wrapper
    await page.locator('.pf-v6-c-card').first().waitFor({ timeout: 30000 });
    return page;
}

async function requestAdmin(page) {
    // The "Limited access" link is in the Cockpit shell top bar (top-level page, not iframe)
    const shellSelectors = [
        'a:has-text("Limited access")',
        '#super-user-indicator a',
        '#super-user-indicator button',
        'button:has-text("Turn on administrative access")',
    ];
    for (const sel of shellSelectors) {
        const el = page.locator(sel).first();
        // Use waitFor (not isVisible) — isVisible is immediate and ignores the timeout option
        const visible = await el.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
        if (visible) {
            await el.click();
            // Password prompt (passwordless sudo completes quickly or without prompt)
            const pwField = page.locator('input[type="password"]').last();
            if (await pwField.isVisible({ timeout: 3000 }).catch(() => false)) {
                await pwField.fill(COCKPIT_PASS);
                await page.keyboard.press('Enter');
            }
            // Wait for elevation to confirm — "Limited access" disappears when admin is granted
            await page.locator('a:has-text("Limited access"), button:has-text("Limited access")')
                .waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
            break;
        }
    }
}

// Returns true if the Cockpit privileged bridge appears active via the shell indicator.
// Reliable when Defaults!/usr/bin/cockpit-bridge !use_pty is in /etc/sudoers.d/cockpit-bridge —
// with that rule in place, admin active in the shell means cockpit.file writes will actually succeed.
// A page.evaluate probe write was tried but deadlocks Playwright+Cockpit WebSocket when the
// bridge is initializing, so we rely on the DOM indicator instead.
async function canDoPrivilegedWrite(page) {
    const limited = page.locator('a:has-text("Limited access"), button:has-text("Limited access")');
    const visible = await limited.isVisible({ timeout: 2000 }).catch(() => false);
    return !visible;
}

module.exports = { loginToCockpit, getModuleFrame, requestAdmin, canDoPrivilegedWrite, COCKPIT_URL };
