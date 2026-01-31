
import { createClient } from "@retconned/kick-js";
import fs from "fs";
import path from "path";

const UA = "multichat-overlay/1.0 (+https://localhost)";
const CHANNEL_LOGIN = (process.env.KICK_CHANNEL || "souherrmann").toLowerCase();

function log(...a) { console.log("[kick]", ...a); }
function warn(...a) { console.warn("[kick]", ...a); }

// Helper for JSON fetching
async function j(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!r.ok) {
      if (r.status === 404) return null; // Graceful 404
      throw new Error(`HTTP ${r.status} ${r.statusText} - ${url}`);
  }
  return r.json();
}

/**
 * 7TV Emote Loader
 */
async function load7TVGlobal() {
  try {
    const res = await j("https://api.7tv.app/v3/emote-sets/global");
    const emotes = res?.emotes || [];
    const cat = {};
    for (const e of emotes) {
      const name = e.name;
      if (e.data?.host?.url && e.data?.host?.files) {
          const files = e.data.host.files;
          // Prefer 4x, then 3x, etc
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
  // 1. Global
  const global = await load7TVGlobal();
  
  // 2. User Specific
  let channelCat = {};
  
  try {
    const v3 = await j(`https://api.7tv.app/v3/users/kick/${encodeURIComponent(slug)}`);
    const emotes = v3?.emote_set?.emotes || [];
    for (const e of emotes) {
      const name = e?.name || e?.data?.name;
      
      if (e?.data?.host?.url && e?.data?.host?.files) {
           const base = "https:" + e.data.host.url;
           const file = e.data.host.files.find(f => f.name === "4x.webp") || 
                        e.data.host.files.find(f => f.name === "3x.webp") ||
                        e.data.host.files.find(f => f.name === "2x.webp") ||
                        e.data.host.files[e.data.host.files.length - 1];
                        
           if (file && name) {
               channelCat[name] = `${base}/${file.name}`;
           }
      }
    }
    log(`[kick] loaded ${Object.keys(channelCat).length} channel 7TV emotes for ${slug}.`);
  } catch (e) {
      warn(`[kick] failed to load 7tv channel emotes for ${slug}: ${e.message}`);
  }
  
  // Merge: Channel overrides Global
  return { ...global, ...channelCat };
}

/**
 * Local file catalog
 */
function loadLocalCatalog() {
  try {
    const p = path.join(process.cwd(), "config", "kick-emotes.json");
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf8");
      const j = JSON.parse(content);
      return j && typeof j === "object" ? j : null;
    }
  } catch {}
  return null;
}

/**
 * Parsing Logic
 */
function partsFromCatalogNames(text, catalog) {
  if (!catalog || !text) return null;
  // Sort names by length desc to match longest first
  const names = Object.keys(catalog).sort((a,b)=>b.length - a.length);
  if (!names.length) return null;

  // Escape for regex
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
  // Match word boundaries or start/end
  const re = new RegExp(`(^|\\s)(${escaped.join("|")})(?=\\s|$)`, "g");
  
  const parts = []; 
  let last = 0, m;
  
  while ((m = re.exec(text)) !== null) {
      // m[1] is the whitespace prefix (or empty if start)
      // m[2] is the matched name
      const prefix = m[1];
      const name = m[2];
      const matchIndex = m.index + prefix.length; // start of the actual name
      
      if (matchIndex > last) {
          parts.push({ type: "text", text: text.slice(last, matchIndex) });
      }
      
      const url = catalog[name];
      if (url) {
          const asString = String(url);
          const isUrl = /^https?:\/\//i.test(asString);
          if (isUrl) {
              parts.push({ type: "emoji", url: asString, alt: name });
          } else {
              parts.push({ type: "text", text: asString });
          }
      } else {
          parts.push({ type: "text", text: name });
      }
      
      last = matchIndex + name.length;
  }
  
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  
  // Filter out any parts with undefined URL (safety check)
  return parts.filter(p => p.type !== 'emoji' || p.url).length ? parts : null;
}

// Helper to replace [emote:id] or similar if Kick sends them (future proofing)
// Currently Kick sends raw text. 7TV emotes are typed as text "KEKW". 
// Kick platform emotes might be ":emote_name:" or similarly typed.
async function loadKickOfficial() {
    try {
        const res = await j("https://kick.com/api/v1/emotes/global");
        if (Array.isArray(res)) {
            const cat = {};
            res.forEach(e => {
                // Official Kick emotes usually have a name like "kiwi", "chompy".
                if (e.name && e.id) {
                    cat[e.name] = `https://files.kick.com/emotes/${e.id}/fullsize`;
                    // Also support :name: format
                    cat[`:${e.name}:`] = `https://files.kick.com/emotes/${e.id}/fullsize`;
                    // And [emote:id] format logic if needed, but for now map names
                }
            });
            log(`[kick] loaded ${Object.keys(cat).length} official Kick emotes.`);
            return cat;
        }
    } catch (e) {
        log("[kick] warning: failed to load official global emotes (API might be blocked).");
    }
    return {};
}


// Map specific "native" text tokens that Kick backend sends to standard emojis or images
const KICK_NATIVE_EMOTES = {
    "emojiAstonished": "😲",
    "emojiSmile": "🙂",
    "emojiFrown": "☹️",
    "emojiLaugh": "😂",
    "emojiCry": "😢",
    "emojiAngry": "😡",
    "emojiLove": "❤️",
    "emojiFire": "🔥",
    "emojiThumbsUp": "👍",
    "emojiThumbsDown": "👎",
    "emojiCrave": "🤤", // Best match for Crave
    "emojiThinking": "🤔",
    "emojiSweat": "😅",
    "emojiClown": "🤡",
    "emojiParty": "🥳",
    "emojiEyes": "👀"
};

async function loadChannelEmotes(slug) {
    if (!slug) return {};
    try {
        const res = await j(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`);
        // Kick v2 channel response usually has `emotes` array
        // Structure: res.emotes = [ { name: '...', id: '...', ... } ] or inside subscriber_badges
        // Actually, sometimes it is under `chatroom.emotes`? Or separate endpoint.
        // Let's safe guard.
        const emotes = res?.emotes || []; 
        const cat = {};
        if (Array.isArray(emotes)) {
            emotes.forEach(e => {
               if (e.name && e.id) {
                   cat[e.name] = `https://files.kick.com/emotes/${e.id}/fullsize`;
               }
            });
        }
        return cat;
    } catch (e) {
        return {};
    }
}

function partsReplaceEmojiTokens(text, catalogs) {
  const combined = { 
      ...KICK_NATIVE_EMOTES,
      ...(catalogs.official || {}), 
      ...(catalogs.channel || {}), // Added channel specific
      ...(catalogs.remote || {}), 
      ...(catalogs.local || {}) 
  };
  
  // Try to match exact words against the combined catalog first
  // This handles "KEKW", "Pog", ":smile:"
  // improved regex to catch :name: or just name
  
  return partsFromCatalogNames(text, combined) || [{ type: "text", text }];
}


/**
 * Avatar & Badges
 */
function normalizeKickBadges(msg, channelSlug) {
  const s = msg?.sender || msg?.user || {};
  const raw =
    (Array.isArray(msg?.badges) ? msg.badges :
     Array.isArray(s?.badges) ? s.badges :
     Array.isArray(s?.roles) ? s.roles : []) || [];
    
  // Kick `identity` object often has badges
  if (s?.identity?.badges && Array.isArray(s.identity.badges)) {
      s.identity.badges.forEach(b => raw.push(b.type || b.text));
  }

  const aliases = {
    broadcaster:"broadcaster", streamer:"broadcaster", owner:"broadcaster",
    moderator:"mod", admin:"admin", staff:"staff", vip:"vip",
    subscriber:"sub", sub:"sub", founder:"founder", verified:"verified",
    og: "founder"
  };

  const author = s?.username || msg?.user?.username || msg?.author || "";
  const isBroadcaster = author && channelSlug && author.toLowerCase() === channelSlug.toLowerCase();

  const lowered = raw
    .map(x => (typeof x==='string' ? x : (x?.name || x?.type || x?.role || ""))?.toLowerCase())
    .concat(isBroadcaster ? ["broadcaster"] : []);

  const pretty = Array.from(new Set(lowered.map(k => aliases[k] || k).filter(Boolean)));
  // Sort importance
  const order  = ['broadcaster','mod','vip','founder','verified','sub','staff','admin'];
  pretty.sort((a,b)=>(order.indexOf(a)<0?999:order.indexOf(a))-(order.indexOf(b)<0?999:order.indexOf(b)));
  
  return pretty;
}

const avatarCache = new Map();
async function getKickAvatar(slug) {
  const key = String(slug||'').toLowerCase();
  if (!key) return null;
  if (avatarCache.has(key)) return avatarCache.get(key);
  
  try {
      // 1. Try v1 USERS API (Best for chat authors)
      const resV1 = await fetch(`https://kick.com/api/v1/users/${encodeURIComponent(key)}`, {
           headers: { "User-Agent": UA, "Accept": "application/json" }
      });
      if (resV1.ok) {
          const dV1 = await resV1.json();
          const uV1 = dV1?.profile_pic;
          if (uV1 && !uV1.includes("default_profile")) {
              avatarCache.set(key, uV1);
              return uV1;
          }
      }
      
      // 2. Try v2 CHANNELS API (Fallback if user is a streamer)
      const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(key)}`, {
          headers: { "User-Agent": UA, "Accept": "application/json" }
      });
      if (res.ok) {
          const data = await res.json();
          const url = data?.user?.profile_pic;
          if (url && !url.includes("default_profile")) {
              avatarCache.set(key, url);
              return url;
          }
      }
  } catch (e) {
      // warn("[kick] avatar fetch failed:", e.message);
  }
  
  const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(key)}&background=00E701&color=fff&bold=true`;
  avatarCache.set(key, fallback);
  return fallback;
}


/**
 * Initialization
 */
export async function initKick(emit) {
  const channel = CHANNEL_LOGIN;
  if (!channel) { log("no KICK_CHANNEL; skipping"); return; }
  
  log(`initializing for channel: ${channel}`);

  try {
    // Load catalogs
    const [remoteCatalog, officialCatalog, channelEmotes] = await Promise.all([
        load7TVKick(channel).catch(e => ({})),
        loadKickOfficial().catch(e => ({})),
        loadChannelEmotes(channel).catch(e => ({}))
    ]);
    const localCatalog  = loadLocalCatalog();
    
    // Combine for easier passing
    const catalogs = {
        remote: remoteCatalog,
        official: officialCatalog,
        channel: channelEmotes,
        local: localCatalog
    };
    
    log(`Emotes loaded - 7TV: ${Object.keys(remoteCatalog).length}, Official: ${Object.keys(officialCatalog).length}, Channel: ${Object.keys(channelEmotes).length}`);

    // Create Client
    // We stick to @retconned/kick-js for now as it provides the loop
    const client = createClient(channel, { 
        readOnly: true, 
        logger: false 
    });

    client.on("connected", () => log("connected to chat"));
    client.on("error", (e) => warn("connection error:", e?.message || e));

    const onMsg = async (msg) => {
    //   console.log('raw kick msg:', JSON.stringify(msg,null,2));

      const s = msg?.sender || msg?.user || {};
      const author = s?.username || msg?.author || "Kick User";
      const text   = msg?.content || msg?.message || msg?.text || msg?.body || "";
      
      if (!text) return;

      // Logic: Parse Text -> Replace Emotes
      let parts = partsReplaceEmojiTokens(text, catalogs);

      const badges = normalizeKickBadges(msg, channel);
      
      // Avatar
      // msg.sender.profile_pic might exist in some events, check it first
      let avatar = s?.profile_pic || null;
      if (!avatar || avatar.includes("default_profile")) {
           avatar = await getKickAvatar(author);
      }

      emit({
        platform: "kick",
        author,
        text,
        color: s?.identity?.color || null, // Kick often sends color in identity
        badges,
        avatar: avatar || null,
        parts,
        timestamp: Date.now()
      });
    };

    // Listen to standard events
    // Kick-js emits 'ChatMessage'
    client.on("ChatMessage", onMsg);
    
    // Some libraries emit 'message'
    // client.on("message", onMsg);

    // Keep alive / Ignore pusher internals
    
  } catch (e) {
    warn("failed to init:", e?.message || e);
  }
}
