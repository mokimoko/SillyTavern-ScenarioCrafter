# Changelog

Earlier releases were not recorded here.

## Unreleased

## 1.0.3 - 2026-11-23

- Keep large character and persona collections responsive with batched label indexing and searchable dropdowns limited to 200 choices, retaining the current selection while filtering.
- Share overlapping panel-opening attempts, cancel unfinished loading on close, and offer a retry after failed or timed-out initialization without marking a partial load complete.
- Apply generated prose as literal message text, with shared generation and application workflows for the modal and slash commands.
- Bind drafts to their original chat and message, discard stale results, and rewrite the selected character's response while preserving its original swipe.
- Respect Twist history, lorebook, and summary choices; discover character, persona, chat, and global lorebooks consistently.
- Fix cold-start twist commands, custom-command rewrite mode, connection profile switching/restoration, and saved modal defaults.
- Preserve scenario notes while previewing and store applied notes with their chat. Fix literal character-name substitution and cancellable world-info selections.
- Validate scenario selections before generation, clamp numeric settings, and add keyboard focus management and accessible dialog labels.

- Support readable SimpleSummarizer filenames recorded in its index, while retaining compatibility with older ID-only archives.
- Read SimpleSummarizer's per-chat archive index in the story summary picker and load full text and quotes only for summaries selected for generation.
- Use stable archive IDs and character owners to keep same-named chats separate, while supporting legacy and unmigrated recaps without reusing stale backups.
- Added an MIT license and started tracking project changes in this changelog.
