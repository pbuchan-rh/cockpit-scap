// Opens a same-origin popup now (synchronous, avoids popup-blocker), then
// resolves htmlPromise and hands the HTML off via IndexedDB to viewer.html,
// which writes it into its own page. The report's styles apply there; its
// scripts are blocked by the package CSP on purpose (see viewer.js).
//
// Returns false if the popup was blocked, so the caller can surface a
// visible error instead of the underlying fetch resolving successfully with
// nothing to show for it (which looks exactly like "clicked the button and
// nothing happened").
export function openReportViewer(htmlPromise) {
    const popup = window.open('about:blank', '_blank');
    if (!popup) return false;
    const viewerUrl = new URL('viewer.html', window.location.href).href;

    htmlPromise.then(html => {
        const blob = new Blob([html], { type: 'text/html' });
        const req = indexedDB.open('cockpit-scap', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('reports');
        req.onerror = () => popup.close();
        req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('reports', 'readwrite');
            tx.objectStore('reports').put(blob, 'current');
            tx.oncomplete = () => { db.close(); popup.location = viewerUrl };
        };
    }).catch(() => popup.close());
    return true;
}
