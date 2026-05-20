import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommandArgument, ARGUMENT_TYPE } from '../../../slash-commands/SlashCommandArgument.js';
import { SlashCommandEnumValue, enumTypes } from '../../../slash-commands/SlashCommandEnumValue.js';
import { eventSource, event_types } from '../../../../script.js';

const MODULE_NAME = 'ScenarioCrafter';
const extensionFolderPath = `scripts/extensions/third-party/SillyTavern-${MODULE_NAME}`;

let modal = null;
let isExtensionActive = false;

async function initializeExtension() {
    try {
        // Load CSS
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `${extensionFolderPath}/styles.css`;
        document.head.appendChild(link);
        
        // Import dependencies
        const [
            { initSettings },
            { log },
        ] = await Promise.all([
            import('./src/settings.js'),
            import('./src/utils.js'),
        ]);
        
        // Initialize settings
        await initSettings();
        
        // Import and create modal
        const { ScenarioCrafterModal } = await import('./src/modal.js');
        modal = new ScenarioCrafterModal();
        
        console.log('[ScenarioCrafter] All components initialized');
    } catch (error) {
        console.error('[ScenarioCrafter] Failed to initialize extension:', error);
        toastr.error('Failed to load Scenario Crafter', MODULE_NAME);
    }
}

function cleanup() {
    console.log('[ScenarioCrafter] Cleaning up...');
    
    isExtensionActive = false;
    
    if (modal) {
        modal.destroy();
        modal = null;
    }
    
    $('#scenariocrafter_button').remove();
    
    console.log('[ScenarioCrafter] Cleanup complete');
}

jQuery(async () => {
    if (isExtensionActive) {
        console.log('[ScenarioCrafter] Already initialized, skipping');
        return;
    }
    
    isExtensionActive = true;
    
    addUI();
    registerSlashCommands();
    
    eventSource.on(event_types.APP_READY, async () => {
        if (!isExtensionActive) return;
        console.log('[ScenarioCrafter] APP_READY - initializing extension');
        await initializeExtension();
    });
});

if (typeof window.ScenarioCrafterCleanup === 'undefined') {
    window.ScenarioCrafterCleanup = cleanup;
}

function registerSlashCommands() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'scenario',
        callback: async () => {
            if (!modal) {
                toastr.error('Scenario Crafter not initialized', MODULE_NAME);
                return '';
            }
            openModal();
            return '';
        },
        returns: 'empty string',
        helpString: `
            <div>
                Opens the Scenario Crafter modal for generating AI-powered roleplay scenarios and greetings. Configure scenario type, tone, context options, and apply mode before generating.
            </div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li>
                        <pre><code>/scenario</code></pre>
                        Opens the Scenario Crafter interface.
                    </li>
                </ul>
            </div>
        `,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'scenario-twist',
        callback: async (args, category) => {
            
            if (!category) {
                return 'Usage: /scenario-twist [wholesome|dramatic|spicy|meta|chaos]';
            }

            const context = SillyTavern.getContext();
            if (!context.chat || context.chat.length === 0) {
                toastr.error('No active chat to apply twist', MODULE_NAME);
                return 'Error: No active chat';
            }

            try {
                const { generateScenario } = await import('./src/generator.js');
                const { getSettings } = await import('./src/settings.js');
                const { getTwistCategories } = await import('./src/templates.js');
                
                const validCategories = getTwistCategories();
                if (!validCategories.includes(category.toLowerCase())) {
                    return `Invalid category. Available: ${validCategories.join(', ')}`;
                }

                const settings = getSettings();
                const state = {
                    scenarioType: 'twist',
                    category: category.toLowerCase(),
                    applyMode: 'append',
                    tone: settings.default_tone,
                    selectedCharacter: context.characterId,
                    selectedPersona: null,
                    includeHistory: true,
                    historyRange: 15,
                    includeWorldInfo: false,
                };

                // Handle connection profile switching
                let originalProfile = null;
                if (settings.profileId) {
                    const profilesActive = $('#sys-settings-button').find('#connection_profiles').length > 0;
                    
                    if (profilesActive) {
                        const currentResult = await context.executeSlashCommandsWithOptions('/profile-get');
                        originalProfile = currentResult.pipe;
                        
                        if (originalProfile !== settings.profileId) {
                            await context.executeSlashCommandsWithOptions(`/profile-set ${settings.profileId}`);
                            await new Promise(resolve => setTimeout(resolve, 1500));
                        }
                    }
                }

                toastr.info('Generating plot twist...', MODULE_NAME);
                let result;
                try {
                    result = await generateScenario(state);

                    const char = context.characters[context.characterId];
                    const charName = char?.name || 'Character';
                    await context.executeSlashCommandsWithOptions(`/sendas name="${charName}" ${result.text}`);

                    toastr.success(`Applied twist: ${result.twistApplied}`, MODULE_NAME);
                    return result.text;
                } finally {
                    if (originalProfile && settings.profileId && originalProfile !== settings.profileId) {
                        await context.executeSlashCommandsWithOptions(`/profile-set ${originalProfile}`);
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }
            } catch (error) {
                console.error('[ScenarioCrafter] Twist error:', error);
                toastr.error('Failed to generate twist: ' + error.message, MODULE_NAME);
                return 'Error: ' + error.message;
            }
        },
        returns: 'generated twist text',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'twist category',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
                enumList: [
                    new SlashCommandEnumValue('wholesome', 'funny/absurd twists', enumTypes.enum, '😊'),
                    new SlashCommandEnumValue('dramatic', 'conflicts/revelations', enumTypes.enum, '🎭'),
                    new SlashCommandEnumValue('spicy', 'NSFW romantic twists', enumTypes.enum, '🌶️'),
                    new SlashCommandEnumValue('meta', 'fourth-wall breaks', enumTypes.enum, '🎬'),
                    new SlashCommandEnumValue('chaos', 'reality-breaking madness', enumTypes.enum, '🌀'),
                ],
            }),
        ],
        helpString: `
            <div>
                Applies a random plot twist from the specified category to the current chat. The twist is naturally woven into the ongoing conversation as a new message from the character.
            </div>
            <div>
                <strong>Examples:</strong>
                <ul>
                    <li>
                        <pre><code>/scenario-twist dramatic</code></pre>
                        Adds a dramatic plot twist (conflict, revelation, danger).
                    </li>
                    <li>
                        <pre><code>/scenario-twist wholesome</code></pre>
                        Adds a funny or absurd twist to lighten the mood.
                    </li>
                </ul>
            </div>
        `,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'scenario-custom',
        callback: async (args, prompt) => {
            
            if (!prompt) {
                return 'Usage: /scenario-custom [your prompt here]';
            }

            const context = SillyTavern.getContext();

            try {
                const { generateScenario } = await import('./src/generator.js');
                const { getSettings } = await import('./src/settings.js');

                const settings = getSettings();
                const state = {
                    scenarioType: 'custom',
                    customPrompt: prompt,
                    applyMode: settings.apply_mode,
                    tone: settings.default_tone,
                    selectedCharacter: context.characterId,
                    selectedPersona: null,
                    includeHistory: settings.include_chat_history,
                    historyRange: settings.history_range,
                    includeWorldInfo: settings.include_world_info,
                    worldInfoMode: settings.world_info_mode,
                    enabledBooks: { ...settings.enabled_world_books },
                    selectedEntries: { ...settings.selected_entries },
                };

                // Handle connection profile switching
                let originalProfile = null;
                if (settings.profileId) {
                    const profilesActive = $('#sys-settings-button').find('#connection_profiles').length > 0;
                    
                    if (profilesActive) {
                        const currentResult = await context.executeSlashCommandsWithOptions('/profile-get');
                        originalProfile = currentResult.pipe;
                        
                        if (originalProfile !== settings.profileId) {
                            await context.executeSlashCommandsWithOptions(`/profile-set ${settings.profileId}`);
                            await new Promise(resolve => setTimeout(resolve, 1500));
                        }
                    }
                }

                toastr.info('Generating custom scenario...', MODULE_NAME);
                let result;
                try {
                    result = await generateScenario(state);

                    if (state.applyMode === 'new-chat') {
                        await context.selectCharacterById(state.selectedCharacter);
                        await new Promise(resolve => setTimeout(resolve, 300));
                        await context.executeSlashCommandsWithOptions('/newchat');
                        await new Promise(resolve => setTimeout(resolve, 200));
                        await context.executeSlashCommandsWithOptions('/del 1');
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }

                    const char = context.characters[state.selectedCharacter];
                    const charName = char?.name || 'Character';
                    await context.executeSlashCommandsWithOptions(`/sendas name="${charName}" ${result.text}`);

                    toastr.success('Custom scenario applied!', MODULE_NAME);
                    return result.text;
                } finally {
                    if (originalProfile && settings.profileId && originalProfile !== settings.profileId) {
                        await context.executeSlashCommandsWithOptions(`/profile-set ${originalProfile}`);
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }
            } catch (error) {
                console.error('[ScenarioCrafter] Custom scenario error:', error);
                toastr.error('Failed to generate: ' + error.message, MODULE_NAME);
                return 'Error: ' + error.message;
            }
        },
        returns: 'generated scenario text',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'custom scenario prompt',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        helpString: `
            <div>
                Generates a scenario from a custom text prompt and applies it according to your default apply mode setting. Uses your default tone, context options, and connection profile.
            </div>
            <div>
                <strong>Examples:</strong>
                <ul>
                    <li>
                        <pre><code>/scenario-custom A tense confrontation in a rainy alley</code></pre>
                        Creates a scenario based on the description.
                    </li>
                    <li>
                        <pre><code>/scenario-custom {{char}} discovers a hidden message from {{user}}</code></pre>
                        Uses placeholders for character and user names.
                    </li>
                </ul>
            </div>
        `,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'scenario-list',
        callback: async (args, type) => {
            
            try {
                const { loadTemplates, loadTwists, getTropeCategories, getMoodCategories, getTwistCategories } = await import('./src/templates.js');
                
                await loadTemplates();
                await loadTwists();

                if (!type || type === 'all') {
                    const tropes = getTropeCategories();
                    const moods = getMoodCategories();
                    const twists = getTwistCategories();
                    
                    let result = '=== SCENARIO CRAFTER TEMPLATES ===\n\n';
                    result += `TROPES: ${tropes.join(', ')}\n`;
                    result += `MOODS: ${moods.join(', ')}\n`;
                    result += `TWISTS: ${twists.join(', ')}`;
                    
                    toastr.info('Check console for full list', MODULE_NAME);
                    console.log(result);
                    return result;
                }

                if (type === 'trope' || type === 'tropes') {
                    const categories = getTropeCategories();
                    const result = `TROPE CATEGORIES: ${categories.join(', ')}`;
                    console.log(result);
                    return result;
                }

                if (type === 'mood' || type === 'moods') {
                    const categories = getMoodCategories();
                    const result = `MOOD CATEGORIES: ${categories.join(', ')}`;
                    console.log(result);
                    return result;
                }

                if (type === 'twist' || type === 'twists') {
                    const categories = getTwistCategories();
                    const result = `TWIST CATEGORIES: ${categories.join(', ')}`;
                    console.log(result);
                    return result;
                }

                return 'Usage: /scenario-list [all|tropes|moods|twists]';
            } catch (error) {
                console.error('[ScenarioCrafter] List error:', error);
                return 'Error loading templates';
            }
        },
        returns: 'list of available templates',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'template type to list',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: false,
                enumList: [
                    new SlashCommandEnumValue('all', 'list all template types', enumTypes.enum, '📋'),
                    new SlashCommandEnumValue('tropes', 'list trope categories', enumTypes.enum, '🎭'),
                    new SlashCommandEnumValue('moods', 'list mood categories', enumTypes.enum, '💭'),
                    new SlashCommandEnumValue('twists', 'list twist categories', enumTypes.enum, '🌀'),
                ],
            }),
        ],
        helpString: `
            <div>
                Lists available template categories. Output is sent to console for easy reading.
            </div>
            <div>
                <strong>Examples:</strong>
                <ul>
                    <li>
                        <pre><code>/scenario-list all</code></pre>
                        Shows all available tropes, moods, and twists.
                    </li>
                    <li>
                        <pre><code>/scenario-list tropes</code></pre>
                        Lists only trope categories.
                    </li>
                </ul>
            </div>
        `,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'scenario-clear',
        callback: async () => {
            
            try {
                const context = SillyTavern.getContext();
                const { extension_prompt_types } = await import('../../../../../script.js');
                
                context.setExtensionPrompt('scenariocrafter_inject', '', extension_prompt_types.IN_CHAT, 0, false);
                
                toastr.success('Scenario injection cleared', MODULE_NAME);
                return 'Injection cleared';
            } catch (error) {
                console.error('[ScenarioCrafter] Clear error:', error);
                toastr.error('Failed to clear injection', MODULE_NAME);
                return 'Error: ' + error.message;
            }
        },
        returns: 'operation result',
        aliases: ['scenario-clear-inject'],
        helpString: `
            <div>
                Removes the scenario note injection from the current chat. The scenario message itself remains, but the system prompt reminder is cleared.
            </div>
            <div>
                <strong>Example:</strong>
                <ul>
                    <li>
                        <pre><code>/scenario-clear</code></pre>
                        Clears the scenario injection from chat context.
                    </li>
                </ul>
            </div>
        `,
    }));
    
    console.log('[ScenarioCrafter] Slash commands registered');
}

async function openModal() {
    if (!modal) {
        const { ScenarioCrafterModal } = await import('./src/modal.js');
        modal = new ScenarioCrafterModal();
    }
    modal.show();
}

function addUI() {
    const button = $('<div id="scenariocrafter_button" class="list-group-item flex-container flexGap5 interactable">' +
        '<i class="fa-solid fa-wand-magic-sparkles"></i>' +
        '<span>Scenario Crafter</span>' +
        '</div>');
    
    button.on('click', async () => {
        if (!modal) {
            toastr.error('Scenario Crafter not initialized', MODULE_NAME);
            return;
        }
        openModal();
    });
    $('#extensionsMenu').append(button);
}
