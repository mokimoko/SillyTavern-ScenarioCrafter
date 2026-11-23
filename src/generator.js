import { generateRaw, substituteParams } from '../../../../../script.js';
import { getSettings } from './settings.js';
import { getTemplatePrompt, getRandomTwist, getToneModifier } from './templates.js';
import { log, logError, worldBookCache } from './utils.js';
import { power_user } from '../../../../power-user.js';
import { findRewriteMessage } from './scenario-target.js';
import { getAvailableWorldBooks } from './worldbook-discovery.js';

function replaceNamesInText(text, activeCharName, activeUserName, targetCharName, targetUserName) {
    // Replace {{char}}/{{user}} macros with active names, then swap to target names
    if (!text) return text;
    
    const names = new Map([[activeCharName, targetCharName], [activeUserName, targetUserName]]);
    const patterns = [...names.keys()].filter(Boolean).sort((a, b) => b.length - a.length)
        .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const literalNames = patterns.length ? `|(?<![\\p{L}\\p{N}_])(?:${patterns.join('|')})(?![\\p{L}\\p{N}_])` : '';
    const pattern = new RegExp(`\\{\\{(?:[cC][hH][aA][rR]|[uU][sS][eE][rR])\\}\\}${literalNames}`, 'gu');
    // Resolve macros and names together so neither replacements nor macro tokens cascade.
    return text.replace(pattern, name => /^\{\{char\}\}$/i.test(name) ? targetCharName
        : /^\{\{user\}\}$/i.test(name) ? targetUserName : names.get(name));
}

function prepareTextWithNames(text, selectedCharName, selectedUserName) {
    // Replace {{char}}/{{user}} macros with selected names
    if (!text) return text;
    
    let result = text;
    result = result.replace(/\{\{char\}\}/gi, () => selectedCharName);
    result = result.replace(/\{\{user\}\}/gi, () => selectedUserName);
    
    return result;
}

async function buildGenerationMessages(state, settings, context) {
    // Get character and user info
    const charInfo = getCharacterInfo(state, context);
    
    if (!charInfo) {
        throw new Error('No character selected. Please select a character from the dropdown.');
    }
    
    const charName = charInfo.name;
    const userName = getPersonaName(state, context);
    
    log('Building prompt for:', charName, 'and', userName);

    // Check if we're in rewrite mode
    const isRewriteMode = state.applyMode === 'rewrite-last';
    
    // Get last message if in rewrite mode
    let lastMessage = null;
    if (isRewriteMode) {
        if (!context.chat || context.chat.length === 0) {
            throw new Error('No chat history available to rewrite');
        }
        lastMessage = findRewriteMessage(state, context).message;
    }

    // ── Build system prompt (all context) ──────────────────────────────────
    let systemParts = [];

    // 1. Character info
    let charSection = `Character Information:\nName: ${charName}\n`;
    if (charInfo.description) charSection += `Description: ${prepareTextWithNames(charInfo.description, charName, userName)}\n`;
    if (charInfo.personality) charSection += `Personality: ${prepareTextWithNames(charInfo.personality, charName, userName)}\n`;
    if (charInfo.scenario) charSection += `Current Scenario: ${prepareTextWithNames(charInfo.scenario, charName, userName)}\n`;
    if (charInfo.exampleMessages) charSection += `Example Dialogue:\n${prepareTextWithNames(charInfo.exampleMessages, charName, userName)}\n`;

    // Persona info
    const personaInfo = getPersonaInfo(state, context);
    if (personaInfo) {
        charSection += `\nUser Persona (${userName}):\n${prepareTextWithNames(personaInfo, charName, userName)}\n`;
    }
    systemParts.push(charSection);

    // 2. World info
    if (state.includeWorldInfo === true) {
        const worldInfo = await getWorldInfo(state, context);
        if (worldInfo) {
            systemParts.push(`World Information:\n${prepareTextWithNames(worldInfo, charName, userName)}`);
        }
    }

    // 3. Comprehensive summaries
    if (state.includeComprehensive === true) {
        const comprehensiveSummaries = state.selectedComprehensiveSummaries || [];
        
        if (comprehensiveSummaries.length > 0) {
            let summaryContent = `Previous Story Summaries:\nThe following summaries describe previous events between these characters, presented in chronological order:\n\n`;
            
            comprehensiveSummaries.forEach((summary, index) => {
                summaryContent += `Chapter ${index + 1}: ${summary.displayName}\n`;
                let resolvedContent = prepareTextWithNames(summary.content, charName, userName);
                try {
                    if (typeof substituteParams === 'function') {
                        resolvedContent = substituteParams(resolvedContent);
                    }
                } catch (e) {
                    log('Macro resolution skipped:', e.message);
                }
                summaryContent += `${resolvedContent}\n\n`;
                
                if (summary.quotes && summary.quotes.length > 0) {
                    summaryContent += `Memorable moments:\n`;
                    summary.quotes.forEach(quote => {
                        summaryContent += `- ${quote.speaker}: "${quote.text}" (${quote.context})\n`;
                    });
                    summaryContent += `\n`;
                }
            });
            
            systemParts.push(summaryContent);
        }
    }

    // 4. Chat history (only if enabled and not rewrite mode)
    if (state.includeHistory === true && !isRewriteMode && context.chat && context.chat.length > 0) {
        const history = getChatHistory(state, context);
        if (history.length > 0) {
            const activeCharName = context.characters[context.characterId]?.name || charName;
            const activeUserName = context.name1 || userName;
            
            const historyText = history.map(m => {
                const speakerName = m.is_user ? userName : charName;
                const convertedMessage = replaceNamesInText(m.mes, activeCharName, activeUserName, charName, userName);
                return `${speakerName}: ${convertedMessage}`;
            }).join('\n\n');
            
            systemParts.push(`Recent Chat History:\n${historyText}`);
        }
    }

    // 5. Style guidelines + tone (context, not instruction)
    let stylePrompt = settings.base_style_prompt
        .replace(/\{\{char\}\}/g, () => charName)
        .replace(/\{\{user\}\}/g, () => userName);
    
    let styleSection = `Style Guidelines:\n${stylePrompt}`;
    const toneModifier = getToneModifier(state.tone);
    if (toneModifier) {
        styleSection += `\nTone: ${toneModifier}`;
    }
    systemParts.push(styleSection);

    const systemPrompt = systemParts.join('\n\n');

    // ── Build user prompt (the actual instruction) ─────────────────────────
    let userPrompt = `Output the scenario text only. No preamble, no meta-commentary, no explanations, no thought process.\nDo not write for ${userName}. ${userName}'s actions, dialogue, thoughts, and reactions are off-limits — the scenario must leave room for ${userName} to act.\n\n`;

    if (isRewriteMode) {
        userPrompt += `Rewrite the following message as ${charName}. Preserve the core events but write from ${charName}'s perspective. `;
        userPrompt += `Original:\n${lastMessage.name}: ${prepareTextWithNames(lastMessage.mes, charName, userName)}\n\n`;
        
        if (state.scenarioType === 'custom' && state.customPrompt) {
            const processedCustom = state.customPrompt
                .replace(/\{\{char\}\}/g, () => charName)
                .replace(/\{\{user\}\}/g, () => userName);
            userPrompt += `Incorporate this scenario direction: ${processedCustom}`;
        } else if (state.category && state.subcategory) {
            const templatePrompt = getTemplatePrompt(state.scenarioType, state.category, state.subcategory, state.leadRole === 'user');
            if (templatePrompt) {
                const processedPrompt = templatePrompt
                    .replace(/\{\{char\}\}/g, () => charName)
                    .replace(/\{\{user\}\}/g, () => userName);
                userPrompt += `Apply this scenario approach: ${processedPrompt}`;
            }
        }
    } else {
        userPrompt += `Write a new roleplay scenario/greeting for ${charName}. `;

        if (state.scenarioType === 'custom' && state.customPrompt) {
            const processedCustom = state.customPrompt
                .replace(/\{\{char\}\}/g, () => charName)
                .replace(/\{\{user\}\}/g, () => userName);
            userPrompt += `The scenario should be based on this premise: ${processedCustom}`;
        } else if (state.category && state.subcategory) {
            const templatePrompt = getTemplatePrompt(state.scenarioType, state.category, state.subcategory, state.leadRole === 'user');
            if (templatePrompt) {
                const processedPrompt = templatePrompt
                    .replace(/\{\{char\}\}/g, () => charName)
                    .replace(/\{\{user\}\}/g, () => userName);
                userPrompt += processedPrompt;
            }
        }
    }

    // Build display messages for View Prompt
    const displayMessages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];

    return { systemPrompt, userPrompt, displayMessages };
}

export async function generateScenario(state, context = SillyTavern.getContext()) {
    const settings = getSettings();
    
    log('Generating scenario with state:', {
        type: state.scenarioType,
        category: state.category,
        applyMode: state.applyMode
    });
    
    // Special handling for twist mode
    if (state.scenarioType === 'twist') {
        return await generateTwist(state, settings, context);
    }
    
    // Build the prompt parts for generation
    const { systemPrompt, userPrompt, displayMessages } = await buildGenerationMessages(state, settings, context);
    
    log('Built prompts for generation');
    
    try {
        const response = await generateRaw({
            prompt: userPrompt,
            systemPrompt: systemPrompt,
        });

        if (!response || !response.trim()) {
            throw new Error('Empty response from API');
        }

        const finalText = cleanResponse(response);
        if (!finalText.trim()) throw new Error('Empty scenario after removing response preamble');

        return {
            text: finalText,
            prompt: displayMessages
        };

    } catch (error) {
        logError('Generation error:', error);
        throw new Error(error.message || 'Failed to generate scenario');
    }
}

async function generateTwist(state, settings, context) {
    if (!context.chat?.length) throw new Error('No active chat to apply twist to');
    const selectedTwist = getRandomTwist(state.category);
    if (!selectedTwist) throw new Error('Select a valid plot twist category.');
    const prompts = await buildGenerationMessages({ ...state, scenarioType: 'custom',
        customPrompt: `Continue the scene, naturally incorporating this plot twist: ${selectedTwist}. Do not explain the twist.` }, settings, context);
    const userPrompt = prompts.userPrompt.replace('Write a new roleplay scenario/greeting', 'Continue the current roleplay scene');
    const response = await generateRaw({ prompt: userPrompt, systemPrompt: prompts.systemPrompt });
    const text = cleanResponse(response || '');
    if (!text.trim()) throw new Error('Empty response from API');
    return { text, twistApplied: selectedTwist,
        prompt: [{ role: 'system', content: prompts.systemPrompt }, { role: 'user', content: userPrompt }] };
}

function getCharacterInfo(state, context) {
    if (state.selectedCharacter === null || state.selectedCharacter === undefined) {
        logError('No character selected');
        return null;
    }

    if (!context.characters || context.characters.length === 0) {
        logError('No characters loaded');
        return null;
    }

    const charIndex = parseInt(state.selectedCharacter);
    const char = context.characters[charIndex];
    
    if (!char) {
        logError('Character not found at index:', charIndex);
        return null;
    }

    log('Using character:', char.name);

    // Use char.data for raw unprocessed data with {{char}}/{{user}} macros
    // Try both char.data and direct char properties for compatibility
    const description = char.data?.description || char.description || '';
    const personality = char.data?.personality || char.personality || '';
    const scenario = char.data?.scenario || char.scenario || '';
    const exampleMessages = char.data?.mes_example || char.mes_example || '';
    
    log('Character info loaded:', {
        hasDescription: !!description,
        hasPersonality: !!personality,
        hasScenario: !!scenario,
        hasExamples: !!exampleMessages,
        exampleLength: exampleMessages.length
    });

    return {
        name: char.data?.name || char.name || 'Character',
        description: description,
        personality: personality,
        scenario: scenario,
        exampleMessages: exampleMessages
    };
}

function getPersonaInfo(state, context) {
    if (Object.hasOwn(state, 'personaDescription')) return state.personaDescription;
    // If a specific persona is selected (not empty string)
    if (state.selectedPersona && state.selectedPersona !== '' && power_user?.persona_descriptions) {
        const description = power_user.persona_descriptions[state.selectedPersona]?.description || '';
        log('Using persona description from:', state.selectedPersona);
        return description;
    }
    
    // Otherwise use current active persona
    if (power_user?.persona_description) {
        log('Using active persona description');
        return power_user.persona_description;
    }
    
    return '';
}

function getPersonaName(state, context) {
    if (Object.hasOwn(state, 'personaName')) return state.personaName;
    // If specific persona selected (not empty string)
    if (state.selectedPersona && state.selectedPersona !== '' && power_user?.personas) {
        const personaName = power_user.personas[state.selectedPersona];
        log('Using selected persona:', personaName, 'from avatar:', state.selectedPersona);
        return personaName || context.name1 || 'User';
    }
    
    // Otherwise use current active persona name
    log('Using active persona:', context.name1);
    return context.name1 || 'User';
}

function getChatHistory(state, context) {
    if (!context.chat || context.chat.length === 0) return [];

    const range = Math.min(Math.max(1, Number(state.historyRange) || 5), 50, context.chat.length);
    const start = Math.max(0, context.chat.length - range);

    return context.chat.slice(start).map(m => ({
        name: m.name,
        mes: m.mes,
        is_user: m.is_user  // ADD THIS LINE
    }));
}

async function getWorldInfo(state, context) {
    // ONLY proceed if world info is enabled
    if (state.includeWorldInfo !== true) {
        log('World info disabled');
        return '';
    }

    // Get enabled world books from settings
    const bookNames = getAvailableWorldBooks(state, context);
    
    if (bookNames.length === 0) {
        log('No world books enabled');
        return '';
    }

    log('Getting world info, mode:', state.worldInfoMode);

    try {
        if (state.worldInfoMode === 'selected') {
            return await getSelectedWorldInfo(state, context, bookNames);
        } else if (state.worldInfoMode === 'all') {
            return await getAllWorldInfo(state, context, bookNames);
        } else {
            // triggered mode
            return await getTriggeredWorldInfo(state, context, bookNames);
        }
    } catch (error) {
        logError('Error getting world info:', error);
        return '';
    }
}

async function getSelectedWorldInfo(state, context, bookNames) {
    const entries = [];
    
    for (const bookName of bookNames) {
        if (!state.selectedEntries?.[bookName]) continue;
        
        try {
            const bookData = await loadWorldBook(bookName, context);
            if (!bookData || !bookData.entries) continue;
            
            for (const uid of state.selectedEntries[bookName]) {
                const entry = bookData.entries[uid];
                if (entry && !entry.disable && !entry.disabled) {
                    const entryText = entry.comment 
                        ? `[${entry.comment}]\n${entry.content}`
                        : entry.content;
                    entries.push(entryText);
                }
            }
        } catch (e) {
            logError(`Failed to load world book ${bookName}:`, e);
        }
    }
    
    return entries.join('\n\n');
}

async function getAllWorldInfo(state, context, bookNames) {
    const entries = [];
    
    for (const bookName of bookNames) {
        try {
            const bookData = await loadWorldBook(bookName, context);
            if (!bookData || !bookData.entries) continue;
            
            Object.values(bookData.entries).forEach(entry => {
                if (!entry.disable && !entry.disabled && entry.content) {
                    const entryText = entry.comment
                        ? `[${entry.comment}]\n${entry.content}`
                        : entry.content;
                    entries.push(entryText);
                }
            });
        } catch (e) {
            logError(`Failed to load world book ${bookName}:`, e);
        }
    }
    
    return entries.join('\n\n');
}

async function getTriggeredWorldInfo(state, context, bookNames) {
    // Build trigger text from scenario prompt and character info
    let triggerText = '';
    
    const charInfo = getCharacterInfo(state, context);
    if (charInfo?.name) {
        triggerText += charInfo.name + ' ';
    }
    
    if (state.scenarioType === 'custom' && state.customPrompt) {
        triggerText += state.customPrompt;
    } else if (state.category && state.subcategory) {
        const templatePrompt = getTemplatePrompt(state.scenarioType, state.category, state.subcategory);
        if (templatePrompt) {
            triggerText += templatePrompt;
        }
    }
    
    if (state.includeHistory && context.chat) {
        const history = getChatHistory(state, context);
        triggerText += ' ' + history.map(m => m.mes).join(' ');
    }
    
    const lowerTrigger = triggerText.toLowerCase();
    const entries = [];
    
    for (const bookName of bookNames) {
        try {
            const bookData = await loadWorldBook(bookName, context);
            if (!bookData || !bookData.entries) continue;
            
            Object.values(bookData.entries).forEach(entry => {
                if (entry.disable || entry.disabled || !entry.content) return;
                
                // Normalize keys
                let keys = [];
                if (Array.isArray(entry.key)) {
                    keys = entry.key;
                } else if (Array.isArray(entry.keys)) {
                    keys = entry.keys;
                } else if (typeof entry.key === 'string') {
                    keys = entry.key.split(',').map(k => k.trim()).filter(Boolean);
                } else if (typeof entry.keys === 'string') {
                    keys = entry.keys.split(',').map(k => k.trim()).filter(Boolean);
                }
                
                // Check if any key matches
                const matches = entry.constant || keys.some(key => {
                    const keyLower = String(key).toLowerCase();
                    return lowerTrigger.includes(keyLower);
                });
                
                if (matches) {
                    const entryText = entry.comment
                        ? `[${entry.comment}]\n${entry.content}`
                        : entry.content;
                    entries.push(entryText);
                }
            });
        } catch (e) {
            logError(`Failed to load world book ${bookName}:`, e);
        }
    }
    
    log(`Triggered ${entries.length} entries`);
    return entries.join('\n\n');
}

async function loadWorldBook(bookName, context) {
    // Check cache first
    if (worldBookCache.has(bookName)) {
        log('Using cached world book:', bookName);
        return worldBookCache.get(bookName);
    }
    
    try {
        log('Loading world book:', bookName);
        
        // Use SillyTavern's world info loading method
        if (typeof context.loadWorldInfo === 'function') {
            const data = await context.loadWorldInfo(bookName);
            worldBookCache.set(bookName, data);
            return data;
        }
        
        // Fallback: Direct API call
        const response = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({ name: bookName })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        worldBookCache.set(bookName, data);
        return data;
    } catch (error) {
        logError(`Failed to load "${bookName}":`, error);
        return null;
    }
}


function cleanResponse(text) {
    let cleaned = text.trim();

    // Remove common unwanted prefixes
    const prefixes = [
        'Here is a scenario:',
        'Here\'s a scenario:',
        'Scenario:',
        'Sure, here\'s a scenario:',
        'Here you go:',
        'Here\'s a roleplay scenario:',
    ];

    for (const prefix of prefixes) {
        if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
            cleaned = cleaned.substring(prefix.length).trim();
        }
    }

    // Remove surrounding quotes
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        cleaned = cleaned.substring(1, cleaned.length - 1);
    }

    return cleaned;
}

// Generate scenario summary for injection
export async function generateSummary(scenarioText, charName) {
    try {
        const systemPrompt = `Summarize roleplay scenarios in 1-2 factual sentences. Capture the key situation and setting. Be objective and concise.`;
        const userPrompt = `Summarize this scenario for ${charName} in 1-2 sentences:\n\n${scenarioText}`;

        const result = await generateRaw({
            prompt: userPrompt,
            systemPrompt: systemPrompt,
        });

        return result.trim();
    } catch (error) {
        logError('Error generating summary:', error);
        return '';
    }
}

export { getCharacterInfo, getPersonaInfo, getPersonaName, getChatHistory };
