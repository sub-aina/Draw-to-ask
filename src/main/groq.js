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
const DEFAULT_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'; // open-weight, multimodal

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

  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      max_tokens: 700,
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
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

      if (evt.error) throw new Error(evt.error.message || 'Stream error');

      const delta = evt.choices?.[0]?.delta?.content;
      if (delta) {
        full += delta;
        onChunk?.(delta);
      }
    }
  }

  return full;
}

module.exports = { streamAnswer, DEFAULT_MODEL };
