/* Time-left estimate for the running scan (U1). Pure functions; the
 * running view keeps the state between its 1 s ticks.
 *
 * With a prior scan (same content, profile and tailoring) the estimate is
 * that scan's duration, counted down in real time, as v3 did. Without one
 * it comes from the rule rate, but oscap's rule times are very uneven (most
 * are instant, a few walk the file system for seconds), so a raw
 * elapsed / done * left would climb during every slow rule and drop on the
 * next burst. Instead the estimate is an end time: between rule completions
 * it simply counts down, and a completion only moves it when the new figure
 * is clearly higher (RAISE_FACTOR and RAISE_MIN_S both met); a faster scan
 * just reaches "Finishing…" sooner. */

export const RAISE_FACTOR = 1.2;
export const RAISE_MIN_S = 15;
// A prior scan's estimate is dropped once the scan has run this much longer.
export const PRIOR_GIVE_UP = 1.5;
// The rate estimate waits for this many rules and seconds.
const RATE_MIN_RULES = 5;
const RATE_MIN_SECONDS = 3;

/* Estimate from the prior scan's duration:
 * { remaining (s, >= 0), fraction (0..1) }, or null once the scan has run
 * PRIOR_GIVE_UP times as long (elapsed only from then on). */
export function priorEstimate(priorDuration, elapsedS) {
    if (elapsedS >= priorDuration * PRIOR_GIVE_UP) return null;
    return {
        remaining: Math.max(0, priorDuration - elapsedS),
        fraction: Math.min(1, elapsedS / priorDuration),
    };
}

/* Next rate-estimate state. `state` is { endAt (ms) | null, done } from the
 * previous call (or null). The end time is only (re)computed when `done`
 * changed, i.e. on rule completions. */
export function nextRateState(state, { now, startedAt, done, total }) {
    const prev = state || { endAt: null, done: 0 };
    if (!total || done === prev.done) return prev;
    const elapsedS = (now - startedAt) / 1000;
    if (done < RATE_MIN_RULES || elapsedS < RATE_MIN_SECONDS) return { ...prev, done };

    // Average over every rule so far (slow ones included), blended with
    // the end time already shown.
    const fresh = elapsedS / done * Math.max(0, total - done);
    if (prev.endAt === null) return { endAt: now + fresh * 1000, done };
    const shown = Math.max(0, (prev.endAt - now) / 1000);
    const smoothed = (shown + fresh) / 2;
    if (smoothed > shown * RAISE_FACTOR && smoothed > shown + RAISE_MIN_S)
        return { endAt: now + smoothed * 1000, done };
    return { ...prev, done };
}

/* { remaining, fraction } shown for a rate state, or null before the
 * first estimate. */
export function rateEstimate(state, { now, startedAt }) {
    if (!state || state.endAt === null) return null;
    const remaining = Math.max(0, (state.endAt - now) / 1000);
    const elapsedS = Math.max(0, (now - startedAt) / 1000);
    return { remaining, fraction: elapsedS + remaining > 0 ? elapsedS / (elapsedS + remaining) : 0 };
}
