// Verification for fix/content-links-spacing:
// The "Content file" FormGroup's adjacent link-Buttons ("Enter path
// manually"/"Use auto-detected content", "Upload…", and conditionally
// "Manage uploaded content →") rendered with zero gap between them. Confirms
// visible spacing after wrapping them in a Flex spaceItemsSm, in both light
// and dark mode. Run with STAGE=before / STAGE=after env var to label output.
const { test, expect } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

const SHOTS = 'tests/adhoc/screenshots/';
const STAGE = process.env.STAGE || 'unlabeled';

for (const scheme of ['light', 'dark']) {
    test(`content file link-button spacing (${scheme})`, async ({ page }) => {
        page.on('pageerror', err => console.log('[pageerror]', err.message));
        await page.emulateMedia({ colorScheme: scheme });
        await loginToCockpit(page);
        await page.setViewportSize({ width: 1280, height: 900 });

        const scanCard = page.locator('.pf-v6-c-card', { hasText: 'SCAP Security Scan' }).first();
        await scanCard.waitFor({ timeout: 15000 });

        const buttons = scanCard.locator('.ct-path-toggle, button:has-text("Upload…"), button:has-text("Manage uploaded content")');
        const count = await buttons.count();
        console.log(`[${scheme}] link-button count:`, count);

        const boxes = [];
        for (let i = 0; i < count; i++) {
            const box = await buttons.nth(i).boundingBox();
            const text = await buttons.nth(i).innerText();
            boxes.push({ text, box });
            console.log(`[${scheme}] button "${text}" box:`, JSON.stringify(box));
        }

        const formGroup = scanCard.locator('.pf-v6-c-form__group', { hasText: 'Content file' }).first();
        await formGroup.screenshot({ path: `${SHOTS}content-links-spacing-${STAGE}-${scheme}.png` });

        // Adjacent buttons on the same line must have a visible horizontal gap;
        // if wrapped to a new line, that's fine too (still no overlap/touch).
        for (let i = 0; i < boxes.length - 1; i++) {
            const a = boxes[i].box;
            const b = boxes[i + 1].box;
            const sameLine = Math.abs(a.y - b.y) < 5;
            if (sameLine) {
                const gap = b.x - (a.x + a.width);
                console.log(`[${scheme}] gap between "${boxes[i].text}" and "${boxes[i + 1].text}":`, gap);
                expect(gap).toBeGreaterThan(4);
            }
        }
    });
}
