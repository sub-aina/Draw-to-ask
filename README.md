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
- 🔌 **Swappable backends** — ships with Groq (free tier); Ollama, OpenRouter,
  Anthropic, and Gemini clients included or one env var away
- 🐧🍎🪟 **Linux (X11 & Wayland), macOS, Windows**

## Quick start

Install it globally from npm (needs Node ≥18 on your PATH — the install pulls a
prebuilt Electron binary):

```bash
npm install -g drawtoask
drawtoask
```

Give it a Groq API key the first time — paste it into the in-app overlay, or set
it in your environment before launching:

```bash
export GROQ_API_KEY=gsk_...   # free key from console.groq.com/keys
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

## Choosing a model backend

The default backend is **Groq's free tier** running Qwen 3.6 27B (`qwen/qwen3.6-27b`
— multimodal, very fast, no credit card required). Because `src/main/groq.js`
speaks the standard OpenAI Chat Completions shape, the same file works for any
OpenAI-compatible endpoint:

| Backend | How | Notes |
|---|---|---|
| **Groq** (default) | `GROQ_API_KEY=gsk_...` | Free tier, fast, key from [console.groq.com](https://console.groq.com/keys) |
| **Ollama** (local) | `GROQ_API_BASE=http://localhost:11434/v1`, model e.g. `llama3.2-vision` | Fully private — nothing leaves your machine. Fits a screen-capture tool. |
| **OpenRouter** | `GROQ_API_BASE=https://openrouter.ai/api/v1` + their key | Free-tier vision models available |
| **Anthropic** | swap the `require` in `main.js` to `./anthropic` | Strongest vision; `src/main/anthropic.js` is ready to go |
| **Gemini** | swap the `require` to `./gemini` | Free tier is geo-restricted in some countries |

The model name persists in `settings.json` under the app's `userData` dir
(`~/.config/Draw to Ask/` on Linux, `~/Library/Application Support/Draw to Ask/`
on macOS, `%APPDATA%/Draw to Ask/` on Windows).

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

### macOS permission facts (this is where demos die)

- Screen capture requires **System Settings → Privacy & Security → Screen
  Recording**. The app appears in that list only *after* its first capture
  attempt — run the spike once, grant, then relaunch.
- **The toggle does nothing until the app is fully quit and reopened.** This is
  the #1 "it returns a black/empty image" cause; `capture.js` detects the
  empty-image case and says so.
- During development the permission attaches to **Electron.app / Electron
  Helper**, not your app name. If capture breaks after `npm install` updates
  Electron, re-grant it.
- **macOS 15 Sequoia re-prompts roughly monthly.** There is no supported
  developer opt-out — budget for it in UX copy, don't chase it as a bug.
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

## File map

```
src/
  main/
    main.js        app lifecycle, hotkeys, overlay window, IPC, note saving
    capture.js     desktopCapturer + portal/permission handling
    groq.js        default backend — OpenAI-compatible vision + SSE streaming
    anthropic.js   alternate backend: Anthropic Messages API
    gemini.js      alternate backend: Google Gemini
    settings.js    API key/model persistence
  preload.js       contextBridge surface (the only main↔renderer bridge)
  renderer/
    index.html     overlay shell (frozen frame, ink canvas, ask bar, cards)
    overlay.css    Neo-Brutalist tokens: sticky yellow, hard shadows, mono type
    overlay.js     state machine: frozen → notes; crop+composite; sticky notes
```

## Roadmap / deliberate MVP cuts

- **Append-to-journal saving** — one running `.md` of all answers (drop it in
  an Obsidian vault) instead of a file per note
- **Copy to clipboard** button on notes
- **History** — persist `{crop, question, answer}` to a JSON log in `userData`
- **Multi-monitor note migration** (capture already follows the cursor's display)
- **safeStorage** for the key; code-signing + notarization for distribution
- **Bundled IBM Plex Mono** (`src/renderer/fonts/` + `@font-face`) — currently
  falls back to system mono to keep the repo network-free

## Demo script (zero narration needed)

1. Open a terminal with a gnarly compile error. Hotkey, circle the error,
   Enter. The fix streams onto a sticky note next to it.
2. Open a dense chart in a PDF. Hotkey, circle the weird part, type
   "why the spike?", Enter.
3. Drag the note somewhere satisfying, hit ⤓ to keep the answer. Click ✕.
   Screen recording done.
