// Tiny JSON settings store in the app's userData directory.
// Holds the chosen provider plus per-provider API keys and model overrides.
// Keys are stored per provider so switching providers never loses a key you
// already pasted.
//
// NOTE: this stores keys in plaintext on disk, scoped to the OS user —
// same trust level as ~/.aws/credentials or a .env file. For a shipped
// product, upgrade to Electron's safeStorage (Keychain/DPAPI-backed).

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FILE = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = { provider: 'groq', keys: {}, models: {}, seenWelcome: false };

// Older builds stored a single { apiKey, model } pair (Groq-only). Fold those
// into the per-provider shape so upgrades keep working with no user action.
function migrate(raw) {
  const s = { ...DEFAULTS, ...raw, keys: { ...raw.keys }, models: { ...raw.models } };
  if (raw.apiKey && !s.keys.groq) s.keys.groq = raw.apiKey;
  if (raw.model && !s.models.groq) s.models.groq = raw.model;
  delete s.apiKey;
  delete s.model;
  return s;
}

function loadSettings() {
  try {
    return migrate(JSON.parse(fs.readFileSync(FILE(), 'utf8')));
  } catch {
    return { ...DEFAULTS, keys: {}, models: {} };
  }
}

function saveSettings(settings) {
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.writeFileSync(FILE(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('[settings] save failed:', err);
  }
}

module.exports = { loadSettings, saveSettings };
