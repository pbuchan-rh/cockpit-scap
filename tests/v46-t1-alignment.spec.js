// UAT batch 1, T1: table alignment on all three list tables (Scan History,
// Saved Tailoring Policies, SCAP Content), INSIDE the Cockpit shell
// (/scap-dev), both browser projects, at 1280, 1440 and 1920 px windows.
// - Actions: as narrow as its contents and flush to the table's right
//   edge; the header LEFT-aligned over the first link, the links starting
//   at that same edge (a lone Delete too).
// - Numbers right-aligned under right-aligned headers (Score, Passed,
//   Failed, Rules Modified, Size); Score / Passed / Failed equally wide;
//   the score's % values line up whatever change marker follows them.
// - Text and date columns left-aligned; Profile / Base Profile / Name take
//   the remaining width.
// Fixtures as in v46-u4-tables (fabricated scans with and without a score
// change, the v46-test policy, an uploaded content copy), removed again.
const { test, expect } = require('@playwright/test');
const { openModuleInShell, hostSpawn } = require('./helpers/cockpit');
const S = require('./helpers/scap');

const TABLES = {
    'Scan history': { tab: 'Host Scan', numeric: ['Score', 'Passed', 'Failed'], stretch: ['Profile'] },
    'Saved tailoring policies': { tab: 'Policy Tailoring', numeric: ['Rules Modified'], stretch: ['Name', 'Base Profile'] },
    'SCAP content': { tab: 'Policy Tailoring', numeric: ['Size'], stretch: ['Name'] },
};
const SIZES = [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1280, height: 900 }];

let page, frame, before, tmpBefore;

test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    frame = await openModuleInShell(page);
    before = await S.snapshotScans(frame);
    tmpBefore = await S.snapshotTmp(frame);
    const home = await S.homeDir(frame);
    // Same profile and tailoring: 2099-01-02 shows "▲14" vs 2099-01-01;
    // 2099-01-03 (other tailoring) shows no marker; 2099-01-04 shows ±0.
    const base = { profile_id: 'xccdf_cockpit-scap_profile_v46-test-t1', base_profile_id: S.PROFILE_L1, sds_file: S.DS, rule_meta: {} };
    const scans = [
        ['2099-01-01T00-00-00', 64, 'v46-test T1 policy'],
        ['2099-01-02T00-00-00', 78, 'v46-test T1 policy'],
        ['2099-01-03T00-00-00', 9, 'v46-test T1 other policy'],
        ['2099-01-04T00-00-00', 78, 'v46-test T1 policy'],
    ];
    for (const [ts, score, policy] of scans) {
        const dir = `${home}/SCAP/scans/${ts}`;
        await hostSpawn(frame, ['mkdir', '-p', dir]);
        const manifest = {
            ...base,
            timestamp: ts,
            score,
            counts: { pass: score * 3, fail: 300 - score * 3 },
            profile_title: policy,
            tailoring_file: policy,
            tailoring_path: `/nonexistent/${policy}.xml`,
        };
        await frame.evaluate(async ({ dir, manifest }) => {
            await window.cockpit.file(`${dir}/manifest.json`).replace(JSON.stringify(manifest, null, 2));
        }, { dir, manifest });
    }
    await S.createTestTailoring(frame);
    await hostSpawn(frame, ['sh', '-c', `mkdir -p "${home}/SCAP/content" && cp "${S.DS}" "${home}/SCAP/content/v46-test-t1-ds.xml"`]);
    await page.reload();
    frame = await (await page.locator('iframe[name^="cockpit1:localhost/scap-dev"]').elementHandle()).contentFrame();
    await frame.locator('table[aria-label="Scan history"] tbody tr').first()
            .waitFor({ timeout: 30000 });
});

test.afterAll(async () => {
    if (frame) await S.cleanupCreated(frame, before, tmpBefore);
    await page?.close();
});

/* Geometry of one table: header cells by name, per-row action rects, and
 * the text extents of every cell, read in the page. */
function measure(label) {
    const table = document.querySelector(`table[aria-label="${label}"]`);
    const tr = table.getBoundingClientRect();
    const shown = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    // Extent of an element's text (all text nodes, ignoring whitespace).
    const textBox = el => {
        const range = document.createRange();
        const rects = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.textContent.trim()) continue;
            range.selectNodeContents(n);
            rects.push(...range.getClientRects());
        }
        if (!rects.length) return null;
        return { left: Math.min(...rects.map(r => r.left)), right: Math.max(...rects.map(r => r.right)) };
    };
    const ths = [...table.querySelectorAll('thead th')].filter(shown);
    const heads = ths.map((th, i) => ({
        name: th.textContent.trim(),
        index: [...th.parentNode.children].indexOf(th),
        left: th.getBoundingClientRect().left,
        right: th.getBoundingClientRect().right,
        width: th.getBoundingClientRect().width,
        align: getComputedStyle(th).textAlign,
        text: textBox(th),
        padEnd: parseFloat(getComputedStyle(th).paddingInlineEnd),
        padStart: parseFloat(getComputedStyle(th).paddingInlineStart),
    }));
    const rows = [...table.querySelectorAll('tbody tr')].map(row => {
        const cells = [...row.children];
        const out = { source: row.dataset.ctSource || null, cells: {} };
        for (const h of heads) {
            const td = cells[h.index];
            out.cells[h.name] = { text: textBox(td), align: getComputedStyle(td).textAlign, content: td.textContent.trim() };
        }
        const actions = [...row.querySelectorAll('.ct-actions-cell button')].filter(shown)
                .map(b => ({ name: b.textContent.trim(), left: b.getBoundingClientRect().left, right: b.getBoundingClientRect().right }));
        out.actions = actions;
        // The score's "%" text alone (first text node with a %).
        const score = h => h.name === 'Score';
        if (heads.some(score)) {
            const td = cells[heads.find(score).index];
            const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                const i = n.textContent.indexOf('%');
                if (i < 0) continue;
                const range = document.createRange();
                range.setStart(n, i);
                range.setEnd(n, i + 1);
                out.percentRight = range.getBoundingClientRect().right;
                break;
            }
        }
        return out;
    });
    return { table: { left: tr.left, right: tr.right, width: tr.width }, heads, rows };
}

for (const size of SIZES) {
    for (const [label, spec] of Object.entries(TABLES)) {
        test(`${size.width}px ${label}: Actions fit-content and flush right, header and links left; numbers right; stretch columns`, async () => {
            await page.setViewportSize(size);
            await frame.getByRole('tab', { name: spec.tab }).click();
            const table = frame.locator(`table[aria-label="${label}"]`);
            await table.locator('tbody tr').first()
                    .waitFor({ timeout: 30000 });
            if (label === 'SCAP content')
                await expect(table.locator('tbody tr').filter({ hasText: 'v46-test-t1-ds.xml' })).toHaveCount(1, { timeout: 30000 });
            await page.waitForTimeout(500);
            const m = await frame.evaluate(measure, label);
            const head = name => m.heads.find(h => h.name === name);
            const problems = [];

            // Actions: last column, flush with the table's right edge.
            const act = head('Actions');
            expect(m.heads[m.heads.length - 1].name).toBe('Actions');
            if (Math.abs(act.right - m.table.right) > 1) problems.push(`Actions column ends at ${act.right}, table at ${m.table.right}`);
            if (!['start', 'left'].includes(act.align)) problems.push(`Actions header text-align ${act.align}`);
            // Fit-content: no wider than its widest content (or the header) plus padding.
            const widest = Math.max(act.text.right - act.text.left,
                                    ...m.rows.filter(r => r.actions.length)
                                            .map(r => r.actions[r.actions.length - 1].right - r.actions[0].left));
            if (act.width > widest + act.padStart + act.padEnd + 2) problems.push(`Actions column ${act.width.toFixed(0)} px for ${widest.toFixed(0)} px of content`);
            // Header text and every row's first link start at the same x.
            for (const [i, r] of m.rows.entries()) {
                if (!r.actions.length) continue;
                if (Math.abs(r.actions[0].left - act.text.left) > 2)
                    problems.push(`row ${i} first action "${r.actions[0].name}" at ${r.actions[0].left.toFixed(0)}, header text at ${act.text.left.toFixed(0)}`);
            }

            // Numeric columns: header and values right-aligned, flush right.
            for (const name of spec.numeric) {
                const h = head(name);
                // Passed / Failed only show from xl (U4): not at 1280.
                if (!h && ['Passed', 'Failed'].includes(name) && size.width < 1440) continue;
                if (!h) { problems.push(`no ${name} column`); continue }
                if (!['end', 'right'].includes(h.align)) problems.push(`${name} header text-align ${h.align}`);
                for (const [i, r] of m.rows.entries()) {
                    const c = r.cells[name];
                    if (!['end', 'right'].includes(c.align)) problems.push(`${name} row ${i} text-align ${c.align}`);
                    if (name !== 'Score' && c.text && Math.abs(c.text.right - h.text.right) > 2)
                        problems.push(`${name} row ${i} ends at ${c.text.right.toFixed(0)}, header at ${h.text.right.toFixed(0)}`);
                }
            }
            if (label === 'Scan history') {
                const w = ['Score', 'Passed', 'Failed'].filter(head)
                        .map(n => head(n).width);
                if (size.width >= 1440 && w.length !== 3) problems.push('Passed / Failed missing');
                if (Math.max(...w) - Math.min(...w) > 1) problems.push(`Score/Passed/Failed widths ${w.map(x => x.toFixed(0)).join('/')}`);
                // The % values line up, marker or not.
                const pr = m.rows.map(r => r.percentRight).filter(x => x !== undefined);
                if (Math.max(...pr) - Math.min(...pr) > 1) problems.push(`% right edges spread ${Math.min(...pr).toFixed(1)}..${Math.max(...pr).toFixed(1)}`);
                // The fixtures give rows with "▲14", "±0" and no marker.
                expect(m.rows.some(r => r.cells.Score.content.includes('±0'))).toBe(true);
            }

            // Text and date columns left-aligned.
            for (const h of m.heads) {
                if (spec.numeric.includes(h.name) || h.name === 'Actions') continue;
                if (!['start', 'left'].includes(h.align)) problems.push(`${h.name} header text-align ${h.align}`);
            }
            // The other text and date columns are as narrow as their
            // contents, so the stretch columns get all the slack ...
            for (const h of m.heads) {
                if (spec.stretch.includes(h.name) || spec.numeric.includes(h.name) || h.name === 'Actions') continue;
                const widest = Math.max(h.text.right - h.text.left, ...m.rows.map(r => r.cells[h.name].text)
                        .filter(Boolean)
                        .map(t => t.right - t.left));
                if (h.width > widest + h.padStart + h.padEnd + 2) problems.push(`${h.name} column ${h.width.toFixed(0)} px for ${widest.toFixed(0)} px of content`);
            }
            // ... and on a wide window they are the widest columns.
            if (size.width >= 1920) {
                const others = m.heads.filter(h => !spec.stretch.includes(h.name));
                for (const name of spec.stretch) {
                    const h = head(name);
                    for (const o of others)
                        if (o.width >= h.width) problems.push(`${o.name} (${o.width.toFixed(0)} px) not narrower than ${name} (${h.width.toFixed(0)} px)`);
                }
            }
            expect(problems).toEqual([]);
        });
    }
}
