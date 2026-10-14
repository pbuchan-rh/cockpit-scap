import cockpit from 'cockpit';

const _ = cockpit.gettext;

// Most severe first. Shared by the Results page and the Remediation Builder.
export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'unknown'];

export const SEVERITY_LABEL = {
    critical: _("Critical"),
    high: _("High"),
    medium: _("Medium"),
    low: _("Low"),
    unknown: _("Unknown"),
};

// PF Label colors. These are the content's own data (the rule severity),
// not an opinion about the score, so they stay (Amendment 2).
export const SEVERITY_COLOR = {
    critical: 'red',
    high: 'orange',
    medium: 'yellow',
    low: 'blue',
    unknown: 'grey',
};

export function isCriticalOrHigh(severity) {
    return severity === 'critical' || severity === 'high';
}

export function ruleShortId(fullId) {
    return fullId.replace(/^xccdf_[^_]+_rule_/, '');
}

/* One rule's display facts: the results file's own Benchmark (parsed in
 * lib/results.js, present for every saved scan) first, then the manifest's
 * rule_meta (absent in manifests before V4.2, refs absent before V4.6). */
export function ruleInfo(id, details, ruleMeta) {
    const d = details?.[id];
    const m = ruleMeta?.[id];
    const plain = text => text ? [{ t: 'text', v: text }] : [];
    const fixTypes = d ? d.fixTypes : (m?.automated ? ['bash', 'ansible'] : []);
    return {
        title: d?.title || m?.title || ruleShortId(id),
        cce: d?.cce || m?.cce || '',
        description: d?.description?.length ? d.description : plain(m?.description),
        rationale: d?.rationale?.length ? d.rationale : plain(m?.rationale),
        searchText: [d?.title || m?.title || '', d?.cce || m?.cce || '', ruleShortId(id)].join(' ')
                .toLowerCase(),
        refs: d?.refs?.length ? d.refs : (m?.refs || []),
        fixTypes,
        automated: fixTypes.length > 0,
    };
}

export function slugify(text) {
    return (text || '').toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
}
