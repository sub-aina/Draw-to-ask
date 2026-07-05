# Draw to Ask

Hotkey → screen freezes → circle anything → the region (with your ink stamped
on it) goes to a vision model → the answer slaps onto your screen as a
Neo-Brutalist sticky note. Zero build step, plain Electron + vanilla JS.

```
Cmd/Ctrl+Shift+D ──▶ capture display under cursor (BEFORE overlay shows)
                 ──▶ frozen frame + crosshair, draw with the marker
                 ──▶ ask bar appears near your stroke (type or just Enter)
                 ──▶ screen unfreezes, sticky note streams the answer in
                 ──▶ note is draggable; everything else is click-through
```

## Quick start

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # or paste it into the in-app prompt
npm start
```

Press **Cmd+Shift+D** (macOS) / **Ctrl+Shift+D** (Windows). Esc bails out of
draw mode at any point. Pressing the hotkey again cancels the current session
or starts a new one.

## Spike the risky part first

The biggest risk is OS capture permissions, so there's a dedicated mode that
runs one capture→overlay cycle immediately on launch:

```bash
npm run spike
```

If you see your own frozen screen with a crosshair, the whole risky layer
works and everything else is plain web code.

### macOS permission facts (this is where demos die)

- Screen capture requires **System Settings → Privacy & Security → Screen
  Recording**. The app appears in that list only *after* its first capture
  attempt — so run the spike once, grant, then relaunch.
- **The toggle does nothing until the app is fully quit and reopened.** This
  is the #1 "it returns a black/empty image" cause; `capture.js` detects the
  empty-image case and says so.
- During development the permission attaches to **Electron.app / Electron
  Helper**, not your app name. If capture mysteriously breaks after
  `npm install` updates Electron, re-grant it.
- **macOS 15 Sequoia re-prompts roughly monthly** ("…requesting to bypass the
  system private window picker…"). There is no supported developer opt-out;
  Apple's Persistent Content Capture entitlement exists but is undocumented
  and gated. Budget for this in UX copy (the app's permission card mentions
  it) and don't chase it as a bug.
- Sequoia also shows a purple/orange menu-bar indicator during capture —
  expected, harmless.

### Windows

No permission prompt; works on Win10/11 out of the box. Two known quirks:

- Transparent windows need DWM (always on in 10/11). On machines with broken
  GPU drivers, transparency can fail — launch with
  `DRAW_TO_ASK_NO_GPU=1 npm start` to test the software path.
- Don't use `fullscreen: true` for the overlay — it breaks transparency. We
  size the frameless window to the display's bounds instead (already done).

## How the tricky bits work

**The "freeze" is the screenshot.** We capture *before* showing the overlay,
then display that still frame full-screen inside the overlay. Three problems
solved at once: the overlay never photobombs its own capture, the screen
visibly "freezes", and stroke coordinates map 1:1 onto the image
(CSS px × `display.scaleFactor` = device px).

**Full-res capture via `desktopCapturer` thumbnails.** Modern Electron only
allows `desktopCapturer` in the **main process**; asking for a thumbnail sized
to the display's device pixels yields a crisp still. (`getSources` renders a
thumbnail for *every* display at that size — a small cost per hotkey press;
if you ever need continuous capture, switch to a `getUserMedia` stream.)

**Click-through with hover exceptions.** After the answer arrives the window
goes `setIgnoreMouseEvents(true, { forward: true })`: clicks pass through to
whatever's underneath, but mousemove still reaches the page, so hovering a
sticky note flips the window interactive (`mouseenter`) and leaving flips it
back (`mouseleave`). The `forward` option works on **macOS and Windows**
(older Electron issues claiming macOS lacks it are outdated).

**The model sees your ink.** The crop is the stroke bounding box + 32 px
padding, with the marker stroke composited on top, long edge capped at
2048 device px. The system prompt tells the model to answer the *implicit*
question about the marked element (error → fix, chart → explain, foreign
text → translate) unless you typed an explicit one.

**Streaming.** The main process calls `POST /v1/messages` with `stream: true`
and hand-parses the SSE (`content_block_delta` → `text_delta`), forwarding
chunks over IPC so the note types itself in. Default model is
`claude-sonnet-4-6` (strong vision, fast); change it in
`~/Library/Application Support/draw-to-ask/settings.json` (macOS) /
`%APPDATA%/draw-to-ask/settings.json` (Windows), or in
`src/main/anthropic.js`.

**Security posture.** Renderer is sandboxed with `contextIsolation`; the API
key never enters the renderer — crops go up over IPC, text streams down. The
key is stored plaintext in `userData` (same trust level as `.env`); upgrade
to Electron `safeStorage` before shipping.

## File map

```
src/
  main/
    main.js        app lifecycle, hotkey, overlay window, IPC
    capture.js     desktopCapturer + macOS permission handling
    anthropic.js   vision call + SSE streaming (no SDK dependency)
    settings.js    API key/model persistence
  preload.js       contextBridge surface
  renderer/
    index.html     overlay shell (frozen frame, ink canvas, ask bar, cards)
    overlay.css    Neo-Brutalist tokens: sticky yellow, hard 6px shadows,
                   3px borders, IBM Plex Mono (system-mono fallback)
    overlay.js     state machine: frozen → notes, crop+composite, notes
```

## Deliberate MVP cuts (and where they'd go)

- **Multi-monitor**: we capture whichever display the cursor is on (better
  than "primary only"), but notes don't migrate across displays.
- **History**: notes die on close. Persist `{crop, question, answer}` to a
  JSON log in `userData` when you want it.
- **IBM Plex Mono**: referenced but not bundled (keeps the repo
  network-free). Drop the `.woff2` files in `src/renderer/fonts/` and add
  `@font-face` to make the aesthetic exact everywhere.
- **safeStorage** for the key, code-signing + notarization for distribution
  (unsigned macOS builds get a worse permission UX).

## Demo script (zero narration needed)

1. Open a terminal with a gnarly compile error. Hotkey, circle the error,
   Enter. The fix streams onto a sticky note next to it.
2. Open a dense chart in a PDF. Hotkey, circle the weird part, type
   "why the spike?", Enter.
3. Drag the note somewhere satisfying. Click ✕. Screen recording done.
