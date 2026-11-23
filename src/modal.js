import { getSettings, updateSettings } from './settings.js';
import { loadTemplates, loadTwists, getTemplatePrompt, getTemplateDescription, 
         getTropeCategories, getTropesByCategory, getMoodCategories, getMoodSituations,
         getTwistCategories, hasSwappedPrompt } from './templates.js';
import { generateScenarioDraft } from './generation-workflow.js';
import { applyScenarioDraft } from './scenario-application.js';
import { assertScenarioTarget } from './scenario-target.js';
import { cloneSelectedEntries } from './worldbook-discovery.js';
import { manageDialog } from './dialog-accessibility.js';
import { WorldInfoSelector } from './worldinfo-selector.js';
import { ContextSelector } from './context-selector.js';
import { getUserAvatars, user_avatar } from '../../../../personas.js';
import { log, logError, escapeHtml } from './utils.js';
import { power_user } from '../../../../power-user.js';
import { isSummarizerInstalled, getComprehensiveSummaries, loadComprehensiveSummary, invalidateArchiveCache } from './summarizer-integration.js';
import { makeModalDraggable } from './draggableModal.js';

export class ScenarioCrafterModal {
    constructor() {
        this.state = {
            scenarioType: 'trope',
            applyMode: getSettings().apply_mode,
            category: null,
            subcategory: null,
            leadRole: 'char',
            customPrompt: '',
            generatedText: '',
            tone: getSettings().default_tone,
            selectedCharacter: null,
            selectedPersona: null,
            connectionProfile: getSettings().profileId,
            includeHistory: getSettings().include_chat_history,
            historyRange: getSettings().history_range,
            includeWorldInfo: getSettings().include_world_info,
            worldInfoMode: getSettings().world_info_mode,
            enabledBooks: { ...getSettings().enabled_world_books },
            selectedEntries: cloneSelectedEntries(getSettings().selected_entries),
        };
        
        this.isGenerating = false;
        this.isApplying = false;
        this.generationVersion = 0;
        this.generatedResult = null;
        this.defaultSettings = getSettings();
        this.lastPrompt = null;
        this.cachedElements = null;
        this.isInitialized = false;
        this._initializationPromise = null;
        this._initializationController = null;
        this._destroyed = false;
        this.draggableModal = null;

        this.includeComprehensive = false;
        this.selectedComprehensiveSummaries = [];
        this.availableComprehensiveSummaries = [];
        
        this.customSummaryText = '';
        this.customSummaryTitle = 'Custom Background';
        this.customSummaryOrder = 0;
        
        this.createModal();
    }

    async loadInitialData(signal) {
        if (signal.aborted) return false;
        const [templates, twists] = await Promise.all([loadTemplates(), loadTwists()]);
        if (signal.aborted) return false;
        if (!templates || !twists) throw new Error('Could not load scenario templates.');
        const ready = await Promise.all([
            this.populateCharacters(signal), this.populatePersonas(signal), this.populateConnectionProfiles(signal),
        ]);
        if (signal.aborted || ready.includes(false)) return false;
        this.populateToneSelector();
        this.updateChatDependentControls();
        this.renderScenarioOptions();
        this.setInitialCheckboxStates();
        return true;
    }

    initialize() {
        if (this._initializationPromise) return this._initializationPromise;
        const controller = new AbortController();
        this._initializationController = controller;
        this.modal.attr('aria-busy', 'true');
        this.cachedElements.generateBtn.prop('disabled', true).text('Loading choices…');
        this._initializationPromise = Promise.resolve().then(async () => {
            let timer;
            let onAbort;
            try {
                if (controller.signal.aborted) return;
                const interrupted = new Promise((_, reject) => {
                    onAbort = () => reject(new Error('Loading cancelled.'));
                    controller.signal.addEventListener('abort', onAbort, { once: true });
                    timer = setTimeout(() => reject(new Error('Loading took too long. Please retry.')), 30_000);
                });
                const ready = await Promise.race([this.loadInitialData(controller.signal), interrupted]);
                if (controller.signal.aborted) return;
                if (!ready) throw new Error('Choices changed while loading. Please retry.');
                this.isInitialized = true;
                this.cachedElements.outputContent.html('<div class="scenariocrafter-placeholder"><i class="fa-solid fa-wand-magic-sparkles fa-3x"></i><p>Configure options and click Generate</p></div>');
                this.cachedElements.generateBtn.prop('disabled', false)
                    .html('<i class="fa-solid fa-wand-magic-sparkles"></i> Generate Scenario');
            } catch (error) {
                if (controller.signal.aborted || this._initializationController !== controller) return;
                controller.abort();
                this.characterSelector.cancel();
                this.personaSelector.cancel();
                logError('Failed to initialize modal:', error);
                toastr.error('Could not load Scenario Crafter. Use Retry loading to try again.', 'Scenario Crafter');
                this.cachedElements.outputContent.html('<div class="scenariocrafter-placeholder"><p>Could not load Scenario Crafter. Try again, or close and reopen the panel.</p></div>');
                this.cachedElements.generateBtn.prop('disabled', false).text('Retry loading');
            } finally {
                clearTimeout(timer);
                if (onAbort) controller.signal.removeEventListener('abort', onAbort);
                if (this._initializationController === controller) {
                    this._initializationController = null;
                    this._initializationPromise = null;
                    this.modal?.attr('aria-busy', 'false');
                }
            }
        });
        return this._initializationPromise;
    }

    updateChatDependentControls() {
        const context = SillyTavern.getContext();
        // More robust check - need chatId to exist (not just chat array)
        const hasActiveChat = context.chatId !== undefined && context.chat && context.chat.length > 0;
        
        log('Checking chat state:', {
            chatId: context.chatId,
            hasChat: !!context.chat,
            chatLength: context.chat?.length || 0,
            characterId: context.characterId,
            hasActiveChat
        });
        
        // Sync character dropdown to active chat's character
        if (!this.generatedResult && !this.isGenerating && hasActiveChat && context.characterId !== undefined && context.characterId !== null) {
            const charId = parseInt(context.characterId);
            if (!isNaN(charId) && charId >= 0 && charId < (context.characters?.length || 0)) {
                this.state.selectedCharacter = charId;
                this.characterSelector.setValue(charId);
                log('Synced active character to index:', charId);
            }
        }
        
        // Disable Twist button if no active chat
        const twistBtn = this.modal.find('.scenariocrafter-type-btn[data-type="twist"]');
        twistBtn.prop('disabled', !hasActiveChat);
        if (!hasActiveChat) {
            twistBtn.attr('title', 'Requires an active chat');
            twistBtn.css('opacity', '0.5');
            // If twist was selected, switch to trope
            if (this.state.scenarioType === 'twist') {
                this.switchScenarioType('trope');
            }
        } else {
            twistBtn.removeAttr('title');
            twistBtn.css('opacity', '1');
        }
        
        // Disable Include Chat History if no active chat
        this.cachedElements.includeHistory.prop('disabled', !hasActiveChat);
        if (!hasActiveChat) {
            this.cachedElements.includeHistory.prop('checked', false);
            this.state.includeHistory = false;
            this.cachedElements.historyRangeContainer.hide();
        }
        
        // Update apply mode options
        const applyModeSelect = this.cachedElements.applyModeSelect;
        applyModeSelect.find('option').prop('disabled', false); // Reset all
        
        if (!hasActiveChat) {
            // Disable append and rewrite modes
            applyModeSelect.find('option[value="append"]').prop('disabled', true);
            applyModeSelect.find('option[value="rewrite-last"]').prop('disabled', true);
            
            // Switch to new-chat if currently on disabled mode
            if (this.state.applyMode === 'append' || this.state.applyMode === 'rewrite-last') {
                this.state.applyMode = 'new-chat';
                applyModeSelect.val('new-chat');
            }
        }
        
        log('Updated chat-dependent controls. Has active chat:', hasActiveChat);
    }

    populateToneSelector() {
        this.cachedElements.toneSelect.val(this.state.tone);
    }

    setInitialCheckboxStates() {
        this.cachedElements.includeHistory.prop('checked', this.state.includeHistory);
        this.cachedElements.historyRange.val(this.state.historyRange);
        this.cachedElements.includeWorldInfo.prop('checked', this.state.includeWorldInfo);
        this.modal.find(`input[name="sc-wi-mode"][value="${this.state.worldInfoMode}"]`).prop('checked', true);
        this.cachedElements.addInjection.prop('checked', getSettings().add_scenario_injection);
        this.cachedElements.applyModeSelect.val(this.state.applyMode);
        this.cachedElements.historyRangeContainer.toggle(this.state.includeHistory);
        this.cachedElements.worldInfoOptions.toggle(this.state.includeWorldInfo);
        this.cachedElements.selectEntries.toggle(this.state.worldInfoMode === 'selected');
        
        // Hide comprehensive summaries section if Simple Summarizer is not installed
        const summarizerAvailable = isSummarizerInstalled();
        this.modal.find('.comprehensive-summaries-section').toggle(summarizerAvailable);
        
        if (!summarizerAvailable) {
            log('Simple Summarizer not detected — comprehensive summaries hidden');
        }
        
        // Set custom summary state
        const hasCustom = !!this.customSummaryText;
        this.modal.find('#sc-use-custom-summary').prop('checked', hasCustom);
        this.modal.find('#sc-edit-custom-summary').toggle(hasCustom);
        if (hasCustom) {
            this.updateCustomSummaryPreview();
        }
    }

    createModal() {
        const modal = $(`
            <div id="scenariocrafter_modal" class="scenariocrafter-modal">
                <div class="scenariocrafter-modal-overlay"></div>
                <div class="scenariocrafter-modal-content">
                    <div class="scenariocrafter-header">
                        <div class="scenariocrafter-title">
                            <i class="fa-solid fa-wand-magic-sparkles"></i>
                            <span>Scenario Crafter</span>
                        </div>
                        <button class="scenariocrafter-close" aria-label="Close Scenario Crafter">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>

                    <div class="scenariocrafter-layout">
                        <!-- LEFT PANE: Configuration -->
                        <div class="scenariocrafter-config">
                            <div class="scenariocrafter-section">
                                <h3 class="scenariocrafter-section-title">Active Context</h3>
                                <div class="scenariocrafter-context-selectors">
                                    <div class="scenariocrafter-context-field">
                                        <label for="sc-character-select">Character</label>
                                        <select class="scenariocrafter-select" id="sc-character-select"></select>
                                    </div>
                                    <div class="scenariocrafter-context-field">
                                        <label for="sc-persona-select">Persona</label>
                                        <select class="scenariocrafter-select" id="sc-persona-select"></select>
                                    </div>
                                    <label>
                                        <span>Connection Profile</span>
                                        <select class="scenariocrafter-select" id="sc-profile-select"></select>
                                    </label>
                                    <label>
                                        <span>Apply Mode</span>
                                        <select class="scenariocrafter-select" id="sc-apply-mode">
                                            <option value="new-chat">Start New Chat</option>
                                            <option value="append">Append to Current</option>
                                            <option value="rewrite-last">Rewrite Last Message</option>
                                        </select>
                                    </label>
                                </div>
                            </div>

                            <div class="scenariocrafter-section">
                                <h3 class="scenariocrafter-section-title">Scenario Type</h3>
                                <div class="scenariocrafter-type-buttons">
                                    <button class="scenariocrafter-type-btn active" data-type="trope">
                                        <i class="fa-solid fa-masks-theater"></i>
                                        Trope
                                    </button>
                                    <button class="scenariocrafter-type-btn" data-type="mood">
                                        <i class="fa-solid fa-heart"></i>
                                        Mood
                                    </button>
                                    <button class="scenariocrafter-type-btn" data-type="twist">
                                        <i class="fa-solid fa-bolt"></i>
                                        Twist
                                    </button>
                                    <button class="scenariocrafter-type-btn" data-type="custom">
                                        <i class="fa-solid fa-pen"></i>
                                        Custom
                                    </button>
                                </div>
                            </div>

                            <div class="scenariocrafter-section" id="sc-scenario-options">
                                <!-- Dynamic content based on type -->
                            </div>

                            <div class="scenariocrafter-section">
                                <h3 class="scenariocrafter-section-title">Tone</h3>
                                <select class="scenariocrafter-select" id="sc-tone-select">
                                    <option value="balanced">⚖️ Balanced</option>
                                    <option value="lighthearted">😊 Lighthearted</option>
                                    <option value="serious">😐 Serious</option>
                                    <option value="dark">🌑 Dark</option>
                                    <option value="humorous">😄 Humorous</option>
                                    <option value="romantic">💕 Romantic</option>
                                    <option value="dramatic">🎭 Dramatic</option>
                                    <option value="suspenseful">🔍 Suspenseful</option>
                                </select>
                            </div>

                            <div class="scenariocrafter-section">
                                <h3 class="scenariocrafter-section-title">Context Options</h3>
                                <label class="scenariocrafter-checkbox-label">
                                    <input type="checkbox" id="sc-include-history">
                                    <span>Include Chat History</span>
                                </label>
                                <div class="scenariocrafter-sub-option" id="sc-history-range-container" style="display: none;">
                                    <label>
                                        <span>Messages</span>
                                        <input type="number" class="scenariocrafter-input-sm" id="sc-history-range" min="1" max="50" value="5">
                                    </label>
                                </div>

                                <label class="scenariocrafter-checkbox-label">
                                    <input type="checkbox" id="sc-include-worldinfo">
                                    <span>Include World Info</span>
                                </label>
                                <div class="scenariocrafter-sub-option" id="sc-worldinfo-options" style="display: none;">
                                    <div class="scenariocrafter-radio-group">
                                        <label class="scenariocrafter-radio-label">
                                            <input type="radio" name="sc-wi-mode" value="triggered" checked>
                                            <span>Triggered Entries</span>
                                        </label>
                                        <label class="scenariocrafter-radio-label">
                                            <input type="radio" name="sc-wi-mode" value="all">
                                            <span>All Enabled Books</span>
                                        </label>
                                        <label class="scenariocrafter-radio-label">
                                            <input type="radio" name="sc-wi-mode" value="selected">
                                            <span>Selected Entries</span>
                                        </label>
                                    </div>
                                    <button class="scenariocrafter-btn-sm scenariocrafter-btn-secondary" id="sc-select-entries" style="display: none;">
                                        <i class="fa-solid fa-list-check"></i>
                                        Select Entries
                                    </button>
                                </div>
                            </div>

                            <div class="scenariocrafter-section">
                                <h3 class="scenariocrafter-section-title">Story Summary</h3>
                                <label class="scenariocrafter-checkbox-label">
                                    <input type="checkbox" id="sc-include-comprehensive">
                                    <span>Include Story Summary</span>
                                </label>
                                <div class="scenariocrafter-sub-option" id="sc-comprehensive-options" style="display: none;">
                                    
                                    <!-- Custom Summary Section -->
                                    <div class="custom-summary-section">
                                        <div class="custom-summary-header">
                                            <label class="scenariocrafter-checkbox-label">
                                                <input type="checkbox" id="sc-use-custom-summary">
                                                <span>Custom Summary</span>
                                            </label>
                                            <button class="scenariocrafter-btn-icon" id="sc-edit-custom-summary" aria-label="Edit custom summary" style="display:none;">
                                                <i class="fa-solid fa-pen"></i>
                                            </button>
                                        </div>
                                        <div id="sc-custom-summary-preview" class="custom-summary-preview" style="display:none;"></div>
                                    </div>
                                    
                                    <!-- Comprehensive Summaries (requires Simple Summarizer) -->
                                    <div class="comprehensive-summaries-section">
                                        <h4 style="margin: 12px 0 8px 0; font-size: 12px; font-weight: 600; color: var(--sc-text); opacity: 0.8;">Comprehensive Summaries</h4>
                                        <div id="sc-comprehensive-list" class="comprehensive-summary-list">
                                            <div class="comprehensive-summary-empty">No summaries available</div>
                                        </div>
                                    </div>
                                    
                                    <small class="sc-comprehensive-info"></small>
                                </div>
                            </div>

                            <button class="scenariocrafter-btn scenariocrafter-btn-primary scenariocrafter-generate-btn">
                                <i class="fa-solid fa-sparkles"></i>
                                Generate Scenario
                            </button>
                        </div>

                        <!-- RIGHT PANE: Output -->
                        <div class="scenariocrafter-output-pane">
                            <div class="scenariocrafter-output-header">
                                <button class="scenariocrafter-btn-icon" id="sc-view-prompt" disabled>
                                    <i class="fa-solid fa-eye"></i>
                                    View Prompt
                                </button>
                            </div>

                            <div class="scenariocrafter-output-content">
                                <div class="scenariocrafter-placeholder">
                                    <i class="fa-solid fa-wand-magic-sparkles fa-3x"></i>
                                    <p>Configure options and click Generate</p>
                                </div>
                            </div>

                            <div class="scenariocrafter-apply-section">
                                <h3 class="scenariocrafter-section-title">Apply Scenario</h3>
                                
                                <label class="scenariocrafter-checkbox-label">
                                    <input type="checkbox" id="sc-add-injection" checked>
                                    <span>Add Scenario Note (System Injection)</span>
                                </label>
                                <textarea class="scenariocrafter-textarea" id="sc-scenario-note" rows="2" placeholder="Optional scenario summary..."></textarea>
                                <button class="scenariocrafter-btn scenariocrafter-btn-success" id="sc-apply-btn" disabled>
                                    <i class="fa-solid fa-paper-plane"></i>
                                    Apply Scenario
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `);

        $('body').append(modal);
        this.modal = modal;
        this.cacheElements();
        this.characterSelector = new ContextSelector(this.cachedElements.characterSelect[0], 'characters');
        this.personaSelector = new ContextSelector(this.cachedElements.personaSelect[0], 'personas');
        this.onChatChanged = () => {
            if (this.isApplying) return;
            this.invalidateResult();
            this._summaryLoadId = (this._summaryLoadId || 0) + 1;
            this.availableComprehensiveSummaries = [];
            this.selectedComprehensiveSummaries = [];
            this._charactersDirty = true;
            if (this.isInitialized && this.modal.is(':visible')) {
                this.populateCharacters().then(ready => {
                    if (!ready || this._destroyed) return;
                    this.updateChatDependentControls();
                    if (this.includeComprehensive) this.loadAvailableComprehensiveSummaries();
                }).catch(error => logError('Could not refresh characters:', error));
            }
        };
        const context = SillyTavern.getContext();
        context.eventSource.on(context.event_types.CHAT_CHANGED, this.onChatChanged);
        this.draggableModal = makeModalDraggable(
            modal.find('.scenariocrafter-modal-content')[0],
            modal.find('.scenariocrafter-header')[0],
            {
                prefix: 'scenariocrafter-modal',
                visibleClass: 'scenariocrafter-modal-visible',
            },
        );
    }

    cacheElements() {
        this.cachedElements = {
            characterSelect: this.modal.find('#sc-character-select'),
            personaSelect: this.modal.find('#sc-persona-select'),
            profileSelect: this.modal.find('#sc-profile-select'),
            applyModeSelect: this.modal.find('#sc-apply-mode'),
            toneSelect: this.modal.find('#sc-tone-select'),
            includeHistory: this.modal.find('#sc-include-history'),
            historyRange: this.modal.find('#sc-history-range'),
            historyRangeContainer: this.modal.find('#sc-history-range-container'),
            includeWorldInfo: this.modal.find('#sc-include-worldinfo'),
            worldInfoOptions: this.modal.find('#sc-worldinfo-options'),
            selectEntries: this.modal.find('#sc-select-entries'),
            generateBtn: this.modal.find('.scenariocrafter-generate-btn'),
            outputContent: this.modal.find('.scenariocrafter-output-content'),
            viewPrompt: this.modal.find('#sc-view-prompt'),
            applyBtn: this.modal.find('#sc-apply-btn'),
            addInjection: this.modal.find('#sc-add-injection'),
            scenarioNote: this.modal.find('#sc-scenario-note'),
            comprehensiveOptions: this.modal.find('#sc-comprehensive-options'),
        };
    }

    async populateCharacters(signal) {
        if (signal?.aborted || this._destroyed) return false;
        this._charactersDirty = true;
        this.cachedElements.generateBtn.prop('disabled', true);
        const context = SillyTavern.getContext();
        const characters = context.characters || [];
        const active = context.chatId !== undefined && characters[context.characterId]
            ? context.characterId : null;
        const pending = this.characterSelector.setItems(characters, (character, index) => character && ({
            value: index, name: character.name, avatar: character.avatar,
        }), active, signal);
        const version = this.characterSelector.version;
        try {
            const ready = await pending;
            if (!ready || version !== this.characterSelector.version || signal?.aborted || this._destroyed) return false;
            this.state.selectedCharacter = this.characterSelector.selectedValue === ''
                ? null : Number(this.characterSelector.selectedValue);
            this._charactersDirty = false;
            return true;
        } finally {
            if (version === this.characterSelector.version && !this._destroyed) {
                this.cachedElements.generateBtn.prop('disabled', !this.isInitialized || this._charactersDirty || this.isGenerating || this.isApplying);
            }
        }
    }

    async populatePersonas(signal) {
        const avatars = await getUserAvatars(false);
        if (signal?.aborted || this._destroyed) return false;
        if (!Array.isArray(avatars)) throw new Error('Could not load personas.');
        const pending = this.personaSelector.setItems(avatars, avatar => ({
            value: avatar, name: power_user.personas?.[avatar] || avatar, avatar,
            title: power_user.persona_descriptions?.[avatar]?.title,
        }), this.state.selectedPersona ?? user_avatar, signal);
        const version = this.personaSelector.version;
        const ready = await pending;
        if (!ready || version !== this.personaSelector.version || signal?.aborted || this._destroyed) return false;
        this.state.selectedPersona = this.personaSelector.selectedValue || user_avatar;
        return ready;
    }

    async populateConnectionProfiles(signal) {
        if (signal?.aborted || this._destroyed) return false;
        const context = SillyTavern.getContext();
        const select = this.cachedElements.profileSelect;
        select.empty().append(new Option('Default Connection', ''));
        if ($('#sys-settings-button').find('#connection_profiles').length === 0) return true;
        const result = await context.executeSlashCommandsWithOptions('/profile-list');
        if (signal?.aborted || this._destroyed) return false;
        const profiles = JSON.parse(result.pipe);
        if (!Array.isArray(profiles)) throw new Error('Could not load connection profiles.');
        const fragment = document.createDocumentFragment();
        for (const name of profiles) fragment.append(new Option(name, name));
        select[0].append(fragment);
        select.val(this.state.connectionProfile);
        return true;
    }

    async loadAvailableComprehensiveSummaries() {
        if (!isSummarizerInstalled()) {
            log('Simple Summarizer not installed, skipping comprehensive summary load');
            return;
        }
        
        const loadId = this._summaryLoadId = (this._summaryLoadId || 0) + 1;
        const listContainer = this.modal.find('#sc-comprehensive-list');
        listContainer.html('<div class="comprehensive-summary-empty">Loading...</div>');
        
        try {
            // Get the selected character's name for filtering
            const context = SillyTavern.getContext();
            const charIndex = parseInt(this.state.selectedCharacter);
            const selectedChar = context.characters?.[charIndex];
            const charName = selectedChar?.name || null;
            
            // Invalidate cache to get fresh data
            invalidateArchiveCache();
            
            // Load summaries, optionally filtered by character
            const summaries = await getComprehensiveSummaries(
                selectedChar ? { characterName: charName, characterAvatar: selectedChar.avatar } : {}
            );
            
            if (loadId !== this._summaryLoadId) return;
            if (summaries.length === 0) {
                listContainer.html('<div class="comprehensive-summary-empty">No summaries available</div>');
                this.availableComprehensiveSummaries = [];
                this.selectedComprehensiveSummaries = [];
                this.updateComprehensiveInfo();
                return;
            }
            
            this.availableComprehensiveSummaries = summaries;
            const availableIds = new Set(summaries.map(summary => summary.uid));
            this.selectedComprehensiveSummaries = this.selectedComprehensiveSummaries
                .filter(summary => availableIds.has(summary.uid));
            this.renumberSelectedSummaries();
            
            this.renderComprehensiveSummaryList();
            
            log('Found', this.availableComprehensiveSummaries.length, 'comprehensive summaries');
            
        } catch (error) {
            if (loadId !== this._summaryLoadId) return;
            logError('Failed to load comprehensive summaries:', error);
            listContainer.html('<div class="comprehensive-summary-empty">Error loading summaries</div>');
        }
    }

    renderComprehensiveSummaryList() {
        const listContainer = this.modal.find('#sc-comprehensive-list');
        listContainer.empty();
        
        if (this.availableComprehensiveSummaries.length === 0) {
            listContainer.html('<div class="comprehensive-summary-empty">No summaries available</div>');
            return;
        }
        
        const selectedMap = new Map();
        this.selectedComprehensiveSummaries.forEach(item => {
            selectedMap.set(item.uid, item.order);
        });
        
        this.availableComprehensiveSummaries.forEach(summary => {
            const isSelected = selectedMap.has(summary.uid);
            const order = selectedMap.get(summary.uid) || 0;
            
            const dateStr = summary.lastGenerated 
                ? new Date(summary.lastGenerated).toLocaleDateString() 
                : '';
            const quoteCount = Array.isArray(summary.quotes) ? summary.quotes.length : null;
            
            const item = $(`
                <div class="comprehensive-summary-item ${isSelected ? 'selected' : ''}" data-uid="${escapeHtml(summary.uid)}">
                    <div class="summary-item-header">
                        <label class="summary-item-checkbox">
                            <input type="checkbox" ${isSelected ? 'checked' : ''}>
                            <span class="summary-item-title">${escapeHtml(summary.displayName)}</span>
                        </label>
                        ${isSelected ? `<span class="summary-order-badge">#${order}</span>` : ''}
                    </div>
                    <div class="summary-item-meta">
                        ${dateStr ? `<span>${dateStr}</span>` : ''}
                        ${quoteCount === null ? '' : `<span>${quoteCount} quotes</span>`}
                    </div>
                    ${isSelected ? `
                        <div class="summary-item-controls">
                            <button aria-label="Move summary earlier" class="summary-move-up" ${order === 1 ? 'disabled' : ''}>
                                <i class="fa-solid fa-arrow-up"></i>
                            </button>
                            <button aria-label="Move summary later" class="summary-move-down" ${order === this.selectedComprehensiveSummaries.length ? 'disabled' : ''}>
                                <i class="fa-solid fa-arrow-down"></i>
                            </button>
                        </div>
                    ` : ''}
                </div>
            `);
            
            item.find('input[type="checkbox"]').on('change', (e) => {
                this.invalidateResult();
                if ($(e.target).is(':checked')) {
                    const maxOrder = this.selectedComprehensiveSummaries.reduce((max, s) => 
                        Math.max(max, s.order), 0);
                    this.selectedComprehensiveSummaries.push({
                        uid: summary.uid,
                        order: maxOrder + 1
                    });
                } else {
                    this.selectedComprehensiveSummaries = this.selectedComprehensiveSummaries
                        .filter(s => s.uid !== summary.uid);
                    this.renumberSelectedSummaries();
                }
                this.renderComprehensiveSummaryList();
            });
            
            item.find('.summary-move-up').on('click', () => {
                this.moveSummary(summary.uid, -1);
            });
            
            item.find('.summary-move-down').on('click', () => {
                this.moveSummary(summary.uid, 1);
            });
            
            listContainer.append(item);
        });
        
        this.updateComprehensiveInfo();
    }

    moveSummary(uid, direction) {
        this.invalidateResult();
        const index = this.selectedComprehensiveSummaries.findIndex(s => s.uid === uid);
        if (index === -1) return;
        
        const currentOrder = this.selectedComprehensiveSummaries[index].order;
        const newOrder = currentOrder + direction;
        
        const swapIndex = this.selectedComprehensiveSummaries.findIndex(s => s.order === newOrder);
        if (swapIndex === -1) return;
        
        this.selectedComprehensiveSummaries[index].order = newOrder;
        this.selectedComprehensiveSummaries[swapIndex].order = currentOrder;
        
        this.renderComprehensiveSummaryList();
    }

    renumberSelectedSummaries() {
        this.selectedComprehensiveSummaries
            .sort((a, b) => a.order - b.order)
            .forEach((item, index) => {
                item.order = index + 1;
            });
    }

    updateComprehensiveInfo() {
        const infoEl = this.modal.find('.sc-comprehensive-info');
        const count = this.selectedComprehensiveSummaries.length;
        const hasCustom = this.modal.find('#sc-use-custom-summary').is(':checked') && this.customSummaryText;
        
        if (count === 0 && !hasCustom) {
            infoEl.text('');
            return;
        }
        
        const totalQuotes = this.selectedComprehensiveSummaries.reduce((sum, selected) => {
            const summary = this.availableComprehensiveSummaries.find(s => s.uid === selected.uid);
            return sum + (summary?.quotes?.length || 0);
        }, 0);
        
        const totalCount = count + (hasCustom ? 1 : 0);
        const quotesKnown = this.selectedComprehensiveSummaries.every(selected =>
            Array.isArray(this.availableComprehensiveSummaries.find(s => s.uid === selected.uid)?.quotes));
        infoEl.text(`${totalCount} ${totalCount === 1 ? 'summary' : 'summaries'}${quotesKnown ? `, ${totalQuotes} quotes` : ''}`);
    }
    
    showCustomSummaryEditor() {
        const popup = $(`
            <div class="scenariocrafter-popup">
                <div class="scenariocrafter-popup-overlay"></div>
                <div class="scenariocrafter-popup-content" style="max-width: 800px;">
                    <h2><i class="fa-solid fa-pen-to-square"></i> Custom Story Summary</h2>
                    
                    <div style="margin-bottom: 16px;">
                        <label>
                            <span>Summary Title</span>
                            <input type="text" class="scenariocrafter-input" id="custom-summary-title" 
                                value="${escapeHtml(this.customSummaryTitle)}" 
                                placeholder="Custom Background">
                        </label>
                    </div>
                    
                    <div style="margin-bottom: 16px;">
                        <label>
                            <span>Summary Text</span>
                            <textarea class="scenariocrafter-textarea" id="custom-summary-text" 
                                    rows="12" 
                                    placeholder="Enter a summary of previous events, character backgrounds, or world state...

ST macros are supported:
  {{summary}} - Current chat summary
  {{getvar::keyName}} - Chat variable value
  {{char}} / {{user}} - Character and persona names

Example:
The war between the Dragon Clans had raged for decades. {{char}} served as a scout in the Northern forces but grew disillusioned after witnessing a massacre. Current situation: {{getvar::current_arc}}">${escapeHtml(this.customSummaryText)}</textarea>
                        </label>
                    </div>
                    
                    <div style="display: flex; gap: 10px; justify-content: space-between; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <label style="margin: 0; font-size: 13px;">Chronological position:</label>
                            <select class="scenariocrafter-select" id="custom-summary-position" style="width: auto;">
                                <option value="0">First (earliest events)</option>
                                ${this.selectedComprehensiveSummaries.map((_, idx) => 
                                    `<option value="${idx + 1}">After summary #${idx + 1}</option>`
                                ).join('')}
                            </select>
                        </div>
                        
                        <div style="display: flex; gap: 10px;">
                            <button class="scenariocrafter-btn scenariocrafter-btn-secondary cancel-btn">Cancel</button>
                            <button class="scenariocrafter-btn scenariocrafter-btn-primary save-btn">
                                <i class="fa-solid fa-floppy-disk"></i> Save Summary
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `);
        
        let releaseDialog;
        const closePopup = () => {
            releaseDialog?.();
            popup.animate({ opacity: 0 }, 200, () => popup.remove());
        };

        // Set current position
        popup.find('#custom-summary-position').val(this.customSummaryOrder);
        
        popup.find('.cancel-btn, .scenariocrafter-popup-overlay').on('click', () => {
            closePopup();
        });
        
        popup.find('.save-btn').on('click', () => {
            this.invalidateResult();
            this.customSummaryTitle = popup.find('#custom-summary-title').val().trim() || 'Custom Background';
            this.customSummaryText = popup.find('#custom-summary-text').val().trim();
            this.customSummaryOrder = parseInt(popup.find('#custom-summary-position').val());
            
            // Update preview
            this.updateCustomSummaryPreview();
            this.updateComprehensiveInfo();
            
            // Auto-check the custom summary checkbox if text was entered
            if (this.customSummaryText) {
                this.modal.find('#sc-use-custom-summary').prop('checked', true);
                this.modal.find('#sc-edit-custom-summary').show();
                this.modal.find('#sc-custom-summary-preview').show();
            }
            
            closePopup();
        });
        
        $('body').append(popup);
        releaseDialog = manageDialog(popup[0], closePopup);
        popup.animate({ opacity: 1 }, 200);
        popup.find('#custom-summary-text').focus();
    }
    
    updateCustomSummaryPreview() {
        const preview = this.modal.find('#sc-custom-summary-preview');
        
        if (!this.customSummaryText) {
            preview.hide();
            return;
        }
        
        const truncated = this.customSummaryText.length > 150 
            ? this.customSummaryText.substring(0, 150) + '...'
            : this.customSummaryText;
        
        const positionText = this.customSummaryOrder === 0 
            ? 'First' 
            : `After summary #${this.customSummaryOrder}`;
        
        preview.html(`
            <div class="custom-summary-preview-header">
                <strong>${escapeHtml(this.customSummaryTitle)}</strong>
                <span class="custom-summary-position">${positionText}</span>
            </div>
            <div class="custom-summary-preview-text">${escapeHtml(truncated)}</div>
        `).show();
    }

    async getSelectedComprehensiveSummaries() {
        const hasCustom = this.modal.find('#sc-use-custom-summary').is(':checked') && this.customSummaryText;
        
        if (!this.includeComprehensive) {
            return [];
        }
        
        // Get comprehensive summaries
        const references = [...this.selectedComprehensiveSummaries]
            .sort((a, b) => a.order - b.order)
            .map(selected => {
                return this.availableComprehensiveSummaries.find(s => s.uid === selected.uid);
            })
            .filter(s => s !== undefined);

        invalidateArchiveCache();
        const summaries = [];
        for (const reference of references) {
            summaries.push(await loadComprehensiveSummary(reference));
            if (this._generationCancelled) return [];
        }
        
        // Insert custom summary at specified position
        if (hasCustom) {
            const customSummary = {
                uid: 'custom',
                displayName: this.customSummaryTitle,
                content: this.customSummaryText,
                quotes: [],
                isCustom: true
            };
            
            // Insert at customSummaryOrder position
            summaries.splice(this.customSummaryOrder, 0, customSummary);
        }
        
        return summaries;
    }

    loadCustomPrompt(promptName) {
        const settings = getSettings();
        if (settings.saved_custom_prompts[promptName]) {
            this.state.customPrompt = settings.saved_custom_prompts[promptName];
            this.modal.find('#sc-custom-prompt').val(this.state.customPrompt);
        }
    }

    saveCustomPrompt() {
        const promptText = this.state.customPrompt.trim();
        if (!promptText) {
            toastr.warning('Cannot save empty prompt', 'Scenario Crafter');
            return;
        }
        
        // Prompt for name
        const promptName = prompt('Enter a name for this custom prompt:');
        if (!promptName || !promptName.trim()) return;
        
        const settings = getSettings();
        settings.saved_custom_prompts[promptName.trim()] = promptText;
        updateSettings({ saved_custom_prompts: settings.saved_custom_prompts });
        
        // Refresh the dropdown
        this.renderScenarioOptions();
        
        // Select the newly saved prompt
        this.modal.find('#sc-custom-prompt-select').val(promptName.trim());
        
        toastr.success('Custom prompt saved!', 'Scenario Crafter');
    }

    deleteCustomPrompt(promptName) {
        if (!promptName) return;
        
        if (!confirm(`Delete custom prompt "${promptName}"?`)) return;
        
        const settings = getSettings();
        delete settings.saved_custom_prompts[promptName];
        updateSettings({ saved_custom_prompts: settings.saved_custom_prompts });
        
        // Reset state and refresh
        this.state.customPrompt = '';
        this.renderScenarioOptions();
        
        toastr.success('Custom prompt deleted', 'Scenario Crafter');
    }

    renderScenarioOptions() {
        const container = this.modal.find('#sc-scenario-options');
        // Clean up old event listeners before clearing
        container.find('*').off();
        container.empty();

        if (this.state.scenarioType === 'custom') {
            const settings = getSettings();
            const savedPrompts = settings.saved_custom_prompts || {};
            
            // Build dropdown options
            let optionsHtml = '<option value="">New Custom Prompt</option>';
            Object.keys(savedPrompts).forEach(name => {
                optionsHtml += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
            });
            
            container.html(`
                <h3 class="scenariocrafter-section-title">Custom Prompt</h3>
                <div class="scenariocrafter-custom-controls">
                    <select class="scenariocrafter-select-sm" id="sc-custom-prompt-select">
                        ${optionsHtml}
                    </select>
                    <button class="scenariocrafter-btn-icon" id="sc-save-custom" title="Save prompt">
                        <i class="fa-solid fa-floppy-disk"></i>
                    </button>
                    <button class="scenariocrafter-btn-icon" id="sc-delete-custom" title="Delete prompt" disabled>
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
                <textarea class="scenariocrafter-textarea" id="sc-custom-prompt" rows="4" placeholder="Describe the scenario you want...">${escapeHtml(this.state.customPrompt)}</textarea>
            `);
            
            // Bind events
            container.find('#sc-custom-prompt').on('input', (e) => {
                this.state.customPrompt = $(e.target).val();
            });
            
            container.find('#sc-custom-prompt-select').on('change', (e) => {
                const selected = $(e.target).val();
                const deleteBtn = container.find('#sc-delete-custom');
                
                if (selected) {
                    this.loadCustomPrompt(selected);
                    deleteBtn.prop('disabled', false);
                } else {
                    this.state.customPrompt = '';
                    container.find('#sc-custom-prompt').val('');
                    deleteBtn.prop('disabled', true);
                }
            });
            
            container.find('#sc-save-custom').on('click', () => {
                this.saveCustomPrompt();
            });
            
            container.find('#sc-delete-custom').on('click', () => {
                const selected = container.find('#sc-custom-prompt-select').val();
                this.deleteCustomPrompt(selected);
            });
        } else if (this.state.scenarioType === 'trope') {
            this.renderTropeOptions(container);
        } else if (this.state.scenarioType === 'mood') {
            this.renderMoodOptions(container);
        } else if (this.state.scenarioType === 'twist') {
            this.renderTwistOptions(container);
        }
    }

    renderTwistOptions(container) {
        const context = SillyTavern.getContext();
        
        // Check if we have an active chat
        if (!context.chat || context.chat.length === 0) {
            container.html(`
                <div class="scenariocrafter-placeholder">
                    <i class="fa-solid fa-triangle-exclamation fa-2x"></i>
                    <p>Plot twists require an active chat with messages</p>
                </div>
            `);
            return;
        }

        container.html(`
            <h3 class="scenariocrafter-section-title">Twist Category</h3>
            <div class="scenariocrafter-button-grid" id="sc-twist-categories"></div>
            <div id="sc-twist-description" class="scenariocrafter-description" style="display: none;"></div>
        `);

        const categories = getTwistCategories();
        const categoriesContainer = container.find('#sc-twist-categories');

        const categoryLabels = {
            'wholesome': 'Wholesome',
            'dramatic': 'Dramatic',
            'spicy': 'Spicy 🌶️',
            'meta': 'Meta',
            'chaos': 'Chaos'
        };

        categories.forEach(cat => {
            const label = categoryLabels[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
            const btn = $(`<button title="${escapeHtml(label)}">${escapeHtml(label)}</button>`);
            btn.on('click', () => this.selectTwistCategory(cat));
            categoriesContainer.append(btn);
        });
    }

    selectTwistCategory(category) {
        this.invalidateResult();
        this.state.category = category;
        this.state.subcategory = null;

        const container = this.modal.find('#sc-scenario-options');
        const categoriesContainer = container.find('#sc-twist-categories button');
        categoriesContainer.removeClass('active');
        categoriesContainer.filter((_, el) => $(el).text().toLowerCase().includes(category.toLowerCase())).addClass('active');

        const descriptions = {
            'wholesome': 'Funny, absurd, or lighthearted plot twists',
            'dramatic': 'Conflicts, revelations, or danger',
            'spicy': 'NSFW scenarios and romantic twists',
            'meta': 'Fourth-wall breaking and meta humor',
            'chaos': 'Reality-breaking absolute madness'
        };

        const descContainer = container.find('#sc-twist-description');
        descContainer.html(`<strong>${escapeHtml(category.charAt(0).toUpperCase() + category.slice(1))}</strong><br>${escapeHtml(descriptions[category] || 'Apply a random plot twist')}`).show();
    }

    renderTropeOptions(container) {
        container.html(`
            <h3 class="scenariocrafter-section-title">Trope Category</h3>
            <div class="scenariocrafter-button-grid" id="sc-trope-categories"></div>
            <div id="sc-trope-subcategories" style="display: none;">
                <h3 class="scenariocrafter-section-title">Trope</h3>
                <div class="scenariocrafter-button-grid" id="sc-trope-options"></div>
            </div>
            <div id="sc-trope-description" class="scenariocrafter-description" style="display: none;"></div>
        `);

        const categories = getTropeCategories();
        const categoriesContainer = container.find('#sc-trope-categories');

        categories.forEach(cat => {
            const label = cat.charAt(0).toUpperCase() + cat.slice(1);
            const btn = $(`<button title="${escapeHtml(label)}">${escapeHtml(label)}</button>`);
            btn.on('click', () => this.selectTropeCategory(cat));
            categoriesContainer.append(btn);
        });
    }

    selectTropeCategory(category) {
        this.invalidateResult();
        this.state.category = category;
        this.state.subcategory = null;

        const container = this.modal.find('#sc-scenario-options');
        const categoriesContainer = container.find('#sc-trope-categories button');
        categoriesContainer.removeClass('active');
        categoriesContainer.filter((_, el) => $(el).text().toLowerCase() === category).addClass('active');

        const tropes = getTropesByCategory(category);
        const optionsContainer = container.find('#sc-trope-options');
        optionsContainer.empty();

        Object.keys(tropes).forEach(tropeName => {
            const btn = $(`<button title="${escapeHtml(tropeName)}">${escapeHtml(tropeName)}</button>`);
            btn.on('click', () => this.selectTrope(tropeName));
            optionsContainer.append(btn);
        });

        container.find('#sc-trope-subcategories').show();
        container.find('#sc-trope-description').hide();
        // Clear any lead toggle from a previously-selected trope in the old category
        container.find('#sc-lead-toggle').remove();
        this.state.leadRole = 'char';
    }

    selectTrope(tropeName) {
        this.invalidateResult();
        this.state.subcategory = tropeName;
        // Reset lead role on every new trope selection so it never carries over stale state.
        this.state.leadRole = 'char';

        const container = this.modal.find('#sc-scenario-options');
        const optionsContainer = container.find('#sc-trope-options button');
        optionsContainer.removeClass('active');
        optionsContainer.filter((_, el) => $(el).text() === tropeName).addClass('active');

        const prompt = getTemplatePrompt('trope', this.state.category, tropeName);
        const description = getTemplateDescription('trope', this.state.category, tropeName);

        const descContainer = container.find('#sc-trope-description');
        descContainer.html(`<strong>${escapeHtml(tropeName)}</strong><br>${escapeHtml(description || prompt)}`).show();

        this.renderLeadToggle(container, 'trope', this.state.category, tropeName);
    }

    // Renders the "Who leads?" toggle, but ONLY when the selected entry has a swapped variant.
    // Presence of prompt_swapped is the single source of truth for showing this control.
    renderLeadToggle(container, type, category, subcategory) {
        // Remove any existing toggle first (e.g. when switching between tropes)
        container.find('#sc-lead-toggle').remove();

        if (!hasSwappedPrompt(type, category, subcategory)) {
            return;
        }

        const context = SillyTavern.getContext();
        const charName = this.state.selectedCharacter !== null && context.characters?.[this.state.selectedCharacter]
            ? context.characters[this.state.selectedCharacter].name
            : '{{char}}';
        const userName = context.name1 || '{{user}}';

        const toggle = $(`
            <div id="sc-lead-toggle" class="scenariocrafter-lead-toggle">
                <span class="scenariocrafter-lead-label">Who leads?</span>
                <div class="scenariocrafter-lead-buttons">
                    <button type="button" data-lead="char" class="active">${escapeHtml(charName)}</button>
                    <button type="button" data-lead="user">${escapeHtml(userName)}</button>
                </div>
            </div>
        `);

        toggle.find('button').on('click', (e) => {
            const lead = $(e.currentTarget).data('lead');
            this.invalidateResult();
            this.state.leadRole = lead;
            toggle.find('button').removeClass('active');
            $(e.currentTarget).addClass('active');
            log('Lead role set to:', lead);
        });

        // Insert the toggle right after the description block
        container.find('#sc-trope-description').after(toggle);
    }

    renderMoodOptions(container) {
        container.html(`
            <h3 class="scenariocrafter-section-title">Mood Category</h3>
            <div class="scenariocrafter-button-grid" id="sc-mood-categories"></div>
            <div id="sc-mood-situations" style="display: none;">
                <h3 class="scenariocrafter-section-title">Situation</h3>
                <div class="scenariocrafter-button-grid" id="sc-mood-options"></div>
            </div>
            <div id="sc-mood-description" class="scenariocrafter-description" style="display: none;"></div>
        `);

        const moods = getMoodCategories();
        const categoriesContainer = container.find('#sc-mood-categories');

        moods.forEach(mood => {
            const btn = $(`<button title="${escapeHtml(mood)}">${escapeHtml(mood)}</button>`);
            btn.on('click', () => this.selectMoodCategory(mood));
            categoriesContainer.append(btn);
        });
    }

    selectMoodCategory(mood) {
        this.invalidateResult();
        this.state.category = mood;
        this.state.subcategory = null;

        const container = this.modal.find('#sc-scenario-options');
        const categoriesContainer = container.find('#sc-mood-categories button');
        categoriesContainer.removeClass('active');
        categoriesContainer.filter((_, el) => $(el).text() === mood).addClass('active');

        const situations = getMoodSituations(mood);
        const optionsContainer = container.find('#sc-mood-options');
        optionsContainer.empty();

        Object.keys(situations).forEach(situationName => {
            const btn = $(`<button title="${escapeHtml(situationName)}">${escapeHtml(situationName)}</button>`);
            btn.on('click', () => this.selectMoodSituation(situationName));
            optionsContainer.append(btn);
        });

        container.find('#sc-mood-situations').show();
        container.find('#sc-mood-description').hide();
    }

    selectMoodSituation(situationName) {
        this.invalidateResult();
        this.state.subcategory = situationName;

        const container = this.modal.find('#sc-scenario-options');
        const optionsContainer = container.find('#sc-mood-options button');
        optionsContainer.removeClass('active');
        optionsContainer.filter((_, el) => $(el).text() === situationName).addClass('active');

        const prompt = getTemplatePrompt('mood', this.state.category, situationName);

        const descContainer = container.find('#sc-mood-description');
        descContainer.html(`<strong>${escapeHtml(situationName)}</strong><br>${escapeHtml(prompt)}`).show();
    }

    invalidateResult() {
        this.generationVersion++;
        this.generatedResult = null;
        this.cachedElements?.applyBtn.prop('disabled', true);
    }

    attachEventListeners() {
        if (this._listenersAttached) return;
        this._listenersAttached = true;
        this.modal.on('input change', '.scenariocrafter-config input, .scenariocrafter-config select, .scenariocrafter-config textarea', () => this.invalidateResult());
        // Store bound handlers for cleanup
        this._boundHandlers = {
            openModal: () => this.show(),
        };
        
        // External open trigger
        document.addEventListener('sc-open-modal', this._boundHandlers.openModal);

        // Close modal
        this.modal.find('.scenariocrafter-close, .scenariocrafter-modal-overlay').on('click', () => this.hide());

        // Type buttons
        this.modal.on('click', '.scenariocrafter-type-btn', (e) => {
            const type = $(e.currentTarget).data('type');
            this.switchScenarioType(type);
        });

        // Character select
        this.cachedElements.characterSelect.on('change', (e) => {
            this.state.selectedCharacter = parseInt($(e.target).val());
            this._summaryLoadId = (this._summaryLoadId || 0) + 1;
            this.availableComprehensiveSummaries = [];
            this.selectedComprehensiveSummaries = [];
            log('Character changed to:', this.state.selectedCharacter);
            
            // Reload summaries if showing (they're filtered by character)
            if (this.includeComprehensive && isSummarizerInstalled()) {
                this.loadAvailableComprehensiveSummaries();
            }
        });

        // Persona select
        this.cachedElements.personaSelect.on('change', (e) => {
            this.state.selectedPersona = $(e.target).val();
            log('Persona changed to:', this.state.selectedPersona);
        });

        // Profile select
        this.cachedElements.profileSelect.on('change', (e) => {
            this.state.connectionProfile = $(e.target).val();
        });

        // Apply mode
        this.cachedElements.applyModeSelect.on('change', (e) => {
            this.state.applyMode = $(e.target).val();
        });

        // Tone select
        this.cachedElements.toneSelect.on('change', (e) => {
            this.state.tone = $(e.target).val();
        });

        // Include history checkbox
        this.cachedElements.includeHistory.on('change', (e) => {
            this.state.includeHistory = $(e.target).is(':checked');
            this.cachedElements.historyRangeContainer.toggle(this.state.includeHistory);
        });

        // History range
        this.cachedElements.historyRange.on('change', (e) => {
            this.state.historyRange = parseInt($(e.target).val());
        });

        // Include world info checkbox
        this.cachedElements.includeWorldInfo.on('change', (e) => {
            this.state.includeWorldInfo = $(e.target).is(':checked');
            this.cachedElements.worldInfoOptions.toggle(this.state.includeWorldInfo);
        });

        // World info mode radio buttons
        this.modal.find('input[name="sc-wi-mode"]').on('change', (e) => {
            this.state.worldInfoMode = $(e.target).val();
            this.cachedElements.selectEntries.toggle(this.state.worldInfoMode === 'selected');
        });

        // Select entries button
        this.cachedElements.selectEntries.on('click', () => this.showWorldInfoSelector());

        // Comprehensive summary handlers
        this.modal.find('#sc-include-comprehensive').on('change', (e) => {
            this.includeComprehensive = $(e.target).is(':checked');
            this.cachedElements.comprehensiveOptions.toggle(this.includeComprehensive);
            if (this.includeComprehensive && isSummarizerInstalled()) {
                this.loadAvailableComprehensiveSummaries();
            }
        });
        
        // Custom summary checkbox
        this.modal.find('#sc-use-custom-summary').on('change', (e) => {
            const isChecked = $(e.target).is(':checked');
            this.modal.find('#sc-edit-custom-summary').toggle(isChecked);
            this.modal.find('#sc-custom-summary-preview').toggle(isChecked && this.customSummaryText.length > 0);
            
            if (isChecked && !this.customSummaryText) {
                // Auto-open editor if no text yet
                this.showCustomSummaryEditor();
            } else {
                this.updateComprehensiveInfo();
            }
        });
        
        // Edit custom summary button
        this.modal.find('#sc-edit-custom-summary').on('click', () => {
            this.showCustomSummaryEditor();
        });

        // Generate button
        this.cachedElements.generateBtn.on('click', () => this.isInitialized ? this.handleGenerate() : this.show());

        // View prompt button
        this.cachedElements.viewPrompt.on('click', () => this.viewPrompt());

        // Apply button
        this.cachedElements.applyBtn.on('click', () => this.handleApply());

    }

    switchScenarioType(type) {
        this.invalidateResult();
        this.state.scenarioType = type;
        this.state.category = null;
        this.state.subcategory = null;

        this.modal.find('.scenariocrafter-type-btn').removeClass('active');
        this.modal.find(`.scenariocrafter-type-btn[data-type="${type}"]`).addClass('active');

        this.renderScenarioOptions();
    }

    async showWorldInfoSelector() {
        const selector = new WorldInfoSelector(this.state.enabledBooks, this.state.selectedEntries, this.state);
        const result = await selector.show();
        if (result) {
            this.invalidateResult();
            this.state.selectedEntries = result;
            updateSettings({ selected_entries: result });
        }
    }

    async handleGenerate() {
        if (this.isGenerating || this.isApplying || this._charactersDirty) return;
        this.invalidateResult();
        const version = this.generationVersion;
        this.isGenerating = true;
        this._generationCancelled = false;
        this.state.generatedText = '';
        this.lastPrompt = null;
        this.cachedElements.viewPrompt.prop('disabled', true);
        this.cachedElements.scenarioNote.val('');
        const btn = this.cachedElements.generateBtn;
        const originalHtml = btn.html();
        const outputContent = this.cachedElements.outputContent;
        btn.removeClass('scenariocrafter-btn-primary').addClass('scenariocrafter-btn-danger');
        btn.html('<i class="fa-solid fa-stop"></i> Stop');
        btn.off('click').on('click', () => {
            this._generationCancelled = true;
            btn.prop('disabled', true).html('Stopping...');
            const context = SillyTavern.getContext();
            context.eventSource.emit(context.event_types.GENERATION_STOPPED);
        });
        outputContent.html('<div class="scenariocrafter-loading"><i class="fa-solid fa-spinner fa-spin fa-3x"></i></div>');
        try {
            const result = await generateScenarioDraft({ ...this.state, includeComprehensive: this.includeComprehensive }, {
                shouldCancel: () => this._generationCancelled || version !== this.generationVersion,
                prepareSummaries: () => this.getSelectedComprehensiveSummaries(),
                onSummary: () => btn.html('<i class="fa-solid fa-stop"></i> Stop (writing scenario note)'),
            });
            if (this._generationCancelled || version !== this.generationVersion) return;
            this.generatedResult = result;
            this.state.generatedText = result.text;
            this.state.scenarioSummary = result.summary;
            this.lastPrompt = result.prompt;
            outputContent.empty();
            const textarea = $('<textarea class="scenariocrafter-textarea" id="sc-generated-text" rows="15" aria-label="Generated scenario"></textarea>');
            textarea.val(result.text).on('input', () => {
                this.state.generatedText = textarea.val();
                this.cachedElements.applyBtn.prop('disabled', !this.generatedResult || !this.state.generatedText.trim());
            });
            outputContent.append(textarea);
            this.cachedElements.scenarioNote.val(result.summary);
            this.cachedElements.viewPrompt.prop('disabled', false);
            this.cachedElements.applyBtn.prop('disabled', false);
            toastr.success('Scenario generated!', 'Scenario Crafter');
        } catch (error) {
            const cancelled = this._generationCancelled || version !== this.generationVersion;
            outputContent.html(`<div class="scenariocrafter-error"><p>${escapeHtml(cancelled
                ? 'Generation stopped or the configuration changed. Generate again when ready.'
                : error.message || 'Failed to generate scenario')}</p></div>`);
            if (!cancelled) { logError('Generation error:', error); toastr.error(error.message, 'Scenario Crafter'); }
        } finally {
            this.isGenerating = false;
            this._generationCancelled = false;
            btn.removeClass('scenariocrafter-btn-danger').addClass('scenariocrafter-btn-primary');
            btn.prop('disabled', !!this._charactersDirty).html(originalHtml);
            btn.off('click').on('click', () => this.handleGenerate());
        }
    }

    viewPrompt() {
        if (!this.lastPrompt) return;

        // Get character and persona names for display
        const context = SillyTavern.getContext();
        const char = context.characters[this.state.selectedCharacter];
        const charName = char?.name || 'Character';
        const userName = this.state.selectedPersona 
            ? (power_user.personas[this.state.selectedPersona] || context.name1 || 'User')
            : (context.name1 || 'User');

        // Build pretty formatted messages showing FULL prompt
        let messagesHtml = '';
        this.lastPrompt.forEach((msg, idx) => {
            let content = msg.content
                .replace(/\[CHARACTER\]/g, charName)
                .replace(/\[USER\]/g, userName);
            
            messagesHtml += `
                <div class="scenariocrafter-prompt-message">
                    <div class="scenariocrafter-prompt-role">
                        ${escapeHtml(msg.role.toUpperCase())} ${idx > 0 ? `(Message ${idx})` : ''}
                    </div>
                    <div class="scenariocrafter-prompt-content">${escapeHtml(content)}</div>
                </div>
            `;
        });

        const promptHtml = `
            <div class="scenariocrafter-prompt-view">
                <div class="scenariocrafter-prompt-header">
                    <h3>Full Generation Prompt</h3>
                    <div class="scenariocrafter-prompt-info">
                        <strong>Character:</strong> ${escapeHtml(charName)} | <strong>User:</strong> ${escapeHtml(userName)}
                    </div>
                </div>
                <div class="scenariocrafter-prompt-messages">
                    ${messagesHtml}
                </div>
            </div>
        `;

        const popup = $(`
            <div class="scenariocrafter-popup">
                <div class="scenariocrafter-popup-overlay"></div>
                <div class="scenariocrafter-popup-content scenariocrafter-prompt-popup">
                    ${promptHtml}
                    <button class="scenariocrafter-btn scenariocrafter-btn-secondary scenariocrafter-popup-close">Close</button>
                </div>
            </div>
        `);

        let releaseDialog;
        const closePopup = () => {
            releaseDialog?.();
            popup.animate({ opacity: 0 }, 200, () => popup.remove());
        };

        popup.find('.scenariocrafter-popup-close, .scenariocrafter-popup-overlay').on('click', () => {
            closePopup();
        });

        $('body').append(popup);
        releaseDialog = manageDialog(popup[0], closePopup);
        popup.animate({ opacity: 1 }, 200);
    }

    async handleApply() {
        if (this.isGenerating || this.isApplying || !this.generatedResult) return;
        const result = this.generatedResult;
        const applyBtn = this.cachedElements.applyBtn;
        this.isApplying = true;
        applyBtn.prop('disabled', true).html('Applying...');
        try {
            assertScenarioTarget(result.target, SillyTavern.getContext());
            await applyScenarioDraft(result, {
                text: this.state.generatedText,
                addInjection: this.cachedElements.addInjection.is(':checked'),
                scenarioNote: this.cachedElements.scenarioNote.val(),
                injectionDepth: getSettings().injection_depth,
            });
            this.invalidateResult();
            toastr.success('Scenario applied!', 'Scenario Crafter');
            this.hide();
        } catch (error) {
            logError('Apply error:', error);
            toastr.error(error.message, 'Scenario Crafter');
        } finally {
            this.isApplying = false;
            applyBtn.prop('disabled', !this.generatedResult).html('<i class="fa-solid fa-paper-plane"></i> Apply Scenario');
        }
    }

    async show() {
        if (this._destroyed) return;
        try {
            if (this.generatedResult) {
                try { assertScenarioTarget(this.generatedResult.target, SillyTavern.getContext()); }
                catch { this.invalidateResult(); }
            }
            const settings = getSettings();
            for (const [key, field] of [['apply_mode', 'applyMode'], ['default_tone', 'tone'], ['profileId', 'connectionProfile'],
                ['include_chat_history', 'includeHistory'], ['history_range', 'historyRange'],
                ['include_world_info', 'includeWorldInfo'], ['world_info_mode', 'worldInfoMode']]) {
                if (settings[key] !== this.defaultSettings[key]) { this.state[field] = settings[key]; this.invalidateResult(); }
            }
            if (settings.add_scenario_injection !== this.defaultSettings.add_scenario_injection) {
                this.cachedElements.addInjection.prop('checked', settings.add_scenario_injection);
            }
            this.defaultSettings = settings;
            this.modal.css('display', 'flex');
            this.modal[0].offsetHeight;
            this.modal.addClass('scenariocrafter-modal-visible');
            $('body').addClass('scenariocrafter-modal-open');
            if (!this.releaseDialog) this.releaseDialog = manageDialog(this.modal[0], () => this.hide());
            requestAnimationFrame(() => this.draggableModal?.clamp());
            this.attachEventListeners();
            if (!this.isInitialized) return await this.initialize();

            if (this._charactersDirty && !await this.populateCharacters()) return;
            if (this._destroyed || !this.modal.hasClass('scenariocrafter-modal-visible')) return;
            if (this.characterSelector.needsRender && !await this.characterSelector.render()) return;
            if (this.personaSelector.needsRender && !await this.personaSelector.render()) return;
            if (this._destroyed || !this.modal.hasClass('scenariocrafter-modal-visible')) return;
            this.updateChatDependentControls();
            this.cachedElements.applyModeSelect.val(this.state.applyMode);
            this.populateToneSelector();
            this.cachedElements.profileSelect.val(this.state.connectionProfile);
            this.cachedElements.includeHistory.prop('checked', this.state.includeHistory);
            this.cachedElements.historyRange.val(this.state.historyRange);
            this.cachedElements.historyRangeContainer.toggle(this.state.includeHistory);
            this.cachedElements.includeWorldInfo.prop('checked', this.state.includeWorldInfo);
            this.cachedElements.worldInfoOptions.toggle(this.state.includeWorldInfo);
            this.modal.find(`input[name="sc-wi-mode"][value="${this.state.worldInfoMode}"]`).prop('checked', true);
            this.cachedElements.selectEntries.toggle(this.state.worldInfoMode === 'selected');
        } catch (error) {
            logError('Could not open Scenario Crafter:', error);
            toastr.error('Could not open Scenario Crafter. Close and reopen the panel to retry.', 'Scenario Crafter');
        }
    }

    cancelLoading() {
        this._initializationController?.abort();
        this._initializationController = null;
        this._initializationPromise = null;
        this.characterSelector.cancel();
        this.personaSelector.cancel();
        this.modal?.attr('aria-busy', 'false');
    }

    hide() {
        this.cancelLoading();
        this.releaseDialog?.();
        this.releaseDialog = null;
        this.modal.removeClass('scenariocrafter-modal-visible');
        // Wait for transition before hiding
        setTimeout(() => {
            if (this.modal && !this.modal.hasClass('scenariocrafter-modal-visible')) {
                this.modal.css('display', 'none');
            }
        }, 200);
        $('body').removeClass('scenariocrafter-modal-open');
    }
    
    destroy() {
        log('Destroying modal...');
        this._destroyed = true;
        this.cancelLoading();
        this.characterSelector.destroy();
        this.personaSelector.destroy();
        this._generationCancelled = true;
        this.invalidateResult();
        this.releaseDialog?.();
        const context = SillyTavern.getContext();
        context.eventSource.removeListener(context.event_types.CHAT_CHANGED, this.onChatChanged);
        this.draggableModal?.destroy();
        
        // Remove document-level event listeners
        if (this._boundHandlers) {
            document.removeEventListener('sc-open-modal', this._boundHandlers.openModal);
        }
        
        // Remove modal event listeners
        this.modal.off();
        this.modal.find('*').off();
        
        // Remove modal from DOM
        this.modal.remove();
        
        // Clear references
        this.cachedElements = null;
        this._boundHandlers = null;
        this.draggableModal = null;
        this.modal = null;
        
        log('Modal destroyed');
    }
}
