// Results the Results page lists as their own groups, besides fail/error.
const LISTED_RESULTS = ['fail', 'error', 'notapplicable', 'notchecked'];

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

// Framework references shown as chips on an expanded rule, in this order
// (href substring -> label; ported from main's PY_EXTRACT_FAILING_RULES
// REF_KEEP in index.js). Everything else (COBIT, ISA, HIPAA, ...) is left
// out, as in v3.
export const REF_KEEP = [
    ['cisecurity.org/benchmark', 'CIS Benchmark'],
    ['cisecurity.org/controls', 'CIS Controls'],
    ['800-53', 'NIST 800-53'],
    ['800-171', 'NIST 800-171'],
    ['cswp', 'NIST CSF'],
    ['pcisecuritystandards.org', 'PCI-DSS'],
    ['docs-prv.pci', 'PCI-DSS'],
    ['cyber.mil/stigs', 'DISA'],
    ['iase.disa.mil', 'DISA'],
];

/* <reference href=...>text</reference> list -> [{label, values}] in
 * REF_KEEP order. Shared with the saved rule_meta (lib/tailoring.js
 * extracts the same {href, text} pairs at save time). */
export function groupReferences(refs) {
    const byLabel = new Map();
    for (const { href, text } of refs) {
        if (!text) continue;
        const hl = (href || '').toLowerCase();
        const hit = REF_KEEP.find(([pat]) => hl.includes(pat));
        if (!hit) continue;
        if (!byLabel.has(hit[1])) byLabel.set(hit[1], []);
        byLabel.get(hit[1]).push(text);
    }
    const order = [...new Set(REF_KEEP.map(([, l]) => l))];
    return order.filter(l => byLabel.has(l)).map(label => ({ label, values: byLabel.get(label) }));
}

/* XCCDF description/rationale (XHTML mixed content) -> flat segments the
 * UI renders without innerHTML: {t:'text'|'code'|'pre', v} and {t:'br'}.
 * Inline commands (<html:code>, <html:pre>) stay code (R12); an
 * <xccdf:sub idref> is replaced by the value the scan used. */
export function richText(el, values) {
    const out = [];
    const push = (t, v) => {
        if (t === 'text' && out.length && out[out.length - 1].t === 'text') out[out.length - 1].v += v;
        else out.push(v === undefined ? { t } : { t, v });
    };
    const flat = node => {
        let s = '';
        for (const c of node.childNodes) {
            if (c.nodeType === 3) s += c.nodeValue;
            else if (c.nodeType === 1 && c.localName === 'sub') s += subValue(c);
            else if (c.nodeType === 1) s += flat(c);
        }
        return s;
    };
    const subValue = c => {
        const id = c.getAttribute('idref') || '';
        return values[id] ?? id.replace(/^xccdf_[^_]+_value_/, '');
    };
    const walk = node => {
        for (const c of node.childNodes) {
            if (c.nodeType === 3) {
                push('text', c.nodeValue.replace(/\s+/g, ' '));
            } else if (c.nodeType === 1) {
                const name = c.localName;
                if (name === 'sub') push('code', subValue(c));
                else if (name === 'code' || name === 'tt' || name === 'kbd') push('code', flat(c).replace(/\s+/g, ' ')
                        .trim());
                else if (name === 'pre') push('pre', flat(c).replace(/^\n+|\s+$/g, ''));
                else if (name === 'br') push('br');
                else if (c.namespaceURI === XHTML_NS && ['p', 'li', 'ul', 'ol', 'div', 'table', 'tr'].includes(name)) {
                    if (out.length) push('br');
                    if (name === 'li') push('text', '• ');
                    walk(c);
                } else {
                    walk(c);
                }
            }
        }
    };
    if (el) walk(el);
    // Trim leading/trailing whitespace-only text.
    if (out[0]?.t === 'text') out[0].v = out[0].v.trimStart();
    const last = out[out.length - 1];
    if (last?.t === 'text') last.v = last.v.trimEnd();
    return out.filter(seg => seg.t !== 'text' || seg.v !== '');
}

function richToPlain(segs) {
    return segs.map(s => s.t === 'br' ? ' ' : s.v).join('')
            .replace(/\s+/g, ' ')
            .trim();
}

/* Per-rule facts for the listed rules, read from the Benchmark that oscap
 * embeds in its --results file. Works for every saved scan, including
 * those whose manifest predates rule_meta. */
function ruleDetails(doc, ids, values) {
    const wanted = new Set(ids);
    const out = {};
    for (const rule of doc.getElementsByTagNameNS('*', 'Rule')) {
        const id = rule.getAttribute('id');
        if (!wanted.has(id)) continue;
        let title = '';
        let cce = '';
        let description = [];
        let rationale = [];
        const refs = [];
        const fixes = new Set();
        for (const c of rule.children) {
            switch (c.localName) {
            case 'title': title = c.textContent.trim(); break;
            case 'description': description = richText(c, values); break;
            case 'rationale': rationale = richText(c, values); break;
            case 'ident':
                if (!cce && /cce/i.test(c.getAttribute('system') || '')) cce = c.textContent.trim();
                break;
            case 'reference': refs.push({ href: c.getAttribute('href'), text: c.textContent.trim() }); break;
            case 'fix': {
                const sys = c.getAttribute('system') || '';
                if (/script:sh$/.test(sys)) fixes.add('bash');
                else if (/script:ansible$/.test(sys)) fixes.add('ansible');
                break;
            }
            default: break;
            }
        }
        out[id] = {
            title,
            cce,
            description,
            rationale,
            descriptionText: richToPlain(description),
            refs: groupReferences(refs),
            fixTypes: [...fixes],
        };
    }
    return out;
}

export function parseResults(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');

    if (doc.querySelector('parsererror'))
        throw new Error('Failed to parse XCCDF results XML');

    const testResult = doc.querySelector('TestResult');
    const scoreEl = testResult?.querySelector('score');
    const scorePercent = scoreEl ? Math.round(parseFloat(scoreEl.textContent)) : null;

    const counts = {
        pass: 0,
        fail: 0,
        error: 0,
        notapplicable: 0,
        unknown: 0,
        informational: 0,
        notchecked: 0,
        notselected: 0,
    };
    const failingRules = [];
    const otherRules = { notapplicable: [], notchecked: [] };
    // Every rule-result idref, whatever its result (notselected included):
    // generateScopedFix() deselects all of these but the wanted ones.
    const allRuleIds = [];

    for (const rr of doc.querySelectorAll('rule-result')) {
        const result = rr.querySelector('result')?.textContent?.trim() ?? 'unknown';
        if (result in counts) counts[result]++;
        else counts.unknown++;
        const id = rr.getAttribute('idref') ?? '';
        if (id) allRuleIds.push(id);

        if (LISTED_RESULTS.includes(result)) {
            const entry = { id, severity: rr.getAttribute('severity') ?? 'unknown', result };
            if (result === 'fail' || result === 'error') failingRules.push(entry);
            else otherRules[result].push(entry);
        }
    }

    // Header facts straight from the results file, so saved scans from
    // before V4.6 (whose manifests lack them) get the same header.
    const header = {
        startTime: testResult?.getAttribute('start-time') ?? null,
        endTime: testResult?.getAttribute('end-time') ?? null,
        contentVersion: testResult?.getAttribute('version') ?? null,
        testedProfileId: testResult?.querySelector('profile')?.getAttribute('idref') ?? null,
        benchmarkTitle: doc.documentElement.querySelector(':scope > title')?.textContent?.trim() ?? null,
    };

    // Values the scan used (TestResult <set-value>), for <sub> in texts.
    const values = {};
    for (const sv of testResult?.getElementsByTagNameNS('*', 'set-value') ?? [])
        values[sv.getAttribute('idref')] = sv.textContent;
    const listedIds = [...failingRules, ...otherRules.notapplicable, ...otherRules.notchecked].map(r => r.id);
    const details = ruleDetails(doc, listedIds, values);

    return { scorePercent, ...counts, failingRules, otherRules, allRuleIds, header, details };
}
