// V4.6 step 3, scope A: OpenSCAP or SCAP content missing. REMOVES AND
// REINSTALLS PACKAGES (openscap-scanner, scap-security-guide and the
// dependent openscap-utils): ONLY against the disposable scap-apply10.
// afterAll reinstalls whatever was installed before, even on failure.
const { requireApplyHost, sshApplyHost, scpFromApplyHost } = require('./helpers/apply-host');
requireApplyHost();

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { openModuleInShell, COCKPIT_URL } = require('./helpers/cockpit');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

const SHOTS = path.join(__dirname, 'test-results/v46-step3');
fs.mkdirSync(SHOTS, { recursive: true });
const SHELL_PATH = process.env.SCAP_SHELL_PATH || '/scap-dev';
const PACKAGES = ['openscap-scanner', 'scap-security-guide', 'openscap-utils'];
const UPLOAD_NAME = 'v46-test-missing-deps-ds.xml';
const LOCAL_DS = path.join(SHOTS, UPLOAD_NAME);
const COMMAND = 'sudo dnf install openscap-scanner scap-security-guide';

let page, frame, project, installedBefore;

/* Installed packages of PACKAGES as exact NAME-VERSION-RELEASE. The Install
 * dialog (PackageKit) installs the newest version; the restore puts the
 * original versions back (dnf install of an older NEVRA downgrades). */
function installed() {
    const out = sshApplyHost(`rpm -q --qf '%{NAME}-%{VERSION}-%{RELEASE}\\n' ${PACKAGES.join(' ')} 2>/dev/null || true`);
    return out.split('\n').filter(l => PACKAGES.some(p => l.startsWith(p + '-')));
}
const names = list => list.map(n => PACKAGES.find(p => n.startsWith(p + '-') && /^\d/.test(n.slice(p.length + 1))));

function dnf(action, pkgs) {
    if (pkgs.length) sshApplyHost(`sudo -n dnf -y -q ${action} ${pkgs.join(' ')}`);
}
function restorePackages() {
    const now = installed();
    dnf('install', installedBefore.filter(n => !now.includes(n)));
}

async function reload() {
    await page.goto(COCKPIT_URL + SHELL_PATH);
    const iframe = page.locator(`iframe[name="cockpit1:localhost${SHELL_PATH}"]`);
    await iframe.waitFor({ state: 'attached', timeout: 30000 });
    frame = await (await iframe.elementHandle()).contentFrame();
    await frame.locator('.pf-v6-c-card').first()
            .waitFor({ timeout: 30000 });
}

async function shots(name) {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/${name}-light-${project}.png` });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/${name}-dark-${project}.png` });
    await page.emulateMedia({ colorScheme: 'light' });
}

const tab = name => frame.getByRole('tab', { name });
const card = title => frame.locator('.pf-v6-c-card').filter({ has: frame.getByRole('heading', { name: title, exact: true }) });

async function expectNoRawErrors() {
    const text = await frame.locator('body').innerText();
    expect(text).not.toMatch(/OpenSCAP Error|not-found|No such file|exit status|Failed to load/);
    // Only the module frame's own errors: the Cockpit shell around it throws
    // an unrelated "ee" on every login on this host, with or without oscap.
    expect(await frame.evaluate(() => window.__ctErrors || []), 'uncaught errors in the module').toEqual([]);
}

test.beforeAll(async ({ browser }, info) => {
    project = info.project.name;
    installedBefore = installed();
    expect(names(installedBefore), 'scanner and content installed at the start').toEqual(expect.arrayContaining(PACKAGES.slice(0, 2)));
    // A copy of the SSG datastream to upload once the package is gone.
    scpFromApplyHost(S.DS, LOCAL_DS);
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    // Records uncaught errors and unhandled rejections inside the module.
    await page.addInitScript(shellPath => {
        if (!location.pathname.includes(shellPath + '/')) return;
        window.__ctErrors = [];
        window.addEventListener('error', e => window.__ctErrors.push(String(e.message)));
        window.addEventListener('unhandledrejection', e => window.__ctErrors.push(String(e.reason?.message ?? e.reason)));
    }, SHELL_PATH);
    frame = await openModuleInShell(page);
});

test.afterAll(async () => {
    // Restore the original versions, even after a failure.
    restorePackages();
    sshApplyHost(`rm -f ~/SCAP/content/${UPLOAD_NAME}`);
    fs.rmSync(LOCAL_DS, { force: true });
    await page?.close();
    expect(installed()).toEqual(installedBefore);
});

test('OpenSCAP missing: one EmptyState per tab with the command; the lists still render', async () => {
    dnf('remove', PACKAGES.slice(0, 2));
    expect(installed()).toEqual([]);
    await reload();

    const scan = frame.locator('#ct-scan-oscap-missing');
    await expect(scan).toBeVisible({ timeout: 30000 });
    await expect(scan.getByRole('heading', { name: 'SCAP Security Scan' })).toBeVisible();
    await expect(scan.locator('.pf-v6-c-empty-state')).toHaveCount(1);
    await expect(scan.getByRole('heading', { name: 'OpenSCAP is not installed' })).toBeVisible();
    await expect(scan).toContainText('openscap-scanner');
    await expect(scan).toContainText('scap-security-guide');
    await expect(scan.locator('.ct-install-command code')).toHaveText(COMMAND);
    // PackageKit is on scap-apply10, and admin is on: Install offered.
    await expect(scan.getByRole('button', { name: 'Install', exact: true })).toBeEnabled({ timeout: 30000 });
    await expect(frame.locator('#ct-scap-content')).toHaveCount(0);
    await expect(frame.getByRole('button', { name: 'Run Scan' })).toHaveCount(0);
    await expect(card('Scan History')).toBeVisible();
    await expectNoRawErrors();
    await shots('oscap-missing-scan');

    await tab('Policy Tailoring').click();
    const tailor = frame.locator('#ct-tailor-oscap-missing');
    await expect(tailor).toBeVisible();
    await expect(tailor.getByRole('heading', { name: 'OpenSCAP is not installed' })).toBeVisible();
    await expect(tailor.locator('.ct-install-command code')).toHaveText(COMMAND);
    await expect(frame.locator('#ct-tailor-content-select')).toHaveCount(0);
    await expect(card('Saved Tailoring Policies')).toBeVisible();
    await expect(frame.locator('#ct-scap-content-card')).toBeVisible();
    await expectNoRawErrors();
    await shots('oscap-missing-tailoring');
    await tab('Host Scan').click();
});

test('Install (Cockpit install dialog) brings the forms back without a reload', async () => {
    const scan = frame.locator('#ct-scan-oscap-missing');
    await scan.getByRole('button', { name: 'Install', exact: true }).click();
    const dialog = frame.getByRole('dialog').filter({ hasText: 'Install software' });
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await expect(dialog).toContainText('openscap-scanner');
    await expect(dialog).toContainText('scap-security-guide');
    const install = dialog.getByRole('button', { name: 'Install', exact: true });
    await expect(install).toBeEnabled({ timeout: 300000 });
    await page.screenshot({ path: `${SHOTS}/install-dialog-${project}.png` });
    await install.click();
    await expect(dialog).toHaveCount(0, { timeout: 600000 });
    // Re-detected in place: the form, with this host's content and profiles.
    await expect(frame.locator('#ct-scan-oscap-missing')).toHaveCount(0, { timeout: 30000 });
    await expect(frame.locator('#ct-scap-content')).toHaveAttribute('data-ct-value', S.DS, { timeout: 30000 });
    await expect(frame.locator('#ct-scap-profile')).toBeEnabled({ timeout: 60000 });
    await tab('Policy Tailoring').click();
    await expect(frame.locator('#ct-tailor-content-select')).toBeVisible();
    await expect(frame.locator('#ct-tailor-oscap-missing')).toHaveCount(0);
    await tab('Host Scan').click();
    expect(names(installed())).toEqual(expect.arrayContaining(PACKAGES.slice(0, 2)));
    await expectNoRawErrors();
});

test('content missing: EmptyState with Install scap-security-guide and Upload content', async () => {
    dnf('remove', ['scap-security-guide']);
    sshApplyHost(`rm -f ~/SCAP/content/${UPLOAD_NAME}; ls ~/SCAP/content 2>/dev/null | grep . && exit 1 || true`);
    await reload();
    const empty = frame.locator('#ct-scan-no-content');
    await expect(empty).toBeVisible({ timeout: 30000 });
    await expect(empty.getByRole('heading', { name: 'No SCAP content installed' })).toBeVisible();
    await expect(empty.locator('.ct-install-command code')).toHaveText('sudo dnf install scap-security-guide');
    await expect(empty.getByRole('button', { name: 'Install scap-security-guide' })).toBeEnabled({ timeout: 30000 });
    await expect(empty.getByRole('button', { name: 'Upload content' })).toBeEnabled();
    await expect(frame.locator('#ct-scan-oscap-missing')).toHaveCount(0);
    await expect(frame.getByRole('button', { name: 'Run Scan' })).toHaveCount(0);
    await expectNoRawErrors();
    await shots('content-missing');

    // Upload content goes through the existing upload path.
    const chooser = page.waitForEvent('filechooser');
    await empty.getByRole('button', { name: 'Upload content' }).click();
    await (await chooser).setFiles(LOCAL_DS);
    await expect(frame.locator('#ct-scan-no-content')).toHaveCount(0, { timeout: 120000 });
    await expect(frame.locator('#ct-scap-content')).toHaveText('v46-test-missing-deps-ds');
    await expect(frame.locator('#ct-scap-profile')).toBeEnabled({ timeout: 60000 });
    await expectNoRawErrors();
});

test('after reinstalling with dnf, the form is back on reload', async () => {
    sshApplyHost(`rm -f ~/SCAP/content/${UPLOAD_NAME}`);
    restorePackages();
    await reload();
    await expect(frame.locator('#ct-scap-content')).toHaveAttribute('data-ct-value', S.DS, { timeout: 30000 });
    await expect(frame.locator('#ct-scan-no-content, #ct-scan-oscap-missing')).toHaveCount(0);
    await expect(frame.locator('#ct-scap-profile')).toBeEnabled({ timeout: 60000 });
    expect(installed()).toEqual(installedBefore);
    await expectNoRawErrors();
});
