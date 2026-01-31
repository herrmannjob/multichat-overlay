# Multichat Overlay (YouTube + Twitch + Kick + TikTok) — OBS Ready

A **single overlay** that aggregates chat messages from **Twitch**, **YouTube**, **Kick** and **TikTok** into one clean, customizable UI that you can add as a **Browser Source** in **OBS Studio**.

## Features
- ✅ Works with **OBS Studio** (Browser Source)
- ✅ **Plug-and-play adapters** for Twitch, YouTube (Auto-detect live), Kick, TikTok (enable only what you use)
- ✅ **No DB needed**; runs locally
- ✅ **Theming via CSS variables** (colors, fonts, opacity, radius, shadows, line height, sizes)
- ✅ Filters: bad-words blocklist, max message length, emote-safe rendering, platform tags
- ✅ Simple **WebSocket** pipe from server → overlay
- ✅ Health endpoint (`/healthz`) and server-side logging

> ⚠️ **APIs & Credentials**: some platforms require tokens or keys for best results. Adapters are optional—enable the ones you want and comment/disable the rest.

---

## 1) Requirements
- **Node.js 18+** and **npm** (or pnpm/yarn)
- Your stream accounts:
  - **Twitch**: channel name (anonymous read works via `tmi.js`, but rate-limited)
  - **YouTube**: API Key + **Live Chat ID** (for an active livestream)
  - **Kick**: channel name (community libs; may break if site updates)
  - **TikTok**: username (community libs; may break if site updates)

---

## 2) Install
```bash
# from the unzipped folder
cd multichat-overlay

# install base deps
npm install

# install the adapters you actually plan to use (optional):
npm install tmi.js           # Twitch
npm install googleapis       # YouTube
npm install tiktok-live-connector  # TikTok (community lib)
npm install kick-chat-api    # Kick (community lib; alternatives exist)
```

> If an adapter's package fails to install or is outdated, simply **disable that adapter** in `server/index.js` until you find a compatible library. The overlay will still work for the enabled platforms.

---

## 3) Configure
Duplicate `.env.example` to `.env` and fill what you need:
```
cp .env.example .env
```

**.env**
```
# Server
PORT=3000
HOST=0.0.0.0

# Twitch
TWITCH_CHANNEL=your_twitch_channel
# Optional OAuth (for higher limits); otherwise anonymous read:
TWITCH_USERNAME=
TWITCH_OAUTH_TOKEN=

# YouTube
YOUTUBE_API_KEY=your_google_api_key
# Specify ONE of these to auto-detect live stream:
YOUTUBE_CHANNEL_ID=your_channel_id
YOUTUBE_HANDLE=your_handle (e.g. SouHerrmann)

# Optional: Force a specific Live Chat ID (auto-detection will be skipped if this is set)
YOUTUBE_LIVE_CHAT_ID=

# Kick
KICK_CHANNEL=your_kick_channel

# TikTok
TIKTOK_USERNAME=your_tiktok_username

# Overlay
OVERLAY_TITLE=Chat
THEME_ACCENT=#8b5cf6
THEME_TEXT=#ffffff
THEME_BG=rgba(17, 17, 23, 0.35)
THEME_CARD_BG=rgba(0, 0, 0, 0.35)
THEME_BORDER=rgba(255,255,255,0.12)
THEME_FONT_FAMILY=Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"

# Behavior
MAX_MESSAGE_LENGTH=350
BAD_WORDS=badword1,badword2,badword3
SHOW_PLATFORM_TAG=true
```

---

## 4) Run the server
```bash
npm run dev
# or
npm start
```
It shows which adapters are enabled and logs connections.

Health check: http://localhost:3000/healthz

---

## 5) Add to OBS
1. Open **OBS Studio** → **Sources** → **+** → **Browser**.
2. Set **URL** to: `http://localhost:3000/overlay/`
3. Set **Width**: 500–700 (try 600) and **Height**: 900 (or fit your layout).
4. Enable **Refresh browser when scene becomes active** if needed.
5. **Custom CSS** not required (the overlay ships with its own CSS).
6. Move/resize the overlay in your scene.

> Tip: You can open `http://localhost:3000/overlay/?theme=dark&scale=1.0` in your browser to preview.

---

## 6) Customization (CSS Variables)
Open `overlay/styles.css` and adjust the CSS variables at `:root` (or pass via query params).
- `--accent`, `--text`, `--bg`, `--card-bg`, `--border`
- `--font-family`, `--radius`, `--shadow`, `--line-height`
- `--avatar-size`, `--message-max-width`
- Toggle platform badge in `.message .platform`

You can also tweak live via query params:
- `?accent=%238b5cf6&text=%23ffffff&bg=rgba(17,17,23,0.35)&title=Meu+Chat`

---

## 7) Adapters: Enable/Disable quickly
In `server/index.js`, comment out any `initX()` call you don't want. The server only forwards messages coming from connected adapters.

---

## 8) Deploy Notes
Local usage is easiest. For remote deployments, ensure the overlay’s WebSocket `ws://host:PORT` is reachable from OBS. If hosting with HTTPS, adjust the overlay code to `wss://` accordingly.

---

## 9) Troubleshooting
- **No messages?** Make sure at least one adapter is configured and the stream/chat is live.
- **YouTube**: You **must** provide a valid `YOUTUBE_LIVE_CHAT_ID` for an **active** broadcast.
- **Kick/TikTok**: Community libs sometimes break when platforms change. Update or disable the adapter.
- **OBS Can’t load URL?** Check firewall, ad-blockers, or that the server is running on the correct port.
- **Stuttering or overload**: Reduce emotes/emoji rendering, cut long messages with `MAX_MESSAGE_LENGTH`.

---

## License
MIT
