/** Index-only browsing with full recaps loaded only when selected for generation. */
const LEGACY_FILE = 'archive_summarizer.json';
const normalizeFilename = value => String(value || '').replace(/\.jsonl$/i, '');
const characterName = (entry, filename) => entry.metadata?.character?.name
    || entry.metadata?.character?.displayName
    || filename.match(/^(.+?)\s*-\s*\d/)?.[1]?.trim() || 'Unknown';
const entryOwner = entry => entry.identity?.owner
    || (entry.metadata?.character?.avatar ? `character:${entry.metadata.character.avatar}` : '');

export function createSummaryArchives({ readFile, getAPI = () => null, now = Date.now }) {
    const cache = new Map();

    function cached(key, load) {
        const existing = cache.get(key);
        if (existing && now() - existing.time < 30_000) return existing.promise;
        const record = { time: now(), promise: Promise.resolve().then(load) };
        cache.delete(key);
        cache.set(key, record);
        if (cache.size > 10) cache.delete(cache.keys().next().value);
        record.promise.catch(() => { if (cache.get(key) === record) cache.delete(key); });
        return record.promise;
    }

    function catalog() {
        return cached('catalog', async () => {
            const index = await readFile('summarizer-index.json');
            if (index !== null) {
                if (index.version !== 2 || !index.archives || Array.isArray(index.archives)) {
                    throw new Error('Unsupported Summarizer index.');
                }
                return { modern: true, entries: index.archives };
            }
            const legacy = await readFile(LEGACY_FILE);
            return { modern: false, entries: legacy?.summaries || {} };
        });
    }

    async function list(options = {}, context = {}) {
        const { modern, entries } = await catalog();
        const currentFilename = normalizeFilename(context.chatMetadata?.file_name || context.chatId);
        const currentOwner = context.groupId ? `group:${context.groupId}`
            : `character:${context.characters?.[context.characterId]?.avatar || ''}`;
        const results = [];
        for (const [id, entry] of Object.entries(entries)) {
            if (modern ? !entry.hasSummary : !entry?.text) continue;
            const filename = modern ? entry.chatFilename || entry.identity?.chatFilename || '' : id;
            const name = characterName(entry, filename);
            const owner = entryOwner(entry);
            if (options.characterAvatar && owner) {
                if (owner !== `character:${options.characterAvatar}`) continue;
            } else if (options.characterName && name !== options.characterName) continue;
            results.push({
                uid: id, archiveId: modern ? id : null, chatFilename: filename,
                displayName: normalizeFilename(filename), characterName: name, owner,
                // Index text is a truncated preview and must never become generation context.
                content: modern ? null : entry.text, quotes: modern ? null : entry.quotes || [],
                lastGenerated: entry.lastGenerated || null,
                isCurrent: normalizeFilename(filename) === currentFilename && (!owner || owner === currentOwner),
            });
        }
        results.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent)
            || (b.lastGenerated || 0) - (a.lastGenerated || 0));
        return results;
    }

    async function load(reference) {
        const { modern, entries } = await catalog();
        let id = reference.archiveId || reference.chatFilename;
        if (modern && !reference.archiveId) {
            const matches = Object.entries(entries).filter(([, entry]) =>
                normalizeFilename(entry.chatFilename) === normalizeFilename(reference.chatFilename)
                && (!reference.owner || entryOwner(entry) === reference.owner));
            if (matches.length !== 1) throw new Error('Could not identify the selected summary. Refresh the summary list.');
            id = matches[0][0];
        }
        const entry = entries[id];
        if (!entry || (modern && !entry.hasSummary)) return null;
        return cached(`summary:${id}`, async () => {
            const api = getAPI();
            if (typeof api?.getSummary === 'function') return api.getSummary(id);
            if (!modern) return entry;
            if (!/^[a-z0-9_-]{8,80}$/i.test(id)) throw new Error('Invalid Summarizer archive ID.');
            const legacyFilename = `summarizer-chat-${id}.json`;
            const filename = entry.filename ?? legacyFilename;
            if (typeof filename !== 'string' || filename.length > 240 || !filename.startsWith('summarizer-chat-')
                || (filename !== legacyFilename && !filename.endsWith(`--${id}.json`))
                || /[<>:"/\\|?*\u0000-\u001f]/u.test(filename)) throw new Error('Invalid Summarizer archive filename.');
            const archive = await readFile(filename);
            if (archive) {
                if (archive.version !== 2 || archive.id !== id) throw new Error('Invalid Summarizer archive.');
                return archive.comprehensive || null;
            }
            // Only explicitly unmigrated recaps may fall back to the retained backup.
            if (!entry.legacyFilename) return null;
            const legacy = await cached('legacy', () => readFile(LEGACY_FILE));
            return legacy?.summaries?.[entry.legacyFilename] || null;
        });
    }

    return { list, load, invalidate: () => cache.clear() };
}
