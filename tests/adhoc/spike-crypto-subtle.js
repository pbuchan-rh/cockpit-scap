// Ad-hoc spike: does crypto.subtle.digest work under Cockpit's real HTTPS
// serving on rhel10cis? PLAN_V4.3_CONTENT_UPLOAD.md flags this as an
// unverified assumption to check before committing to the checksum-based
// write-verification approach (Decision 1). Not a real spec — no assertions.
const { chromium } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await loginToCockpit(page);

    const result = await page.evaluate(async () => {
        try {
            const data = new TextEncoder().encode('cockpit-scap spike test');
            const digest = await crypto.subtle.digest('SHA-256', data);
            const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
            return { ok: true, isSecureContext: window.isSecureContext, hex };
        } catch (ex) {
            return { ok: false, isSecureContext: window.isSecureContext, error: ex.message };
        }
    });

    console.log('crypto.subtle spike result:', JSON.stringify(result, null, 2));
    await browser.close();
    process.exit(result.ok ? 0 : 1);
})();
