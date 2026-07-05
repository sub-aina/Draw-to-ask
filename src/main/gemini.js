const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const DEFAULT_MODEL = 'gemini-2.0-flash';

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

async function streamAnswer({ apiKey, model, imageBase64, mediaType = 'image/png', question, onChunk }) {
  const url = `${API_BASE}${model || DEFAULT_MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const parts = [
    { inlineData: { mimeType: mediaType, data: imageBase64 } },
    {
      text: question && question.trim()
        ? `My question about the marked region: ${question.trim()}`
        : 'Answer the implicit question about the region I marked.',
    },
  ];

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    }),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch {}
    throw new Error(`API ${res.status}: ${detail || res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;

      let evt;
      try { evt = JSON.parse(payload); } catch { continue; }

      const candidate = evt.candidates?.[0];
      if (!candidate) {
        if (evt.promptFeedback?.blockReason) {
          throw new Error(`Request blocked: ${evt.promptFeedback.blockReason}`);
        }
        continue;
      }

      if (candidate.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
        if (candidate.finishReason === 'SAFETY') {
          throw new Error('Response blocked by content safety filters.');
        }
      }

      const text = candidate.content?.parts?.map(p => p.text).join('') || '';
      if (text.length > full.length) {
        const delta = text.slice(full.length);
        full = text;
        onChunk?.(delta);
      }
    }
  }

  return full;
}

module.exports = { streamAnswer, DEFAULT_MODEL };
