# Roadmap

Planned features, roughly in priority order. 🔥 = high value.

## Next up

- **Follow-up chat on a note** 🔥 — the highest-value one. A small input at the
  bottom of a sticky note so you can reply ("explain simpler", "show the fix in
  Python") and keep going. We already keep `{question, crop}` per note; just keep
  the message history and re-send with the same image. Turns one-shot answers
  into a conversation anchored to a screen region. _(Medium effort)_

- **History / journal** 🔥 — persist every `{crop thumbnail, question, answer,
  timestamp}` to `userData`, with a small browsable panel (a second hotkey).
  Pairs with the append-to-one-markdown-file idea — saving straight into an
  Obsidian vault with backlink-friendly formatting makes it a genuine study log.

- **Tray icon** — quit / settings / history from a menu-bar icon, no terminal or
  hotkeys needed. Also fixes "how do I exit?" discoverability for new users.
  _(Small effort)_

## Later

- **Copy to clipboard** button on notes.
- **Multi-monitor note migration** (capture already follows the cursor's display).
- **safeStorage** for the API key; code-signing + notarization for distribution.
