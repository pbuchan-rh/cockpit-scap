// 4.6.2 round 2 (A): shared checks for the results' Expand all / Collapse
// all button, used on a saved fixture scan (v46-462-expand-all) and on a
// fresh real scan (v46-462-expand-fresh). They read whatever groups the
// results show: failing = severity groups and Errors; other = Not
// applicable / Not checked.
const { expect } = require('@playwright/test');

const FAILING_KEYS = ['critical', 'high', 'medium', 'low', 'unknown', 'error'];
const OTHER_KEYS = ['notapplicable', 'notchecked'];
const RULE = 'xccdf_org.ssgproject.content_rule_v46_test_';

const FIXTURE_RULES = {
    high: [{ id: 'high_a', title: 'v46-test high rule A' }, { id: 'high_b', title: 'v46-test high rule B' }],
    medium: [{ id: 'med_a', title: 'v46-test medium rule A' }, { id: 'med_b', title: 'v46-test medium rule Bravo' },
        { id: 'med_c', title: 'v46-test medium rule C' }],
    low: [{ id: 'low_a', title: 'v46-test low rule A' }],
    notapplicable: [{ id: 'na_a', title: 'v46-test n/a rule A' }, { id: 'na_b', title: 'v46-test n/a rule B' }],
};
const FIXTURE_FAILING = 6;

/* A minimal XCCDF 1.2 results file: the Benchmark's Rules (titles) and a
 * TestResult with one rule-result per fixture rule. */
function fixtureResultsXml() {
    const rules = [];
    const results = [];
    for (const [sev, list] of Object.entries(FIXTURE_RULES)) {
        for (const r of list) {
            rules.push(`<Rule id="${RULE}${r.id}" severity="${sev === 'notapplicable' ? 'medium' : sev}" selected="true">` +
                `<title>${r.title}</title><description>${r.title} description</description></Rule>`);
            results.push(`<rule-result idref="${RULE}${r.id}" severity="${sev === 'notapplicable' ? 'medium' : sev}">` +
                `<result>${sev === 'notapplicable' ? 'notapplicable' : 'fail'}</result></rule-result>`);
        }
    }
    return '<?xml version="1.0"?>\n<Benchmark xmlns="http://checklists.nist.gov/xccdf/1.2" id="xccdf_v46-test_benchmark">\n' +
        '<title>v46-test benchmark</title>\n' + rules.join('\n') + '\n' +
        '<TestResult id="xccdf_v46-test_testresult" start-time="2099-01-05T00:00:00+00:00" end-time="2099-01-05T00:00:10+00:00" version="0.1.81">\n' +
        '<rule-result idref="xccdf_org.ssgproject.content_rule_v46_test_pass"><result>pass</result></rule-result>\n' +
        results.join('\n') + '\n<score system="urn:xccdf:scoring:default" maximum="100">50</score>\n</TestResult>\n</Benchmark>\n';
}

const results = frame => frame.locator('[data-ct-results]');
const button = frame => results(frame).locator('.ct-rules-search-row')
        .getByRole('button', { name: /^(Expand|Collapse) all$/ });
const groupToggle = (frame, key) => results(frame).locator(`.ct-failing-group-${key} > .pf-v6-c-expandable-section__toggle > button`);
const ruleRows = (frame, key) => results(frame).locator(`.ct-failing-group-${key} .ct-rule-row`);

/* Keys of the groups shown, split into failing and other. */
async function shownGroups(frame) {
    const classes = await results(frame).locator('.ct-failing-group')
            .evaluateAll(els => els.map(e => e.className));
    const keys = classes.map(c => c.match(/ct-failing-group-([a-z]+)/)[1]);
    return { failing: keys.filter(k => FAILING_KEYS.includes(k)), other: keys.filter(k => OTHER_KEYS.includes(k)) };
}

async function failingRuleCount(frame) {
    return results(frame).locator('.ct-failing-group')
            .evaluateAll(
                (els, keys) => els.filter(e => keys.some(k => e.classList.contains(`ct-failing-group-${k}`)))
                        .reduce((n, e) => n + parseInt(e.querySelector('.pf-v6-c-label')?.textContent || '0', 10), 0),
                FAILING_KEYS);
}

async function expectDefault(frame) {
    await expect(button(frame)).toHaveText('Expand all');
    const { failing } = await shownGroups(frame);
    expect(failing.length).toBeGreaterThan(0);
    await expect(results(frame).locator('.ct-rule-row[aria-expanded="true"]')).toHaveCount(0);
}

async function expandAllAndCheck(frame) {
    const { failing, other } = await shownGroups(frame);
    const otherBefore = {};
    for (const k of other) otherBefore[k] = await groupToggle(frame, k).getAttribute('aria-expanded');
    const total = await failingRuleCount(frame);
    await button(frame).click();
    await expect(button(frame)).toHaveText('Collapse all');
    let rows = 0;
    for (const k of failing) {
        await expect(groupToggle(frame, k)).toHaveAttribute('aria-expanded', 'true');
        const n = await ruleRows(frame, k).count();
        expect(n).toBeGreaterThan(0);
        await expect(ruleRows(frame, k).and(frame.locator('[aria-expanded="true"]'))).toHaveCount(n);
        // each open row shows its own panel
        await expect(results(frame).locator(`.ct-failing-group-${k} .ct-rule-detail`)).toHaveCount(n);
        rows += n;
    }
    expect(rows).toBe(total);
    for (const k of other) {
        await expect(groupToggle(frame, k)).toHaveAttribute('aria-expanded', otherBefore[k]);
        if (otherBefore[k] === 'false') await expect(ruleRows(frame, k)).toHaveCount(0);
    }
    return { groups: failing, rows };
}

async function toggleOneRow(frame) {
    const { failing } = await shownGroups(frame);
    const row = ruleRows(frame, failing[failing.length - 1]).last();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await expect(button(frame)).toHaveText('Expand all');
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(button(frame)).toHaveText('Collapse all');
}

async function collapseAllAndCheck(frame) {
    const { failing, other } = await shownGroups(frame);
    // open the first other group by hand, so Collapse all has it to close
    if (other.length) {
        await groupToggle(frame, other[0]).click();
        await expect(groupToggle(frame, other[0])).toHaveAttribute('aria-expanded', 'true');
    }
    await expect(button(frame)).toHaveText('Collapse all');
    await button(frame).click();
    await expect(button(frame)).toHaveText('Expand all');
    for (const k of [...failing, ...other])
        await expect(groupToggle(frame, k)).toHaveAttribute('aria-expanded', 'false');
    await expect(results(frame).locator('.ct-rule-row')).toHaveCount(0);
}

async function keyboard(frame) {
    const { failing } = await shownGroups(frame);
    await expect(button(frame)).toHaveText('Expand all');
    await button(frame).focus();
    await frame.page().keyboard.press('Enter');
    await expect(button(frame)).toHaveText('Collapse all');
    await expect(groupToggle(frame, failing[0])).toHaveAttribute('aria-expanded', 'true');
    await expect(button(frame)).toBeFocused();
    await frame.page().keyboard.press('Space');
    await expect(button(frame)).toHaveText('Expand all');
    await expect(results(frame).locator('.ct-rule-row')).toHaveCount(0);
}

/* Search `term` (matches a rule of group `key`): that group shows open;
 * clearing restores the default open groups (critical/high, else the first
 * failing one) with Not applicable closed. */
async function searchStillWorks(frame, term, key) {
    const search = results(frame).getByRole('textbox', { name: 'Search rules' });
    await search.fill(term);
    await expect(groupToggle(frame, key)).toHaveAttribute('aria-expanded', 'true');
    await expect(ruleRows(frame, key)).toHaveCount(1);
    await search.fill('');
    const { failing, other } = await shownGroups(frame);
    const ch = failing.filter(k => k === 'critical' || k === 'high');
    const open = ch.length ? ch : [failing[0]];
    for (const k of failing)
        await expect(groupToggle(frame, k)).toHaveAttribute('aria-expanded', open.includes(k) ? 'true' : 'false');
    for (const k of other)
        await expect(groupToggle(frame, k)).toHaveAttribute('aria-expanded', 'false');
}

module.exports = {
    FIXTURE_RULES,
    FIXTURE_FAILING,
    fixtureResultsXml,
    expectDefault,
    expandAllAndCheck,
    toggleOneRow,
    collapseAllAndCheck,
    keyboard,
    searchStillWorks,
    shownGroups,
};
