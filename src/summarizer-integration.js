/**
 * Simple Summarizer integration for ScenarioCrafter
 * 
 * Detects whether Simple Summarizer is installed and loads
 * comprehensive summaries from its archive file directly
 * (no hard dependency — just reads the same JSON file).
 */
import { getRequestHeaders } from '../../../../../script.js';

const log = (...args) => console.log('[ScenarioCrafter Summarizer]', ...args);

const ARCHIVE_FILE_URL = '/user/files/archive_summarizer.json';

// Cache the archive data for the session
let archiveCache = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30000; // 30 seconds

/**
 * Check if Simple Summarizer extension is installed and active.
 * Looks for its extension settings key in the ST context.
 */
export function isSummarizerInstalled() {
    try {
        const context = SillyTavern.getContext();
        // Simple Summarizer stores settings under extension_settings.summarizer
        return context.extensionSettings?.summarizer !== undefined;
    } catch {
        return false;
    }
}

/**
 * Load the archive_summarizer.json file directly.
 * Returns the parsed store object or null.
 */
async function loadArchiveFile() {
    const now = Date.now();
    if (archiveCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
        return archiveCache;
    }

    try {
        const response = await fetch(ARCHIVE_FILE_URL, {
            method: 'GET',
            headers: getRequestHeaders(),
        });

        if (response.status === 404) {
            log('Archive file not found (no comprehensive summaries yet)');
            archiveCache = null;
            cacheTimestamp = now;
            return null;
        }

        if (!response.ok) {
            log('Failed to load archive file:', response.status);
            return null;
        }

        const data = await response.json();
        archiveCache = data;
        cacheTimestamp = now;
        return data;
    } catch (error) {
        log('Error loading archive file:', error.message);
        return null;
    }
}

/**
 * Invalidate the cached archive data (call when summaries may have changed).
 */
export function invalidateArchiveCache() {
    archiveCache = null;
    cacheTimestamp = 0;
}

/**
 * Get all available comprehensive summaries from Simple Summarizer.
 * 
 * @param {Object} [options]
 * @param {string} [options.characterName] - Filter to summaries for this character
 * @returns {Promise<Array<{chatFilename, displayName, content, quotes, lastGenerated, characterName}>>}
 */
export async function getComprehensiveSummaries(options = {}) {
    if (!isSummarizerInstalled()) {
        log('Summarizer not installed');
        return [];
    }

    const store = await loadArchiveFile();
    if (!store?.summaries) return [];

    const context = SillyTavern.getContext();
    const currentChatFilename = context.chat_metadata?.file_name || `${context.chatId}.jsonl`;

    const results = [];

    for (const [chatFilename, entry] of Object.entries(store.summaries)) {
        if (!entry?.text) continue;

        // Character name from entry metadata
        const charName = entry.metadata?.character?.name 
            || entry.metadata?.character?.displayName
            || parseCharNameFromFilename(chatFilename)
            || 'Unknown';

        // Apply character filter if specified
        if (options.characterName && charName !== options.characterName) continue;

        const isCurrent = chatFilename === currentChatFilename;
        const displayName = chatFilename.replace(/\.jsonl$/i, '');

        results.push({
            chatFilename,
            displayName,
            content: entry.text,
            quotes: entry.quotes || [],
            lastGenerated: entry.lastGenerated || null,
            characterName: charName,
            isCurrent,
        });
    }

    // Sort: current chat first, then by lastGenerated descending
    results.sort((a, b) => {
        if (a.isCurrent && !b.isCurrent) return -1;
        if (!a.isCurrent && b.isCurrent) return 1;
        return (b.lastGenerated || 0) - (a.lastGenerated || 0);
    });

    log(`Found ${results.length} comprehensive summaries` + 
        (options.characterName ? ` for ${options.characterName}` : ''));
    
    return results;
}

/**
 * Parse character name from ST chat filename format: "CharName - Date.jsonl"
 */
function parseCharNameFromFilename(filename) {
    const match = filename.match(/^(.+?)\s*-\s*\d/);
    return match ? match[1].trim() : null;
}
