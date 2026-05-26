import { saveSettingsDebounced } from '../../../../../script.js';

const SETTINGS_KEY = 'scenariocrafter_settings';

const DEFAULT_SETTINGS = {
    // Writing Style
    base_style_prompt: `Write in third person past tense from {{char}}'s POV only. 2-4 paragraphs, 5-7 sentences each.
- Casual Prose: Plain modern English. BAN purple prose, flowery language, and cliched phrases. Use punchy, evocative language with striking imagery and visceral sensory detail.
- Show Don't Tell: Never state {{char}}'s emotions directly. Convey feeling through mannerisms, body language, tone, and dialogue.
- Critical — Do Not Write for {{user}}: NEVER narrate, describe, or imply {{user}}'s actions, dialogue, thoughts, feelings, decisions, or physical reactions. {{user}} is controlled entirely by the player. The scenario must end at a point where {{user}} can act or respond. Any content written from {{user}}'s perspective or depicting what {{user}} does is a violation of this rule.`,
    
    // Connection
    profileId: '',
    
    // Defaults
    default_tone: 'balanced',
    
    // Context Options
    include_chat_history: false,
    history_range: 5,
    include_world_info: false,
    world_info_mode: 'triggered',
    enabled_world_books: {},
    selected_entries: {},
    
    // Application
    add_scenario_injection: true,
    injection_depth: 10,
    apply_mode: 'new-chat',

    // Custom Prompts
    saved_custom_prompts: {},
};

let currentSettings = { ...DEFAULT_SETTINGS };

/**
 * Create settings UI in extension drawer
 */
function createFullSettingsUI() {
    const context = window.SillyTavern?.getContext?.();
    if (!context) {
        console.error('[ScenarioCrafter] Could not get SillyTavern context for settings UI');
        return;
    }
    
    const settingsHtml = `
        <div class="scenariocrafter-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Scenario Crafter</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="scenariocrafter-settings-row">
                        <button id="sc-open-modal" class="menu_button" style="width: 100%; white-space: nowrap;">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> Open Scenario Crafter
                        </button>
                    </div>
                    <!-- Base Style Prompt -->
                    <h4 class="scenariocrafter-section-header">
                        <i class="fa-solid fa-pen-fancy"></i> Writing Style
                    </h4>
                    
                    <div class="scenariocrafter-settings-row">
                        <label>
                            <span>Base Style Prompt</span>
                            <small class="notes">Instructions for how the AI should write scenarios. Use {{char}} and {{user}} placeholders.</small>
                        </label>
                        <textarea class="text_pole" id="sc-settings-style-prompt" rows="8">${currentSettings.base_style_prompt}</textarea>
                    </div>
                    
                    <hr>
                    
                    <!-- Defaults -->
                    <h4 class="scenariocrafter-section-header">
                        <i class="fa-solid fa-sliders"></i> Defaults
                    </h4>
                    
                    <div class="scenariocrafter-settings-grid">
                        <label>
                            <span>Default Tone</span>
                            <select class="text_pole" id="sc-settings-default-tone">
                                <option value="balanced" ${currentSettings.default_tone === 'balanced' ? 'selected' : ''}>⚖️ Balanced</option>
                                <option value="lighthearted" ${currentSettings.default_tone === 'lighthearted' ? 'selected' : ''}>😊 Lighthearted</option>
                                <option value="serious" ${currentSettings.default_tone === 'serious' ? 'selected' : ''}>😐 Serious</option>
                                <option value="dark" ${currentSettings.default_tone === 'dark' ? 'selected' : ''}>🌑 Dark</option>
                                <option value="humorous" ${currentSettings.default_tone === 'humorous' ? 'selected' : ''}>😄 Humorous</option>
                                <option value="romantic" ${currentSettings.default_tone === 'romantic' ? 'selected' : ''}>💕 Romantic</option>
                                <option value="dramatic" ${currentSettings.default_tone === 'dramatic' ? 'selected' : ''}>🎭 Dramatic</option>
                                <option value="suspenseful" ${currentSettings.default_tone === 'suspenseful' ? 'selected' : ''}>🔍 Suspenseful</option>
                            </select>
                        </label>
                        
                        <label>
                            <span>Default Connection Profile</span>
                            <select class="text_pole" id="sc-settings-profile"></select>
                        </label>
                    </div>
                    
                    <hr>
                    
                    <!-- Context Options -->
                    <h4 class="scenariocrafter-section-header">
                        <i class="fa-solid fa-list-check"></i> Default Context Options
                    </h4>
                    
                    <div class="scenariocrafter-settings-row">
                        <label class="checkbox_label">
                            <input type="checkbox" id="sc-settings-include-history" ${currentSettings.include_chat_history ? 'checked' : ''}>
                            <span>Include Chat History by default</span>
                        </label>
                    </div>
                    
                    <div class="scenariocrafter-settings-row" id="sc-settings-history-range-container" style="display: ${currentSettings.include_chat_history ? 'block' : 'none'};">
                        <label>
                            <span>Default History Range</span>
                            <input type="number" class="text_pole" id="sc-settings-history-range" 
                                   min="1" max="50" value="${currentSettings.history_range}" style="width: 100px;">
                            <small class="notes">Number of messages to include</small>
                        </label>
                    </div>
                    
                    <div class="scenariocrafter-settings-row">
                        <label class="checkbox_label">
                            <input type="checkbox" id="sc-settings-include-worldinfo" ${currentSettings.include_world_info ? 'checked' : ''}>
                            <span>Include World Info by default</span>
                        </label>
                    </div>
                    
                    <div class="scenariocrafter-settings-row" id="sc-settings-worldinfo-mode-container" style="display: ${currentSettings.include_world_info ? 'block' : 'none'};">
                        <label>
                            <span>Default World Info Mode</span>
                            <select class="text_pole" id="sc-settings-worldinfo-mode">
                                <option value="triggered" ${currentSettings.world_info_mode === 'triggered' ? 'selected' : ''}>Triggered Entries</option>
                                <option value="all" ${currentSettings.world_info_mode === 'all' ? 'selected' : ''}>All Enabled Books</option>
                                <option value="selected" ${currentSettings.world_info_mode === 'selected' ? 'selected' : ''}>Selected Entries</option>
                            </select>
                        </label>
                    </div>
                    
                    <hr>
                    
                    <!-- Application Settings -->
                    <h4 class="scenariocrafter-section-header">
                        <i class="fa-solid fa-paper-plane"></i> Application
                    </h4>
                    
                    <div class="scenariocrafter-settings-row">
                        <label class="checkbox_label">
                            <input type="checkbox" id="sc-settings-add-injection" ${currentSettings.add_scenario_injection ? 'checked' : ''}>
                            <span>Add scenario injection by default</span>
                        </label>
                    </div>
                    
                    <div class="scenariocrafter-settings-row">
                        <label>
                            <span>Injection Depth</span>
                            <input type="number" class="text_pole" id="sc-settings-injection-depth" 
                                   min="0" max="100" value="${currentSettings.injection_depth}" style="width: 100px;">
                            <small class="notes">Controls where scenario note injections appear in context (higher = earlier).</small>
                        </label>
                    </div>
                    
                    <div class="scenariocrafter-settings-row">
                        <label>
                            <span>Default Apply Mode</span>
                            <select class="text_pole" id="sc-settings-apply-mode">
                                <option value="new-chat" ${currentSettings.apply_mode === 'new-chat' ? 'selected' : ''}>Start New Chat</option>
                                <option value="append" ${currentSettings.apply_mode === 'append' ? 'selected' : ''}>Append to Current</option>
                                <option value="rewrite-last" ${currentSettings.apply_mode === 'rewrite-last' ? 'selected' : ''}>Rewrite Last Message</option>
                            </select>
                        </label>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    $('#extensions_settings2').append(settingsHtml);
    
    // Populate connection profiles
    populateConnectionProfiles();
    
    // Set up event listeners
    setupSettingsListeners();
}

/**
 * Populate connection profile dropdown
 */
function populateConnectionProfiles() {
    const context = window.SillyTavern?.getContext?.();
    if (!context) return;
    
    const select = $('#sc-settings-profile');
    select.empty();
    
    select.append('<option value="">Default Connection</option>');
    
    if ($('#sys-settings-button').find('#connection_profiles').length === 0) {
        return;
    }
    
    context.executeSlashCommandsWithOptions('/profile-list').then(result => {
        try {
            const profiles = JSON.parse(result.pipe);
            
            profiles.forEach(profileName => {
                const isSelected = profileName === currentSettings.profileId;
                const option = $(`<option value="${profileName}">${profileName}</option>`);
                if (isSelected) {
                    option.prop('selected', true);
                }
                select.append(option);
            });
        } catch (error) {
            console.error('[ScenarioCrafter] Failed to parse profiles:', error);
        }
    }).catch(error => {
        console.error('[ScenarioCrafter] Failed to load profiles:', error);
    });
}

/**
 * Set up event listeners for settings inputs
 */
function setupSettingsListeners() {
    // Open modal button
    $('#sc-open-modal').on('click', async () => {
        const context = window.SillyTavern?.getContext?.();
        if (context) {
            await context.executeSlashCommandsWithOptions('/scenario');
        }
    });

    // Style prompt
    $('#sc-settings-style-prompt').on('input', function() {
        currentSettings.base_style_prompt = $(this).val();
        saveSettings();
    });
    
    // Default tone
    $('#sc-settings-default-tone').on('change', function() {
        currentSettings.default_tone = $(this).val();
        saveSettings();
    });
    
    // Connection profile
    $('#sc-settings-profile').on('change', function() {
        currentSettings.profileId = $(this).val();
        saveSettings();
    });
    
    // Include history
    $('#sc-settings-include-history').on('change', function() {
        currentSettings.include_chat_history = $(this).is(':checked');
        $('#sc-settings-history-range-container').toggle(currentSettings.include_chat_history);
        saveSettings();
    });
    
    // History range
    $('#sc-settings-history-range').on('change', function() {
        currentSettings.history_range = parseInt($(this).val()) || 5;
        saveSettings();
    });
    
    // Include world info
    $('#sc-settings-include-worldinfo').on('change', function() {
        currentSettings.include_world_info = $(this).is(':checked');
        $('#sc-settings-worldinfo-mode-container').toggle(currentSettings.include_world_info);
        saveSettings();
    });
    
    // World info mode
    $('#sc-settings-worldinfo-mode').on('change', function() {
        currentSettings.world_info_mode = $(this).val();
        saveSettings();
    });
    
    // Add injection
    $('#sc-settings-add-injection').on('change', function() {
        currentSettings.add_scenario_injection = $(this).is(':checked');
        saveSettings();
    });
    
    // Injection depth
    $('#sc-settings-injection-depth').on('change', function() {
        currentSettings.injection_depth = parseInt($(this).val()) || 10;
        saveSettings();
    });
    
    // Apply mode
    $('#sc-settings-apply-mode').on('change', function() {
        currentSettings.apply_mode = $(this).val();
        saveSettings();
    });
}

/**
 * Save settings to localStorage (with debouncing via ST's function)
 */
function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentSettings));
    saveSettingsDebounced();
}

export async function initSettings() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
        try {
            currentSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
        } catch (e) {
            console.error('[ScenarioCrafter] Failed to load settings:', e);
        }
    }
    
    createFullSettingsUI();
}

export function getSettings() {
    return { ...currentSettings };
}

export function updateSettings(newSettings) {
    currentSettings = { ...currentSettings, ...newSettings };
    saveSettings();
}

export function resetSettings() {
    currentSettings = { ...DEFAULT_SETTINGS };
    saveSettings();
}

// Export for use in modal tabs
export { currentSettings, saveSettings, populateConnectionProfiles };
