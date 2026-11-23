import { generateScenario, generateSummary } from './generator.js';
import { loadTemplates, loadTwists, getTemplatePrompt, getTwistCategories } from './templates.js';
import { captureScenarioTarget, assertScenarioTarget } from './scenario-target.js';
import { withConnectionProfile } from './connection-profile.js';
import { power_user } from '../../../../power-user.js';
import { user_avatar } from '../../../../personas.js';

let generating = false;

export function validateScenarioState(state, context) {
    captureScenarioTarget(state, context);
    if (state.scenarioType === 'custom') {
        if (!state.customPrompt?.trim()) throw new Error('Enter a custom scenario prompt.');
    } else if (state.scenarioType === 'twist') {
        if (!context.chat?.length || context.chatId == null) throw new Error('Plot twists require an active chat.');
        if (!getTwistCategories().includes(state.category)) throw new Error('Select a plot twist category.');
    } else if (['trope', 'mood'].includes(state.scenarioType)) {
        if (!getTemplatePrompt(state.scenarioType, state.category, state.subcategory)) {
            throw new Error('Select a complete scenario category and trope or situation.');
        }
    } else throw new Error('Select a valid scenario type.');
}

export async function generateScenarioDraft(input, { shouldCancel = () => false, onSummary = () => {},
    prepareSummaries, summarize = true } = {}) {
    if (generating) throw new Error('Scenario Crafter is already generating.');
    generating = true;
    const checkCancelled = () => { if (shouldCancel()) throw new Error('Generation cancelled.'); };
    try {
        const context = SillyTavern.getContext();
        const state = structuredClone(input);
        state.selectedPersona ||= user_avatar;
        state.personaName = power_user.personas?.[state.selectedPersona] || context.name1 || 'User';
        state.personaDescription = power_user.persona_descriptions?.[state.selectedPersona]?.description
            ?? power_user.persona_description ?? '';
        const target = captureScenarioTarget(state, context);
        const characters = context.characters.slice();
        for (const index of new Set([Number(state.selectedCharacter), Number(context.characterId)])) {
            if (characters[index]) characters[index] = structuredClone(characters[index]);
        }
        const generationContext = { ...context, characters, chat: structuredClone(context.chat || []),
            chatMetadata: structuredClone(context.chatMetadata || {}) };
        await Promise.all([loadTemplates(), loadTwists()]);
        checkCancelled();
        validateScenarioState(state, generationContext);
        if (prepareSummaries) state.selectedComprehensiveSummaries = await prepareSummaries();
        checkCancelled();
        return await withConnectionProfile(state.connectionProfile, async () => {
            checkCancelled();
            assertScenarioTarget(target, SillyTavern.getContext());
            const result = await generateScenario(state, generationContext);
            checkCancelled();
            let summary = '';
            if (summarize) {
                onSummary();
                summary = await generateSummary(result.text, target.characterName);
                checkCancelled();
            }
            assertScenarioTarget(target, SillyTavern.getContext());
            return { ...result, summary, target, state };
        });
    } finally {
        generating = false;
    }
}
