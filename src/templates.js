import { log, logError } from './utils.js';

let templates = null;
let twists = null;

function getExtensionDirectory() {
    const url = new URL(import.meta.url);
    const path = url.pathname;
    return path.substring(0, path.lastIndexOf('/src/'));
}

export async function loadTemplates() {
    if (templates) return templates;

    try {
        const extensionDir = getExtensionDirectory();
        const templatesPath = `${extensionDir}/templates.json`;
        
        log('Loading templates from:', templatesPath);
        const response = await fetch(templatesPath);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        templates = await response.json();
        log('Templates loaded successfully');
        return templates;
    } catch (error) {
        logError('Failed to load templates:', error);
        throw new Error('Could not load scenario templates');
    }
}

export function getTropeCategories() {
    if (!templates?.trope?.categories) return [];
    return templates.trope.categories;
}

export function getTropesByCategory(category) {
    if (!templates?.trope?.[category]) return {};
    return templates.trope[category];
}

export function getMoodCategories() {
    if (!templates?.mood) return [];
    return Object.keys(templates.mood);
}

export function getMoodSituations(mood) {
    if (!templates?.mood?.[mood]) return {};
    return templates.mood[mood];
}

export function getTemplatePrompt(type, category, subcategory) {
    if (type === 'trope') {
        return templates?.trope?.[category]?.[subcategory]?.prompt || '';
    } else if (type === 'mood') {
        return templates?.mood?.[category]?.[subcategory] || '';
    }
    return '';
}

export function getTemplateDescription(type, category, subcategory) {
    if (type === 'trope') {
        return templates?.trope?.[category]?.[subcategory]?.description || '';
    }
    return '';
}

export async function loadTwists() {
    if (twists) return twists;

    try {
        const extensionDir = getExtensionDirectory();
        const twistsPath = `${extensionDir}/twists.json`;
        
        log('Loading twists from:', twistsPath);
        const response = await fetch(twistsPath);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        twists = await response.json();
        log('Twists loaded successfully');
        return twists;
    } catch (error) {
        logError('Failed to load twists:', error);
        return null;
    }
}

export function getTwistCategories() {
    if (!twists) return [];
    return Object.keys(twists);
}

export function getTwistsByCategory(category) {
    if (!twists || !twists[category]) return [];
    return twists[category];
}

export function getRandomTwist(category) {
    const categoryTwists = getTwistsByCategory(category);
    if (categoryTwists.length === 0) return null;
    return categoryTwists[Math.floor(Math.random() * categoryTwists.length)];
}

export function getToneModifier(tone) {
    if (!templates?.tones) return '';
    return templates.tones[tone] || '';
}