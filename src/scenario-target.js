const messageStamp = message => JSON.stringify(message && [message.name, message.original_avatar,
    message.is_user, message.is_system, message.mes, message.swipe_id, message.send_date]);

export function chatIdentity(context) {
    return JSON.stringify([context.groupId ?? null, context.chatId ?? null,
        context.characters?.[context.characterId]?.avatar ?? null]);
}

export function findRewriteMessage(state, context) {
    const character = context.characters?.[state.selectedCharacter];
    for (let index = (context.chat?.length || 0) - 1; index >= 0; index--) {
        const message = context.chat[index];
        if (message.is_user || message.is_system) continue;
        const belongsToCharacter = message.original_avatar
            ? message.original_avatar === character?.avatar
            : message.name === character?.name;
        if (belongsToCharacter) return { index, message };
    }
    throw new Error('No response from the selected character is available to rewrite.');
}

export function captureScenarioTarget(state, context) {
    const character = context.characters?.[state.selectedCharacter];
    if (!character) throw new Error('Select a character before generating.');
    if (!['new-chat', 'append', 'rewrite-last'].includes(state.applyMode)) throw new Error('Select a valid apply mode.');
    if (state.applyMode !== 'new-chat' && (context.chatId == null || !context.chat?.length)) {
        throw new Error('This apply mode requires an active chat.');
    }
    const rewrite = state.applyMode === 'rewrite-last' ? findRewriteMessage(state, context) : null;
    return { chatKey: chatIdentity(context), characterAvatar: character.avatar,
        characterName: character.name, applyMode: state.applyMode,
        chatLength: context.chat?.length || 0, tail: messageStamp(context.chat?.at(-1)),
        tailReference: context.chat?.at(-1), rewriteReference: rewrite?.message,
        rewriteIndex: rewrite?.index, rewriteStamp: rewrite ? messageStamp(rewrite.message) : null };
}

export function assertScenarioTarget(target, context) {
    if (!target || chatIdentity(context) !== target.chatKey
        || (context.chat?.length || 0) !== target.chatLength
        || messageStamp(context.chat?.at(-1)) !== target.tail
        || context.chat?.at(-1) !== target.tailReference
        || (target.rewriteIndex != null && context.chat?.[target.rewriteIndex] !== target.rewriteReference)
        || (target.rewriteIndex != null && messageStamp(context.chat?.[target.rewriteIndex]) !== target.rewriteStamp)) {
        throw new Error('The chat changed since generation. Generate a fresh scenario before applying.');
    }
    if (!context.characters?.some(character => character.avatar === target.characterAvatar)) {
        throw new Error('The selected character is no longer available.');
    }
}
