import { getSettings } from './settings.js';
import { generateScenarioDraft } from './generation-workflow.js';
import { applyScenarioDraft } from './scenario-application.js';

export async function runQuickScenario(type, input) {
    const context = SillyTavern.getContext();
    const settings = getSettings();
    const state = {
        scenarioType: type,
        category: type === 'twist' ? input.trim().toLowerCase() : null,
        customPrompt: type === 'custom' ? input : '',
        applyMode: type === 'twist' ? 'append' : settings.apply_mode,
        tone: settings.default_tone,
        selectedCharacter: context.characterId,
        selectedPersona: null,
        connectionProfile: settings.profileId,
        includeHistory: settings.include_chat_history,
        historyRange: settings.history_range,
        includeWorldInfo: settings.include_world_info,
        worldInfoMode: settings.world_info_mode,
        enabledBooks: settings.enabled_world_books,
        selectedEntries: settings.selected_entries,
    };
    const draft = await generateScenarioDraft(state, { summarize: settings.add_scenario_injection });
    await applyScenarioDraft(draft, { addInjection: settings.add_scenario_injection,
        injectionDepth: settings.injection_depth });
    return draft;
}
