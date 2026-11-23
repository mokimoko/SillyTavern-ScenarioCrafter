import { SlashCommandParser } from '../../../../slash-commands/SlashCommandParser.js';
import { logError } from './utils.js';

export async function withConnectionProfile(profileName, generate) {
    if (!profileName) return generate();
    const profile = SlashCommandParser.commands.profile?.callback;
    if (!profile) throw new Error('Connection profiles are unavailable. Select Default Connection.');
    const original = await profile({}, '');
    let switched = false;
    try {
        if (original !== profileName) {
            // The callback receives literal names, including quotes, pipes, and braces.
            switched = true;
            const selected = await profile({ await: 'true' }, profileName);
            if (selected !== profileName) throw new Error(`Could not select connection profile: ${profileName}`);
        }
        return await generate();
    } finally {
        if (switched) {
            try {
                const restored = await profile({ await: 'true' }, original || '<None>');
                if (restored !== (original || '<None>')) throw new Error('Profile restoration was not confirmed.');
            } catch (error) {
                logError('Failed to restore connection profile:', error);
                toastr.warning('Generation finished, but the previous connection profile could not be restored.', 'Scenario Crafter');
            }
        }
    }
}
