// Debug flag - set to true to enable debug logging
const DEBUG = false;

// Debug logger
export function log(...args) {
    if (DEBUG) {
        console.log('[ScenarioCrafter]', ...args);
    }
}

// Always log errors
export function logError(...args) {
    console.error('[ScenarioCrafter]', ...args);
}

// Escape HTML for safe display
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Handle duplicate names in character/persona lists
export function buildDisplayName(name, avatar, title, nameCounts) {
    let displayName = name;
    
    // Always show title if available
    if (title) {
        displayName = `${name} (${title})`;
    }
    // If there are duplicates and no title, use avatar/filename
    else if (nameCounts[name] > 1 && avatar) {
        displayName = `${name} (${avatar})`;
    }
    
    return displayName;
}

// Count occurrences of names in a list
export function countNames(items, nameGetter) {
    const counts = {};
    items.forEach(item => {
        const name = nameGetter(item);
        counts[name] = (counts[name] || 0) + 1;
    });
    return counts;
}

// Shared world book cache with TTL
class WorldBookCache {
    constructor() {
        this.cache = {};
        this.timestamps = {};
        this.TTL = 5 * 60 * 1000; // 5 minutes
    }
    
    get(bookName) {
        if (!this.cache[bookName]) {
            return null;
        }
        
        const timestamp = this.timestamps[bookName];
        if (Date.now() - timestamp > this.TTL) {
            log('Cache expired for:', bookName);
            delete this.cache[bookName];
            delete this.timestamps[bookName];
            return null;
        }
        
        return this.cache[bookName];
    }
    
    set(bookName, data) {
        this.cache[bookName] = data;
        this.timestamps[bookName] = Date.now();
    }
    
    has(bookName) {
        const data = this.get(bookName);
        return data !== null;
    }
    
    clear() {
        this.cache = {};
        this.timestamps = {};
    }
    
    remove(bookName) {
        delete this.cache[bookName];
        delete this.timestamps[bookName];
    }
}

// Global cache instance
export const worldBookCache = new WorldBookCache();