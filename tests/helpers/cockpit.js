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

// Path of the module inside the Cockpit shell. V4.6 specs run against the
// dev copy (tools/deploy-dev-copies.sh), never the RPM's /scap.
const SHELL_PATH = process.env.SCAP_SHELL_PATH || '/scap-dev';

/* Log in, elevate admin on the shell page, then open the module INSIDE the
 * Cockpit shell (/scap-dev, module in its iframe) rather than at its direct
 * URL. The direct URL has no shell CSP around it, which is how the Firefox
 * blob-download block went unseen (C§1b). Returns the module's Frame; use
 * `page` itself for shell-level things like download events. */
async function openModuleInShell(page, shellPath = SHELL_PATH) {
    await page.goto(COCKPIT_URL);
    await page.locator('#login-user-input').waitFor({ timeout: 15000 });
    await page.fill('#login-user-input', COCKPIT_USER);
    await page.fill('#login-password-input', COCKPIT_PASS);
    await page.click('#login-button');
    await page.waitForFunction(() => !document.getElementById('login-user-input'), null, { timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await requestAdmin(page);
    await page.goto(COCKPIT_URL + shellPath);
    const iframe = page.locator(`iframe[name="cockpit1:localhost${shellPath}"]`);
    await iframe.waitFor({ state: 'attached', timeout: 30000 });
    const frame = await (await iframe.elementHandle()).contentFrame();
    await frame.locator('.pf-v6-c-card').first()
            .waitFor({ timeout: 30000 });
    return frame;
}

/* Run a command on the test host through the module frame's own cockpit
 * bridge (as the logged-in user; superuser only when asked). */
async function hostSpawn(frame, args, { superuser = false } = {}) {
    // await inside: a cockpit.spawn() proc is a thenable, not a real
    // Promise, so returning it unawaited serializes to undefined.
    return frame.evaluate(async ({ args, superuser }) =>
        await window.cockpit.spawn(args, { err: 'message', ...(superuser ? { superuser: 'require' } : {}) }),
    { args, superuser });
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

module.exports = {
    loginToCockpit, getModuleFrame, requestAdmin, canDoPrivilegedWrite, COCKPIT_URL,
    openModuleInShell, hostSpawn, SHELL_PATH,
};
