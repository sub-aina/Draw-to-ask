// ─────────────────────────────────────────────────────────────────────────────
// Provider registry — the single source of truth for "which AIs can answer".
//
// Draw to Ask is provider-agnostic: pick any of these in the overlay and paste
// that provider's key. Three client shapes cover everything here:
//   • openai   — OpenAI Chat Completions (Groq, OpenAI, OpenRouter, Ollama, …).
//                One client, many endpoints — just a different `apiBase`.
//   • anthropic — Anthropic Messages API.
//   • gemini    — Google Generative Language API.
//
// To add another OpenAI-compatible endpoint, copy a `kind: 'openai'` entry and
// change `apiBase` + `defaultModel`. No other file needs to change.
// ─────────────────────────────────────────────────────────────────────────────

const openai = require('./groq'); // OpenAI-compatible client (named for its origin)
const anthropic = require('./anthropic');
const gemini = require('./gemini');

const MODULES = { openai, anthropic, gemini };

// Order here is the order shown in the picker. `groq` stays first as the
// zero-cost default (free tier, no card).
const PROVIDERS = {
  groq: {
    label: 'Groq (free tier)',
    kind: 'openai',
    apiBase: 'https://api.groq.com/openai/v1',
    defaultModel: 'qwen/qwen3.6-27b',
    envKeys: ['GROQ_API_KEY'],
    keysUrl: 'console.groq.com/keys',
    placeholder: 'gsk_…',
  },
  openai: {
    label: 'OpenAI',
    kind: 'openai',
    apiBase: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    envKeys: ['OPENAI_API_KEY'],
    keysUrl: 'platform.openai.com/api-keys',
    placeholder: 'sk-…',
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    defaultModel: anthropic.DEFAULT_MODEL,
    envKeys: ['ANTHROPIC_API_KEY'],
    keysUrl: 'console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-…',
  },
  gemini: {
    label: 'Google Gemini',
    kind: 'gemini',
    defaultModel: gemini.DEFAULT_MODEL,
    envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    keysUrl: 'aistudio.google.com/apikey',
    placeholder: 'AIza…',
  },
  openrouter: {
    label: 'OpenRouter',
    kind: 'openai',
    apiBase: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-2.0-flash-exp:free',
    envKeys: ['OPENROUTER_API_KEY'],
    keysUrl: 'openrouter.ai/keys',
    placeholder: 'sk-or-…',
  },
  ollama: {
    label: 'Ollama (local)',
    kind: 'openai',
    apiBase: process.env.OLLAMA_API_BASE || 'http://localhost:11434/v1',
    defaultModel: 'llama3.2-vision',
    envKeys: ['OLLAMA_API_KEY'],
    keysUrl: 'ollama.com/download',
    placeholder: 'ollama (any value)',
    localKeyOptional: true, // Ollama ignores the key; a placeholder is fine
  },
};

const DEFAULT_PROVIDER = 'groq';

function getProvider(id) {
  return PROVIDERS[id] || PROVIDERS[DEFAULT_PROVIDER];
}

// First non-empty env var among a provider's accepted names.
function envKeyFor(id) {
  const p = getProvider(id);
  for (const name of p.envKeys || []) {
    if (process.env[name]) return process.env[name];
  }
  return '';
}

// The client module (openai/anthropic/gemini) that serves a provider.
function moduleFor(id) {
  return MODULES[getProvider(id).kind];
}

// A UI-safe catalog for the renderer (no functions/modules leak across IPC).
function catalog() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    label: p.label,
    defaultModel: p.defaultModel,
    keysUrl: p.keysUrl,
    placeholder: p.placeholder,
    localKeyOptional: Boolean(p.localKeyOptional),
    hasEnvKey: Boolean(envKeyFor(id)),
  }));
}

module.exports = {
  PROVIDERS,
  DEFAULT_PROVIDER,
  getProvider,
  envKeyFor,
  moduleFor,
  catalog,
};
