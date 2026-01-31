
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const URLS = [
    "https://www.gstatic.com/youtube/img/emojis/emojis-svg-0.json",
    // "https://www.gstatic.com/youtube/img/emojis/emojis-svg-1.json" // standard emojis often here
];

async function main() {
    const combinedMap = {};

    for (const url of URLS) {
        console.log(`Fetching ${url}...`);
        try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const data = await res.json();
            
            // Expected structure: Array of objects
            // { emojiId, shortcuts: [":foo:"], image: { thumbnails: [{url}] } }
            
            data.forEach(item => {
                const img = item.image?.thumbnails?.[0]?.url;
                if (!img) return;
                
                // Add shortcuts
                if (item.shortcuts && Array.isArray(item.shortcuts)) {
                    item.shortcuts.forEach(sc => {
                        combinedMap[sc] = img;
                    });
                }
            });
        } catch (e) {
            console.error("Error fetching/parsing", url, e);
        }
    }
    
    // Add manual overrides if needed (e.g. specific purple crying if not in SVG-0)
    // The user specifically wanted :face-purple-crying:
    // We can add it manually if the fetch misses it, but let's see.
    combinedMap[":face-purple-crying:"] = "https://yt3.ggpht.com/g6_km98AfdHbN43gvEuNdZ2I07MmzVpArLwEvNBwwPqpZYzszqhRzU_DXALl11TchX5_xFE=w24-h24-c-k-nd";
    combinedMap[":eyes-purple-crying:"] = "https://yt3.ggpht.com/g6_km98AfdHbN43gvEuNdZ2I07MmzVpArLwEvNBwwPqpZYzszqhRzU_DXALl11TchX5_xFE=w24-h24-c-k-nd";

    const outputPath = path.join(__dirname, '..', 'server', 'data', 'youtube_emotes.json');
    
    // Ensure dir exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    fs.writeFileSync(outputPath, JSON.stringify(combinedMap, null, 2));
    console.log(`Wrote ${Object.keys(combinedMap).length} emotes to ${outputPath}`);
}

main();
