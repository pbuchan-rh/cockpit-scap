import React from 'react';

/* Renders lib/results.js richText() segments: rule descriptions keep their
 * inline commands as <code> and blocks as <pre> (R12), without innerHTML. */
export const RichText = ({ segments, className }) => {
    if (!segments?.length) return null;
    return (
        <div className={className}>
            {segments.map((s, i) => {
                switch (s.t) {
                case 'code': return <code key={i} className="ct-inline-code">{s.v}</code>;
                case 'pre': return <pre key={i} className="ct-rich-pre">{s.v}</pre>;
                case 'br': return <br key={i} />;
                default: return <React.Fragment key={i}>{s.v}</React.Fragment>;
                }
            })}
        </div>
    );
};
