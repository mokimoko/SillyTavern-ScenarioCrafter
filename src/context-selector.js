import { buildDisplayName } from './utils.js';

const OPTION_LIMIT = 200;
const BATCH_SIZE = 500;
const SEARCH_DELAY = 150;
const pause = () => new Promise(resolve => setTimeout(resolve, 0));

// Only lightweight labels are indexed; character cards and avatar images stay with ST.
export class ContextSelector {
    constructor(select, kind) {
        this.select = select;
        this.kind = kind;
        this.entries = [];
        this.byValue = new Map();
        this.version = 0;
        this.renderVersion = 0;
        this.selectedValue = '';

        this.search = document.createElement('input');
        this.search.type = 'search';
        this.search.className = 'scenariocrafter-select scenariocrafter-context-search';
        this.search.placeholder = `Search ${kind}…`;
        this.search.setAttribute('aria-label', `Search ${kind} by name, title, or filename`);
        this.search.autocomplete = 'off';
        this.search.hidden = true;
        select.before(this.search);

        this.hint = document.createElement('small');
        this.hint.className = 'scenariocrafter-context-hint';
        this.hint.id = `${select.id}-hint`;
        this.hint.setAttribute('aria-live', 'polite');
        this.hint.hidden = true;
        select.after(this.hint);
        this.search.setAttribute('aria-describedby', this.hint.id);
        select.setAttribute('aria-describedby', this.hint.id);

        this.onSearch = () => {
            clearTimeout(this.searchTimer);
            this.renderVersion++;
            this.searchTimer = setTimeout(() => this.render().catch(error => {
                console.error('[ScenarioCrafter] Could not filter choices:', error);
            }), SEARCH_DELAY);
        };
        this.onChange = () => { this.selectedValue = select.value; };
        this.search.addEventListener('input', this.onSearch);
        select.addEventListener('change', this.onChange);
    }

    async setItems(items, describe, selectedValue, signal) {
        this.cancel();
        const version = this.version;
        const current = () => version === this.version && !signal?.aborted;
        const entries = [], counts = Object.create(null), byValue = new Map();
        this.select.disabled = true;
        this.search.disabled = true;
        this.hint.hidden = false;
        this.hint.textContent = `Loading ${this.kind}…`;

        for (let start = 0; start < items.length; start += BATCH_SIZE) {
            if (start) await pause();
            if (!current()) return false;
            for (let index = start; index < Math.min(start + BATCH_SIZE, items.length); index++) {
                const details = describe(items[index], index);
                if (!details) continue;
                const entry = {
                    value: String(details.value), name: String(details.name || 'Unknown'),
                    avatar: String(details.avatar || ''), title: String(details.title || ''),
                };
                entries.push(entry);
                counts[entry.name] = (counts[entry.name] || 0) + 1;
            }
        }
        for (let start = 0; start < entries.length; start += BATCH_SIZE) {
            if (start) await pause();
            if (!current()) return false;
            for (let index = start; index < Math.min(start + BATCH_SIZE, entries.length); index++) {
                const entry = entries[index];
                entry.label = buildDisplayName(entry.name, entry.avatar, entry.title, counts);
                entry.searchText = `${entry.name} ${entry.title} ${entry.avatar}`.toLowerCase();
                byValue.set(entry.value, entry);
            }
        }
        if (!current()) return false;
        this.entries = entries;
        this.byValue = byValue;
        const requested = String(selectedValue ?? '');
        this.selectedValue = byValue.has(requested) ? requested : entries[0]?.value ?? '';
        this.search.value = '';
        this.search.hidden = entries.length <= OPTION_LIMIT;
        const ready = await this.render(signal);
        if (current()) this.search.disabled = false;
        return current() && ready;
    }

    async render(signal) {
        const version = ++this.renderVersion;
        const current = () => version === this.renderVersion && !signal?.aborted;
        const query = this.search.value.trim().toLowerCase();
        const entries = this.entries, visible = [];
        let matches = 0;
        this.select.disabled = true;
        for (let start = 0; start < entries.length; start += BATCH_SIZE) {
            if (start) await pause();
            if (!current()) return false;
            for (let index = start; index < Math.min(start + BATCH_SIZE, entries.length); index++) {
                const entry = entries[index];
                if (query && !entry.searchText.includes(query)) continue;
                matches++;
                if (visible.length < OPTION_LIMIT) visible.push(entry);
            }
        }
        if (!current()) return false;
        // Filtering must never silently switch the character/persona used for generation.
        const selected = this.byValue.get(this.selectedValue);
        if (selected && !visible.includes(selected)) {
            visible.unshift(selected);
            if (visible.length > OPTION_LIMIT) visible.pop();
        }
        const fragment = document.createDocumentFragment();
        for (const entry of visible) fragment.append(new Option(entry.label, entry.value));
        if (!visible.length) fragment.append(new Option(`No ${query ? 'matching' : 'available'} ${this.kind}`, ''));
        this.select.replaceChildren(fragment);
        if (selected) this.select.value = selected.value;
        this.select.disabled = !visible.length;
        this.hint.hidden = entries.length <= OPTION_LIMIT;
        this.hint.textContent = matches > OPTION_LIMIT
            ? `${matches.toLocaleString()} ${query ? 'matches' : this.kind}. Showing up to ${OPTION_LIMIT}; type to narrow the list.`
            : `${matches.toLocaleString()} matches.${selected ? ' Current selection is kept available.' : ''}`;
        this.needsRender = false;
        return true;
    }

    setValue(value) {
        const entry = this.byValue.get(String(value));
        if (!entry) return false;
        this.selectedValue = entry.value;
        if (![...this.select.options].some(option => option.value === entry.value)) {
            if (this.select.options.length >= OPTION_LIMIT) this.select.remove(this.select.options.length - 1);
            this.select.add(new Option(entry.label, entry.value));
        }
        this.select.value = entry.value;
        return true;
    }

    cancel() {
        this.version++;
        this.renderVersion++;
        clearTimeout(this.searchTimer);
        this.needsRender = true;
        this.select.disabled = !this.entries.length;
        this.search.disabled = false;
    }

    destroy() {
        this.cancel();
        this.search.removeEventListener('input', this.onSearch);
        this.select.removeEventListener('change', this.onChange);
        this.search.remove();
        this.hint.remove();
        this.entries = [];
        this.byValue.clear();
    }
}
