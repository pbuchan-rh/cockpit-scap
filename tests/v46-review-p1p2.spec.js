// Release-gate findings P1 and P2 (job 4), both browser projects.
//   P1: Update on a tailoring file keeps every byte outside the root element
//       (declaration, comments, PIs, blank lines, line endings, final newline).
// The "unit" tests run src/lib code in a blank page (helpers/lib-bundle.js),
// no host. The others run INSIDE the Cockpit shell (/scap-dev); no scan.
// Everything they create carries "v46-test" in its name and is removed.
const { test, expect } = require('@playwright/test');
const { openModuleInShell, hostSpawn } = require('./helpers/cockpit');
const { loadLib } = require('./helpers/lib-bundle');
const S = require('./helpers/scap');

test.describe.configure({ mode: 'serial' });

const NS = 'http://checklists.nist.gov/xccdf/1.2';
const PROFILE = 'xccdf_org.cockpit-scap.test_profile_v46-test-p1p2';
const OTHER = 'xccdf_org.cockpit-scap.test_profile_v46-test-p1p2-other';

/* A two-profile root element; `nl` is the line ending inside it. */
const rootXml = (nl = '\n', title = 'v46-test p1p2') => [
    `<Tailoring xmlns="${NS}" id="xccdf_org.cockpit-scap.test_tailoring_v46-test">`,
    `  <benchmark href="${S.DS}"/>`,
    '  <version time="2026-10-20T00:00:00">1</version>',
    `  <Profile id="${PROFILE}">`,
    `    <title>${title}</title>`,
    `    <select idref="${S.RULE}package_aide_installed" selected="true"/>`,
    '  </Profile>',
    `  <Profile id="${OTHER}" extends="${S.PROFILE_L1}">`,
    '    <title>v46-test p1p2 other</title>',
    `    <select idref="${S.RULE}aide_build_database" selected="false"/>`,
    `    <select idref="${S.RULE}aide_periodic_cron_checking" selected="false"/>`,
    '  </Profile>',
    '</Tailoring>',
].join(nl);

const P1_CASES = {
    'declaration, leading comment, final newline': ['<?xml version="1.0" encoding="UTF-8"?>\n<!-- v46-test: leading -->\n', '\n'],
    'no declaration, no final newline': ['', ''],
    'declaration as written, blank lines': ["<?xml version='1.0' standalone='yes' ?>\n\n\n", '\n\n'],
    'CRLF line endings': ['<?xml version="1.0" encoding="UTF-8"?>\r\n<!-- v46-test -->\r\n', '\r\n<!-- after -->\r\n'],
    'comments and PIs after the root': [
        '<?xml version="1.0"?>\n<?xml-stylesheet type="text/xsl" href="a.xsl"?>\n<!-- a > b -->\n',
        '\n<!-- trailing </Tailoring> -->\n<?v46-test   spaced  data ?>\n\n',
    ],
    'DOCTYPE with an internal subset': ['<?xml version="1.0"?>\n<!DOCTYPE Tailoring [\n  <!ENTITY v46 "a > b">\n  <!-- ]> -->\n]>\n', '\n'],
};

test.describe('unit', () => {
    let page;
    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        await loadLib(page, 'tailoring.js');
    });
    test.afterAll(async () => { await page?.close() });

    const update = (xml, rules) => page.evaluate(([xml, profile, rules]) =>
        window.lib.updateTailoringXml(xml, profile, 'v46-test p1p2', rules, {}), [xml, PROFILE, rules]);

    for (const [name, [prefix, suffix]] of Object.entries(P1_CASES)) {
        test(`P1: ${name}: outside the root is byte-identical after Update`, async () => {
            const nl = name.startsWith('CRLF') ? '\r\n' : '\n';
            const xml = prefix + rootXml(nl) + suffix;
            const rules = { [`${S.RULE}package_aide_installed`]: false, [`${S.RULE}package_sudo_installed`]: true };
            const out = await update(xml, rules);
            expect(out.slice(0, prefix.length)).toBe(prefix);
            expect(out.slice(out.length - suffix.length)).toBe(suffix);
            const root = out.slice(prefix.length, out.length - suffix.length);
            expect(root.startsWith('<Tailoring ')).toBe(true);
            expect(root.endsWith('</Tailoring>')).toBe(true);
            // One declaration at most, the file's own.
            expect(out.split('<?xml ').length).toBe(xml.split('<?xml ').length);
            // Inside the root, as before: the edit is applied, the parser
            // turned CRLF into LF, nothing else changed.
            expect(root).toBe(rootXml('\n')
                    .replace(`package_aide_installed" selected="true"/>`,
                             `package_aide_installed" selected="false"/>\n    <select idref="${S.RULE}package_sudo_installed" selected="true"/>`));
            const parsed = await page.evaluate(([out, profile]) => ({
                error: new DOMParser().parseFromString(out, 'application/xml').getElementsByTagName('parsererror').length,
                rules: window.lib.parseTailoringXml(out, profile).ruleChanges,
            }), [out, PROFILE]);
            expect(parsed).toEqual({ error: 0, rules });
        });
    }

    test('P1: an Update that changes nothing returns the file unchanged', async () => {
        const xml = P1_CASES['comments and PIs after the root'].join(rootXml());
        expect(await update(xml, { [`${S.RULE}package_aide_installed`]: true })).toBe(xml);
    });

    test('P1: rootElementSpan finds the root past look-alikes', async () => {
        const docs = [
            // prefixed root, '>' and '/>' in attribute values, end tag with a space
            '<?xml version="1.0"?><x:Tailoring xmlns:x="u" a="1>2" b=\'/>\'><x:p/></x:Tailoring >\n',
            // the root's end tag inside a comment, CDATA and a nested PI
            '<!-- <a> --><a><!-- </a> --><![CDATA[</a>]]><?p </a> ?><b c="</a>"></b></a><!-- </a> -->',
            // a self-closing root
            '\n<a x="y"/>\n',
        ];
        const spans = await page.evaluate(docs => docs.map(d => window.lib.rootElementSpan(d)), docs);
        expect(spans.map((s, i) => docs[i].slice(...s))).toEqual([
            '<x:Tailoring xmlns:x="u" a="1>2" b=\'/>\'><x:p/></x:Tailoring >',
            '<a><!-- </a> --><![CDATA[</a>]]><?p </a> ?><b c="</a>"></b></a>',
            '<a x="y"/>',
        ]);
    });
});

test.describe('in the shell', () => {
    let page, frame, before, home;

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        frame = await openModuleInShell(page);
        home = await S.homeDir(frame);
        before = await S.snapshotScans(frame);
        await frame.getByRole('tab', { name: 'Policy Tailoring' }).click();
    });

    test.afterAll(async () => {
        if (frame) await S.cleanupCreated(frame, before);
        await page?.close();
    });

    const editor = () => frame.locator('.ct-tailor-editor-card');
    const bar = () => editor().locator('[data-ct-tailor-actionbar]');
    const policiesCard = () => frame.locator('.pf-v6-c-card').filter({ has: frame.getByRole('heading', { name: 'Saved Tailoring Policies' }) });
    const policyRow = name => policiesCard().locator('tbody tr')
            .filter({ has: frame.getByRole('gridcell', { name, exact: true }) });
    /* The host file's bytes, as base64 (keeps CR and the final newline). */
    const hostBytes = async glob => Buffer.from((await hostSpawn(frame, ['sh', '-c', `base64 -w0 ${glob}`])).trim(), 'base64');

    test('P1: Update on an uploaded file keeps the leading comment and the final newline', async () => {
        const name = 'v46-test p1p2 upload';
        const [prefix, suffix] = P1_CASES['declaration, leading comment, final newline'];
        const xml = prefix + rootXml('\n', name) + suffix;
        await policiesCard().locator('input[type=file]')
                .setInputFiles({ name: 'v46-test-p1p2.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) });
        const row = policyRow(name);
        await expect(row).toHaveCount(1, { timeout: 30000 });
        const glob = `"${home}"/SCAP/tailoring/v46-test-p1p2-upload-*.xml`;
        expect((await hostBytes(glob)).toString()).toBe(xml);

        await row.getByRole('button', { name: 'Edit' })
                .click();
        await expect(bar()).toContainText('1 rule, 0 variables modified', { timeout: 120000 });
        const search = editor().getByRole('textbox', { name: 'Search rules' });
        await search.fill('Install sudo Package');
        await editor().locator('.ct-tailor-tree input[type=checkbox]')
                .first()
                .click();
        await search.fill('');
        await expect(bar()).toContainText('2 rules, 0 variables modified');
        await bar().getByRole('button', { name: 'Update' })
                .click();
        await expect(editor().getByRole('heading', { name: 'New Tailoring Policy' })).toBeVisible();

        const out = (await hostBytes(glob)).toString();
        expect(out).not.toBe(xml);
        expect(out.slice(0, prefix.length)).toBe(prefix);
        expect(out.slice(out.length - suffix.length)).toBe(suffix);
        const root = out.slice(prefix.length, out.length - suffix.length);
        expect(root.startsWith('<Tailoring ')).toBe(true);
        expect(root.endsWith('</Tailoring>')).toBe(true);
        expect(root).toContain(`<select idref="${S.RULE}package_sudo_installed" selected="true"/>`);
        const info = await hostSpawn(frame, ['sh', '-c', `oscap info "$(ls ${glob})" >/dev/null 2>&1; echo rc=$?`]);
        expect(info.trim()).toBe('rc=0');
    });
});
