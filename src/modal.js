import { getSettings, updateSettings } from './settings.js';
import { loadTemplates, loadTwists, getTemplatePrompt, getTemplateDescription, 
         getTropeCategories, getTropesByCategory, getMoodCategories, getMoodSituations,
         getTwistCategories } from './templates.js';
import { generateScenario, generateSummary } from './generator.js';
import { WorldInfoSelector } from './worldinfo-selector.js';
import { getUserAvatars, user_avatar } from '../../../../personas.js';
import { log, logError, escapeHtml, buildDisplayName, countNames } from './utils.js';
import { power_user } from '../../../../power-user.js';
import { isSummarizerInstalled, getComprehensiveSummaries, invalidateArchiveCache } from './summarizer-integration.js';

export class ScenarioCrafterModal {
    constructor() {
        this.state = {
            scenarioType: 'trope',
            applyMode: 'new-chat',
            category: null,
            subcategory: null,
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
            selectedEntries: { ...getSettings().selected_entries },
        };
        
        this.isGenerating = false;
        this.lastPrompt = null;
        this.cachedElements = null;
        this.isInitialized = false;

        this.includeComprehensive = false;
        this.selectedComprehensiveSummaries = [];
        this.availableComprehensiveSummaries = [];
        
        this.customSummaryText = '';
        this.customSummaryTitle = 'Custom Background';
        this.customSummaryOrder = 0;
        
        this.createModal();
    }

    async loadInitialData() {
        try {
            // Load templates and twists
            await Promise.all([loadTemplates(), loadTwists()]);
            
            // Populate UI elements
            this.populateCharacters();
            this.populateToneSelector();
            
            // Defer non-critical loading
            requestAnimationFrame(() => {
                this.populateConnectionProfiles();
                this.updateChatDependentControls();
                this.renderScenarioOptions();
                this.setInitialCheckboxStates();
            });
            
            // Load personas asynchronously (they're slow)
            this.populatePersonas();
        } catch (error) {
            logError('Failed to load initial data:', error);
            toastr.error('Failed to initialize Scenario Crafter', 'Error');
        }
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
        if (hasActiveChat && context.characterId !== undefined && context.characterId !== null) {
            const charId = parseInt(context.characterId);
            if (!isNaN(charId) && charId >= 0 && charId < (context.characters?.length || 0)) {
                this.state.selectedCharacter = charId;
                this.cachedElements.characterSelect.val(charId);
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
        this.cachedElements.addInjection.prop('checked', true);
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
                        <button class="scenariocrafter-close">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>

                    <div class="scenariocrafter-layout">
                        <!-- LEFT PANE: Configuration -->
                        <div class="scenariocrafter-config">
                            <div class="scenariocrafter-section">
                                <h3 class="scenariocrafter-section-title">Active Context</h3>
                                <div class="scenariocrafter-context-selectors">
                                    <label>
                                        <span>Character</span>
                                        <select class="scenariocrafter-select" id="sc-character-select"></select>
                                    </label>
                                    <label>
                                        <span>Persona</span>
                                        <select class="scenariocrafter-select" id="sc-persona-select"></select>
                                    </label>
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
                                            <button class="scenariocrafter-btn-icon" id="sc-edit-custom-summary" style="display:none;">
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

    populateCharacters() {
        const context = SillyTavern.getContext();
        const select = this.cachedElements.characterSelect;
        select.empty();

        if (!context.characters || context.characters.length === 0) {
            select.append('<option value="">No characters loaded</option>');
            this.state.selectedCharacter = null;
            return;
        }

        let characters = context.characters;

        // Use utility function for duplicate handling
        const nameCounts = countNames(characters, char => char.name || 'Unknown');

        characters.forEach((char, index) => {
            const name = char.name || 'Unknown';
            const avatar = char.avatar || '';
            
            const displayName = buildDisplayName(name, avatar, null, nameCounts);
            
            const option = $(`<option value="${index}">${escapeHtml(displayName)}</option>`);
            select.append(option);
        });

        // Set active character as selected (only if chat is loaded)
        let activeCharIndex = null;
        if (context.chatId !== undefined && context.characterId !== undefined && context.characterId !== null) {
            activeCharIndex = context.characterId;
        } else if (characters.length > 0) {
            // Default to first character
            activeCharIndex = 0;
        }

        this.state.selectedCharacter = activeCharIndex;
        if (activeCharIndex !== null) {
            select.val(activeCharIndex);
        }

        log('Set active character to index:', activeCharIndex);
    }

    async populatePersonas() {
        const context = SillyTavern.getContext();
        const select = this.cachedElements.personaSelect;
        select.empty();
        
        // Get current persona avatar
        const currentPersonaAvatar = user_avatar;
        
        // Get all available personas
        try {
            const userAvatars = await getUserAvatars(false);
            
            if (userAvatars.length === 0) {
                log('No personas found');
                return;
            }
            
            let personas = userAvatars.map(avatar => ({
                name: power_user.personas[avatar] || avatar,
                avatar: avatar,
                title: power_user.persona_descriptions?.[avatar]?.title || '',
                filename: avatar
            }));

            // If active persona is NOT in the list, add it to the top
            const activePersonaInList = personas.some(p => p.avatar === currentPersonaAvatar);
            if (!activePersonaInList) {
                const activePersonaData = userAvatars.find(avatar => avatar === currentPersonaAvatar);
                if (activePersonaData) {
                    personas.unshift({
                        name: power_user.personas[activePersonaData] || activePersonaData,
                        avatar: activePersonaData,
                        title: power_user.persona_descriptions?.[activePersonaData]?.title || '',
                        filename: activePersonaData
                    });
                }
            }
            
            // Check for duplicate names
            const nameCounts = {};
            personas.forEach(persona => {
                nameCounts[persona.name] = (nameCounts[persona.name] || 0) + 1;
            });
            
            // Build display names
            const processedPersonas = personas.map(persona => {
                // Always show title if available
                if (persona.title) {
                    return {
                        ...persona,
                        displayName: `${persona.name} (${persona.title})`
                    };
                }
                
                // If there are duplicates and no title, use filename
                if (nameCounts[persona.name] > 1) {
                    return {
                        ...persona,
                        displayName: `${persona.name} (${persona.filename})`
                    };
                }
                
                // Just the name
                return {
                    ...persona,
                    displayName: persona.name
                };
            });
            
            // Add to dropdown with selected state
            processedPersonas.forEach(persona => {
                const isSelected = persona.avatar === currentPersonaAvatar;
                select.append(`<option value="${persona.avatar}" ${isSelected ? 'selected' : ''}>${escapeHtml(persona.displayName)}</option>`);
            });
            
            // Set selected persona state
            if (this.state.selectedPersona === null) {
                this.state.selectedPersona = currentPersonaAvatar;
            }
            
            log('Populated personas:', processedPersonas.length);
        } catch (error) {
            logError('Error loading personas:', error);
        }
    }

    async populateConnectionProfiles() {
        const context = SillyTavern.getContext();
        const select = this.cachedElements.profileSelect;
        select.empty();

        select.append('<option value="">Default Connection</option>');

        // Check if connection profiles extension is active
        if ($('#sys-settings-button').find('#connection_profiles').length === 0) {
            log('Connection profiles extension not active');
            return;
        }

        try {
            const result = await context.executeSlashCommandsWithOptions('/profile-list');
            const profiles = JSON.parse(result.pipe);
            
            profiles.forEach(profileName => {
                const isSelected = profileName === this.state.connectionProfile;
                const option = $(`<option value="${profileName}">${escapeHtml(profileName)}</option>`);
                if (isSelected) {
                    option.prop('selected', true);
                }
                select.append(option);
            });
            
            log('Populated connection profiles:', profiles.length);
        } catch (error) {
            logError('Failed to load connection profiles:', error);
        }
    }

    async loadAvailableComprehensiveSummaries() {
        if (!isSummarizerInstalled()) {
            log('Simple Summarizer not installed, skipping comprehensive summary load');
            return;
        }
        
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
                charName ? { characterName: charName } : {}
            );
            
            if (summaries.length === 0) {
                listContainer.html('<div class="comprehensive-summary-empty">No summaries available</div>');
                this.availableComprehensiveSummaries = [];
                return;
            }
            
            this.availableComprehensiveSummaries = summaries.map(s => ({
                uid: s.chatFilename,       // Use chatFilename as unique ID
                chatFilename: s.chatFilename,
                displayName: s.displayName,
                content: s.content,
                quotes: s.quotes,
                lastGenerated: s.lastGenerated,
                characterName: s.characterName,
            }));
            
            this.renderComprehensiveSummaryList();
            
            log('Found', this.availableComprehensiveSummaries.length, 'comprehensive summaries');
            
        } catch (error) {
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
            const quoteCount = summary.quotes?.length || 0;
            
            const item = $(`
                <div class="comprehensive-summary-item ${isSelected ? 'selected' : ''}" data-uid="${summary.uid}">
                    <div class="summary-item-header">
                        <label class="summary-item-checkbox">
                            <input type="checkbox" ${isSelected ? 'checked' : ''}>
                            <span class="summary-item-title">${escapeHtml(summary.displayName)}</span>
                        </label>
                        ${isSelected ? `<span class="summary-order-badge">#${order}</span>` : ''}
                    </div>
                    <div class="summary-item-meta">
                        ${dateStr ? `<span>${dateStr}</span>` : ''}
                        <span>${quoteCount} quotes</span>
                    </div>
                    ${isSelected ? `
                        <div class="summary-item-controls">
                            <button class="summary-move-up" ${order === 1 ? 'disabled' : ''}>
                                <i class="fa-solid fa-arrow-up"></i>
                            </button>
                            <button class="summary-move-down" ${order === this.selectedComprehensiveSummaries.length ? 'disabled' : ''}>
                                <i class="fa-solid fa-arrow-down"></i>
                            </button>
                        </div>
                    ` : ''}
                </div>
            `);
            
            item.find('input[type="checkbox"]').on('change', (e) => {
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
        infoEl.text(`${totalCount} ${totalCount === 1 ? 'summary' : 'summaries'}, ${totalQuotes} quotes`);
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
        
        // Set current position
        popup.find('#custom-summary-position').val(this.customSummaryOrder);
        
        popup.find('.cancel-btn, .scenariocrafter-popup-overlay').on('click', () => {
            popup.animate({ opacity: 0 }, 200, () => popup.remove());
        });
        
        popup.find('.save-btn').on('click', () => {
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
            
            popup.animate({ opacity: 0 }, 200, () => popup.remove());
        });
        
        $('body').append(popup);
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

    getSelectedComprehensiveSummaries() {
        const hasCustom = this.modal.find('#sc-use-custom-summary').is(':checked') && this.customSummaryText;
        
        if (!this.includeComprehensive) {
            return [];
        }
        
        // Get comprehensive summaries
        let summaries = this.selectedComprehensiveSummaries
            .sort((a, b) => a.order - b.order)
            .map(selected => {
                return this.availableComprehensiveSummaries.find(s => s.uid === selected.uid);
            })
            .filter(s => s !== undefined);
        
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
    }

    selectTrope(tropeName) {
        this.state.subcategory = tropeName;

        const container = this.modal.find('#sc-scenario-options');
        const optionsContainer = container.find('#sc-trope-options button');
        optionsContainer.removeClass('active');
        optionsContainer.filter((_, el) => $(el).text() === tropeName).addClass('active');

        const prompt = getTemplatePrompt('trope', this.state.category, tropeName);
        const description = getTemplateDescription('trope', this.state.category, tropeName);

        const descContainer = container.find('#sc-trope-description');
        descContainer.html(`<strong>${escapeHtml(tropeName)}</strong><br>${escapeHtml(description || prompt)}`).show();
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
        this.state.subcategory = situationName;

        const container = this.modal.find('#sc-scenario-options');
        const optionsContainer = container.find('#sc-mood-options button');
        optionsContainer.removeClass('active');
        optionsContainer.filter((_, el) => $(el).text() === situationName).addClass('active');

        const prompt = getTemplatePrompt('mood', this.state.category, situationName);

        const descContainer = container.find('#sc-mood-description');
        descContainer.html(`<strong>${escapeHtml(situationName)}</strong><br>${escapeHtml(prompt)}`).show();
    }

    attachEventListeners() {
        // Store bound handlers for cleanup
        this._boundHandlers = {
            openModal: () => this.show(),
            escapeKey: (e) => {
                if (!this.modal.is(':visible')) return;
                if (e.key === 'Escape') this.hide();
            }
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
        this.cachedElements.generateBtn.on('click', () => this.handleGenerate());

        // View prompt button
        this.cachedElements.viewPrompt.on('click', () => this.viewPrompt());

        // Apply button
        this.cachedElements.applyBtn.on('click', () => this.handleApply());

        // Escape key (using bound handler for cleanup)
        $(document).on('keydown.scenariocrafter', this._boundHandlers.escapeKey);
    }

    switchScenarioType(type) {
        this.state.scenarioType = type;
        this.state.category = null;
        this.state.subcategory = null;

        this.modal.find('.scenariocrafter-type-btn').removeClass('active');
        this.modal.find(`.scenariocrafter-type-btn[data-type="${type}"]`).addClass('active');

        this.renderScenarioOptions();
    }

    async showWorldInfoSelector() {
        const selector = new WorldInfoSelector(this.state.enabledBooks, this.state.selectedEntries);
        const result = await selector.show();
        if (result) {
            this.state.selectedEntries = result;
            updateSettings({ selected_entries: result });
        }
    }

    async handleGenerate() {
        if (this.isGenerating) return;

        this.isGenerating = true;
        this._generationCancelled = false;
        const btn = this.cachedElements.generateBtn;
        const originalHtml = btn.html();

        // Clear any existing injection from a previous scenario so it doesn't persist during generation
        try {
            const { extension_prompt_types } = await import('../../../../../script.js');
            const ctx = SillyTavern.getContext();
            ctx.setExtensionPrompt('scenariocrafter_inject', '', extension_prompt_types.IN_CHAT, 0, false);
        } catch (e) {
            logError('Failed to clear old injection:', e);
        }
        
        // Clear stale scenario note from previous generation
        this.cachedElements.scenarioNote.val('');
        this.state.scenarioSummary = '';

        // Switch to Stop button
        btn.removeClass('scenariocrafter-btn-primary').addClass('scenariocrafter-btn-danger');
        btn.html('<i class="fa-solid fa-stop"></i> Stop');
        btn.off('click').on('click', () => {
            if (!this.isGenerating) return;
            this._generationCancelled = true;
            log('Generation cancelled by user');
            btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Stopping...');
            try {
                const ctx = SillyTavern.getContext();
                if (ctx.eventSource && ctx.event_types?.GENERATION_STOPPED) {
                    ctx.eventSource.emit(ctx.event_types.GENERATION_STOPPED);
                }
            } catch (e) {
                logError('Failed to emit stop event:', e);
            }
        });

        const outputContent = this.cachedElements.outputContent;
        outputContent.html('<div class="scenariocrafter-loading"><i class="fa-solid fa-spinner fa-spin fa-3x"></i></div>');

        // Save current profile ONCE at the start
        let currentProfile = null;
        const context = SillyTavern.getContext();
        
        try {
            // Switch to connection profile if specified
            if (this.state.connectionProfile) {
                const profilesActive = $('#sys-settings-button').find('#connection_profiles').length > 0;
                
                if (profilesActive) {
                    const currentResult = await context.executeSlashCommandsWithOptions('/profile');
                    currentProfile = currentResult.pipe;
                    
                    if (currentProfile !== this.state.connectionProfile) {
                        log('Switching to connection profile:', this.state.connectionProfile);
                        await context.executeSlashCommandsWithOptions(`/profile ${this.state.connectionProfile}`);
                        // Wait for profile to fully apply
                        await new Promise(resolve => setTimeout(resolve, 1500));
                    }
                }
            }

            // Get selected comprehensive summaries
            const comprehensiveSummaries = this.getSelectedComprehensiveSummaries();

            // Update state
            this.state.includeComprehensive = this.includeComprehensive;
            this.state.selectedComprehensiveSummaries = comprehensiveSummaries;

            // Generate scenario
            const result = await generateScenario(this.state);
            
            if (this._generationCancelled) return;
            
            this.state.generatedText = result.text;
            this.lastPrompt = result.prompt;

            // Clear loading, show textarea
            outputContent.empty();
            
            const textarea = $('<textarea class="scenariocrafter-textarea" id="sc-generated-text" rows="15"></textarea>');
            textarea.val(result.text);
            outputContent.append(textarea);
            
            // Bind input handler
            textarea.on('input', () => {
                this.state.generatedText = textarea.val();
            });

            this.cachedElements.viewPrompt.prop('disabled', false);
            this.cachedElements.applyBtn.prop('disabled', false);
            
            // Generate summary (still on scenario profile)
            const char = context.characters[this.state.selectedCharacter];
            const charName = char?.name || 'Character';
            
            btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Generating summary...');
            const summary = await generateSummary(result.text, charName);
            this.state.scenarioSummary = summary;
            this.cachedElements.scenarioNote.val(summary);
            
            toastr.success('Scenario generated!', 'Scenario Crafter');

        } catch (error) {
            if (this._generationCancelled) {
                log('Generation was cancelled');
                outputContent.html(`
                    <div class="scenariocrafter-placeholder">
                        <i class="fa-solid fa-hand fa-3x"></i>
                        <p>Generation stopped</p>
                    </div>
                `);
                toastr.info('Generation stopped', 'Scenario Crafter');
            } else {
                logError('Generation error:', error);
                outputContent.html(`
                    <div class="scenariocrafter-error">
                        <i class="fa-solid fa-triangle-exclamation fa-3x"></i>
                        <p>${escapeHtml(error.message || 'Failed to generate scenario')}</p>
                    </div>
                `);
                toastr.error('Generation failed', 'Scenario Crafter');
            }
        } finally {
            // Restore connection profile AFTER all generation is complete
            if (currentProfile && this.state.connectionProfile && currentProfile !== this.state.connectionProfile) {
                log('Restoring connection profile:', currentProfile);
                await context.executeSlashCommandsWithOptions(`/profile ${currentProfile}`);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            this.isGenerating = false;
            this._generationCancelled = false;
            btn.removeClass('scenariocrafter-btn-danger').addClass('scenariocrafter-btn-primary');
            btn.prop('disabled', false).html(originalHtml);
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

        popup.find('.scenariocrafter-popup-close, .scenariocrafter-popup-overlay').on('click', () => {
            popup.animate({ opacity: 0 }, 200, () => popup.remove());
        });

        $('body').append(popup);
        popup.animate({ opacity: 1 }, 200);
    }

    async handleApply() {
        if (!this.state.generatedText) return;

        const applyMode = this.state.applyMode;
        const addInjection = this.cachedElements.addInjection.is(':checked');
        const scenarioNote = this.cachedElements.scenarioNote.val();
        
        const context = SillyTavern.getContext();
        const settings = getSettings();
        
        const applyBtn = this.cachedElements.applyBtn;
        applyBtn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Applying...');

        try {
            // Switch to selected persona if different from current
            if (this.state.selectedPersona && this.state.selectedPersona !== window.user_avatar) {
                log('Switching to persona:', this.state.selectedPersona);
                applyBtn.html('<i class="fa-solid fa-spinner fa-spin"></i> Switching persona...');
                
                const { setUserAvatar } = await import('../../../../personas.js');
                await setUserAvatar(this.state.selectedPersona);
                
                // Brief wait for persona switch to complete
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            if (applyMode === 'rewrite-last') {
                // REWRITE MODE: Replace last message
                if (!context.chat || context.chat.length === 0) {
                    throw new Error('No chat history to rewrite');
                }
                
                applyBtn.html('<i class="fa-solid fa-spinner fa-spin"></i> Rewriting message...');
                
                const lastMessage = context.chat[context.chat.length - 1];
                lastMessage.mes = this.state.generatedText;
                
                await context.saveChat();
                await context.reloadCurrentChat();
                
                toastr.success('Message rewritten!', 'Scenario Crafter');
                
            } else if (applyMode === 'new-chat') {
                // NEW CHAT MODE
                log('Switching to character index:', this.state.selectedCharacter);
                applyBtn.html('<i class="fa-solid fa-spinner fa-spin"></i> Switching character...');
                
                await context.selectCharacterById(this.state.selectedCharacter);
                // Wait for character switch to process
                await new Promise(resolve => setTimeout(resolve, 300));
                
                applyBtn.html('<i class="fa-solid fa-spinner fa-spin"></i> Creating new chat...');
                
                // Create new chat
                await context.executeSlashCommandsWithOptions('/newchat');
                // Wait for new chat creation
                await new Promise(resolve => setTimeout(resolve, 200));
                
                // Delete the default greeting
                await context.executeSlashCommandsWithOptions('/del 1');
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Add injection if requested
                if (addInjection && scenarioNote) {
                    const { extension_prompt_types, extension_prompt_roles } = await import('../../../../../script.js');
                    
                    context.setExtensionPrompt(
                        'scenariocrafter_inject',
                        `[Scenario: ${scenarioNote}]`,
                        extension_prompt_types.IN_CHAT,
                        settings.injection_depth,
                        false,
                        extension_prompt_roles.SYSTEM
                    );
                }
                
                const char = context.characters[this.state.selectedCharacter];
                const charName = char?.name || 'Character';
                
                applyBtn.html('<i class="fa-solid fa-spinner fa-spin"></i> Sending message...');
                await context.executeSlashCommandsWithOptions(`/sendas name="${charName}" ${this.state.generatedText}`);
                await new Promise(resolve => setTimeout(resolve, 300));
                
                toastr.success('Scenario applied!', 'Scenario Crafter');
                
            } else {
                // APPEND MODE
                if (addInjection && scenarioNote) {
                    const { extension_prompt_types, extension_prompt_roles } = await import('../../../../../script.js');
                    
                    context.setExtensionPrompt(
                        'scenariocrafter_inject',
                        `[Scenario: ${scenarioNote}]`,
                        extension_prompt_types.IN_CHAT,
                        settings.injection_depth,
                        false,
                        extension_prompt_roles.SYSTEM
                    );
                }
                
                const char = context.characters[this.state.selectedCharacter];
                const charName = char?.name || 'Character';
                
                applyBtn.html('<i class="fa-solid fa-spinner fa-spin"></i> Sending message...');
                await context.executeSlashCommandsWithOptions(`/sendas name="${charName}" ${this.state.generatedText}`);
                
                toastr.success('Scenario applied!', 'Scenario Crafter');
            }

            // Re-enable button before hiding
            applyBtn.prop('disabled', false).html('<i class="fa-solid fa-paper-plane"></i> Apply Scenario');
            this.hide();

        } catch (error) {
            logError('Apply error:', error);
            toastr.error('Failed to apply scenario: ' + error.message, 'Scenario Crafter');
            applyBtn.prop('disabled', false).html('<i class="fa-solid fa-paper-plane"></i> Apply Scenario');
        }
    }

    async show() {
        // Lazy initialize on first show
        if (!this.isInitialized) {
            this.isInitialized = true;
            
            // Show modal first
            this.modal.css('display', 'flex');
            this.modal[0].offsetHeight; // Force reflow
            this.modal.addClass('scenariocrafter-modal-visible');
            $('body').addClass('scenariocrafter-modal-open');
            
            // Attach event listeners FIRST
            this.attachEventListeners();
            
            // Then load data
            try {
                await this.loadInitialData();
            } catch (error) {
                logError('Failed to initialize modal:', error);
                toastr.error('Failed to load Scenario Crafter', 'Error');
                this.hide();
            }
        } else {
            // Already initialized, just show and update chat-dependent controls
            this.modal.css('display', 'flex');
            this.modal[0].offsetHeight; // Force reflow
            this.modal.addClass('scenariocrafter-modal-visible');
            $('body').addClass('scenariocrafter-modal-open');
            
            // Update controls based on current chat state
            this.updateChatDependentControls();
        }
    }

    hide() {
        this.modal.removeClass('scenariocrafter-modal-visible');
        // Wait for transition before hiding
        setTimeout(() => {
            if (!this.modal.hasClass('scenariocrafter-modal-visible')) {
                this.modal.css('display', 'none');
            }
        }, 200);
        $('body').removeClass('scenariocrafter-modal-open');
    }
    
    destroy() {
        console.log('[ScenarioCrafter] Destroying modal...');
        
        // Remove document-level event listeners
        if (this._boundHandlers) {
            document.removeEventListener('sc-open-modal', this._boundHandlers.openModal);
            $(document).off('keydown.scenariocrafter', this._boundHandlers.escapeKey);
        }
        
        // Remove modal event listeners
        this.modal.off();
        this.modal.find('*').off();
        
        // Remove modal from DOM
        this.modal.remove();
        
        // Clear references
        this.cachedElements = null;
        this._boundHandlers = null;
        this.modal = null;
        
        console.log('[ScenarioCrafter] Modal destroyed');
    }
}