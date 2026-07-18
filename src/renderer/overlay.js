// ─────────────────────────────────────────────────────────────────────────────
// Draw to Ask — overlay renderer
//
// States:
//   idle     window hidden (main controls that)
//   frozen   screenshot shown, user draws strokes, ask bar after first stroke
//   notes    screen unfrozen (live again); ink + sticky notes float on top;
//            window is click-through except when hovering a note
//
// Coordinates: strokes are recorded in CSS px. The screenshot is device px
// (CSS px × scaleFactor). Cropping maps CSS→device by multiplying by the
// display's scaleFactor supplied by the main process.
// ─────────────────────────────────────────────────────────────────────────────

const api = window.drawToAsk;

const el = {
  frozen: document.getElementById('frozen'),
  ink: document.getElementById('ink'),
  hint: document.getElementById('hint'),
  welcomecard: document.getElementById('welcomecard'),
  welcomeok: document.getElementById('welcomeok'),
  askbar: document.getElementById('askbar'),
  question: document.getElementById('question'),
  askbtn: document.getElementById('askbtn'),
  keycard: document.getElementById('keycard'),
  keyinput: document.getElementById('keyinput'),
  keysave: document.getElementById('keysave'),
  keycancel: document.getElementById('keycancel'),
  permcard: document.getElementById('permcard'),
  permopen: document.getElementById('permopen'),
  permclose: document.getElementById('permclose'),
  notes: document.getElementById('notes'),
};

const MARKER = '#ff3d00';
const STROKE_WIDTH = 4;      // CSS px
const CROP_PADDING = 32;     // CSS px around the ink bounding box
const MAX_EDGE = 2048;       // device px cap on the crop's long edge

let ctx = el.ink.getContext('2d');
let state = 'idle';
let scaleFactor = 1;
let screenshot = null;       // HTMLImageElement of the frozen frame (device px)
let hasApiKey = false;
let seenWelcome = true;      // suppress the welcome card until main says otherwise
let keepFrozen = false;      // Linux: keep the frozen frame up while notes show

let strokes = [];            // strokes of the CURRENT session: [{points:[{x,y}]}]
let pinnedStrokes = [];      // strokes kept alive by open notes: [{points, noteId}]
let drawing = false;
let nextRequestId = 1;
const noteById = new Map(); // requestId → { root, body, done }

// ── Canvas sizing (crisp on retina) ─────────────────────────────────────────

function sizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  el.ink.width = Math.round(innerWidth * dpr);
  el.ink.height = Math.round(innerHeight * dpr);
  el.ink.style.width = innerWidth + 'px';
  el.ink.style.height = innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redraw();
}
addEventListener('resize', sizeCanvas);

function drawStroke(s) {
  const pts = s.points;
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = MARKER;
  ctx.lineWidth = STROKE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function redraw() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  for (const s of pinnedStrokes) drawStroke(s);
  for (const s of strokes) drawStroke(s);
}

// ── Session lifecycle (driven by main) ──────────────────────────────────────

api.onSessionStart(({ dataUrl, scaleFactor: sf, hasApiKey: keyed, seenWelcome: sw, keepFrozen: kf }) => {
  scaleFactor = sf;
  hasApiKey = keyed;
  seenWelcome = sw !== false; // undefined (older main) → treat as seen
  keepFrozen = Boolean(kf);
  strokes = [];
  hideAskbar();
  el.permcard.hidden = true;

  const img = new Image();
  img.onload = () => {
    // The capture may not be display-sized: on Linux the portal picker can
    // return a single WINDOW (Meet-style share). Letterbox it onto a
    // display-sized canvas so the on-screen image and the crop math both
    // stay in the same device-px coordinate space.
    const fitted = fitToDisplay(img);
    screenshot = fitted.source;
    el.frozen.src = fitted.dataUrl || dataUrl;
    document.body.classList.add('frozen');
    document.body.classList.remove('notes-mode');
    state = 'frozen';
    sizeCanvas();

    // First-ever freeze: explain the flow before showing the draw hint.
    if (!seenWelcome) {
      el.hint.hidden = true;
      el.welcomecard.hidden = false;
    } else {
      el.hint.hidden = false;
    }
  };
  img.src = dataUrl;
});

// Dismiss the welcome card and remember it, so it only ever shows once.
function dismissWelcome() {
  if (el.welcomecard.hidden) return;
  el.welcomecard.hidden = true;
  seenWelcome = true;
  api.markWelcomeSeen();
  if (state === 'frozen') el.hint.hidden = false;
}
el.welcomeok.addEventListener('click', dismissWelcome);

// Contain-fit a capture into the display's device-px box (no-op when it
// already matches, i.e. a normal full-screen grab).
function fitToDisplay(img) {
  const W = Math.round(innerWidth * scaleFactor);
  const H = Math.round(innerHeight * scaleFactor);
  if (img.width === W && img.height === H) return { source: img, dataUrl: null };

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1a1a';
  g.fillRect(0, 0, W, H);
  const k = Math.min(W / img.width, H / img.height);
  const dw = Math.round(img.width * k), dh = Math.round(img.height * k);
  g.drawImage(img, Math.round((W - dw) / 2), Math.round((H - dh) / 2), dw, dh);
  return { source: c, dataUrl: c.toDataURL('image/png') };
}

api.onSessionCancel(() => exitDrawMode());
api.onPermissionNeeded(() => {
  state = 'frozen'; // interactive, but no screenshot
  el.permcard.hidden = false;
});
api.onSessionError(({ message }) => {
  state = 'frozen';
  spawnErrorNote(message, { x: innerWidth / 2, y: innerHeight / 2 });
});

// Leave draw mode. Keep the window alive (click-through) if notes are open.
function exitDrawMode() {
  strokes = [];
  hideAskbar();
  el.hint.hidden = true;
  el.welcomecard.hidden = true;
  el.keycard.hidden = true;
  el.permcard.hidden = true;

  const keepingNotes = noteById.size > 0;
  if (!(keepingNotes && keepFrozen)) {
    // Unfreeze — except on Linux with notes open, where the frozen frame
    // stays up as context (the overlay blocks the desktop there anyway).
    document.body.classList.remove('frozen');
    el.frozen.removeAttribute('src');
  }

  if (keepingNotes) {
    document.body.classList.add('notes-mode');
    state = 'notes';
    redraw();
    api.endSession({ keepNotes: true });
  } else {
    state = 'idle';
    redraw();
    api.endSession({ keepNotes: false });
  }
}

// ── Drawing ──────────────────────────────────────────────────────────────────

el.ink.addEventListener('pointerdown', (e) => {
  if (state !== 'frozen' || !screenshot) return;
  if (!el.welcomecard.hidden || !el.keycard.hidden || !el.permcard.hidden) return; // modal open
  drawing = true;
  el.hint.hidden = true;
  hideAskbar();
  strokes.push({ points: [{ x: e.clientX, y: e.clientY }] });
  el.ink.setPointerCapture(e.pointerId);
});

el.ink.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const s = strokes[strokes.length - 1];
  s.points.push({ x: e.clientX, y: e.clientY });
  redraw();
});

el.ink.addEventListener('pointerup', () => {
  if (!drawing) return;
  drawing = false;
  const s = strokes[strokes.length - 1];
  if (s.points.length < 3) strokes.pop(); // stray click, not a stroke
  redraw();
  if (strokes.length) showAskbar();
});

// ── Geometry helpers ─────────────────────────────────────────────────────────

function strokesBBox(list) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of list) for (const p of s.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

// Shoelace area of a stroke treated as a closed polygon (CSS px²).
function strokeArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function lastStrokeCentroid() {
  const pts = strokes[strokes.length - 1].points;
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

// ── Ask bar ──────────────────────────────────────────────────────────────────

function showAskbar() {
  const b = strokesBBox(strokes);
  const W = 380, H = 78;
  let x = Math.min(Math.max(8, (b.minX + b.maxX) / 2 - W / 2), innerWidth - W - 8);
  let y = b.maxY + 16;
  if (y + H > innerHeight - 8) y = Math.max(8, b.minY - H - 16);
  el.askbar.style.left = x + 'px';
  el.askbar.style.top = y + 'px';
  el.askbar.hidden = false;
  el.question.focus();
}

function hideAskbar() {
  el.askbar.hidden = true;
  el.question.value = '';
}

function submit() {
  if (!strokes.length || !screenshot) return;
  if (!hasApiKey) { el.keycard.hidden = false; el.keyinput.focus(); return; }
  const question = el.question.value;
  const anchor = lastStrokeCentroid();
  const crop = buildCrop();
  const myStrokes = strokes;
  const requestId = nextRequestId++;

  // Unfreeze immediately — the note streams in over the live screen.
  pinnedStrokes.push(...myStrokes.map((s) => ({ ...s, noteId: requestId })));
  spawnNote(requestId, anchor, question);
  strokes = [];
  exitDrawModeKeepingNotes();

  api.ask({
    imageBase64: crop.base64,
    mediaType: 'image/png',
    question,
    requestId,
  }).catch(() => { /* surfaced via answer:error */ });
}

function exitDrawModeKeepingNotes() {
  hideAskbar();
  el.hint.hidden = true;
  if (!keepFrozen) {
    // macOS/Windows: unfreeze — the note floats over the live screen.
    document.body.classList.remove('frozen');
    el.frozen.removeAttribute('src');
  }
  document.body.classList.add('notes-mode');
  state = 'notes';
  redraw();
  api.endSession({ keepNotes: true });
}

el.askbtn.addEventListener('click', submit);
el.question.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit();
  e.stopPropagation();
});

// ── Crop + composite ─────────────────────────────────────────────────────────
// Cut the region around the ink out of the screenshot and stamp the ink on
// top, so the model literally sees what was circled.

function buildCrop() {
  const b = strokesBBox(strokes);
  const x0 = Math.max(0, b.minX - CROP_PADDING);
  const y0 = Math.max(0, b.minY - CROP_PADDING);
  const x1 = Math.min(innerWidth, b.maxX + CROP_PADDING);
  const y1 = Math.min(innerHeight, b.maxY + CROP_PADDING);

  const sx = Math.round(x0 * scaleFactor);
  const sy = Math.round(y0 * scaleFactor);
  const sw = Math.max(1, Math.round((x1 - x0) * scaleFactor));
  const sh = Math.max(1, Math.round((y1 - y0) * scaleFactor));

  // Cap the long edge — keeps vision tokens/cost sane on huge circles.
  const down = Math.min(1, MAX_EDGE / Math.max(sw, sh));
  const cw = Math.max(1, Math.round(sw * down));
  const ch = Math.max(1, Math.round(sh * down));

  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const cx = c.getContext('2d');
  cx.drawImage(screenshot, sx, sy, sw, sh, 0, 0, cw, ch);

  const k = scaleFactor * down;

  // Focus the model on what's INSIDE the loop, not the whole bounding box.
  // If the stroke(s) enclose a meaningful area (a circle/lasso, not a thin
  // underline or scribble), veil everything outside the enclosed polygon so
  // surrounding content that merely falls inside the crop rectangle fades away.
  const cropAreaCss = (x1 - x0) * (y1 - y0);
  const enclosedCss = strokes.reduce((sum, s) => sum + strokeArea(s.points), 0);
  const looksLikeLoop = enclosedCss > 0.18 * cropAreaCss &&
    strokes.some((s) => s.points.length > 8);

  if (looksLikeLoop) {
    cx.save();
    cx.beginPath();
    cx.rect(0, 0, cw, ch);                    // outer subpath …
    for (const s of strokes) {                // … minus each loop (even-odd)
      cx.moveTo((s.points[0].x - x0) * k, (s.points[0].y - y0) * k);
      for (let i = 1; i < s.points.length; i++) {
        cx.lineTo((s.points[i].x - x0) * k, (s.points[i].y - y0) * k);
      }
      cx.closePath();
    }
    // Neutral wash (not cream) so it fades context on BOTH light and dark
    // backgrounds without inverting a dark UI into a bright ring.
    cx.fillStyle = 'rgba(128,128,128,0.55)';
    cx.fill('evenodd');
    cx.restore();
  }

  // Ink, transformed from CSS px into crop space.
  cx.strokeStyle = MARKER;
  cx.lineWidth = STROKE_WIDTH * k;
  cx.lineJoin = 'round';
  cx.lineCap = 'round';
  for (const s of strokes) {
    cx.beginPath();
    cx.moveTo((s.points[0].x - x0) * k, (s.points[0].y - y0) * k);
    for (let i = 1; i < s.points.length; i++) {
      cx.lineTo((s.points[i].x - x0) * k, (s.points[i].y - y0) * k);
    }
    cx.stroke();
  }

  return { base64: c.toDataURL('image/png').split(',')[1] };
}

// ── Sticky notes ─────────────────────────────────────────────────────────────

function spawnNote(requestId, anchor, question = '') {
  const root = document.createElement('div');
  root.className = 'note';
  root.innerHTML = `
    <div class="note-head"><span class="dot"></span>DRAW TO ASK<span class="spacer"></span>
      <button class="note-save" title="Save to file">⤓</button>
      <button class="note-close" title="Dismiss">✕</button></div>
    <div class="note-body"><span class="caret"></span></div>`;
  positionNote(root, anchor);
  el.notes.appendChild(root);

  const body = root.querySelector('.note-body');
  noteById.set(requestId, { root, body, done: false, question });

  root.querySelector('.note-save').addEventListener('click', () => saveNote(requestId));
  root.querySelector('.note-close').addEventListener('click', () => closeNote(requestId));
  makeHoverInteractive(root);
  makeDraggable(root, root.querySelector('.note-head'));
}

function spawnErrorNote(message, anchor) {
  const id = nextRequestId++;
  spawnNote(id, anchor);
  const n = noteById.get(id);
  n.root.classList.add('error');
  n.body.textContent = message;
  n.done = true;
}

function positionNote(root, anchor) {
  const W = 320, GAP = 20;
  let x = anchor.x + GAP;
  if (x + W > innerWidth - 8) x = Math.max(8, anchor.x - W - GAP);
  let y = Math.min(Math.max(8, anchor.y - 40), innerHeight - 160);
  root.style.left = x + 'px';
  root.style.top = y + 'px';
}

async function saveNote(requestId) {
  const n = noteById.get(requestId);
  if (!n) return;
  const text = n.body.innerText.trim();
  if (!text) return;
  const btn = n.root.querySelector('.note-save');
  try {
    const savedPath = await api.saveNote({ text, question: n.question });
    if (!savedPath) return; // user cancelled the picker
    if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = '⤓'; }, 1500); }
    showSavedFooter(n.root, `SAVED → ${savedPath}`);
  } catch (err) {
    showSavedFooter(n.root, `✗ SAVE FAILED: ${err.message}`, true);
  }
}

function showSavedFooter(root, message, isError = false) {
  let foot = root.querySelector('.note-foot');
  if (!foot) {
    foot = document.createElement('div');
    foot.className = 'note-foot';
    root.appendChild(foot);
  }
  foot.textContent = message;
  foot.classList.toggle('error', isError);
  foot.hidden = false;
  clearTimeout(foot._timer);
  foot._timer = setTimeout(() => { foot.hidden = true; }, 5000);
}

function closeNote(requestId) {
  const n = noteById.get(requestId);
  if (!n) return;
  n.root.remove();
  noteById.delete(requestId);
  pinnedStrokes = pinnedStrokes.filter((s) => s.noteId !== requestId);
  redraw();
  if (noteById.size === 0 && state === 'notes') {
    state = 'idle';
    document.body.classList.remove('notes-mode');
    document.body.classList.remove('frozen');
    el.frozen.removeAttribute('src');
    api.hideOverlay();
  } else {
    api.setIgnoreMouse(true); // cursor no longer over anything ours
  }
}

// Streaming answer plumbing
api.onAnswerChunk(({ requestId, text }) => {
  const n = noteById.get(requestId);
  if (!n) return;
  const caret = n.body.querySelector('.caret');
  caret.insertAdjacentText('beforebegin', text);
  n.body.scrollTop = n.body.scrollHeight;
});
api.onAnswerDone(({ requestId }) => {
  const n = noteById.get(requestId);
  if (!n) return;
  n.body.querySelector('.caret')?.remove();
  n.done = true;
});
api.onAnswerError(({ requestId, message }) => {
  const n = noteById.get(requestId);
  if (!n) return;
  n.root.classList.add('error');
  n.body.querySelector('.caret')?.remove();
  n.body.textContent = `✗ ${message}`;
  n.done = true;
});

// ── Click-through choreography ──────────────────────────────────────────────
// In notes mode the window ignores mouse events but forwards moves; hovering
// a note flips the window interactive, leaving flips it back.

function makeHoverInteractive(node) {
  node.addEventListener('mouseenter', () => {
    if (state === 'notes') api.setIgnoreMouse(false);
  });
  node.addEventListener('mouseleave', () => {
    if (state === 'notes') api.setIgnoreMouse(true);
  });
}

function makeDraggable(root, handle) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return; // buttons in the head click, not drag
    const startX = e.clientX - root.offsetLeft;
    const startY = e.clientY - root.offsetTop;
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      root.style.left = Math.min(Math.max(0, ev.clientX - startX), innerWidth - 60) + 'px';
      root.style.top = Math.min(Math.max(0, ev.clientY - startY), innerHeight - 40) + 'px';
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

// ── API key card ─────────────────────────────────────────────────────────────

el.keysave.addEventListener('click', async () => {
  const key = el.keyinput.value.trim();
  if (!key) return;
  await api.setApiKey(key);
  hasApiKey = true;
  el.keycard.hidden = true;
  el.keyinput.value = '';
  submit(); // resume the ask that triggered onboarding
});
el.keycancel.addEventListener('click', () => { el.keycard.hidden = true; });
el.keyinput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.keysave.click();
  e.stopPropagation();
});

// ── Permission card ──────────────────────────────────────────────────────────

el.permopen.addEventListener('click', () => api.openPermissionSettings());
el.permclose.addEventListener('click', () => exitDrawMode());

// ── Global keys ──────────────────────────────────────────────────────────────

addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!el.welcomecard.hidden) { dismissWelcome(); return; }
  if (!el.keycard.hidden) { el.keycard.hidden = true; return; }
  if (state === 'frozen') { exitDrawMode(); return; }
  if (state === 'notes') {
    // Dismiss all notes → hides the overlay (important on Linux, where the
    // overlay blocks the desktop while notes are open).
    for (const id of [...noteById.keys()]) closeNote(id);
  }
});

sizeCanvas();
