/** Optional Simple Summarizer integration; reads modern archives and legacy recaps. */
import { getRequestHeaders } from '../../../../../script.js';
import { createSummaryArchives } from './summarizer-archives.js';

const archives = createSummaryArchives({
    getAPI: () => globalThis.Summarizer,
    readFile: async filename => {
        const response = await fetch(`/user/files/${encodeURIComponent(filename)}`, {
            headers: getRequestHeaders(), cache: 'no-store',
        });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`Could not read Summarizer memory (${response.status}).`);
        return response.json();
    },
});

export function isSummarizerInstalled() {
    if (globalThis.Summarizer?.isInstalled) return true;
    try { return SillyTavern.getContext().extensionSettings?.summarizer !== undefined; }
    catch { return false; }
}

export function invalidateArchiveCache() { archives.invalidate(); }

/** List labels and metadata without reading every chat's full memory archive. */
export async function getComprehensiveSummaries(options = {}) {
    if (!isSummarizerInstalled()) return [];
    return archives.list(options, SillyTavern.getContext());
}

/** Resolve selected summaries to their current full text and quotes before generation. */
export async function loadComprehensiveSummary(reference) {
    const summary = await archives.load(reference);
    if (!summary?.text?.trim()) {
        throw new Error(`Summary "${reference.displayName}" is no longer available. Refresh the summary list.`);
    }
    return { ...reference, content: summary.text, quotes: Array.isArray(summary.quotes) ? summary.quotes : [] };
}
