// server/platforms/twitch.js
// ESM
// Prioridade de emotes: (1) índice oficial (userstate.emotes)  → (2) catálogo remoto (IVR → Adamcy) → (3) catálogo local
// Avatar via decapi/unavatar. Badges normalizadas e ordenadas.

export async function initTwitch(emit) {
  let tmi;
  try {
    tmi = await import('tmi.js');
  } catch {
    console.warn('[twitch] tmi.js not installed. Skipping.');
    return;
  }

  const UA = 'multichat-overlay/1.0 (+https://localhost)';
  const CHANNEL_LOGIN = (process.env.TWITCH_CHANNEL || 'souherrmann').toLowerCase();

  const fetchJson = async (url) => {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} - ${url}`);
    return r.json();
  };
  const fetchText = async (url) => {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/plain' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} - ${url}`);
    return r.text();
  };

  const uniq = (a) => Array.from(new Set(a.filter(Boolean)));

  function normalizeTwitchBadges(userstate) {
    const raw = Object.keys(userstate?.badges || {});
    const pretty = {
      broadcaster:'broadcaster', moderator:'mod', vip:'vip', founder:'founder',
      partner:'partner', subscriber:'sub', 'artist-badge':'artist',
      premium:'prime', bits:'bits', staff:'staff', admin:'admin', global_mod:'global-mod'
    };
    const order = ['broadcaster','mod','vip','founder','partner','sub','artist','prime','bits','staff','admin','global-mod'];
    const out = raw.map(k => pretty[k] || k);
    out.sort((a,b)=>(order.indexOf(a)<0?999:order.indexOf(a))-(order.indexOf(b)<0?999:order.indexOf(b)));
    return uniq(out);
  }

  // ---------- Avatar ----------
  const avatarCache = new Map();
  async function getTwitchAvatar(login) {
    if (!login) return null;
    if (avatarCache.has(login)) return avatarCache.get(login);
    try {
      const res = await fetch(`https://decapi.me/twitch/avatar/${encodeURIComponent(login)}`);
      const url = await res.text();
      if (res.ok && /^https?:\/\//i.test(url)) { avatarCache.set(login, url); return url; }
    } catch {}
    const url = `https://unavatar.io/twitch/${encodeURIComponent(login)}.png`;
    avatarCache.set(login, url); return url;
  }

  // ---------- Emotes: índice oficial ----------
  function partsFromIndexMap(message, emotesMap) {
    if (!emotesMap || !Object.keys(emotesMap).length) return null;
    const ranges = [];
    for (const [id, arr] of Object.entries(emotesMap)) {
      for (const r of arr) {
        const [s, e] = r.split('-').map(n=>parseInt(n,10));
        if (!Number.isNaN(s) && !Number.isNaN(e)) ranges.push({start:s,end:e,id});
      }
    }
    ranges.sort((a,b)=>a.start-b.start);
    const parts = [];
    let cur = 0;
    const urlOf = id => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`;
    for (const r of ranges) {
      if (cur < r.start) parts.push({ type:'text', text: message.slice(cur, r.start) });
      const alt = message.slice(r.start, r.end+1);
      parts.push({ type:'emoji', url: urlOf(r.id), alt });
      cur = r.end + 1;
    }
    if (cur < message.length) parts.push({ type:'text', text: message.slice(cur) });
    return parts;
  }

  // ---------- Catálogo remoto (IVR → Adamcy) ----------
  const remoteCache = new Map(); // key: 'global' | `chan:<login>` -> { name: url }

  const idFromLogin = async (login) => {
    try {
      const t = await fetchText(`https://decapi.me/twitch/id/${encodeURIComponent(login)}`);
      return /^\d+$/.test(t) ? t : null;
    } catch { return null; }
  };
  const urlFromId = (id) => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`;

  async function loadGlobal_IVR() {
    const data = await fetchJson('https://api.ivr.fi/v2/twitch/emotes/global');
    const cat = {};
    for (const e of data || []) {
      const name = e?.code || e?.name;
      const id   = e?.id || e?.emote_id;
      if (name && id) cat[name] = urlFromId(id);
    }
    return cat;
  }
  async function loadChannel_IVR(login) {
    const data = await fetchJson(`https://api.ivr.fi/v2/twitch/emotes/${encodeURIComponent(login)}`);
    const cat = {};
    for (const e of data || []) {
      const name = e?.code || e?.name;
      const id   = e?.id || e?.emote_id;
      if (name && id) cat[name] = urlFromId(id);
    }
    return cat;
  }
  async function loadGlobal_Adamcy() {
    const data = await fetchJson('https://emotes.adamcy.pl/v1/global/emotes/twitch');
    const cat = {};
    for (const e of data || []) if (e?.code && e?.id) cat[e.code] = urlFromId(e.id);
    return cat;
  }
  async function loadChannel_Adamcy(login) {
    const id = await idFromLogin(login);
    if (!id) return {};
    const data = await fetchJson(`https://emotes.adamcy.pl/v1/channel/${id}/emotes/twitch`);
    const cat = {};
    for (const e of data || []) if (e?.code && e?.id) cat[e.code] = urlFromId(e.id);
    return cat;
  }

  async function getRemoteCatalog(scopeKey, loader) {
    if (remoteCache.has(scopeKey)) return remoteCache.get(scopeKey);
    try {
      const v = await loader();
      if (v && Object.keys(v).length) { remoteCache.set(scopeKey, v); return v; }
    } catch {}
    remoteCache.set(scopeKey, {}); return {};
  }

  function partsFromNameCatalog(message, catalog) {
    if (!catalog || !Object.keys(catalog).length) return null;
    const names = Object.keys(catalog).sort((a,b)=>b.length-a.length).map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
    if (!names.length) return null;
    const re = new RegExp(`(^|[^\\w])(${names.join("|")})(?!\\w)`, "g");
    const parts = [];
    let last = 0, m;
    while ((m = re.exec(message)) !== null) {
      const i = m.index + m[1].length;
      if (i > last) parts.push({ type:'text', text: message.slice(last, i) });
      const nm = m[2];
      parts.push({ type:'emoji', url: catalog[nm], alt: nm });
      last = i + nm.length;
    }
    if (last < message.length) parts.push({ type:'text', text: message.slice(last) });
    return parts.length ? parts : null;
  }

  // ---------- Catálogo local ----------
  let localCatalog = null;
  try {
    const mod = await import(new URL('../../config/twitch-emotes.json', import.meta.url));
    localCatalog = mod?.default && typeof mod.default === 'object' ? mod.default : null;
  } catch { /* ok, sem local */ }

  function partsFromLocalCatalog(message) {
    if (!localCatalog || !Object.keys(localCatalog).length) return null;
    const names = Object.keys(localCatalog).sort((a,b)=>b.length-a.length).map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
    const re = new RegExp(`(^|[^\\w])(${names.join("|")})(?!\\w)`, "g");
    const parts = []; let last = 0, m;
    while ((m = re.exec(message)) !== null) {
      const i = m.index + m[1].length;
      if (i > last) parts.push({ type:'text', text: message.slice(last, i) });
      const nm = m[2]; const url = localCatalog[nm];
      parts.push(url ? { type:'emoji', url, alt:nm } : { type:'text', text:nm });
      last = i + nm.length;
    }
    if (last < message.length) parts.push({ type:'text', text: message.slice(last) });
    return parts.length ? parts : null;
  }

  // ---------- Conexão ----------
  const opts = {
    options: { debug: false, messagesLogLevel: "info" },
    connection: { 
      reconnect: true, 
      secure: true, 
      maxReconnectAttempts: Infinity,
      maxReconnectInterval: 10000,
      reconnectInterval: 1000,
      timeout: 10000
    },
    channels: [CHANNEL_LOGIN],
    logger: {
        info: () => {},
        warn: (msg) => { if (!msg.includes("Reconnecting")) console.warn("[twitch] " + msg); },
        error: (msg) => { 
            // Suppress noisy connection errors
            if (msg.includes("No response") || msg.includes("Unable to connect")) {
                 console.warn("[twitch] connection unstable, retrying...");
                 return;
            }
            console.error("[twitch] " + msg); 
        }
    }
  };

  if (process.env.TWITCH_USERNAME && process.env.TWITCH_OAUTH_TOKEN) {
    opts.identity = { username: process.env.TWITCH_USERNAME, password: process.env.TWITCH_OAUTH_TOKEN };
  }

  const client = new tmi.Client(opts);

  client.on('message', async (_chan, userstate, message, self) => {
    if (self && process.env.TWITCH_IGNORE_SELF === '1') return;

    const login = userstate.username;
    const display = userstate['display-name'] || login;
    const badges = normalizeTwitchBadges(userstate);
    const avatar = await getTwitchAvatar(login);

    // 1) índice oficial
    let parts = partsFromIndexMap(message, userstate.emotes || null);

    // 2) catálogo remoto (IVR → Adamcy) se ainda não montou
    if (!parts) {
      let remote = await getRemoteCatalog('global', loadGlobal_IVR).catch(()=> ({}));
      const remoteChan = await getRemoteCatalog(`chan:${CHANNEL_LOGIN}`, () => loadChannel_IVR(CHANNEL_LOGIN)).catch(()=> ({}));
      remote = { ...remote, ...remoteChan };
      if (!Object.keys(remote).length) {
        const g2 = await getRemoteCatalog('global:adamcy', loadGlobal_Adamcy);
        const c2 = await getRemoteCatalog(`chan:${CHANNEL_LOGIN}:adamcy`, () => loadChannel_Adamcy(CHANNEL_LOGIN));
        remote = { ...g2, ...c2 };
      }
      parts = partsFromNameCatalog(message, remote);
    }

    // 3) catálogo local como último recurso
    if (!parts) parts = partsFromLocalCatalog(message) || [{ type:'text', text: message }];

    emit({
      platform: 'twitch',
      author: display,
      text: message,
      color: userstate.color || null,
      badges,
      avatar,
      parts,
      timestamp: Date.now(),
      isHighlight: userstate['msg-id'] === 'highlighted-message'
    });
  });

  await client.connect();
  console.log('[twitch] connected to', CHANNEL_LOGIN, '(remote catalogs preferred; local as fallback)');
}
