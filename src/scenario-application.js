import { doNewChat, deleteMessage, extension_prompt_types, extension_prompt_roles } from '../../../../../script.js';
import { getNameAndAvatarForMessage } from '../../../../slash-commands.js';
import { getMessageTimeStamp } from '../../../../RossAscends-mods.js';
import { setUserAvatar, user_avatar } from '../../../../personas.js';
import { assertScenarioTarget, chatIdentity } from './scenario-target.js';

export function restoreScenarioNote(context = SillyTavern.getContext()) {
    const note = context.chatMetadata?.scenariocrafter_note;
    context.setExtensionPrompt('scenariocrafter_inject', note?.text ? `[Scenario: ${note.text}]` : '',
        extension_prompt_types.IN_CHAT, note?.depth ?? 0, false, extension_prompt_roles.SYSTEM);
}

export async function setScenarioNote(text, depth = 10, context = SillyTavern.getContext()) {
    if (text?.trim()) context.chatMetadata.scenariocrafter_note = { text: text.trim(), depth };
    else delete context.chatMetadata.scenariocrafter_note;
    restoreScenarioNote(context);
    await context.saveMetadata();
}

function requireChat(key) {
    const context = SillyTavern.getContext();
    if (chatIdentity(context) !== key) throw new Error('The chat changed while applying the scenario.');
    return context;
}

export async function appendLiteralMessage(context, character, text) {
    const key = chatIdentity(context);
    const avatar = getNameAndAvatarForMessage(character, character.name);
    const extra = { api: 'manual', model: 'Scenario Crafter', gen_id: Date.now() };
    const message = { name: character.name, is_user: false, is_system: false, mes: text,
        send_date: getMessageTimeStamp(), force_avatar: avatar.force_avatar,
        original_avatar: character.avatar, extra, swipe_id: 0, swipes: [text] };
    message.swipe_info = [{ send_date: message.send_date, gen_started: null,
        gen_finished: null, extra: structuredClone(extra) }];
    context.chatMetadata.tainted = true;
    const index = context.chat.push(message) - 1;
    await context.eventSource.emit(context.event_types.MESSAGE_RECEIVED, index, 'command');
    requireChat(key).addOneMessage(message);
    await context.eventSource.emit(context.event_types.CHARACTER_MESSAGE_RENDERED, index, 'command');
    await requireChat(key).saveChat();
}

async function prepareNewChat(target) {
    let context = SillyTavern.getContext();
    const index = context.characters.findIndex(character => character.avatar === target.characterAvatar);
    await context.selectCharacterById(index);
    context = SillyTavern.getContext();
    const before = chatIdentity(context);
    const selected = () => context.groupId == null && context.characters[context.characterId]?.avatar === target.characterAvatar;
    if (!selected()) throw new Error('The character changed while preparing the new chat.');
    await doNewChat();
    context = SillyTavern.getContext();
    if (chatIdentity(context) === before || !selected()) {
        throw new Error('A fresh chat could not be confirmed. No messages were removed.');
    }
    const fresh = chatIdentity(context);
    if (context.chat.length > 1 || context.chat[0]?.is_user || context.chat[0]?.is_system) {
        throw new Error('The new chat already contains messages. Its messages were left untouched.');
    }
    if (context.chat.length === 1) await deleteMessage(0, undefined, false);
    context = requireChat(fresh);
    if (context.chat.length) throw new Error('The new chat changed. No scenario was sent.');
    return context;
}

async function rewriteMessage(context, target, text) {
    const message = context.chat[target.rewriteIndex];
    const oldExtra = structuredClone(message.extra || {});
    const oldSwipe = { send_date: message.send_date, gen_started: message.gen_started,
        gen_finished: message.gen_finished, extra: oldExtra };
    if (!Array.isArray(message.swipes) || !message.swipes.length) {
        message.swipes = [message.mes]; message.swipe_info = [oldSwipe]; message.swipe_id = 0;
    } else {
        message.swipe_info ||= [];
        message.swipes[message.swipe_id ?? 0] = message.mes;
        message.swipe_info[message.swipe_id ?? 0] = oldSwipe;
    }
    message.extra = { ...oldExtra };
    delete message.extra.display_text;
    message.mes = text;
    message.swipe_id = message.swipes.push(text) - 1;
    message.swipe_info[message.swipe_id] = { ...oldSwipe, extra: structuredClone(message.extra) };
    context.chatMetadata.tainted = true;
    await context.eventSource.emit(context.event_types.MESSAGE_EDITED, target.rewriteIndex);
    await requireChat(target.chatKey).saveChat();
    await requireChat(target.chatKey).reloadCurrentChat();
    return requireChat(target.chatKey);
}

let applying = false;

export async function applyScenarioDraft(draft, { text = draft.text, addInjection = true,
    scenarioNote = draft.summary, injectionDepth = 10 } = {}) {
    if (applying) throw new Error('A scenario is already being applied.');
    if (!text?.trim()) throw new Error('The scenario text is empty.');
    applying = true;
    try {
        let context = SillyTavern.getContext();
        assertScenarioTarget(draft.target, context);
        if (draft.state.selectedPersona && draft.state.selectedPersona !== user_avatar) {
            await setUserAvatar(draft.state.selectedPersona);
            context = SillyTavern.getContext();
            assertScenarioTarget(draft.target, context);
        }
        if (draft.target.applyMode === 'new-chat') context = await prepareNewChat(draft.target);
        const key = chatIdentity(context);
        if (draft.target.applyMode === 'rewrite-last') {
            context = await rewriteMessage(context, draft.target, text);
        } else {
            const character = context.characters.find(character => character.avatar === draft.target.characterAvatar);
            await appendLiteralMessage(context, character, text);
            context = requireChat(key);
        }
        await setScenarioNote(addInjection ? scenarioNote : '', injectionDepth, context);
    } finally {
        applying = false;
    }
}
