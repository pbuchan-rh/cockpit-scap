// Shared helpers for the V4.6 specs (tests/v46-*.spec.js). Everything these
// create on the test host carries "v46-test" in its name, or is a scan
// directory recorded by snapshotScans() before the spec started, so
// cleanupCreated() only ever removes the spec's own artifacts.
const fs = require('fs');
const { expect } = require('@playwright/test');
const { hostSpawn } = require('./cockpit');

const DS = '/usr/share/xml/scap/ssg/content/ssg-rhel10-ds.xml';
const RULE = 'xccdf_org.ssgproject.content_rule_';
const PROFILE_L1 = 'xccdf_org.ssgproject.content_profile_cis_server_l1';
const TEST_TAILORING_NAME = 'v46-test CIS L1 set-value';
const TEST_TAILORED_PROFILE = 'xccdf_cockpit-scap_profile_v46-test-cis-l1-set-value';
// Deselected by the test tailoring: both are in CIS L1 and have bash fixes,
// so a tailoring-aware whole-profile fix has exactly 2 fewer fix blocks.
const DESELECTED = ['package_aide_installed', 'aide_build_database'];
// Automated rules (bash fix) with no Ansible task in SSG 0.1.81 RHEL 10.
const NO_ANSIBLE_RULES = ['use_pam_wheel_group_for_su', 'sshd_limit_user_access', 'ensure_root_password_configured',
    'ensure_journald_and_rsyslog_not_active_together', 'partition_for_tmp', 'grub2_password'];
const SET_VALUES = {
    var_password_pam_minlen: '18',
    var_accounts_passwords_pam_faillock_deny: '4',
};

async function homeDir(frame) {
    return frame.evaluate(async () => (await window.cockpit.user()).home);
}

async function snapshotScans(frame) {
    const home = await homeDir(frame);
    const out = await hostSpawn(frame, ['sh', '-c', `ls -1 "${home}/SCAP/scans" 2>/dev/null || true`]);
    return out.split('\n').filter(Boolean);
}

/* Writes the v46-test tailoring (XML + sidecar JSON, same shape
 * lib/tailoring.js writes) into ~/SCAP/tailoring. Returns its XML path. */
async function createTestTailoring(frame) {
    const home = await homeDir(frame);
    const dir = `${home}/SCAP/tailoring`;
    const base = `${dir}/v46-test-cis-l1-set-value-2026-10-14T00-00-00`;
    const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Tailoring xmlns="http://checklists.nist.gov/xccdf/1.2" id="xccdf_cockpit-scap_tailoring_default">',
        '  <version time="2026-10-14T00:00:00">1</version>',
        `  <Profile id="${TEST_TAILORED_PROFILE}" extends="${PROFILE_L1}">`,
        `    <title>${TEST_TAILORING_NAME}</title>`,
        '    <description>Created by the cockpit-scap V4.6 Playwright specs</description>',
        ...DESELECTED.map(r => `    <select idref="${RULE}${r}" selected="false"/>`),
        ...Object.entries(SET_VALUES).map(([v, val]) =>
            `    <set-value idref="xccdf_org.ssgproject.content_value_${v}">${val}</set-value>`),
        '  </Profile>',
        '</Tailoring>',
    ].join('\n');
    const sidecar = {
        name: TEST_TAILORING_NAME,
        base_profile_id: PROFILE_L1,
        base_profile_title: 'CIS Red Hat Enterprise Linux 10 Benchmark for Level 1 - Server',
        profile_id: TEST_TAILORED_PROFILE,
        sds_path: DS,
        path: `${base}.xml`,
        created: '2026-10-14T00-00-00',
        rules_modified: DESELECTED.length,
    };
    await frame.evaluate(async ({ dir, base, xml, sidecar }) => {
        const c = window.cockpit;
        await c.spawn(['mkdir', '-p', dir]);
        await c.spawn(['chmod', '700', dir]);
        await c.file(`${base}.xml`).replace(xml);
        await c.file(`${base}.json`).replace(JSON.stringify(sidecar, null, 2));
        await c.spawn(['chmod', '600', `${base}.xml`, `${base}.json`]);
    }, { dir, base, xml, sidecar });
    return `${base}.xml`;
}

async function snapshotTmp(frame) {
    const out = await hostSpawn(frame, ['sh', '-c', 'ls -1d /tmp/cockpit-scap-* 2>/dev/null || true']);
    return out.split('\n').filter(Boolean);
}

/* Removes the spec's own artifacts: scan dirs not in `before`, every
 * ~/SCAP file with "v46-test" in its name, and /tmp/cockpit-scap-* entries
 * (scan tmpdirs, staged downloads) not in `tmpBefore`. */
async function cleanupCreated(frame, before, tmpBefore = null) {
    if (tmpBefore) {
        const leftovers = (await snapshotTmp(frame)).filter(p => !tmpBefore.includes(p) && !p.endsWith('.rpm'));
        if (leftovers.length) await hostSpawn(frame, ['rm', '-rf', ...leftovers], { superuser: true });
    }
    const home = await homeDir(frame);
    const now = await snapshotScans(frame);
    const mine = now.filter(ts => !before.includes(ts));
    for (const ts of mine) {
        if (!/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d$/.test(ts)) continue;
        await hostSpawn(frame, ['rm', '-rf', `${home}/SCAP/scans/${ts}`]);
    }
    await hostSpawn(frame, ['find', `${home}/SCAP`, '-name', '*v46-test*', '-type', 'f', '-delete']);
    return mine;
}

/* Clicks something that should produce a download; returns {filename, text|buffer}. */
async function expectDownload(page, click, { binary = false } = {}) {
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        click(),
    ]);
    const p = await download.path();
    const buf = fs.readFileSync(p);
    return { filename: download.suggestedFilename(), buffer: buf, text: binary ? null : buf.toString('utf8') };
}

/* Runs a scan from the setup page and waits for the results page. */
async function runScan(frame, { profileId = PROFILE_L1, tailoringPath = null } = {}) {
    await frame.locator('#ct-scap-content').selectOption(DS);
    await expect(frame.locator('#ct-scap-profile')).toBeEnabled({ timeout: 60000 });
    await frame.locator('#ct-scap-profile').selectOption(profileId);
    if (tailoringPath) await frame.locator('#ct-scap-tailoring-select').selectOption(tailoringPath);
    const run = frame.getByRole('button', { name: 'Run Scan' });
    await expect(run).toBeEnabled({ timeout: 30000 });
    await run.click();
    await frame.locator('[data-ct-results]').waitFor({ timeout: 300000 });
}

/* Results page -> Remediation Builder drawer with a preset
 * ('critical' = "Critical & high (n)", 'all' = "All failures (n)"). */
async function openBuilder(frame, preset) {
    const name = preset === 'critical' ? /^Critical & high \(\d+\)$/ : /^All failures \(\d+\)$/;
    await frame.locator('[data-ct-results]').getByRole('button', { name })
            .click();
    const drawer = frame.locator('.ct-builder-drawer');
    await expect(drawer).toBeVisible();
    return drawer;
}

async function closeBuilder(frame) {
    await frame.getByRole('button', { name: 'Close Remediation Builder' }).click();
    await expect(frame.locator('.pf-v6-c-drawer.pf-m-expanded')).toHaveCount(0);
}

async function builderDownload(page, frame, fixType) {
    const name = fixType === 'bash' ? 'Download Bash script' : 'Download Ansible playbook';
    return expectDownload(page, () => frame.locator('.ct-builder-drawer').getByRole('button', { name })
            .click());
}

/* Results footer "Download ▾" -> item ('HTML report' | 'Results XML' | 'ARF'). */
async function resultsDownload(frame, item) {
    const results = frame.locator('[data-ct-results]');
    await results.locator('.ct-results-footer').getByRole('button', { name: 'Download', exact: true })
            .click();
    await frame.getByRole('menuitem', { name: new RegExp('^' + item) }).click();
}

/* var_* assignments in a generated fix: bash `var_x='14'` / Ansible vars
 * `var_x: !!str 14`. Returns Map name -> Set of values seen. */
function fixVariables(text, fixType) {
    const re = fixType === 'bash'
        ? /^\s*(var_[A-Za-z0-9_]+)=(.*)$/gm
        : /^\s*(var_[A-Za-z0-9_]+):\s*(.*)$/gm;
    const vars = new Map();
    for (const m of text.matchAll(re)) {
        if (!vars.has(m[1])) vars.set(m[1], new Set());
        vars.get(m[1]).add(m[2].trim());
    }
    return vars;
}

/* Compares every variable of `scoped` with `reference`. Returns
 * {compared, diffs:[{name, scoped, reference}]}. */
function diffVariables(scopedText, referenceText, fixType) {
    const s = fixVariables(scopedText, fixType);
    const r = fixVariables(referenceText, fixType);
    const diffs = [];
    for (const [name, vals] of s) {
        const ref = r.get(name);
        const sv = [...vals].sort().join('|');
        const rv = ref ? [...ref].sort().join('|') : '(absent from reference)';
        if (sv !== rv) diffs.push({ name, scoped: sv, reference: rv });
    }
    return { compared: s.size, diffs, values: Object.fromEntries([...s].map(([k, v]) => [k, [...v].join('|')])) };
}

function countFixBlocks(text) {
    return (text.match(/^# BEGIN fix/gm) || []).length;
}

module.exports = {
    DS, RULE, PROFILE_L1, TEST_TAILORING_NAME, TEST_TAILORED_PROFILE, DESELECTED, SET_VALUES, NO_ANSIBLE_RULES,
    homeDir, snapshotScans, snapshotTmp, createTestTailoring, cleanupCreated, expectDownload, runScan,
    openBuilder, closeBuilder, builderDownload, resultsDownload,
    fixVariables, diffVariables, countFixBlocks,
};
