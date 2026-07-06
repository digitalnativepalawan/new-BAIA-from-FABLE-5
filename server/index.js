import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const __dirname = dirname(fileURLToPath(import.meta.url));

function stripAnsiCodes(text) {
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-npqry=><]/g, '');
}

function extractReply(stdout) {
  const cleaned = stripAnsiCodes(stdout);
  const lines = cleaned.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  let inBox = false;
  const boxLines = [];
  for (const line of lines) {
    if (/^╭─ ⚕ Hermes/.test(line)) {
      inBox = true;
      continue;
    }
    if (/^╰─+/.test(line)) {
      inBox = false;
    }
    if (inBox) boxLines.push(line);
  }

  if (boxLines.length > 0) {
    const boxContent = boxLines.join(' ').trim();
    if (boxContent) return boxContent;
  }

  const meaningful = lines.filter(line => !/^(Resume this session|Session:|Duration:|Messages:)/.test(line));
  if (meaningful.length > 0) return meaningful[meaningful.length - 1];

  return cleaned.trim();
}

let guestPromptCache = null;
let guestPromptLoadError = null;

async function loadGuestPrompt() {
  if (guestPromptCache) return guestPromptCache;
  if (guestPromptLoadError) return null;

  try {
    const promptPath = join(__dirname, 'guest-concierge-system-prompt.md');
    guestPromptCache = await readFile(promptPath, 'utf-8');
    return guestPromptCache;
  } catch (loadError) {
    guestPromptLoadError = loadError?.message ?? String(loadError);
    console.error('[hermes-proxy] guest prompt load error:', guestPromptLoadError);
    return null;
  }
}

app.post('/api/hermes/chat', async (req, res) => {
  const { message, context } = req.body ?? {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    let prompt = message;
    const normalizedContext = typeof context === 'string' ? context.toLowerCase().trim() : '';
    if (normalizedContext === 'guest-concierge') {
      const guestPrompt = await loadGuestPrompt();
      if (guestPrompt) {
        prompt = `${guestPrompt}\n\nGuest says: ${message}`;
      }
    } else if (context) {
      prompt = `[${context}] ${message}`;
    }

    const child = spawn('hermes', ['chat', '-q', '-', '--quiet'], {
      shell: true,
      timeout: 180000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      console.error('Hermes spawn error:', error);
    });

    child.stdin.write(prompt);
    child.stdin.end();

    await new Promise((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0 || stdout.trim()) {
          resolve();
        } else {
          reject(new Error(stderr.trim() || `hermes exited with code ${code}`));
        }
      });

      child.on('error', reject);
    });

    const reply = extractReply(stdout || '');
    return res.json({ reply: reply || 'Agent returned empty output.' });
  } catch (error) {
    console.error('Hermes error:', error);
    const errorMessage = error?.message ?? 'Agent failed.';
    return res.status(500).json({ error: errorMessage });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`Hermes proxy listening on http://localhost:${port}`);
});
