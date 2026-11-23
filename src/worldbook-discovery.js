import { selected_world_info, world_info } from '../../../../world-info.js';
import { power_user } from '../../../../power-user.js';

export function getAvailableWorldBooks(state = {}, context = SillyTavern.getContext()) {
    const character = context.characters?.[state.selectedCharacter ?? context.characterId];
    const avatar = character?.avatar || '';
    const extras = world_info.charLore?.find(item => item.name === avatar.replace(/\.png$/i, ''))?.extraBooks || [];
    const persona = state.selectedPersona
        ? power_user.persona_descriptions?.[state.selectedPersona]?.lorebook
        : power_user.persona_description_lorebook;
    const books = [...selected_world_info, character?.data?.extensions?.world, ...extras,
        persona, context.chatMetadata?.world_info];
    const available = [...new Set(books.filter(name => typeof name === 'string' && name.trim()))]
        .filter(name => !name.startsWith('_scene') && !name.startsWith('archive_'));
    const enabled = state.enabledBooks || {};
    return Object.keys(enabled).length ? available.filter(name => enabled[name] === true) : available;
}

export function cloneSelectedEntries(entries = {}) {
    return Object.fromEntries(Object.entries(entries).map(([book, ids]) =>
        [book, [...new Set((Array.isArray(ids) ? ids : []).map(String))]]));
}
