import { log, logError, escapeHtml, worldBookCache } from './utils.js';
import { getSettings } from './settings.js';

export class WorldInfoSelector {
    constructor(enabledBooks, selectedEntries) {
        this.enabledBooks = { ...enabledBooks };
        this.selectedEntries = { ...selectedEntries };
        this.modal = null;
        this.resolve = null;
    }

    async show() {
        return new Promise((resolve) => {
            this.resolve = resolve;
            this.createModal();
            this.loadWorldBooks();
            this.attachEventListeners();
            this.modal.animate({ opacity: 1 }, 200);
        });
    }

    createModal() {
        this.modal = $(`
            <div class="scenariocrafter-wi-selector">
                <div class="scenariocrafter-popup-overlay"></div>
                <div class="scenariocrafter-popup-content">
                    <h2>Select World Info Entries</h2>
                    <div class="scenariocrafter-wi-search">
                        <input type="text" class="scenariocrafter-input" placeholder="Search entries..." id="sc-wi-search">
                        <button class="scenariocrafter-btn-sm scenariocrafter-btn-secondary" id="sc-wi-select-all">Select All</button>
                        <button class="scenariocrafter-btn-sm scenariocrafter-btn-secondary" id="sc-wi-deselect-all">Deselect All</button>
                    </div>
                    <div class="scenariocrafter-wi-books" id="sc-wi-books-container">
                        <div class="scenariocrafter-loading">
                            <i class="fa-solid fa-spinner fa-spin"></i>
                            Loading world books...
                        </div>
                    </div>
                    <div class="scenariocrafter-wi-footer">
                        <span id="sc-wi-count">0 entries selected</span>
                        <div>
                            <button class="scenariocrafter-btn scenariocrafter-btn-secondary" id="sc-wi-cancel">Cancel</button>
                            <button class="scenariocrafter-btn scenariocrafter-btn-primary" id="sc-wi-confirm">Confirm</button>
                        </div>
                    </div>
                </div>
            </div>
        `);

        $('body').append(this.modal);
    }

    async loadWorldBooks() {
        const container = this.modal.find('#sc-wi-books-container');
        
        try {
            const context = SillyTavern.getContext();
            
            // Get available world books from UI
            const bookNames = this.getAvailableWorldBooks();
            
            if (bookNames.length === 0) {
                container.html('<div class="scenariocrafter-placeholder"><p>No active world books found. Make sure you have world info enabled in your character/chat settings.</p></div>');
                return;
            }

            log('Loading world books for selector:', bookNames);
            
            // Load each book's entries
            const worldBooks = {};
            for (const bookName of bookNames) {
                try {
                    const bookData = await this.loadWorldBook(bookName, context);
                    if (bookData && bookData.entries) {
                        // Convert entries object to array
                        const entriesArray = [];
                        for (const [uid, entry] of Object.entries(bookData.entries)) {
                            if (!entry.disable && !entry.disabled) {
                                entriesArray.push({
                                    uid: uid,
                                    comment: entry.comment || entry.title || '',
                                    content: entry.content || '',
                                    key: this.normalizeKeys(entry)
                                });
                            }
                        }
                        
                        if (entriesArray.length > 0) {
                            worldBooks[bookName] = { entries: entriesArray };
                        }
                    }
                } catch (error) {
                    logError(`Failed to load "${bookName}":`, error);
                }
            }

            if (Object.keys(worldBooks).length === 0) {
                container.html('<div class="scenariocrafter-placeholder"><p>No entries found in active world books</p></div>');
                return;
            }

            container.empty();

            for (const [bookName, bookData] of Object.entries(worldBooks)) {
                // Skip internal/archive worldbooks
                if (bookName.startsWith('_scene') || bookName.startsWith('archive_')) {
                    log('Skipping internal worldbook:', bookName);
                    continue;
                }
                
                const entries = bookData.entries || [];
                const selectedCount = this.selectedEntries[bookName]?.length || 0;

                const bookEl = $(`
                    <div class="scenariocrafter-wi-book">
                        <div class="scenariocrafter-wi-book-header" data-book="${escapeHtml(bookName)}">
                            <div class="scenariocrafter-wi-book-toggle">
                                <i class="fa-solid fa-chevron-right"></i>
                            </div>
                            <h3>${escapeHtml(bookName)}</h3>
                            <span class="scenariocrafter-wi-book-count">
                                ${selectedCount}/${entries.length}
                            </span>
                            <div class="scenariocrafter-wi-book-actions">
                                <button class="scenariocrafter-btn-sm" data-action="select-book" data-book="${escapeHtml(bookName)}">All</button>
                                <button class="scenariocrafter-btn-sm" data-action="deselect-book" data-book="${escapeHtml(bookName)}">None</button>
                            </div>
                        </div>
                        <div class="scenariocrafter-wi-entries" style="display: none;"></div>
                    </div>
                `);
                
                // Toggle collapse/expand
                bookEl.find('.scenariocrafter-wi-book-header').on('click', (e) => {
                    if ($(e.target).closest('button').length) return; // Don't toggle if clicking buttons
                    if ($(e.target).closest('.scenariocrafter-wi-book-actions').length) return;
                    
                    const $entries = bookEl.find('.scenariocrafter-wi-entries');
                    const $icon = bookEl.find('.scenariocrafter-wi-book-toggle i');
                    
                    $entries.slideToggle(200);
                    $icon.toggleClass('fa-chevron-right fa-chevron-down');
                });

                const entriesContainer = bookEl.find('.scenariocrafter-wi-entries');

                entries.forEach(entry => {
                    const isSelected = this.selectedEntries[bookName]?.includes(entry.uid);
                    const title = entry.comment || 'Untitled';
                    const keys = (entry.key || []).join(', ') || 'No keys';
                    const content = entry.content || 'No content';
                    
                    const entryEl = $(`
                        <label class="scenariocrafter-wi-entry">
                            <div class="scenariocrafter-wi-entry-header">
                                <input type="checkbox" data-book="${escapeHtml(bookName)}" data-uid="${entry.uid}" ${isSelected ? 'checked' : ''}>
                                <div class="scenariocrafter-wi-entry-title">${escapeHtml(title)}</div>
                            </div>
                            <div class="scenariocrafter-wi-entry-keys">${escapeHtml(keys)}</div>
                            <div class="scenariocrafter-wi-entry-content">${escapeHtml(content)}</div>
                        </label>
                    `);

                    entriesContainer.append(entryEl);
                });

                container.append(bookEl);
            }

            this.updateCount();

        } catch (error) {
            logError('Error loading world books:', error);
            container.html('<div class="scenariocrafter-error"><p>Failed to load world books</p></div>');
        }
    }

    getAvailableWorldBooks() {
        const books = [];
        
        // Parse the world_info select element to get active book names
        $('#world_info option:selected').each(function() {
            const bookName = $(this).text().trim();
            if (bookName && bookName !== 'slot') {
                books.push(bookName);
            }
        });
        
        return books;
    }

    async loadWorldBook(bookName, context) {
        // Check shared cache first
        if (worldBookCache.has(bookName)) {
            log('Using cached world book:', bookName);
            return worldBookCache.get(bookName);
        }
        
        try {
            log('Loading world book:', bookName);
            
            // Use SillyTavern's world info loading method
            if (typeof context.loadWorldInfo === 'function') {
                const data = await context.loadWorldInfo(bookName);
                worldBookCache.set(bookName, data);
                return data;
            }
            
            // Fallback: Direct API call
            const response = await fetch('/api/worldinfo/get', {
                method: 'POST',
                headers: context.getRequestHeaders(),
                body: JSON.stringify({ name: bookName })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            worldBookCache.set(bookName, data);
            return data;
        } catch (error) {
            logError(`Failed to load "${bookName}":`, error);
            return null;
        }
    }

    normalizeKeys(entry) {
        // Handle various key formats
        if (Array.isArray(entry.key)) {
            return entry.key;
        } else if (Array.isArray(entry.keys)) {
            return entry.keys;
        } else if (typeof entry.key === 'string') {
            return entry.key.split(',').map(k => k.trim()).filter(Boolean);
        } else if (typeof entry.keys === 'string') {
            return entry.keys.split(',').map(k => k.trim()).filter(Boolean);
        }
        return [];
    }

    attachEventListeners() {
        // Cancel / Close
        this.modal.find('#sc-wi-cancel, .scenariocrafter-popup-overlay').on('click', () => {
            this.close(null);
        });

        // Confirm
        this.modal.find('#sc-wi-confirm').on('click', () => {
            this.close(this.selectedEntries);
        });

        // Entry checkboxes
        this.modal.on('change', 'input[type="checkbox"]', (e) => {
            const book = $(e.target).data('book');
            const uid = $(e.target).data('uid');
            const checked = $(e.target).is(':checked');

            if (!this.selectedEntries[book]) {
                this.selectedEntries[book] = [];
            }

            if (checked) {
                if (!this.selectedEntries[book].includes(uid)) {
                    this.selectedEntries[book].push(uid);
                }
            } else {
                this.selectedEntries[book] = this.selectedEntries[book].filter(u => u !== uid);
            }

            this.updateCount();
        });

        // Select/Deselect all
        this.modal.find('#sc-wi-select-all').on('click', () => this.selectAll());
        this.modal.find('#sc-wi-deselect-all').on('click', () => this.deselectAll());

        // Book-level select/deselect
        this.modal.on('click', '[data-action="select-book"]', (e) => {
            const book = $(e.target).data('book');
            this.selectBook(book);
        });

        this.modal.on('click', '[data-action="deselect-book"]', (e) => {
            const book = $(e.target).data('book');
            this.deselectBook(book);
        });
    }

    selectAll() {
        this.modal.find('input[type="checkbox"]').prop('checked', true).trigger('change');
    }

    deselectAll() {
        this.modal.find('input[type="checkbox"]').prop('checked', false).trigger('change');
    }

    selectBook(book) {
        this.modal.find(`input[type="checkbox"][data-book="${book}"]`).prop('checked', true).trigger('change');
    }

    deselectBook(book) {
        this.modal.find(`input[type="checkbox"][data-book="${book}"]`).prop('checked', false).trigger('change');
    }

    updateCount() {
        let total = 0;
        for (const entries of Object.values(this.selectedEntries)) {
            total += entries.length;
        }
        this.modal.find('#sc-wi-count').text(`${total} entries selected`);
    }

    close(result) {
        this.modal.animate({ opacity: 0 }, 200, () => {
            this.modal.remove();
            if (this.resolve) {
                this.resolve(result);
            }
        });
    }
}