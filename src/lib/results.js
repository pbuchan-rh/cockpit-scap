export function parseResults(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');

    if (doc.querySelector('parsererror'))
        throw new Error('Failed to parse XCCDF results XML');

    const scoreEl = doc.querySelector('TestResult score');
    const scorePercent = scoreEl ? Math.round(parseFloat(scoreEl.textContent)) : null;

    const counts = {
        pass: 0, fail: 0, error: 0,
        notapplicable: 0, unknown: 0,
        informational: 0, notchecked: 0, notselected: 0,
    };
    const failingRules = [];

    for (const rr of doc.querySelectorAll('rule-result')) {
        const result = rr.querySelector('result')?.textContent?.trim() ?? 'unknown';
        if (result in counts) counts[result]++;
        else counts.unknown++;

        if (result === 'fail' || result === 'error') {
            failingRules.push({
                id: rr.getAttribute('idref') ?? '',
                severity: rr.getAttribute('severity') ?? 'unknown',
                result,
            });
        }
    }

    return { scorePercent, ...counts, failingRules };
}
