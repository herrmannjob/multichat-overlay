#!/usr/bin/env node
/**
 * Gera config/twitch-emotes.json priorizando catálogos externos por NOME:
 *  1) 7TV (global + canal)
 *  2) BTTV (global + canal)
 *  3) FFZ  (global + canal)
 *  4) Se nada vier, mantém catálogo local existente (se houver)
 *
 * Observação: no runtime, os emotes OFICIAIS da Twitch (Kappa etc.) já renderizam
 * pelo índice userstate.emotes. Este catálogo por nome é fallback/extra.
 *
 * Uso:
 *   node scripts/fetch-twitch-emotes.cjs --login souherrmann
 *   node scripts/fetch-twitch-emotes.cjs --login souherrmann --download
 */

const fs = require('fs');
const path = require('path');
const UA = 'multichat-overlay/1.0 (+https://localhost)';
const ROOT = process.cwd();
const CONFIG_DIR = path.join(ROOT, 'config');
const PUBLIC_DIR = path.join(ROOT, 'public', 'emotes', 'twitch');
const OUT_JSON = path.join(CONFIG_DIR, 'twitch-emotes.json');

if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });

function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.includes('=') ? a.slice(2).split('=') : [a.slice(2), argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true];
    args.set(k, v);
  }
  return args;
}

const args = parseArgs(process.argv);
const login = String(args.get('login') || 'souherrmann').toLowerCase();
const shouldDownload = Boolean(args.get('download'));
if (shouldDownload && !fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

async function j(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} - ${url}`);
  return r.json();
}
async function t(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/plain' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} - ${url}`);
  return r.text();
}
function extFromUrl(u) { try { return path.extname(new URL(u).pathname) || '.png'; } catch { return '.png'; } }
async function downloadTo(src, dest) {
  const r = await fetch(src, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`download fail ${src}: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

/* ---------- 7TV ---------- */
// Global v2
async function sevenTVGlobal() {
  const data = await j('https://api.7tv.app/v2/emotes/global');
  const out = new Map();
  for (const e of data || []) {
    const name = e?.name || e?.code;
    const host = e?.urls?.[3]?.[1] || e?.urls?.[2]?.[1] || e?.urls?.[1]?.[1] || e?.urls?.[0]?.[1];
    if (name && host) out.set(name, host);
  }
  return out;
}
// Canal (tenta v3 e v2)
async function sevenTVChannel(login) {
  // v3
  try {
    const u3 = await j(`https://api.7tv.app/v3/users/twitch/${encodeURIComponent(login)}`);
    const set = u3?.emote_set?.emotes || [];
    const out3 = new Map();
    for (const e of set) {
      const name = e?.name || e?.data?.name;
      const urls = e?.data?.host?.urls || e?.urls;
      const host = urls?.[3]?.[1] || urls?.[2]?.[1] || urls?.[1]?.[1] || urls?.[0]?.[1];
      if (name && host) out3.set(name, host);
    }
    if (out3.size) return out3;
  } catch {}
  // v2
  try {
    const u2 = await j(`https://api.7tv.app/v2/users/twitch/${encodeURIComponent(login)}`);
    const set = u2?.emote_set?.emotes || u2?.emotes || [];
    const out2 = new Map();
    for (const e of set) {
      const name = e?.name || e?.data?.name;
      const urls = e?.urls || e?.data?.host?.urls;
      const host = urls?.[3]?.[1] || urls?.[2]?.[1] || urls?.[1]?.[1] || urls?.[0]?.[1];
      if (name && host) out2.set(name, host);
    }
    return out2;
  } catch { return new Map(); }
}

/* ---------- BTTV ---------- */
async function twitchId(login) {
  try {
    const id = await t(`https://decapi.me/twitch/id/${encodeURIComponent(login)}`);
    return /^\d+$/.test(id) ? id : null;
  } catch { return null; }
}
async function bttvGlobal() {
  const data = await j('https://api.betterttv.net/3/cached/emotes/global');
  const out = new Map();
  for (const e of data || []) {
    if (e?.code && e?.id) out.set(e.code, `https://cdn.betterttv.net/emote/${e.id}/2x`);
  }
  return out;
}
async function bttvChannel(login) {
  const id = await twitchId(login);
  if (!id) return new Map();
  const data = await j(`https://api.betterttv.net/3/cached/users/twitch/${id}`);
  const out = new Map();
  const all = []
    .concat(data?.channelEmotes || [])
    .concat(data?.sharedEmotes || []);
  for (const e of all) {
    if (e?.code && e?.id) out.set(e.code, `https://cdn.betterttv.net/emote/${e.id}/2x`);
  }
  return out;
}

/* ---------- FFZ ---------- */
async function ffzGlobal() {
  const data = await j('https://api.frankerfacez.com/v1/set/global');
  const sets = data?.default_sets || [];
  const out = new Map();
  for (const sid of sets) {
    const set = data?.sets?.[sid];
    for (const e of set?.emoticons || []) {
      const name = e?.name, id = e?.id;
      if (name && id) out.set(name, `https://cdn.frankerfacez.com/emote/${id}/2`);
    }
  }
  return out;
}
async function ffzChannel(login) {
  try {
    const data = await j(`https://api.frankerfacez.com/v1/room/${encodeURIComponent(login)}`);
    const out = new Map();
    for (const sid of Object.keys(data?.sets || {})) {
      const set = data.sets[sid];
      for (const e of set?.emoticons || []) {
        const name = e?.name, id = e?.id;
        if (name && id) out.set(name, `https://cdn.frankerfacez.com/emote/${id}/2`);
      }
    }
    return out;
  } catch { return new Map(); }
}

/* ---------- MAIN ---------- */
(async function main() {
  console.log(`[twitch-emotes] login: ${login}`);
  let combined = new Map();

  try { console.log('[twitch-emotes] 7TV globais…'); const g = await sevenTVGlobal(); g.forEach((v,k)=>combined.set(k,v)); } catch(e){ console.warn('  7TV globais falhou:', e.message); }
  try { console.log('[twitch-emotes] 7TV canal…');   const c = await sevenTVChannel(login); c.forEach((v,k)=>combined.set(k,v)); } catch(e){ console.warn('  7TV canal falhou:', e.message); }

  try { console.log('[twitch-emotes] BTTV globais…'); const g = await bttvGlobal(); g.forEach((v,k)=>combined.set(k,v)); } catch(e){ console.warn('  BTTV globais falhou:', e.message); }
  try { console.log('[twitch-emotes] BTTV canal…');   const c = await bttvChannel(login); c.forEach((v,k)=>combined.set(k,v)); } catch(e){ console.warn('  BTTV canal falhou:', e.message); }

  try { console.log('[twitch-emotes] FFZ globais…');  const g = await ffzGlobal(); g.forEach((v,k)=>combined.set(k,v)); } catch(e){ console.warn('  FFZ globais falhou:', e.message); }
  try { console.log('[twitch-emotes] FFZ canal…');    const c = await ffzChannel(login); c.forEach((v,k)=>combined.set(k,v)); } catch(e){ console.warn('  FFZ canal falhou:', e.message); }

  let result = {};
  if (!combined.size && fs.existsSync(OUT_JSON)) {
    console.warn('[twitch-emotes] Nenhum catálogo externo. Mantendo arquivo local existente.');
    result = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  } else {
    result = Object.fromEntries(combined);
  }

  if (shouldDownload && Object.keys(result).length) {
    if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    console.log(`[twitch-emotes] baixando ${Object.keys(result).length} emotes…`);
    const final = {};
    let i = 0;
    for (const [name, url] of Object.entries(result)) {
      i++;
      const safe = name.replace(/[^\w.-]/g, '_');
      const dest = path.join(PUBLIC_DIR, `${safe}${extFromUrl(url)}`);
      try { await downloadTo(url, dest); final[name] = `/emotes/twitch/${safe}${extFromUrl(url)}`; if (i % 50 === 0) process.stdout.write(`  ✔ ${i}\r`); }
      catch {}
    }
    process.stdout.write('\n');
    fs.writeFileSync(OUT_JSON, JSON.stringify(final, null, 2), 'utf8');
  } else {
    fs.writeFileSync(OUT_JSON, JSON.stringify(result, null, 2), 'utf8');
  }

  console.log(`[twitch-emotes] Gerado: ${path.relative(ROOT, OUT_JSON)} (${Object.keys(result).length} emotes)`);
  console.log('[twitch-emotes] Reinicie o server e atualize o cache no OBS.');
})().catch(e => { console.error('[twitch-emotes] ERRO:', e.message); process.exit(1); });
