// server/platforms/kick.cjs
const { createClient } = require("@retconned/kick-js");
const fs = require("fs");
const path = require("path");

const UA = "multichat-overlay/1.0 (+https://localhost)";
const CHANNEL_LOGIN = (process.env.KICK_CHANNEL || "souherrmann").toLowerCase();

function log(...a) { console.log("[kick]", ...a); }
function warn(...a) { console.warn("[kick]", ...a); }

async function j(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} - ${url}`);
  return r.json();
}

/* ---------- 7TV catálogos para KICK ---------- */
async function load7TVGlobal() {
  try {
    const res = await j("https://api.7tv.app/v3/emote-sets/global");
    const emotes = res?.emotes || [];
    const cat = {};
    for (const e of emotes) {
      const name = e.name;
      // 7TV v3 structure: e.data.host.url (base) + e.data.host.files (array)
      if (e.data?.host?.url && e.data?.host?.files) {
          const files = e.data.host.files;
          // Find 4x, 3x, 2x, or last available
          const file = files.find(f => f.name === "4x.webp") || 
                       files.find(f => f.name === "3x.webp") || 
                       files.find(f => f.name === "2x.webp") || 
                       files[files.length - 1];
                       
          if (file && name) {
              cat[name] = `https:${e.data.host.url}/${file.name}`;
          }
      }
    }
    log(`[kick] loaded ${Object.keys(cat).length} global 7TV emotes.`);
    return cat;
  } catch (e) {
    console.warn("[kick] failed to load 7tv global:", e.message);
    return {};
  }
}

async function load7TVKick(slug) {
  // carrega global primeiro
  const global = await load7TVGlobal();
  
  // tenta v3 user, depois v2
  let channelCat = {};
  
  try {
    const v3 = await j(`https://api.7tv.app/v3/users/kick/${encodeURIComponent(slug)}`);
    const emotes = v3?.emote_set?.emotes || [];
    for (const e of emotes) {
      const name = e?.name || e?.data?.name;
      const urls = e?.data?.host?.urls || e?.urls;
       // 7TV v3 urls often relative to host info, but let's check structure
       // e.data.host.url is base. e.data.host.files is array.
       // OR simplified structure.
       // Let's assume standard response or use cached CDN pattern if complex.
       // Actually 7TV API v3 is complex. 
       
       // Fallback to simple v2-like construction if data.host exists:
       if (e?.data?.host?.url && e?.data?.host?.files) {
           const base = "https:" + e.data.host.url;
           const file = e.data.host.files.find(f => f.name === "4x.webp") || e.data.host.files[0];
           if (file && name) {
               channelCat[name] = `${base}/${file.name}`;
           }
       }
    }
  } catch {}
  
  // Se v3 falhou ou vazio, tenta v2 (embora 7TV v2 esteja depreciada, alguns endpoints funcionam)
  if (!Object.keys(channelCat).length) {
      try {
        const v2 = await j(`https://api.7tv.app/v2/users/kick/${encodeURIComponent(slug)}`);
        const set = v2?.emote_set?.emotes || v2?.emotes || [];
        for (const e of set) {
          const name = e?.name || e?.data?.name;
          const urls = e?.urls || e?.data?.host?.urls;
          // v2 structure: urls is array of [size, url]
          const url  = urls?.[3]?.[1] || urls?.[2]?.[1] || urls?.[0]?.[1];
          if (name && url) channelCat[name] = url;
        }
      } catch {}
  }

  return { ...global, ...channelCat };
}

/* ---------- Local ---------- */
function loadLocalCatalog() {
  try {
    const p = path.join(process.cwd(), "config", "kick-emotes.json");
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      return j && typeof j === "object" ? j : null;
    }
  } catch {}
  return null;
}

// fs is already required at the top if needed, or we just remove this duplicate.

/* ---------- Parts helpers ---------- */
function partsFromCatalogNames(text, catalog) {
  if (!catalog || !text) return null;
  const names = Object.keys(catalog).sort((a,b)=>b.length-a.length).map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
  if (!names.length) return null;
  const re = new RegExp(`(^|[^\\w])(${names.join("|")})(?!\\w)`, "g");
  const parts = []; let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    const i = m.index + m[1].length;
    if (i > last) parts.push({ type:"text", text: text.slice(last, i) });
    const nm = m[2]; const url = catalog[nm];
    parts.push(url ? { type:"emoji", url, alt:nm } : { type:"text", text:nm });
    last = i + nm.length;
  }
  if (last < text.length) parts.push({ type:"text", text: text.slice(last) });
  return parts.length ? parts : null;
}

// Dynamic Kick Official Emotes Loader
async function loadKickOfficial() {
    try {
        // Kick Internal API for global emotes
        const res = await j("https://kick.com/api/v1/emotes/global");
        if (Array.isArray(res)) {
            const cat = {};
            res.forEach(e => {
                if (e.name && e.id) {
                    // Kick CDN format
                    // e.g. https://files.kick.com/emotes/{id}/fullsize
                    cat[e.name] = `https://files.kick.com/emotes/${e.id}/fullsize`;
                    
                    // Also map "emojiName" variant if not present?
                    // Kick emotes are usually just names. 
                    // But our regex looks for [name]? 
                    // Actually `partsReplaceEmojiTokens` specifically searches for `emoji...`.
                    // The official emotes listed in API are like "nice", "kekw", etc?
                    // Or are they "emojiCrave"?
                    // Let's assume the names match what is typed.
                }
            });
            log(`[kick] loaded ${Object.keys(cat).length} official Kick emotes via API.`);
            return cat;
        }
    } catch (e) {
        log("[kick] failed to load official global emotes (API or Cloudflare block).");
    }
    return {};
}

function partsReplaceEmojiTokens(text, catalogs) {
  const cat = catalogs?.remote || catalogs?.local || null;
  const official = catalogs?.official || {}; // We will add 'official' to catalogs
  
  // Merge catalogs for lookup
  const allEmotes = { ...official, ...cat };
  
  const re = /emoji([A-Za-z][A-Za-z0-9_]*)/g;
  const out = []; let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    const i = m.index;
    if (i > last) out.push({ type:"text", text: text.slice(last, i) });
    const name = m[1];
    const fullToken = m[0]; // e.g. emojiCrave
    const cap = name[0].toUpperCase() + name.slice(1);
    
    // Lookups:
    // 1. Exact full token "emojiCrave"
    // 2. Cap name "Crave"
    // 3. Lower name "crave"
    // 4. "emoji" + Cap
    
    const url = allEmotes[fullToken] || 
                allEmotes[name] || 
                allEmotes[cap] || 
                allEmotes[`emoji${cap}`];

    if (url) {
        out.push({ type:"emoji", url, alt: fullToken });
    } else {
        // No texture found, keep text
        out.push({ type:"text", text: fullToken });
    }
    last = i + fullToken.length;
  }
  if (last < text.length) out.push({ type:"text", text: text.slice(last) });
  return out.length ? out : [{ type:"text", text }];
}

/* ---------- Badges/Avatar ---------- */
function normalizeKickBadges(msg, channelSlug) {
  const s = msg?.sender || msg?.user || {};
  const raw =
    (Array.isArray(msg?.badges) ? msg.badges :
     Array.isArray(s?.badges) ? s.badges :
     Array.isArray(s?.roles) ? s.roles : []) || [];

  const aliases = {
    broadcaster:"broadcaster", streamer:"broadcaster", owner:"broadcaster",
    moderator:"mod", admin:"admin", staff:"staff", vip:"vip",
    subscriber:"sub", sub:"sub", founder:"founder", verified:"verified"
  };

  const author = s?.username || msg?.user?.username || msg?.author || "";
  const isBroadcaster = author && channelSlug && author.toLowerCase() === channelSlug.toLowerCase();

  const lowered = raw
    .map(x => (typeof x==='string' ? x : (x?.name || x?.type || x?.role || ""))?.toLowerCase())
    .concat(isBroadcaster ? ["broadcaster"] : []);

  const pretty = Array.from(new Set(lowered.map(k => aliases[k] || k).filter(Boolean)));
  const order  = ['broadcaster','mod','vip','founder','verified','sub','staff','admin'];
  pretty.sort((a,b)=>(order.indexOf(a)<0?999:order.indexOf(a))-(order.indexOf(b)<0?999:order.indexOf(b)));
  return pretty;
}
const avatarCache = new Map();
async function getKickAvatar(slug) {
  const key = String(slug||'').toLowerCase();
  if (!key) return null;
  if (avatarCache.has(key)) return avatarCache.get(key);
  
  // Strategy:
  // 1. Try Kick API v1 (sometimes less strict than v2)
  // 2. Try Unavatar (might support domain query)
  // 3. Fallback to UI Avatars (clean initials)

  try {
      const res = await fetch(`https://kick.com/api/v1/users/${encodeURIComponent(key)}`, {
          headers: { "User-Agent": UA, "Accept": "application/json" }
      });
      if (res.ok) {
          const data = await res.json();
          const url = data?.profile_pic;
          if (url && !url.includes("default_profile")) {
              avatarCache.set(key, url);
              return url;
          }
      }
  } catch (e) {
      // ignore
  }
  
  // Fallbacks
  // Unavatar can try to resolve using domain (unlikely to works perfectly for kick without explicit support, but worth a shot if we pass domain?)
  // Actually, let's just stick to UI Avatars as last resort.
  // We can try to construct the official CDN url if we knew the Pattern? 
  // Kick CDN is usually `https://files.kick.com/images/user/{id}/profile_image`? No, it uses random UUIDs.
  
  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(key)}&background=00E701&color=fff&bold=true`; // Kick Green
  avatarCache.set(key, fallback); 
  return fallback;
}

/* ---------- Init ---------- */
async function initKick(emit) {
  const channel = CHANNEL_LOGIN;
  if (!channel) { log("no KICK_CHANNEL; skipping"); return; }

  try {
    // carrega catálogo remoto 7TV (Kick)
    const remoteCatalog = await load7TVKick(channel).catch(()=> ({}));
    const localCatalog  = loadLocalCatalog();

    const client = createClient(channel, { readOnly: true, logger: false });
    client.on?.("connected", () => log("connected to", channel));
    client.on?.("error", (e) => warn("error:", e?.message || e));

    const onMsg = async (msg) => {
      const s = msg?.sender || msg?.user || {};
      const author = s?.username || msg?.author || "Kick User";
      const text   = msg?.content || msg?.message || msg?.text || msg?.body || "";
      if (!text) return;

      let parts = null;

      // 1) nomes pelo catálogo REMOTO (7TV/Kick)
      if (Object.keys(remoteCatalog||{}).length) {
        parts = partsFromCatalogNames(text, remoteCatalog);
      }

      // 2) tokens emojiXxx -> imagem (se REMOTO/LOCAL tiver) ou Unicode
      if (!parts || parts.every(p => p.type === "text")) {
        parts = partsReplaceEmojiTokens(text, { remote: remoteCatalog, local: localCatalog });
      }

      // 3) nomes pelo catálogo LOCAL
      if (!parts || parts.every(p => p.type === "text")) {
        const lp = partsFromCatalogNames(text, localCatalog);
        if (lp) parts = lp;
      }

      if (!parts) parts = [{ type:"text", text }];

      const badges = normalizeKickBadges(msg, channel);
      const avatar = s?.avatar || await getKickAvatar(author);

      emit({
        platform: "kick",
        author,
        text,
        color: null,
        badges,
        avatar: avatar || null,
        parts,
        timestamp: Date.now()
      });
    };

    ["message","ChatMessage","chat_message","chatMessage","messageCreate"].forEach(evt =>
      client.on?.(evt, (m)=>onMsg(m))
    );
    // Ignore internal Pusher events
    ["pusher:connection_established", "pusher_internal:subscription_succeeded", "pusher:error"].forEach(evt => {
       client.on?.(evt, () => {}); 
    });

    client.on?.("event", (type, payload) => {
      // Ignore known internal events again just in case
      if (type.startsWith("pusher")) return;
      if (String(type || "").toLowerCase().includes("message")) onMsg(payload);
    });

    log("setup complete. Emotes: 7TV(Kick)→tokens→local.");
  } catch (e) {
    warn("failed to init:", e?.message || e);
  }
}

module.exports = { initKick };
