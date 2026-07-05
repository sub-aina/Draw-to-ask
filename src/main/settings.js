// Tiny JSON settings store in the app's userData directory.
// Holds the API key (if not provided via ANTHROPIC_API_KEY env var) and model.
//
// NOTE: this stores the key in plaintext on disk, scoped to the OS user —
// same trust level as ~/.aws/credentials or a .env file. For a shipped
// product, upgrade to Electron's safeStorage (Keychain/DPAPI-backed).

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FILE = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = { apiKey: '', model: 'meta-llama/llama-4-scout-17b-16e-instruct' };

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
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
