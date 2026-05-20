# Scenario Crafter for SillyTavern

Wanna shake things up a bit but not sure what exactly you and {{char}} should actually DO?

Scenario Crafter has a variety of scenarios you can play with. Choose your ~~victim~~ character, the persona you want to use, and one of the numerous scenario options, and generate a unique new greeting. Start a new chat, append to the current one, or rewrite the last message from a different angle.

Choose whether to include chat history, world info, or a summary of past events as context. View the prompt sent to the LLM to see what's going on under the hood.

Enjoy :) -moki

---

## Scenario Types

**Tropes** — Romance, Drama, Action, Fantasy, Mystery, Horror, Slice of Life, Comedy, and Sci-Fi. Each category has specific tropes like "Enemies to Lovers," "Fake Dating," "Trapped Together," "Time Loop," and dozens more.

**Moods** — Emotional situations rather than plot structures. Cozy, Tense, Playful, Melancholic, Intimate, and Adventurous, each with specific scenarios like "Quiet Morning," "Late Night Confession," "Comfort After Nightmare," etc.

**Plot Twists** — Shake up an existing conversation. Wholesome (funny/absurd), Dramatic (conflicts/revelations), Spicy (NSFW twists), Meta (fourth-wall breaks), and Chaos (reality-breaking madness). Picks a random twist and weaves it into the scene. Requires an active chat.

**Custom Prompts** — Write your own scenario instructions. Save them for reuse.

## Apply Modes

- **Start New Chat** — Creates a fresh chat with the generated scenario as the character's first message.
- **Append to Current** — Adds the scenario as a new message in your current chat.
- **Rewrite Last Message** — Replaces the character's most recent response with a rewritten version incorporating your scenario direction.

## Context Options

**Chat History** — Include recent messages so the generator understands the existing dynamic. Configurable message count (default 5).

**World Info** — Pull in lorebook entries. Three modes: Triggered Entries (keyword-matched), All Enabled Books, or Selected Entries (manual picker).

**Character & Persona** — Choose which character and persona to generate for, even if they're different from your current chat.

**Connection Profile** — Use a separate API connection/preset for generation if you want a different model or settings.

## Story Summaries

**Custom Summary** — Write your own summary of background events, world state, or character history. Always available. Supports ST macros ({{char}}, {{user}}, {{summary}}, {{getvar::key}}).

**Comprehensive Summaries** — If [Simple Summarizer](https://github.com/mokimoko/SillyTavern-SimpleSummarizer) is installed, Scenario Crafter can pull in comprehensive summaries from its Context Archive, filtered by the selected character. If Summarizer isn't installed, this option is hidden automatically.

Multiple summaries are presented in chronological order. You can reorder them and position your custom summary wherever it fits in the timeline.

## Settings

Settings are in the Extensions drawer under Scenario Crafter.

- **Writing Style** — The base prompt controlling how scenarios are written. Uses {{char}} and {{user}} placeholders.
- **Defaults** — Preferred tone, connection profile, context options, and apply mode.
- **Application** — Scenario note injection toggle and injection depth.

## Tips

- First generation takes a few seconds to load templates. After that they're cached.
- Plot twists work best with 5-10+ messages of existing history.
- Scenario notes are injected into chat context so the AI remembers the setup. You can edit the summary before applying or disable injection entirely.

## Slash Commands

- `/scenario` — Open the Scenario Crafter modal
- `/scenario-twist [category]` — Apply a random plot twist (wholesome, dramatic, spicy, meta, chaos)
- `/scenario-custom [prompt]` — Generate and apply a custom scenario
- `/scenario-list [type]` — List available templates (all, tropes, moods, twists)
- `/scenario-clear` — Remove the scenario note injection
