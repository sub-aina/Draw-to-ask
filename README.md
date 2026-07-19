# ✏️ Draw to Ask

**Circle anything on your screen. Get an answer as a sticky note.**

Press a hotkey → the screen freezes → draw a circle around anything — an error
message, a chart, foreign text, a weird UI button — → a vision model answers on
a Neo-Brutalist sticky note, streamed in as it thinks. Type a question if you
have one; if you don't, the model infers it from what you circled.

Zero build step. Plain Electron + vanilla JS. No SDK dependencies — the API
clients are ~100 lines of `fetch` each.

```
Ctrl/Cmd+Shift+D ──▶ capture the display under the cursor (BEFORE overlay shows)
                 ──▶ frozen frame + crosshair, draw with the marker
                 ──▶ ask bar appears near your stroke (type or just Enter)
                 ──▶ sticky note streams the answer in
                 ──▶ drag it around, save it as Markdown, or dismiss it
```

## Features

- 🖊️ **Draw, don't describe** — the model literally sees what you circled,
  ink included
- 🧠 **Implicit questions** — circle an error and it explains the fix; circle
  a chart and it explains the trend; circle foreign text and it translates
- ⚡ **Streaming answers** — the note types itself in
- 💾 **Save notes** — one click writes the answer as a `.md` file
- 🔌 **Bring any provider** — pick Groq (free tier), OpenAI, Anthropic, Gemini,
  OpenRouter, or a local Ollama right in the overlay, and paste that key
- 🐧🍎🪟 **Linux (X11 & Wayland), macOS, Windows**

## Quick start

Install it globally from npm (needs Node ≥18 on your PATH — the install pulls a
prebuilt Electron binary):

```bash
npm install -g drawtoask
drawtoask
```

Give it an API key the first time. The in-app overlay has a **provider picker** —
choose Groq, OpenAI, Anthropic, Gemini, OpenRouter, or a local Ollama, and paste
that provider's key. Nothing is hard-wired to Groq. Prefer the environment? Set
the matching variable before launching:

```bash
export GROQ_API_KEY=gsk_...        # free key from console.groq.com/keys
# …or any of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY
```

<details>
<summary><b>Run from source instead</b></summary>

```bash
git clone https://github.com/sub-aina/Draw-to-ask && cd Draw-to-ask
npm install
export GROQ_API_KEY=gsk_...   # or paste it in-app
npm start
```
</details>

| Key | Action |
|---|---|
| **Ctrl+Shift+D** (⌘⇧D on macOS) | Freeze the screen and draw. Press again to cancel/restart. |
| **Enter** | Ask (with or without a typed question) |
| **Esc** | Leave draw mode / dismiss all notes |
| **Ctrl+Shift+Q** (⌘⇧Q) | Quit the app entirely |
| **⤓** on a note | Save the answer as Markdown |
| **✕** on a note | Dismiss the note |

The app is a background utility — no window, no dock icon. It lives on the
hotkey until you quit it.

## Choosing a provider

Pick a provider right in the overlay — hit **⚙ AI provider** in the ask bar (or
it appears automatically the first time you ask without a key). Choose one, paste
its key, and optionally override the model. Keys are stored **per provider**, so
switching back and forth never loses a key you already pasted. The default is
**Groq's free tier** running Qwen 3.6 27B (multimodal, very fast, no card).

| Provider | Default model | Notes |
|---|---|---|
| **Groq** (default) | `qwen/qwen3.6-27b` | Free tier, fast, key from [console.groq.com](https://console.groq.com/keys) |
| **OpenAI** | `gpt-4o-mini` | Key from [platform.openai.com](https://platform.openai.com/api-keys) |
| **Anthropic** | `claude-sonnet-4-6` | Strongest vision; key from [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| **Gemini** | `gemini-2.0-flash` | Free tier is geo-restricted in some countries |
| **OpenRouter** | `google/gemini-2.0-flash-exp:free` | Free-tier vision models available |
| **Ollama** (local) | `llama3.2-vision` | Fully private — nothing leaves your machine. The key can be anything. |

Under the hood, all the OpenAI-compatible endpoints (Groq, OpenAI, OpenRouter,
Ollama) share one client — `src/main/groq.js`. To add another, drop a
`kind: 'openai'` entry into `src/main/providers.js` with its `apiBase` and
`defaultModel`; no other file changes. Anthropic and Gemini have their own
clients (`src/main/anthropic.js`, `src/main/gemini.js`).

Your provider choice, per-provider keys, and model overrides persist in
`settings.json` under the app's `userData` dir (`~/.config/Draw to Ask/` on
Linux, `~/Library/Application Support/Draw to Ask/` on macOS, `%APPDATA%/Draw to
Ask/` on Windows).

## Spike the risky part first

The biggest platform risk is OS capture permissions, so there's a mode that
runs one capture→overlay cycle immediately on launch:

```bash
npm run spike
```

If you see your own frozen screen with a crosshair, the risky layer works and
everything else is plain web code.

## Platform notes

### Linux

Works on **X11 and Wayland** (tested on KDE Plasma/Arch). Wayland's security
model required some adaptations, all built in:

- **Capture goes through the desktop portal** (PipeWire). Pressing the hotkey
  pops your compositor's own "choose what to share" picker — the same one
  Google Meet uses. Pick a screen to freeze everything, or a single window to
  freeze just it (letterboxed). This is the only way to capture native Wayland
  windows.
- **Notes keep the frozen frame up** while you read. Wayland/X11 don't support
  Electron's per-pixel click-through forwarding, so instead of floating notes
  over a live-but-unclickable desktop, the app stays frozen for context.
  **Esc** returns you to your desktop.
- **Saving skips the file picker** — native dialogs misbehave under a
  fullscreen always-on-top overlay on Wayland — and writes straight to
  `~/Downloads/draw-to-ask-<timestamp>.md`, showing the path on the note.
- Transparency trouble on broken GPU drivers: `DRAW_TO_ASK_NO_GPU=1 npm start`.

### macOS

macOS blocks screen capture until you grant **Screen & System Audio Recording**
permission. This is where first-run fails, so do it in this order:

1. **Trigger one capture attempt** so macOS knows the app wants the screen:
   ```bash
   drawtoask --spike     # global install
   # or, from source:  npm run spike
   ```
2. Open **System Settings → Privacy & Security → Screen & System Audio
   Recording**.
3. Click **+** (or the toggle) and **add your terminal app** — `Terminal`,
   or `iTerm`, or whichever app you launched `drawtoask` from. Because the app
   runs as a child process of the terminal, macOS attributes the capture
   permission to the **terminal**, not to "Draw to Ask" or "Electron". Enable
   its toggle.
4. **Fully quit and reopen the terminal**, then run `drawtoask` again. The
   permission does nothing until the terminal is restarted — this is the #1
   "it returns a black/empty image" cause (`capture.js` detects the empty frame
   and says so).

Notes:

- If you instead run a packaged **`.dmg` build**, the permission attaches to
  **Draw to Ask** directly (add that app in step 3 instead of the terminal).
- Running from source in dev, it may show up as **Electron / Electron Helper** —
  same idea, grant whatever launched it. If capture breaks after an
  `npm install` bumps Electron, re-grant it.
- **macOS 15 Sequoia re-prompts roughly monthly.** There's no supported
  developer opt-out — expect it, don't chase it as a bug.
- Sequoia shows a purple/orange menu-bar indicator during capture — expected.

### Windows

No permission prompt; works on Win10/11 out of the box.

- Transparent windows need DWM (always on in 10/11). On broken GPU drivers,
  try `DRAW_TO_ASK_NO_GPU=1 npm start`.
- Don't use `fullscreen: true` for the overlay — it breaks transparency. The
  frameless window is sized to the display's bounds instead (already done).

## How the tricky bits work

**The "freeze" is the screenshot.** Captured *before* the overlay shows, then
displayed full-screen inside it. Three problems solved at once: the overlay
never photobombs its own capture, the screen visibly "freezes", and stroke
coordinates map 1:1 onto the image (CSS px × `display.scaleFactor` = device px).
Captures that don't match the display (a picked window on Wayland) are
letterboxed onto a display-sized canvas so the crop math never changes.

**Full-res capture via `desktopCapturer` thumbnails.** Modern Electron only
allows `desktopCapturer` in the main process; requesting a thumbnail sized to
the display's device pixels yields a crisp still frame — no `getUserMedia`
stream needed for a single frame.

**Click-through with hover exceptions (macOS/Windows).** After the answer
arrives, `setIgnoreMouseEvents(true, { forward: true })` lets clicks pass
through to whatever's underneath while mousemove still reaches the page — so
hovering a note flips the window interactive and leaving flips it back.
(`forward` is macOS/Windows-only, hence the Linux behavior above.)

**The model sees your ink.** The crop is the stroke bounding box + 32 px
padding with the marker stroke composited on top, long edge capped at 2048
device px. The system prompt tells the model to answer the *implicit* question
about the marked element unless you typed an explicit one.

**Streaming.** The main process calls the chat endpoint with `stream: true`
and hand-parses the SSE, forwarding text deltas over IPC so the note types
itself in.

**Security posture.** The renderer is sandboxed with `contextIsolation`; the
API key never enters it — image crops go up over IPC, answer text streams
down. The key is stored plaintext in `userData` (same trust level as a
`.env`); upgrade to Electron `safeStorage` before shipping.