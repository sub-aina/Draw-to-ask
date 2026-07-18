// ─────────────────────────────────────────────────────────────────────────────
// Groq client (vision + streaming) — main process.
//
// Groq speaks the OpenAI Chat Completions shape, so this also works as-is for
// any OpenAI-compatible vision endpoint — just change API_BASE + model:
//   Groq:       https://api.groq.com/openai/v1   (free tier, needs a key)
//   Ollama:     http://localhost:11434/v1        (local, key can be anything)
//   OpenRouter: https://openrouter.ai/api/v1     (free-tier models available)
//
// Vision models pass the image as a data: URL inside an image_url content block.
// Streaming events: choices[0].delta.content, terminated by  data: [DONE]
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = process.env.GROQ_API_BASE || 'https://api.groq.com/openai/v1';
const DEFAULT_MODEL = 'qwen/qwen3.6-27b'; // multimodal (replaces deprecated llama-4-scout)

// Transient upstream failures worth retrying (rate limit + gateway/capacity).
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 4; // up to 5 attempts total (~6s worst-case backoff)

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
    { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
    {
      type: 'text',
      text: question && question.trim()
        ? `My question about the marked region: ${question.trim()}`
        : 'Answer the implicit question about the region I marked.',
    },
  ];

  const body = JSON.stringify({
    model: model || DEFAULT_MODEL,
    max_tokens: 700,
    stream: true,
    // Qwen 3.6 is a reasoning model; skip the think phase so the sticky note
    // gets a direct answer (faster, and no <think> leaking into the note).
    reasoning_effort: 'none',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  });

  // Free-tier vision models are frequently "over capacity" (503) or rate-limited
  // (429) — transient blips the server explicitly asks us to retry with backoff.
  // Retry those silently before the connection opens; surface everything else.
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body,
    });

    if (res.ok) break;

    if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after')) * 1000;
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter                                       // honor server hint
        : Math.min(8000, 400 * 2 ** attempt) + Math.random() * 250; // else 0.4s,0.8s,1.6s,3.2s + jitter
      await new Promise((resolve) => setTimeout(resolve, backoff));
      continue;
    }

    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch {}
    throw new Error(`API ${res.status}: ${detail || res.statusText}`);
  }

  // ── Minimal SSE parser ─────────────────────────────────────────────────────
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  // Safety net: if an overridden model ignores reasoning_effort and emits a
  // <think>…</think> block inline, strip it before it reaches the note. State
  // persists across deltas, and a partial tag straddling a chunk is carried over.
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let inThink = false;
  let carry = '';
  const longestTagPrefixTail = (text, tag) => {
    for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
      if (tag.startsWith(text.slice(text.length - n))) return n;
    }
    return 0;
  };
  const stripThink = (chunk) => {
    let text = carry + chunk;
    carry = '';
    let out = '';
    while (text) {
      if (!inThink) {
        const i = text.indexOf(OPEN);
        if (i === -1) {
          const keep = longestTagPrefixTail(text, OPEN);
          out += text.slice(0, text.length - keep);
          carry = text.slice(text.length - keep);
          break;
        }
        out += text.slice(0, i);
        text = text.slice(i + OPEN.length);
        inThink = true;
      } else {
        const i = text.indexOf(CLOSE);
        if (i === -1) {
          carry = text.slice(text.length - longestTagPrefixTail(text, CLOSE));
          break;
        }
        text = text.slice(i + CLOSE.length);
        inThink = false;
      }
    }
    return out;
  };

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

      if (evt.error) throw new Error(evt.error.message || 'Stream error');

      const visible = stripThink(evt.choices?.[0]?.delta?.content || '');
      if (visible) {
        full += visible;
        onChunk?.(visible);
      }
    }
  }

  return full;
}

module.exports = { streamAnswer, DEFAULT_MODEL };
