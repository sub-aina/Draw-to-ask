// ─────────────────────────────────────────────────────────────────────────────
// Draw to Ask — main process
//
// Flow: global hotkey → capture screenshot of the display under the cursor
// (BEFORE the overlay is shown, so the overlay never appears in its own
// screenshot) → position a transparent always-on-top window over that display
// → renderer shows the frozen frame and lets the user draw → renderer crops
// the circled region and sends it here → we stream a vision-model answer back.
//
// The overlay window has two interaction modes:
//   • DRAW mode  — window receives all mouse events (user is drawing/typing)
//   • NOTE mode  — window is click-through EXCEPT over sticky notes, via
//                  setIgnoreMouseEvents(true, { forward: true }) toggled from
//                  the renderer on mouseenter/mouseleave. Works on macOS and
//                  Windows (the `forward` option is supported on both).
// ─────────────────────────────────────────────────────────────────────────────

const { app, BrowserWindow, globalShortcut, ipcMain, screen, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const { captureDisplay, getScreenAccessStatus, openScreenRecordingSettings } = require('./capture');
const { streamAnswer } = require('./groq');
const { loadSettings, saveSettings } = require('./settings');

const HOTKEY = 'CommandOrControl+Shift+D';
const QUIT_HOTKEY = 'CommandOrControl+Shift+Q';

// Click-through in notes mode relies on setIgnoreMouseEvents(…, { forward:true })
// so the page can still detect hover over a note. `forward` is macOS/Windows
// only. On Linux we can't forward, so we keep the overlay fully interactive in
// notes mode instead — notes stay draggable/clickable; the trade-off is you
// can't click apps *under* the overlay until you dismiss the notes (✕ or Esc).
const CAN_FORWARD = process.platform === 'darwin' || process.platform === 'win32';

let overlay = null;          // the single overlay BrowserWindow
let sessionActive = false;   // a draw session is in progress
let toggling = false;        // debounce guard for the hotkey
let settings = loadSettings();

// ── Overlay window ───────────────────────────────────────────────────────────

function createOverlay() {
  overlay = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    resizable: false,          // resizable:true can break transparency on some platforms
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Float above (almost) everything, including macOS fullscreen apps.
  // 'screen-saver' is the highest practical level; 'floating' is not enough
  // to cover fullscreen video or presentation apps.
  overlay.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') {
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  overlay.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  overlay.on('closed', () => { overlay = null; });
}

// ── Session start: capture → position → show ────────────────────────────────

async function startSession() {
  if (!overlay) createOverlay();

  // Which display is the cursor on? That's the one we freeze.
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);

  // macOS: bail out early with guidance if screen recording isn't authorized.
  const access = getScreenAccessStatus();
  if (access === 'denied' || access === 'restricted') {
    overlay.setBounds(display.bounds);
    overlay.webContents.send('session:permission-needed');
    setInteractive(true);
    overlay.show();
    overlay.focus();
    sessionActive = true;
    return;
  }

  let shot;
  try {
    // Capture BEFORE showing the overlay — the frozen frame must not contain us.
    shot = await captureDisplay(display);
  } catch (err) {
    console.error('[capture]', err);
    overlay.setBounds(display.bounds);
    overlay.webContents.send('session:error', {
      message: err.message || 'Screen capture failed.',
    });
    setInteractive(true);
    overlay.show();
    sessionActive = true;
    return;
  }

  overlay.setBounds(display.bounds);
  overlay.webContents.send('session:start', {
    dataUrl: shot.dataUrl,
    scaleFactor: display.scaleFactor,
    displayBounds: display.bounds,
    hasApiKey: Boolean(settings.apiKey || process.env.GROQ_API_KEY),
    // No click-through forwarding on Linux → the overlay blocks the desktop
    // anyway while notes are open, so keep the frozen image up for context
    // instead of "dropping" the user onto a live screen they can't click.
    keepFrozen: !CAN_FORWARD,
  });

  setInteractive(true);
  overlay.show();
  overlay.focus();
  sessionActive = true;
}

// End the *draw* session. If sticky notes remain, the renderer asks us to keep
// the window visible in click-through mode; otherwise we hide entirely.
function endSession({ keepNotes = false } = {}) {
  sessionActive = false;
  if (!overlay) return;
  if (keepNotes) {
    // macOS/Windows: click-through, notes re-enable on hover via forwarded moves.
    // Linux: no forwarding, so keep the window interactive (notes stay usable).
    setInteractive(!CAN_FORWARD);
  } else {
    overlay.hide();
    setInteractive(true); // reset for next time
  }
}

function setInteractive(interactive) {
  if (!overlay) return;
  if (interactive) {
    overlay.setIgnoreMouseEvents(false);
    overlay.setFocusable(true);
  } else {
    // forward:true keeps mousemove flowing to the page so sticky notes can
    // detect hover and flip themselves interactive again. (macOS + Windows.)
    overlay.setIgnoreMouseEvents(true, { forward: true });
  }
}

function toggle() {
  if (toggling) return;         // rapid double-press protection
  toggling = true;
  setTimeout(() => { toggling = false; }, 300);

  if (sessionActive) {
    overlay?.webContents.send('session:cancel'); // renderer decides: keep notes or hide
  } else {
    startSession();
  }
}

// ── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.on('overlay:set-ignore-mouse', (_e, ignore) => {
  if (!overlay) return;
  if (ignore && CAN_FORWARD) overlay.setIgnoreMouseEvents(true, { forward: true });
  else overlay.setIgnoreMouseEvents(false); // Linux: stay interactive so notes work
});

ipcMain.on('session:end', (_e, opts) => endSession(opts || {}));

ipcMain.on('overlay:hide', () => {
  sessionActive = false;
  overlay?.hide();
});

ipcMain.handle('settings:get', () => ({
  hasApiKey: Boolean(settings.apiKey || process.env.GROQ_API_KEY),
  model: settings.model,
}));

ipcMain.handle('settings:set-api-key', (_e, key) => {
  settings.apiKey = String(key || '').trim();
  saveSettings(settings);
  return true;
});

ipcMain.on('permissions:open-settings', () => openScreenRecordingSettings());

// Save a sticky note's answer. Returns the saved path (or false).
// Linux: native save dialogs under a fullscreen always-on-top overlay are
// unreliable on Wayland — they can open BEHIND the overlay and the await
// hangs forever with zero feedback. So on Linux we skip the picker entirely
// and write straight to ~/Downloads; the renderer shows the path on the note.
// macOS/Windows: show the picker (dropping always-on-top so it's visible).
ipcMain.handle('note:save', async (_e, { text, question } = {}) => {
  const body = String(text || '').trim();
  if (!body) return false;

  const header = question && question.trim() ? `# ${question.trim()}\n\n` : '';
  const content = header + body + '\n';
  const defaultName = `draw-to-ask-${Date.now()}.md`;

  if (process.platform === 'linux') {
    const filePath = path.join(app.getPath('downloads'), defaultName);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('[note:save] wrote', filePath);
    return filePath;
  }

  overlay?.setAlwaysOnTop(false);
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(overlay, {
      title: 'Save note',
      defaultPath: path.join(app.getPath('downloads'), defaultName),
      filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  } finally {
    overlay?.setAlwaysOnTop(true, 'screen-saver');
  }
});

// Ask the vision model. Streams chunks back so the sticky note types itself in.
ipcMain.handle('ask', async (event, { imageBase64, mediaType, question, requestId }) => {
  const apiKey = settings.apiKey || process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('No API key configured. Set GROQ_API_KEY or add one in the overlay.');

  const wc = event.sender;
  try {
    const full = await streamAnswer({
      apiKey,
      model: settings.model,
      imageBase64,
      mediaType,
      question,
      onChunk: (text) => { if (!wc.isDestroyed()) wc.send('answer:chunk', { requestId, text }); },
    });
    if (!wc.isDestroyed()) wc.send('answer:done', { requestId });
    return full;
  } catch (err) {
    if (!wc.isDestroyed()) wc.send('answer:error', { requestId, message: err.message });
    throw err;
  }
});

// ── App lifecycle ────────────────────────────────────────────────────────────

// A transparent overlay wants GPU compositing; on some Windows machines with
// broken GPU drivers transparency fails — this flag is a known escape hatch
// users can try:  DRAW_TO_ASK_NO_GPU=1 npm start
if (process.env.DRAW_TO_ASK_NO_GPU) app.disableHardwareAcceleration();

// Linux/Wayland: route capture through the xdg-desktop-portal + PipeWire.
// This pops the compositor's own "choose what to share" picker (same one
// Google Meet uses) and is the ONLY way to capture native Wayland windows —
// the XWayland fallback only sees the wallpaper and X11 apps. We stay on
// XWayland for the window itself (so setBounds/always-on-top keep working);
// only the capture goes through the portal.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide(); // background utility, no Dock icon

  createOverlay();

  const ok = globalShortcut.register(HOTKEY, toggle);
  if (!ok) console.error(`Failed to register global hotkey ${HOTKEY} (already in use?)`);

  // Quit the whole app from anywhere — it's a background utility with no window.
  globalShortcut.register(QUIT_HOTKEY, () => app.quit());

  // --spike: immediately run one capture+overlay cycle, to test permissions
  // before building anything on top (see README "Spike first").
  if (process.argv.includes('--spike')) {
    setTimeout(startSession, 800);
  } else {
    console.log(`Draw to Ask ready. Press ${HOTKEY} to freeze the screen and draw, ${QUIT_HOTKEY} to quit.`);
  }
});

app.on('will-quit', () => globalShortcut.unregisterAll());

// Keep running with no windows visible — we're a hotkey-summoned utility.
app.on('window-all-closed', (e) => { /* stay alive */ });
