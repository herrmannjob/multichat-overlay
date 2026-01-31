/* Overlay client: conecta ao WS e renderiza mensagens com tema.
   Suporta classes por plataforma e por badge, e ícones SVG embutidos. */

const params = new URLSearchParams(location.search);

function applyThemeFromParams() {
  const root = document.documentElement;
  const map = {
    accent: "--param-accent",
    text: "--param-text",
    bg: "--param-bg",
    "card-bg": "--param-card-bg",
    border: "--param-border",
    font: "--param-font-family",
  };
  for (const [key, cssVar] of Object.entries(map)) {
    if (params.has(key)) root.style.setProperty(cssVar, params.get(key));
  }
  if (params.has("title")) {
    document.getElementById("title").textContent = params.get("title");
  }
  if (params.has("scale")) {
    document.body.style.zoom = params.get("scale");
  }
}
applyThemeFromParams();

const messagesEl = document.getElementById("messages");

function wsUrl() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}`;
}

function avatarNode(avatarUrl, initials = "?") {
  const div = document.createElement("div");
  div.className = "avatar";
  if (avatarUrl) {
    const img = new Image();
    img.src = avatarUrl;
    img.alt = "avatar";
    img.referrerPolicy = "no-referrer";
    img.loading = "lazy";
    div.appendChild(img);
  } else {
    div.textContent = initials.slice(0, 2).toUpperCase();
  }
  return div;
}

function initialsFromName(name = "?") {
  const parts = (name || "?").split(" ").filter(Boolean);
  const a = parts[0]?.[0] || "?";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).trim();
}

/* ===== Plataforma: cores + ícones ===== */
const PLATFORM_META = {
  twitch: { label: "Twitch", color: "#9146FF", icon: twitchIcon },
  youtube: { label: "YouTube", color: "#FF0000", icon: youtubeIcon },
  kick: { label: "Kick", color: "#53FC18", icon: kickIcon },
  tiktok: { label: "TikTok", color: "#00F2EA", icon: tiktokIcon },
};

function platformBadgeNode(platform = "chat") {
  const meta = PLATFORM_META[platform] || {
    label: platform,
    color: "var(--accent)",
    icon: null,
  };
  const span = document.createElement("span");
  span.className = `platform platform--${platform}`;
  span.style.setProperty("--platform-color", meta.color);
  const icon = meta.icon ? meta.icon() : null;

  const label = document.createElement("span");
  label.className = "platform__label";
  label.textContent = meta.label || platform;

  if (icon) {
    const wrap = document.createElement("span");
    wrap.className = "platform__icon";
    wrap.appendChild(icon);
    span.appendChild(wrap);
  }
  span.appendChild(label);
  return span;
}

/* SVGs super leves (monocromáticos) */
function twitchIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<path fill="currentColor" d="M2 3h20v12l-6 6h-5l-3 0-2 0v-4H2V3zm4 2v10h4v4l4-4h4V5H6zm8 2h2v5h-2V7zm-5 0h2v5H9V7z"/>`;
  return svg;
}
function youtubeIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<path fill="currentColor" d="M23 7.5s-.2-1.6-.8-2.3c-.7-.8-1.5-.8-1.9-.9C17.6 4 12 4 12 4h0s-5.6 0-8.3.3c-.4 0-1.2.1-1.9.9C1.2 5.9 1 7.5 1 7.5S.8 9.3.8 11v2c0 1.7.2 3.5.2 3.5s.2 1.6.8 2.3c.7.8 1.6.8 2 1C6.4 20 12 20 12 20s5.6 0 8.3-.3c.4 0 1.2-.1 1.9-.9.6-.7.8-2.3.8-2.3s.2-1.7.2-3.5v-2c0-1.7-.2-3.5-.2-3.5ZM10 8.8l6 3.2-6 3.2V8.8Z"/>`;
  return svg;
}
function kickIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<path fill="currentColor" d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6zM10 10h4v4h-4z"/>`;
  return svg;
}
function tiktokIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<path fill="currentColor" d="M13.5 3h2c.4 1.7 1.7 3 3.4 3.4v2c-1.4 0-2.7-.5-3.7-1.3v7.2c0 3-2.4 5.4-5.4 5.4S4 17.3 4 14.4s2.4-5.4 5.4-5.4c.5 0 1 .1 1.5.2v2.3c-.5-.2-1-.3-1.5-.3-1.7 0-3.1 1.4-3.1 3.1s1.4 3.1 3.1 3.1 3.1-1.4 3.1-3.1V3z"/>`;
  return svg;
}

/* ===== Badges (classes por tipo) ===== */
function badgeNode(label) {
  const span = document.createElement("span");
  const type = String(label || "")
    .toLowerCase()
    .replace(/\s+/g, "-");
  span.className = `badge badge--${type}`;
  span.textContent = label;
  return span;
}

/* ===== Render Parts (text + emotes) ===== */
function renderParts(container, parts, fallbackText) {
  container.innerHTML = "";
  if (!parts || !Array.isArray(parts) || parts.length === 0) {
    container.textContent = fallbackText;
    return;
  }

  parts.forEach((part) => {
    const label = part.alt || part.text || "";
    if ((part.type === "emote" || part.type === "emoji") && part.url) {
      const img = new Image();
      img.src = part.url;
      img.alt = label;
      img.title = label;
      img.className = "emote";
      container.appendChild(img);
    } else {
      // type 'text' or unknown
      const span = document.createElement("span");
      span.textContent = label || part.text || "";
      container.appendChild(span);
    }
  });
}

/* ===== Render ===== */
function renderMessage({
  platform,
  author,
  text,
  color,
  badges,
  avatar,
  parts,
  timestamp,
  type = 'chat',     // 'chat', 'superchat', 'sticker', 'member'
  isHighlight = false,
  payment = null     // { amount, currency, formatted }
}) {
  const wrap = document.createElement("div");
  wrap.className = `message message--${platform} message--type-${type}`;
  if (isHighlight) wrap.classList.add('message--highlight');

  // Avatar
  const av = avatarNode(avatar, initialsFromName(author));
  wrap.appendChild(av);

  // Bubble
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.style.setProperty(
    "--accent",
    PLATFORM_META[platform]?.color || "var(--accent)"
  );
  wrap.appendChild(bubble);

  // HEADER (Author + Badges + Time) ----------------
  const header = document.createElement("div");
  header.className = "header";
  bubble.appendChild(header);

  // Name
  const nameEl = document.createElement("div");
  nameEl.className = "name";
  nameEl.textContent = author || "Unknown";
  // User custom color ONLY if strictly readable, otherwise fallback or white
  // For modern look, often white/bright is better. We can use variable.
  if (color) nameEl.style.color = color; 
  header.appendChild(nameEl);

  // Platform icon
  header.appendChild(platformBadgeNode(platform || "chat"));

  // Badges
  if (badges && badges.length) {
    const badgesEl = document.createElement("div");
    badgesEl.className = "badges";
    (badges || []).slice(0, 4).forEach((b) => badgesEl.appendChild(badgeNode(b)));
    header.appendChild(badgesEl);
  }

  // META / PAYMENT HEADER (SuperChat / Member) ----------------
  if (type === 'superchat' || type === 'sticker' || (payment && payment.formatted)) {
     const metaEl = document.createElement("div");
     metaEl.className = "meta-payment";
     metaEl.textContent = payment?.formatted || "Super Chat";
     bubble.appendChild(metaEl);
  } else if (type === 'member') {
     const metaEl = document.createElement("div");
     metaEl.className = "meta-payment meta-member";
     metaEl.textContent = "New Member!";
     bubble.appendChild(metaEl);
  }

  // TEXT BODY ----------------
  const textEl = document.createElement("div");
  textEl.className = "text";
  
  try {
    if (type === 'sticker') {
         // Stickers sometimes text is just alt.
         renderParts(textEl, [{type:'text', text: text || 'Sticker'}], text || "");
    } else {
         renderParts(textEl, Array.isArray(parts) ? parts : null, text || "");
    }
  } catch (e) {
    textEl.textContent = text || "";
  }
  bubble.appendChild(textEl);

  messagesEl.appendChild(wrap);
  
  // Auto scroll
  const isScrolledNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop <= messagesEl.clientHeight + 100;
  if (true /* Always scroll for now, or use logic */) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Cleanup
  const maxNodes = 100;
  while (messagesEl.childElementCount > maxNodes) {
    messagesEl.removeChild(messagesEl.firstElementChild);
  }
}

function startSocket() {
  function connect() {
    const ws = new WebSocket(wsUrl());
    
    ws.onopen = () => {
      console.log("Connected to overlay WS");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data) renderMessage(data);
      } catch (err) {
        console.error("WS message error:", err);
      }
    };

    ws.onclose = () => {
      console.log("WS closed, retrying in 3s...");
      setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
      console.error("WS error:", err);
      ws.close();
    };
  }
  connect();
}

startSocket();
/* ====== Fim do overlay client ====== */

// For testing purposes
window.testMessage = renderMessage;
