// Unit tests of src/lib code that needs a browser DOM (DOMParser,
// XMLSerializer): bundles a module with esbuild (the build's own bundler),
// `cockpit` stubbed, into a blank page as window.lib. No Cockpit host.
const path = require('path');
const esbuild = require('esbuild');

const cockpitStub = {
    name: 'cockpit-stub',
    setup(build) {
        build.onResolve({ filter: /^cockpit$/ }, () => ({ path: 'cockpit', namespace: 'stub' }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: 'export default { gettext: s => s, format: s => s, ngettext: (a, b, n) => (n === 1 ? a : b) };',
            loader: 'js',
        }));
    },
};

async function loadLib(page, entry) {
    const out = await esbuild.build({
        entryPoints: [path.join(__dirname, '../../src/lib', entry)],
        bundle: true,
        write: false,
        format: 'iife',
        globalName: 'lib',
        plugins: [cockpitStub],
        logLevel: 'silent',
    });
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: out.outputFiles[0].text });
}

module.exports = { loadLib };
