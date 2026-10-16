// V4.6 step 3, S2 (bug fix): the manual content path on Host Scan. Typed
// paths are checked only when the user is done (Enter, blur, ~1 s idle),
// with a cheap stat first; errors sit on the Content file field in plain
// words; Profile reads "Select content first"; the footer buttons are all
// disabled the same way; leaving manual mode restores detected content
// (Peter's stuck-error repro). INSIDE the Cockpit shell (/scap-dev). Reads
// only: /usr/shar (missing), /usr/share (folder), /etc/hosts (not SCAP).
const { test, expect } = require('@playwright/test');
const { openModuleInShell } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

const SHOTS = require('path').join(__dirname, 'test-results/v46-step3') + '/';
let page, frame, project;

test.beforeAll(async ({ browser }, info) => {
    project = info.project.name;
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    frame = await openModuleInShell(page);
    await expect(frame.locator('#ct-scap-profile option').nth(2)).toBeAttached({ timeout: 60000 });
});

test.afterAll(async () => {
    await page?.close();
});

const contentInput = () => frame.locator('input#ct-scap-content');
const contentSelect = () => frame.locator('select#ct-scap-content');
const contentGroup = () => frame.locator('.pf-v6-c-form__group').filter({ has: frame.locator('#ct-scap-content') });
const profileGroup = () => frame.locator('.pf-v6-c-form__group').filter({ has: frame.locator('#ct-scap-profile') });
const contentError = () => frame.locator('#ct-scap-content-error');
// PF appends screen-reader text (": error status;") to an error helper item.
const esc = t => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const errorText = msg => new RegExp(`^${esc(msg)}(: error status;)?$`);
const shot = name => page.screenshot({ path: `${SHOTS}s2-${name}-${project}.png` });

async function otherContent(item) {
    await frame.locator('#ct-scan-other-content').click();
    await frame.getByRole('menuitem', { name: item }).click();
}

/* Counts the module's own stat / oscap spawns from now on. */
async function countSpawns() {
    await frame.evaluate(() => {
        const c = window.cockpit;
        window.__ctSpawns = [];
        if (!c.__ctOrigSpawn) {
            c.__ctOrigSpawn = c.spawn;
            c.spawn = function (args, opts) {
                window.__ctSpawns?.push(args[0]);
                return c.__ctOrigSpawn.call(this, args, opts);
            };
        }
    });
}
const spawned = name => frame.evaluate(n => (window.__ctSpawns || []).filter(a => a === n).length, name);

async function expectProfileIdle() {
    const sel = frame.locator('#ct-scap-profile');
    await expect(sel).toBeDisabled();
    await expect(sel.locator('option:checked')).toHaveText('Select content first');
    await expect(sel).not.toHaveAttribute('aria-invalid', 'true');
    await expect(profileGroup().locator('.pf-v6-c-helper-text, .ct-field-error')).toHaveCount(0);
    await expect(frame.locator('.ct-profile-desc-col .ct-profile-desc-placeholder')).toHaveText('Select a profile to see its description.');
    await expect(frame.locator('.ct-profile-desc-col .pf-v6-c-spinner')).toHaveCount(0);
}

test('typing is not validated per keystroke; only after Enter / blur / idle', async () => {
    await otherContent(/Enter a path/);
    await expect(contentInput()).toBeVisible();
    await countSpawns();
    await contentInput().fill('');
    // 80 ms between keys: well under the 1 s idle.
    await contentInput().pressSequentially('/usr/shar', { delay: 80 });
    await expect(contentError()).toHaveCount(0);
    expect(await spawned('stat')).toBe(0);
    expect(await spawned('oscap')).toBe(0);
    // Idle: one check, after ~1 s, and oscap is never asked about a missing file.
    await expect(contentError()).toHaveText(errorText('No file at /usr/shar'), { timeout: 5000 });
    expect(await spawned('stat')).toBe(1);
    expect(await spawned('oscap')).toBe(0);
});

test('missing file: message on the Content file field, Profile "Select content first"', async () => {
    await contentInput().fill('/usr/shar');
    await contentInput().press('Enter');
    await expect(contentError()).toHaveText(errorText('No file at /usr/shar'));
    await expect(contentInput()).toHaveAttribute('aria-invalid', 'true');
    await expect(contentGroup().locator('.ct-content-error-details')).toHaveCount(0);
    await expectProfileIdle();
    await shot('missing');
});

test('folder: plain message on the Content file field', async () => {
    await contentInput().fill('/usr/share');
    await contentInput().press('Enter');
    await expect(contentError()).toHaveText(errorText('/usr/share is a folder. Choose a SCAP content file (.xml).'));
    await expectProfileIdle();
    await shot('folder');
});

test('not SCAP content: plain message plus collapsed Details without builddir noise', async () => {
    await contentInput().fill('/etc/hosts');
    await contentInput().blur();
    await expect(contentError()).toHaveText(errorText("This file isn't SCAP content that OpenSCAP can read."), { timeout: 30000 });
    const details = contentGroup().locator('.ct-content-error-details');
    await expect(details).toHaveCount(1);
    await expect(details.locator('.ct-content-error-text')).toBeHidden();
    await details.getByRole('button', { name: 'Details' }).click();
    const text = details.locator('.ct-content-error-text');
    await expect(text).toBeVisible();
    await expect(text).toContainText('/etc/hosts');
    expect(await text.innerText()).not.toMatch(/builddir|\.c:\d+\]/);
    await expectProfileIdle();
    await shot('not-scap');
});

test('while content is invalid, the three footer buttons are disabled the same way', async () => {
    const footer = frame.locator('.ct-setup-footer');
    const buttons = [
        footer.getByRole('button', { name: 'Run Scan' }),
        footer.getByRole('button', { name: 'View Compliance Guide' }),
        footer.locator('#ct-download-remediation-primary'),
    ];
    const looks = [];
    for (const b of buttons) {
        await expect(b).toBeDisabled();
        looks.push(await b.evaluate(el => {
            const cs = getComputedStyle(el);
            // PF draws button borders on ::after; a menu toggle has none.
            const visibleBorder = [cs, getComputedStyle(el, '::after')].some(st =>
                st.borderTopStyle !== 'none' && parseFloat(st.borderTopWidth) > 0 && !/rgba\(.*, 0\)$/.test(st.borderTopColor));
            return { color: cs.color, bg: cs.backgroundColor, opacity: cs.opacity, visibleBorder, aria: el.getAttribute('aria-disabled') };
        }));
    }
    expect(looks[1]).toEqual(looks[0]);
    expect(looks[2]).toEqual(looks[0]);
    await shot('footer-disabled');
});

test('a valid typed path loads its profiles', async () => {
    await contentInput().fill(S.DS);
    await contentInput().press('Enter');
    await expect(frame.locator('#ct-scap-profile')).toBeEnabled({ timeout: 60000 });
    await expect(contentError()).toHaveCount(0);
    await expect(frame.locator('#ct-scap-profile option', { hasText: 'CIS Red Hat Enterprise Linux 10 Benchmark for Level 1 - Server' })).toHaveCount(1);
});

test('Peter\'s repro: bad path, then "Use detected content" restores RHEL 10 with no detour', async () => {
    await contentInput().fill('/usr/shar');
    await contentInput().press('Enter');
    await expect(contentError()).toHaveText(errorText('No file at /usr/shar'));
    await shot('stuck-1-error');
    await otherContent('Use detected content');
    await expect(contentSelect()).toBeVisible();
    await expect(contentError()).toHaveCount(0);
    await expect(contentSelect()).toHaveValue(S.DS);
    await expect(contentSelect().locator('option:checked')).toHaveText('Red Hat Enterprise Linux 10');
    await expect(contentSelect()).not.toHaveAttribute('aria-invalid', 'true');
    await expect(frame.locator('#ct-scap-profile')).toBeEnabled({ timeout: 60000 });
    await expect(frame.locator('#ct-scap-profile option', { hasText: 'CIS Red Hat Enterprise Linux 10 Benchmark for Level 1 - Server' })).toHaveCount(1);
    await frame.locator('#ct-scap-profile').selectOption(S.PROFILE_L1);
    await expect(frame.locator('.ct-setup-footer').getByRole('button', { name: 'View Compliance Guide' })).toBeEnabled();
    await expect(frame.locator('.ct-profile-desc-col p').nth(1)).not.toHaveClass(/ct-profile-desc-placeholder/, { timeout: 30000 });
    await shot('stuck-2-restored');
});

test('a not-SCAP path then "Use detected content" also recovers', async () => {
    await otherContent(/Enter a path/);
    await contentInput().fill('/etc/hosts');
    await contentInput().press('Enter');
    await expect(contentError()).toHaveText(errorText("This file isn't SCAP content that OpenSCAP can read."), { timeout: 30000 });
    await otherContent('Use detected content');
    await expect(contentError()).toHaveCount(0);
    await expect(contentSelect()).toHaveValue(S.DS);
    await expect(frame.locator('#ct-scap-profile')).toBeEnabled({ timeout: 60000 });
});
