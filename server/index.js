import express from 'express';
import cors from 'cors';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const __dirname = dirname(fileURLToPath(import.meta.url));
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';

let guestPromptCache = null;

async function loadGuestPrompt() {
  if (guestPromptCache) return guestPromptCache;
  try {
    guestPromptCache = await readFile(join(__dirname, 'guest-concierge-system-prompt.md'), 'utf-8');
    return guestPromptCache;
  } catch (error) {
    console.error('[ollama-proxy] guest prompt load error:', error?.message || String(error));
    return 'You are KAPWA, a helpful resort guest concierge. Be concise and never invent prices, policies, availability, or confirmations.';
  }
}

app.get('/api/hermes/health', async (_req, res) => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    const data = await response.json();
    const installed = Array.isArray(data.models)
      ? data.models.some((model) => model.name === OLLAMA_MODEL)
      : false;
    return res.json({ ok: true, provider: 'ollama', model: OLLAMA_MODEL, installed });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      provider: 'ollama',
      model: OLLAMA_MODEL,
      error: error?.message || 'Ollama is unavailable',
    });
  }
});

app.post('/api/hermes/chat', async (req, res) => {
  const { message, context } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const normalizedContext = typeof context === 'string' ? context.toLowerCase().trim() : '';
    const messages = [];
    if (normalizedContext === 'guest-concierge') {
      messages.push({ role: 'system', content: await loadGuestPrompt() });
    }
    messages.push({ role: 'user', content: message.trim() });

    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        options: { temperature: 0.2 },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Ollama returned ${response.status}: ${detail}`);
    }

    const data = await response.json();
    const reply = data?.message?.content?.trim();
    if (!reply) throw new Error('Ollama returned an empty response');

    return res.json({ reply });
  } catch (error) {
    console.error('[ollama-proxy] chat error:', error);
    return res.status(503).json({
      error: 'Local AI is unavailable. Make sure Ollama is running on this laptop.',
    });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`KAPWA Ollama proxy listening on http://localhost:${port}`);
  console.log(`Using ${OLLAMA_MODEL} at ${OLLAMA_URL}`);
});
