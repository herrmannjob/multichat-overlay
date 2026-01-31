// YouTube via googleapis (discovery) + youtube-chat (parsing/emotes)
export async function initYouTube(emit) {
  let googleapis;
  let YouTubeChat;
  try {
    googleapis = await import("googleapis");
    YouTubeChat = await import("youtube-chat");
  } catch (e) {
    console.warn("[youtube] googleapis or youtube-chat not installed. Skipping.");
    return;
  }
  const { google } = googleapis;
  const { LiveChat } = YouTubeChat;

  const apiKey = process.env.YOUTUBE_API_KEY;

  // Manual map for standard YouTube emotes that often come as text
  const YOUTUBE_EMOJI_MAP = {
      ":face-green-smiling:": "https://yt3.ggpht.com/G061SAfXg2bmG1ZXbJsJzQJpN8qEf_W3f5cb5nwzBYIV58IpPf6H90lElDl85iti3HgoL3o=w24-h24-c-k-nd",
      ":face-red-droopy-eyes:": "https://yt3.ggpht.com/8QO5W56U8rJzP7q3NqOwc-F2_B7P2vS0wN7kCJOy6Z0_w5YFj6gTg-1gG0k2q7_S=w24-h24-c-k-nd", // Best guess or similar style
      ":face-tears-of-joy:": "https://yt3.ggpht.com/M12s6A5eMJoA-d5xR5t5t5R5j5j5j5j5j5j5j5j5=w24-h24-c-k-nd", // Generic fallback if needed
      ":popcorn:": "🍿", // Fallback to unicode if no asset
      // Add more as discovered
  };

  if (!apiKey) {
    console.log("[youtube] missing YOUTUBE_API_KEY; skipping.");
    return;
  }
  
  const youtube = google.youtube({ version: "v3", auth: apiKey });

  // Configuration
  const envLiveChatId = process.env.YOUTUBE_LIVE_CHAT_ID; // Fallback or strict
  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  const channelHandle = process.env.YOUTUBE_HANDLE || "SouHerrmann"; 

  // State
  let liveChatInstance = null;
  let isConnecting = false;
  let validationTimer = null;
  let currentVideoId = null;

  // --- Discovery Helper (Google APIs) ---

  async function getChannelIdFromHandle(handle) {
    try {
      if (!handle) return null;
      const h = handle.startsWith('@') ? handle : `@${handle}`;
      const res = await youtube.channels.list({ part: ['id'], forHandle: h });
      return res.data.items?.[0]?.id || null;
    } catch (e) {
      console.warn("[youtube] failed to resolve handle:", e.message);
      return null;
    }
  }

  async function findLiveVideoId() {
    try {
      let targetChannelId = channelId;
      if (!targetChannelId && channelHandle) {
        targetChannelId = await getChannelIdFromHandle(channelHandle);
        if (targetChannelId) {
             console.log(`[youtube] resolved handle ${channelHandle} -> ${targetChannelId}`);
        }
      }

      if (!targetChannelId) {
        console.warn("[youtube] no CHANNEL_ID or HANDLE to search.");
        return null;
      }

      console.log(`[youtube] searching live stream for channel ${targetChannelId}...`);
      const res = await youtube.search.list({
        part: ["snippet"],
        channelId: targetChannelId,
        eventType: "live",
        type: "video"
      });

      const videoId = res.data.items?.[0]?.id?.videoId;
      if (videoId) {
        console.log(`[youtube] found live video: ${videoId}`);
        return videoId;
      } else {
        console.log("[youtube] no live stream found.");
        return null;
      }
    } catch (e) {
      console.error("[youtube] discovery error:", e?.message || e);
      return null;
    }
  }

  // --- Connection Logic (youtube-chat) ---

  function mapMessageItems(items) {
    if (!items || !Array.isArray(items)) return [];
    
    return items.map(item => {
      // youtube-chat: item can be { text: '...' } or { customEmoji: { ... }, emojiText: '...' }
      if (item.customEmoji) {
        const url = item.customEmoji.image?.thumbnails?.[0]?.url || item.customEmoji.url;
        const alt = item.emojiText || item.customEmoji.shortcuts?.[0] || ":emote:";
        if (url) return { type: "emoji", url, alt };
      }
      
      const txt = item.text || item.emojiText || "";
      
      // Check for known standard system emotes in text
      if (YOUTUBE_EMOJI_MAP[txt]) {
          const mapped = YOUTUBE_EMOJI_MAP[txt];
          if (mapped.startsWith("http")) {
              return { type: "emoji", url: mapped, alt: txt };
          } else {
              return { type: "text", text: mapped };
          }
      }
      
      // Basic text
      return { type: "text", text: txt };
    });
  }

  async function connectToStream(videoId) {
    if (liveChatInstance) {
        liveChatInstance.stop();
        liveChatInstance = null;
    }

    console.log(`[youtube] connecting scraper to video ${videoId}...`);
    try {
        const chat = new LiveChat({ liveId: videoId });
        
        chat.on("start", (liveId) => {
            console.log(`[youtube] connected to chat for ${liveId}`);
        });

        chat.on("end", (reason) => {
            console.log(`[youtube] chat ended: ${reason}`);
            scheduleValidation();
        });

        chat.on("error", (err) => {
            console.warn("[youtube] chat error:", err);
        });

        chat.on("chat", (msg) => {
             // console.log('[youtube] raw msg:', JSON.stringify(msg)); 
             const authorName = msg.author?.name || "YouTube User";
             
             // Badges
             const badges = [];
             if (msg.author?.isOwner) badges.push("owner");
             if (msg.author?.isModerator) badges.push("mod");
             if (msg.author?.isVerified) badges.push("verified");
             if (msg.author?.badge?.label?.toLowerCase().includes("member")) badges.push("member");

             // Parts mapping
             const parts = mapMessageItems(msg.message);
             const fullText = parts.map(p => p.type==='emoji' ? (p.alt||"") : p.text).join("");

             emit({
               platform: "youtube",
               author: authorName,
               text: fullText,
               parts: parts,
               badges: badges,
               avatar: msg.author?.thumbnail?.url || null,
               timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
               type: 'chat'
             });
        });
        
        // Handle SuperChats/Stickers if feasible. 
        // youtube-chat emits "superchat" event? No, usually "chat" with checks or specific events?
        // Library documentation says: chat.on("superchat", (msg) => ...) works.
        
        chat.on("superchat", (msg) => {
            const authorName = msg.author?.name || "SuperChat User";
            const parts = mapMessageItems(msg.message);
            const fullText = parts.map(p => p.type==='emoji' ? p.alt : p.text).join("");
            
            emit({
                platform: "youtube",
                author: authorName,
                text: fullText,
                parts: parts,
                badges: [], // author badges maybe inside msg.author
                avatar: msg.author?.thumbnail?.url || null,
                timestamp: Date.now(),
                type: 'superchat',
                payment: {
                    amount: msg.amount || 0, // library parses this?
                    currency: msg.currency || "",
                    formatted: msg.amountString || ""
                }
            });
        });

        // Start
        const ok = await chat.start();
        if (!ok) {
            console.warn("[youtube] failed to start chat listener.");
            scheduleValidation();
            return;
        }
        liveChatInstance = chat;
        currentVideoId = videoId;
        
    } catch (e) {
        console.warn("[youtube] scraper exception:", e);
        scheduleValidation();
    }
  }

  // --- Main Loop ---

  async function validate() {
    // If we are already running, do nothing
    if (liveChatInstance) return;

    // Resolve Channel ID if needed (and if possible)
    let targetChannelId = channelId;
    if (!targetChannelId && channelHandle && !process.env.YOUTUBE_CHANNEL_ID) {
         // Try to resolve via API if we haven't yet, but if quota is dead, we might fail.
         // If we fail, we can't proceed unless we hardcode it or user adds it to env.
         // However, if we previously found it, maybe we can resort to scraping?
         // For now, let's hope API works OR user put ID in .env.
         const resolved = await getChannelIdFromHandle(channelHandle);
         if (resolved) targetChannelId = resolved;
    }

    // Fallback: If API failed but we have a handle, maybe youtube-chat supports handle? 
    // Usually no, but let's try passing it if we lack ID. 
    // Or if we have a hardcoded fallback from the logs `UC-zEotsGT3fNPzuoK87K9OA` (SouHerrmann).
    if (!targetChannelId && channelHandle.toLowerCase() === 'souherrmann') {
        targetChannelId = 'UC-zEotsGT3fNPzuoK87K9OA'; // Hardcode known ID to bypass Quota/Discovery issue
    }

    if (!targetChannelId && !envLiveChatId) {
        console.warn("[youtube] Waiting for Channel ID resolution...");
        scheduleValidation(60000);
        return;
    }

    // Prefer youtube-chat's internal discovery methods (SCRAING) over API (QUOTA)
    // If we have an ID, we can initialize LiveChat with it, and it finds the current stream.
    
    if (targetChannelId) {
        // Use youtube-chat discovery (No Quota)
         await connectToStream({ channelId: targetChannelId });
    } else if (envLiveChatId) {
         await connectToStream({ liveId: envLiveChatId });
    }
  }

  async function connectToStream(options) {
    if (liveChatInstance) {
        liveChatInstance.stop();
        liveChatInstance = null;
    }

    const label = options.channelId || options.liveId;
    console.log(`[youtube] connecting scraper to ${label} (scraped)...`);
    
    try {
        // youtube-chat constructor: { channelId } OR { liveId }
        const chat = new LiveChat(options);
        
        chat.on("start", (liveId) => {
            console.log(`[youtube] connected to chat for liveId: ${liveId}`);
        });

        chat.on("end", (reason) => {
            console.log(`[youtube] chat ended: ${reason}`);
            liveChatInstance = null; // Ensure we clear it
            scheduleValidation(10000);
        });

        chat.on("error", (err) => {
            console.warn("[youtube] chat error:", err?.message || err);
            // If it's a critical start error, we might need to reset
            // But usually the library keeps trying or emits 'end'.
        });

        chat.on("chat", (msg) => {
             // console.log('[youtube] raw msg:', JSON.stringify(msg)); 
             const authorName = msg.author?.name || "YouTube User";
             
             // Badges
             const badges = [];
             if (msg.author?.isOwner) badges.push("owner");
             if (msg.author?.isModerator) badges.push("mod");
             if (msg.author?.isVerified) badges.push("verified");
             if (msg.author?.badge?.label?.toLowerCase().includes("member")) badges.push("member");

             // Parts mapping
             const parts = mapMessageItems(msg.message);
             const fullText = parts.map(p => p.type==='emoji' ? (p.alt||"") : p.text).join("");

             emit({
               platform: "youtube",
               author: authorName,
               text: fullText,
               parts: parts,
               badges: badges,
               avatar: msg.author?.thumbnail?.url || null,
               timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
               type: 'chat'
             });
        });
        
        // Start
        const ok = await chat.start();
        if (!ok) {
            console.warn("[youtube] failed to locate live stream via scraper.");
            scheduleValidation(60000); // Retry later
            return;
        }
        liveChatInstance = chat;
        
    } catch (e) {
        console.warn("[youtube] scraper exception:", e?.message);
        scheduleValidation(60000);
    }
  }

  function scheduleValidation(ms = 30000) {
      if (validationTimer) clearTimeout(validationTimer);
      validationTimer = setTimeout(validate, ms);
  }

  console.log("[youtube] initializing (scraper mode)... ");
  validate();
}
