import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommandArgument, ARGUMENT_TYPE } from '../../../slash-commands/SlashCommandArgument.js';
import { SlashCommandEnumValue, enumTypes } from '../../../slash-commands/SlashCommandEnumValue.js';
import { eventSource, event_types } from '../../../../script.js';
import { log, logError } from './src/utils.js';
import { restoreScenarioNote, setScenarioNote } from './src/scenario-application.js';

const MODULE_NAME = 'ScenarioCrafter';
const extensionFolderPath = `scripts/extensions/third-party/SillyTavern-${MODULE_NAME}`;

const restoreCurrentScenarioNote = () => restoreScenarioNote();

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
        ] = await Promise.all([
            import('./src/settings.js'),
        ]);
        
        // Initialize settings
        await initSettings();
        
        // Import and create modal
        const { ScenarioCrafterModal } = await import('./src/modal.js');
        if (!modal) modal = new ScenarioCrafterModal();
        
        restoreScenarioNote();
        log('All components initialized');
    } catch (error) {
        logError('Failed to initialize extension:', error);
        toastr.error('Failed to load Scenario Crafter', MODULE_NAME);
    }
}

function cleanup() {
    log('Cleaning up...');
    
    isExtensionActive = false;
    
    if (modal) {
        modal.destroy();
        modal = null;
    }
    
    eventSource.removeListener(event_types.CHAT_CHANGED, restoreCurrentScenarioNote);
    $('#scenariocrafter_button').remove();
    
    log('Cleanup complete');
}

jQuery(async () => {
    if (isExtensionActive) {
        log('Already initialized, skipping');
        return;
    }
    
    isExtensionActive = true;
    
    addUI();
    registerSlashCommands();
    eventSource.on(event_types.CHAT_CHANGED, restoreCurrentScenarioNote);
    
    eventSource.on(event_types.APP_READY, async () => {
        if (!isExtensionActive) return;
        log('APP_READY - initializing extension');
        await initializeExtension();
    });
});

if (typeof window.ScenarioCrafterCleanup === 'undefined') {
    window.ScenarioCrafterCleanup = cleanup;
}

// Public API — allows other extensions (e.g. UI Bedazzler side buttons)
// to open the Scenario Crafter modal programmatically.
window.ScenarioCrafter = { openModal };

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
            if (!category?.trim()) return 'Usage: /scenario-twist [your category here]';
            try {
                const { runQuickScenario } = await import('./src/quick-scenario.js');
                toastr.info('Generating scenario...', MODULE_NAME);
                const result = await runQuickScenario('twist', category);
                toastr.success('Scenario applied!', MODULE_NAME);
                return result.text;
            } catch (error) {
                logError('Scenario command failed:', error);
                toastr.error(error.message, MODULE_NAME);
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
            if (!prompt?.trim()) return 'Usage: /scenario-custom [your prompt here]';
            try {
                const { runQuickScenario } = await import('./src/quick-scenario.js');
                toastr.info('Generating scenario...', MODULE_NAME);
                const result = await runQuickScenario('custom', prompt);
                toastr.success('Scenario applied!', MODULE_NAME);
                return result.text;
            } catch (error) {
                logError('Scenario command failed:', error);
                toastr.error(error.message, MODULE_NAME);
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
                logError('List error:', error);
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
                await setScenarioNote('', 0, context);
                
                toastr.success('Scenario injection cleared', MODULE_NAME);
                return 'Injection cleared';
            } catch (error) {
                logError('Clear error:', error);
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
    
    log('Slash commands registered');
}

async function openModal() {
    try {
        if (!modal) {
            const { ScenarioCrafterModal } = await import('./src/modal.js');
            if (!modal) modal = new ScenarioCrafterModal();
        }
        await modal.show();
    } catch (error) {
        logError('Could not open Scenario Crafter:', error);
        toastr.error('Could not open Scenario Crafter. Please try again.', MODULE_NAME);
    }
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
