// Results the Results page lists as their own groups, besides fail/error.
const LISTED_RESULTS = ['fail', 'error', 'notapplicable', 'notchecked'];

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

    return { scorePercent, ...counts, failingRules, otherRules, allRuleIds, header };
}
