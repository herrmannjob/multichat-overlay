// TikTok via tiktok-live-connector (community lib)
export async function initTikTok(emit) {
  let Connector;
  try {
    Connector = await import('tiktok-live-connector');
  } catch (e) {
    console.warn('[tiktok] tiktok-live-connector not installed. Skipping.');
    return;
  }
  const username = process.env.TIKTOK_USERNAME;
  if (!username) {
    console.log('[tiktok] no TIKTOK_USERNAME provided; skipping.');
    return;
  }

  const { WebcastPushConnection } = Connector;
  let conn = null;
  let isConnecting = false;

  function normalizeTikTokBadges(data) {
    const raw = data.userBadges || [];
    const badges = [];

    // TikTok badges are complex objects, we try to map common types if recognizable
    // Usually they are like { type: 'moderator', name: 'Moderator' } or similar structure depending on version
    // But tiktok-live-connector simplifies them often. 
    
    // We can also infer from top-level flags if available (like isModerator) which library might provide
    if (data.isModerator) badges.push('mod');
    if (data.isSubscriber) badges.push('sub');
    
    // Also check raw list
    for (const b of raw) {
      const type = (b?.type || '').toLowerCase();
      const name = (b?.name || '').toLowerCase();
      
      if (type.includes('moderator') || name.includes('moderator')) badges.push('mod');
      if (type.includes('subscriber') || name.includes('subscriber')) badges.push('sub');
      if (type.includes('founder') || name.includes('founder')) badges.push('founder');
      // "gifter" badges etc
    }
    
    return Array.from(new Set(badges));
  }

  async function connect() {
    if (isConnecting) return;
    isConnecting = true;
    
    try {
      conn = new WebcastPushConnection(username, {
        processInitialData: false, 
        enableExtendedGiftInfo: true,
        enableWebsocketUpgrade: true,
        requestOptions: {
           timeout: 10000 
        }
      });

      conn.on('connected', state => {
        console.log('[tiktok] connected to', username);
        isConnecting = false;
      });

      conn.on('disconnected', () => {
        console.warn('[tiktok] disconnected. Reconnecting in 5s...');
        isConnecting = false;
        setTimeout(connect, 5000);
      });

      conn.on('chat', data => {
        const badges = normalizeTikTokBadges(data);
        const text = data.comment || '';
        
        let parts = [];
        
        // TikTok Emote Styling: Text often contains [EmoteName]
        // data.emotes array contains objects with properties.
        // We prefer using indices if available and reliable.
        // Otherwise, we scan for [Name] if we can map it.
        
        if (Array.isArray(data.emotes) && data.emotes.length > 0) {
            // Strategy: Create a map of "EmoteName" -> URL
            // And also "EmoteId" -> URL just in case.
            const emoteMap = new Map();
            data.emotes.forEach(e => {
                const url = e.imageUrl || e.image?.url || e.url;
                if (!url) return;
                
                // Name might be in `e.name` or `e.impliedName`? 
                // Often TikTok provides `data.emotes[i].name` which matches the text `[name]`.
                // Example: text="[wow]", emote={ name: "wow", ... }
                // Sometimes name includes brackets: "[wow]"
                
                // We'll normalize name to not include brackets for the map keys
                // unless they come with them.
                let name = e.name || e.id || "emote";
                emoteMap.set(name, url);
                
                // If name doesn't have brackets, add version with brackets key too
                if (!name.startsWith('[')) {
                    emoteMap.set(`[${name}]`, url);
                }
            });
            
            // Now parse the text
            // We use a regex to find everything like [Content]
            // We only replace if it's in our map.
            
            const regex = /(\[.*?\])/g;
            let lastIndex = 0;
            let match;
            
            while ((match = regex.exec(text)) !== null) {
                // Text before match
                if (match.index > lastIndex) {
                    parts.push({ type: 'text', text: text.substring(lastIndex, match.index) });
                }
                
                const token = match[0];
                const url = emoteMap.get(token) || emoteMap.get(token.replace(/^\[|\]$/g, ''));
                
                if (url) {
                    parts.push({ type: 'emoji', url, alt: token });
                } else {
                    parts.push({ type: 'text', text: token });
                }
                
                lastIndex = regex.lastIndex;
            }
            
            // Remaining text
            if (lastIndex < text.length) {
                parts.push({ type: 'text', text: text.substring(lastIndex) });
            }
            
            // Fallback: If regex found nothing but we have emotes (maybe they are not [coded]?), 
            // just append them? No, usually TikTok web uses [code]. 
            // If parts is just empty (empty text?), maybe just emotes?
            if (parts.length === 0 && text.length === 0) {
                 data.emotes.forEach(e => {
                     const url = e.imageUrl || e.image?.url || e.url;
                     if (url) parts.push({ type: 'emoji', url, alt: e.name||'emote' });
                 });
            }
            
        } else {
            parts.push({ type: 'text', text });
        }

        emit({
          platform: 'tiktok',
          author: data.nickname || data.uniqueId || 'TikTok User',
          text,
          color: null,
          badges,
          avatar: data.profilePictureUrl || null,
          timestamp: Date.now(),
          type: 'chat',
          parts
        });
      });

      // Handle gifts/likes if we want (optional, but requested "update configurations")
      // For now, let's keep it simple to chat, but structure is ready.
      
      conn.on('error', err => {
        // Suppress common connection errors which are noisy
        console.warn('[tiktok] connection error:', err?.message || err);
      });

      await conn.connect();
    } catch (e) {
      console.warn('[tiktok] connect failed:', e?.message || e);
      isConnecting = false;
      setTimeout(connect, 10000);
    }
  }

  // Handle process exit to clean up if needed
  // ...

  console.log('[tiktok] initializing for', username);
  connect();
}
