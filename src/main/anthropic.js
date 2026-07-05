// ─────────────────────────────────────────────────────────────────────────────
// Anthropic Messages API client (vision + streaming) — main process.
//
// Zero dependencies: Node 18+/Electron ships global fetch with streaming
// bodies, so we parse the SSE stream by hand (~30 lines) instead of pulling
// in the SDK. Swap in @anthropic-ai/sdk later if you want retries/typing.
//
// API shape (verified against current docs at platform.claude.com):
//   POST https://api.anthropic.com/v1/messages
//   headers: x-api-key, anthropic-version: 2023-06-01
//   image content block: { type:"image", source:{ type:"base64", media_type, data } }
//   Put the image BEFORE the text — Claude performs best image-then-text.
//   Streaming events: content_block_delta → delta.type === "text_delta"
// ─────────────────────────────────────────────────────────────────────────────

const API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6'; // fast + strong vision; see README to change

const SYSTEM_PROMPT = `You are the brain behind "Draw to Ask", a screen annotation tool.
The user pressed a hotkey, their screen froze, and they circled or scribbled on
something with a marker. You receive ONLY the cropped region around their ink,
with their stroke composited on top in bright ink.

Rules:
- The marked element is the subject. Infer the implicit question from context:
  an error message → explain and give the fix; a chart → explain what it shows;
  code → explain or spot the bug; a UI element → explain what it does;
  foreign text → translate it.
- If the user typed a question, answer THAT question about the marked region.
- Be direct and compact: this renders on a small sticky note. Lead with the
  answer. 1–4 short sentences, or a tiny code snippet if a fix needs one.
  No preamble, no "It looks like", no closing offers.`;

/**
 * Stream an answer about a cropped, ink-annotated screenshot region.
 * @returns {Promise<string>} the full answer text
 */
async function streamAnswer({ apiKey, model, imageBase64, mediaType = 'image/png', question, onChunk }) {
  const userContent = [
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
    {
      type: 'text',
      text: question && question.trim()
        ? `My question about the marked region: ${question.trim()}`
        : 'Answer the implicit question about the region I marked.',
    },
  ];

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      max_tokens: 700,
      stream: true,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch {}
    throw new Error(`API ${res.status}: ${detail || res.statusText}`);
  }

  // ── Minimal SSE parser ─────────────────────────────────────────────────────
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete tail

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let evt;
      try { evt = JSON.parse(payload); } catch { continue; }

      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        full += evt.delta.text;
        onChunk?.(evt.delta.text);
      } else if (evt.type === 'error') {
        throw new Error(evt.error?.message || 'Stream error');
      }
    }
  }

  return full;
}

module.exports = { streamAnswer, DEFAULT_MODEL };
