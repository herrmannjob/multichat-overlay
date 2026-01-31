#!/usr/bin/env node
/**
 * Gera config/kick-emotes.json priorizando:
 *  1) 7TV (plataforma Kick) por canal (v3 e v2)
 *  2) Scraping leve da página do canal (heurístico)
 *  3) Se nada vier, preserva o local existente
 *
 * Uso:
 *   node scripts/fetch-kick-emotes.cjs --slug souherrmann
 *   node scripts/fetch-kick-emotes.cjs --slug souherrmann --download
 */
const fs = require('fs');
const path = require('path');
const UA = 'multichat-overlay/1.0 (+https://localhost)';
const ROOT = process.cwd();
const CONFIG_DIR = path.join(ROOT, 'config');
const PUBLIC_DIR = path.join(ROOT, 'public', 'emotes', 'kick');
const OUT_JSON = path.join(CONFIG_DIR, 'kick-emotes.json');

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
const slug = String(args.get('slug') || 'souherrmann').toLowerCase();
const shouldDownload = Boolean(args.get('download'));
if (shouldDownload && !fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

async function j(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} - ${url}`);
  return r.json();
}
async function h(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
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

/* ---------- 7TV para KICK ---------- */
// v3
async function sevenTVKickV3(slug) {
  const data = await j(`https://api.7tv.app/v3/users/kick/${encodeURIComponent(slug)}`);
  const out = {};
  for (const e of data?.emote_set?.emotes || []) {
    const name = e?.name || e?.data?.name;
    const urls = e?.data?.host?.urls || e?.urls;
    const url  = urls?.[3]?.[1] || urls?.[2]?.[1] || urls?.[1]?.[1] || urls?.[0]?.[1];
    if (name && url) out[name] = url;
  }
  return out;
}
// v2 (fallback)
async function sevenTVKickV2(slug) {
  const data = await j(`https://api.7tv.app/v2/users/kick/${encodeURIComponent(slug)}`);
  const set  = data?.emote_set?.emotes || data?.emotes || [];
  const out = {};
  for (const e of set) {
    const name = e?.name || e?.data?.name;
    const urls = e?.urls || e?.data?.host?.urls;
    const url  = urls?.[3]?.[1] || urls?.[2]?.[1] || urls?.[1]?.[1] || urls?.[0]?.[1];
    if (name && url) out[name] = url;
  }
  return out;
}

/* ---------- Scraping leve (heurístico) ---------- */
function scrapeFromHtml(html) {
  // Procura JSONs que contenham "emotes":[{name,url}] ou URLs com "/emotes/"
  const map = new Map();
  const urlRe = /(https?:\/\/[^\s"'<>]+\/emotes\/[^\s"'<>]+)/gi;
  let m;
  while ((m = urlRe.exec(html)) !== null) {
    const u = m[1];
    const idx = html.indexOf(u);
    const ctx = html.slice(Math.max(0, idx - 250), idx + 80);
    const nm = /"name"\s*:\s*"([A-Za-z0-9_]+)"/.exec(ctx)?.[1] ||
               /"code"\s*:\s*"([A-Za-z0-9_]+)"/.exec(ctx)?.[1];
    if (nm) map.set(nm, u);
  }
  // varre blobs em <script>
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(x => x[1]);
  for (const s of scripts) {
    if (!/emote/i.test(s)) continue;
    const blobs = [...s.matchAll(/\{[\s\S]{0,30000}\}/g)].map(x => x[0]);
    for (const b of blobs) {
      try {
        const obj = JSON.parse(b);
        const stack = [obj];
        while (stack.length) {
          const cur = stack.pop();
          if (Array.isArray(cur)) { for (const v of cur) stack.push(v); continue; }
          if (cur && typeof cur === 'object') {
            if (Array.isArray(cur.emotes)) {
              for (const e of cur.emotes) {
                const name = e?.name || e?.code; const url = e?.url || e?.image_url || e?.src;
                if (name && url) map.set(name, url);
              }
            }
            for (const v of Object.values(cur)) stack.push(v);
          }
        }
      } catch {}
    }
  }
  if (!map.size) return {};
  const out = {};
  for (const [k,v] of map) out[k] = v;
  return out;
}

/* ---------- MAIN ---------- */
(async function main() {
  console.log(`[kick-emotes] buscando para: ${slug}`);

  let result = {};
  try { const v3 = await sevenTVKickV3(slug); if (Object.keys(v3).length) result = { ...result, ...v3 }; } catch {}
  if (!Object.keys(result).length) { try { const v2 = await sevenTVKickV2(slug); if (Object.keys(v2).length) result = { ...result, ...v2 }; } catch {} }
  if (!Object.keys(result).length) {
    try {
      console.log('[kick-emotes] 7TV não retornou; tentando HTML do canal…');
      const html = await h(`https://kick.com/${encodeURIComponent(slug)}`);
      const scraped = scrapeFromHtml(html);
      if (Object.keys(scraped).length) result = { ...result, ...scraped };
    } catch {}
  }

  // preserva local se nada encontrado
  if (!Object.keys(result).length && fs.existsSync(OUT_JSON)) {
    console.warn('[kick-emotes] Nenhum catálogo externo. Mantendo arquivo local existente.');
    result = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  }

  if (shouldDownload && Object.keys(result).length) {
    if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    console.log(`[kick-emotes] baixando ${Object.keys(result).length} emotes…`);
    const final = {};
    let i = 0;
    for (const [name, url] of Object.entries(result)) {
      i++;
      const safe = name.replace(/[^\w.-]/g, '_');
      const dest = path.join(PUBLIC_DIR, `${safe}${extFromUrl(url)}`);
      try { await downloadTo(url, dest); final[name] = `/emotes/kick/${safe}${extFromUrl(url)}`; if (i % 50 === 0) process.stdout.write(`  ✔ ${i}\r`); }
      catch {}
    }
    process.stdout.write('\n');
    fs.writeFileSync(OUT_JSON, JSON.stringify(final, null, 2), 'utf8');
  } else {
    fs.writeFileSync(OUT_JSON, JSON.stringify(result, null, 2), 'utf8');
  }

  console.log(`[kick-emotes] Gerado: ${path.relative(ROOT, OUT_JSON)} (${Object.keys(result).length} emotes)`);
  console.log('[kick-emotes] Reinicie o server e atualize o cache no OBS.');
})().catch(e => { console.error('[kick-emotes] ERRO:', e.message); process.exit(1); });
