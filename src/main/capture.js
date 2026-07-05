// ─────────────────────────────────────────────────────────────────────────────
// Screen capture (main process only — desktopCapturer is banned from the
// renderer in modern Electron).
//
// We use desktopCapturer thumbnails as full-resolution screenshots: ask for a
// thumbnail sized to the display's *device* pixels (bounds × scaleFactor) and
// you get a crisp still frame. This is simpler than spinning up a
// getUserMedia stream for a single frame, and it's the standard trick.
//
// Platform notes (verified against current docs):
//  • macOS ≥ 10.15 requires the user to grant Screen Recording permission.
//    macOS 15 Sequoia additionally re-prompts roughly MONTHLY ("…requesting to
//    bypass the system private window picker…"). There is no developer opt-out
//    without Apple's undocumented Persistent Content Capture entitlement.
//    Detect state with systemPreferences.getMediaAccessStatus('screen').
//  • The app must be FULLY RELAUNCHED (Cmd+Q) after the permission is granted —
//    toggling the checkbox alone does nothing until restart. During `npm start`
//    the permission attaches to Electron.app/Electron Helper, not your app name.
//  • Windows: no permission prompt; works out of the box on Win10/11 with DWM.
//  • Linux/Wayland: getSources returns a single portal-mediated source.
// ─────────────────────────────────────────────────────────────────────────────

const { desktopCapturer, systemPreferences, shell } = require('electron');

/**
 * Capture a still frame of one display at full native resolution.
 * @param {Electron.Display} display
 * @returns {Promise<{dataUrl: string, width: number, height: number}>}
 */
async function captureDisplay(display) {
  const size = {
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor),
  };

  // NOTE: getSources fetches a thumbnail for EVERY display at this size, so
  // multi-monitor rigs pay a small cost. Fine for a hotkey-triggered action.
  // Linux: the portal picker handles selection, so offer windows as well as
  // screens — picking a single window there is the Meet-style flow. The
  // returned thumbnail keeps the picked source's aspect ratio; the renderer
  // letterboxes captures that don't match the display.
  const sources = await desktopCapturer.getSources({
    types: process.platform === 'linux' ? ['screen', 'window'] : ['screen'],
    thumbnailSize: size,
  });

  if (!sources.length) throw new Error('No screen sources available (permission denied?)');

  // Match the display we want. display_id ↔ screen.Display.id on most
  // platforms. Otherwise prefer a screen source over a window (X11 lists
  // both), and finally take whatever the portal returned (Wayland returns
  // only the one source the user picked).
  const source =
    sources.find((s) => s.display_id === String(display.id)) ||
    sources.find((s) => s.id.startsWith('screen:')) ||
    sources[0];

  const img = source.thumbnail;
  if (img.isEmpty()) {
    throw new Error(
      'Capture returned an empty image — on macOS this usually means Screen Recording permission is missing or was granted without relaunching the app.'
    );
  }

  return {
    dataUrl: img.toDataURL(), // PNG data URL
    width: img.getSize().width,
    height: img.getSize().height,
  };
}

/** 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown' */
function getScreenAccessStatus() {
  if (process.platform !== 'darwin') return 'granted';
  try {
    return systemPreferences.getMediaAccessStatus('screen');
  } catch {
    return 'unknown';
  }
}

/** Deep-link straight to System Settings → Privacy & Security → Screen Recording. */
function openScreenRecordingSettings() {
  if (process.platform === 'darwin') {
    shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    );
  }
}

module.exports = { captureDisplay, getScreenAccessStatus, openScreenRecordingSettings };
