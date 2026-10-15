// V4.6 list cards (Peter 2026-10-15): "N items · size" beside the title,
// no footer row, no divider between title and table, an Actions column
// header on every table, action links on the row text line, and history
// actions as View · Download · Delete links (Delete red). Read only: uses
// whatever history, policies and content the host already has.
const { test, expect } = require("@playwright/test");
const { openModuleInShell } = require("./helpers/cockpit");

let page, frame;
test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
});
test.afterAll(async () => { await page.close(); });

const CARDS = [
    { name: "history", tab: "Host Scan", title: "Scan History", links: ["View", "Download", "Delete"] },
    { name: "policies", tab: "Policy Tailoring", title: "Saved Tailoring Policies", links: ["Edit", "Download", "Delete"] },
    { name: "content", tab: "Policy Tailoring", title: "SCAP Content", links: null },
];

for (const c of CARDS) {
    test(`${c.name}: count beside the title, no footer, table right under the title, actions on the text line`, async ({ browserName }) => {
        await frame.getByRole("tab", { name: c.tab }).click();
        const card = frame.locator(".pf-v6-c-card", { has: frame.getByRole("heading", { name: c.title, exact: true }) });
        await card.locator("tbody tr").first().waitFor({ timeout: 30000 });
        await card.scrollIntoViewIfNeeded();

        const count = card.locator(".pf-v6-c-card__header .ct-list-count");
        await expect(count).toHaveText(/^\d+ items? · \d+(\.\d)? (B|KB|MB|GB)$/);
        const n = await card.locator("tbody tr").count();
        await expect(count).toHaveText(new RegExp(`^${n} item`));
        const t = await card.getByRole("heading", { name: c.title, exact: true }).boundingBox();
        const k = await count.boundingBox();
        expect(k.x).toBeGreaterThan(t.x + t.width);
        expect(Math.abs((k.y + k.height) - (t.y + t.height))).toBeLessThan(8); // same baseline-ish row

        await expect(card.locator(".pf-v6-c-card__footer")).toHaveCount(0);
        await expect(card.locator(":scope > hr, :scope > .pf-v6-c-divider")).toHaveCount(0);
        const head = await card.locator(".pf-v6-c-card__header").boundingBox();
        const thead = await card.locator("thead").boundingBox();
        expect(thead.y - (head.y + head.height)).toBeLessThanOrEqual(8);

        await expect(card.locator("thead th").last()).toHaveText("Actions");

        // Action links sit on the first text line of their row (within 3 px).
        const off = await card.locator("tbody tr").first().evaluate(tr => {
            const first = tr.querySelector("td");
            const r = document.createRange();
            r.selectNodeContents(first.querySelector("div") || first);
            const line = r.getClientRects()[0];
            const btn = [...tr.querySelectorAll(".ct-actions-cell button")].find(b => b.offsetParent);
            if (!btn) return 0;
            const b = btn.getBoundingClientRect();
            return Math.abs((b.top + b.bottom) / 2 - (line.top + line.bottom) / 2);
        });
        expect(off).toBeLessThanOrEqual(3);

        if (c.links) {
            const row = card.locator("tbody tr").first();
            const shown = await row.evaluate(tr => [...tr.querySelectorAll(".ct-actions-cell button")]
                    .filter(b => b.offsetParent).map(b => [b.textContent.trim(), getComputedStyle(b).color]));
            expect(shown.map(s => s[0])).toEqual(c.links);
            expect(shown[0][1]).toBe(shown[1][1]);
            expect(shown[2][1]).not.toBe(shown[0][1]); // Delete is red
        }
        await card.screenshot({ path: `tests/test-results/v46-phase4/tables-${c.name}-${browserName}.png` });
    });
}
