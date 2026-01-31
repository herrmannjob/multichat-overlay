import 'dotenv/config';
import express from 'express';

// Monkey-patch console.log to suppress noisy dependency logs
const originalLog = console.log;
console.log = (...args) => {
  // Join all args to check the full message
  const str = args.map(a => String(a)).join(" ");
  if (str.includes("Unknown event type:") && str.includes("pusher:")) return; 
  if (str.includes("Unknown event type:") && str.includes("pusher_internal:")) return;
  originalLog(...args);
};

import { WebSocketServer } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initTwitch } from './platforms/twitch.js';
import { initYouTube } from './platforms/youtube.js';
// import { initKick } from './platforms/kick.js';
import { initTikTok } from './platforms/tiktok.js';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { initKick } = require('./platforms/kick.cjs'); // <-- CJS aqui

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Static overlay files
app.use('/overlay', express.static(path.join(__dirname, '..', 'overlay')));

// Health
app.get('/healthz', (_, res) => res.json({ ok: true }));

const server = app.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST}:${PORT}`);
  console.log(`[server] overlay at http://${HOST}:${PORT}/overlay/`);
});

// WebSocket hub
const wss = new WebSocketServer({ server });
const sockets = new Set();

wss.on('connection', (ws) => {
  sockets.add(ws);
  ws.on('close', () => sockets.delete(ws));
});

/** Broadcast a normalized message to overlay clients */
export function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const ws of sockets) {
    try {
      ws.send(payload);
    } catch (e) {}
  }
}

// Simple profanity filter
function isBlocked(text = '') {
  const words = (process.env.BAD_WORDS || '').split(',').map(w => w.trim()).filter(Boolean);
  if (!words.length) return false;
  const lower = text.toLowerCase();
  return words.some(w => lower.includes(w));
}

// Normalize and guard
export function emitChat({ platform, author, text, color, badges, timestamp, avatar, type, isHighlight, payment, parts }) {
  if (!text && type === 'chat') return; // somente chat precisa de texto obrigatorio (stickers podem nao ter)
  
  const maxLen = parseInt(process.env.MAX_MESSAGE_LENGTH || '350', 10);
  let safe = text ? text.slice(0, maxLen) : '';
  if (safe && isBlocked(safe)) return;

  broadcast({
    platform,
    author: author || 'Unknown',
    text: safe,
    parts: parts || null, // parts should be pre-parsed array of {type, url, text}
    color: color || null,
    badges: badges || [],
    avatar: avatar || null,
    timestamp: timestamp || Date.now(),
    type: type || 'chat', // 'chat', 'superchat', 'sticker', 'member'
    isHighlight: !!isHighlight, 
    payment: payment || null // { amount: number, currency: string, formatted: string }
  });
}

// ==== Badge normalizer (platform-aware) ==== //
// (Moved to individual platform files)
// =========================================== //// =========================================== //

// Initialize adapters (comment out what you don't use)
(async () => {
  await Promise.all([
    initTwitch?.(emitChat).catch(e => console.warn('[twitch] disabled or failed:', e?.message)),
    initYouTube?.(emitChat).catch(e => console.warn('[youtube] disabled or failed:', e?.message)),
    initKick?.(emitChat).catch(e => console.warn('[kick] disabled or failed:', e?.message)),
    initTikTok?.(emitChat).catch(e => console.warn('[tiktok] disabled or failed:', e?.message))
  ]);
})();

// Keep server alive on platform errors
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[server] Unhandled Rejection:', reason);
});
