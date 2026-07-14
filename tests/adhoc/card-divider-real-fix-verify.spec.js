// Verification for fix/card-divider-real-fix:
// The prior fix (935f464) put the border-bottom on .pf-v6-c-card__title, but
// CardTitle is a flex item inside CardHeader (display:flex) and shrinks to
// its text width — so that border only ever spanned the title text, not the
// card. This script checks rect.width against the card's own width (not just
// "border-bottom is non-zero", which is what let the prior fix pass visual
// review while still being broken), on both the header divider and the new
// footer divider, in both light and dark mode.
const { test, expect } = require('@playwright/test');
const { loginToCockpit } = require('../helpers/cockpit.js');

const SHOTS = 'tests/adhoc/screenshots/';

async function checkFullWidthBorder(card, selector, side, label) {
    const el = card.locator(selector).first();
    await el.waitFor({ timeout: 10000 });
    const data = await el.evaluate((node, side) => {
        const cs = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const cardRect = node.closest('.pf-v6-c-card').getBoundingClientRect();
        return {
            border: side === 'bottom' ? cs.borderBottom : cs.borderTop,
            elWidth: rect.width,
            cardWidth: cardRect.width,
        };
    }, side);
    console.log(`${label}: border=${data.border} elWidth=${data.elWidth.toFixed(1)} cardWidth=${data.cardWidth.toFixed(1)}`);
    expect(data.border).not.toMatch(/^0px/);
    // Full-width means the bordered element's width should be within a few px
    // of the card's width (allowing for the card's own border/scrollbar slop).
    expect(data.elWidth).toBeGreaterThan(data.cardWidth - 5);
}

async function verifyTab(page, tabText, cardHeadingText, hasFooter, modeLabel) {
    if (tabText) {
        await page.click(`.pf-v6-c-tabs__link:has-text("${tabText}")`);
        await page.waitForTimeout(500);
    }
    const card = page.locator('.pf-v6-c-card', { hasText: cardHeadingText }).first();
    await card.waitFor({ timeout: 15000 });

    await checkFullWidthBorder(card, '.pf-v6-c-card__header', 'bottom', `[${modeLabel}] ${cardHeadingText} header divider`);

    if (hasFooter) {
        await checkFullWidthBorder(card, '.pf-v6-c-card__footer', 'top', `[${modeLabel}] ${cardHeadingText} footer divider`);
    }

    await card.screenshot({ path: `${SHOTS}card-divider-real-fix-${modeLabel}-${cardHeadingText.replace(/\s+/g, '-').toLowerCase()}.png` });
}

test('card header and footer dividers are full-width (light mode)', async ({ page }) => {
    page.on('pageerror', err => console.log('[pageerror]', err.message));
    await loginToCockpit(page);
    await page.setViewportSize({ width: 1280, height: 1400 });

    // Host Scan tab: setup card has both a header (title) and a footer (Run Scan et al)
    await verifyTab(page, null, 'SCAP Security Scan', true, 'light');
    await page.screenshot({ path: SHOTS + 'card-divider-real-fix-light-host-scan-full.png', fullPage: true });

    // Policy Tailoring tab — two cards, both header-only (no CardFooter in either)
    await page.click('.pf-v6-c-tabs__link:has-text("Policy Tailoring")');
    await page.waitForTimeout(500);
    await verifyTab(page, null, 'New Tailoring Policy', false, 'light');
    await verifyTab(page, null, 'Saved Tailoring Policies', false, 'light');
    await page.screenshot({ path: SHOTS + 'card-divider-real-fix-light-tailoring-full.png', fullPage: true });
});

test('card header and footer dividers are full-width (dark mode)', async ({ page }) => {
    page.on('pageerror', err => console.log('[pageerror]', err.message));
    await page.emulateMedia({ colorScheme: 'dark' });
    await loginToCockpit(page);
    await page.setViewportSize({ width: 1280, height: 1400 });

    await verifyTab(page, null, 'SCAP Security Scan', true, 'dark');
    await page.screenshot({ path: SHOTS + 'card-divider-real-fix-dark-host-scan-full.png', fullPage: true });

    await page.click('.pf-v6-c-tabs__link:has-text("Policy Tailoring")');
    await page.waitForTimeout(500);
    await verifyTab(page, null, 'New Tailoring Policy', false, 'dark');
    await verifyTab(page, null, 'Saved Tailoring Policies', false, 'dark');
    await page.screenshot({ path: SHOTS + 'card-divider-real-fix-dark-tailoring-full.png', fullPage: true });
});
