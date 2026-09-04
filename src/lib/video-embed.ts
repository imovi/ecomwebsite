export interface ParsedVideoInfo {
  type: "youtube" | "facebook" | "tiktok" | "instagram" | "direct" | "unknown";
  embedUrl: string;
  isVertical: boolean;
  originalUrl: string;
  videoId?: string;
  platformName: string;
}

export function parseVideoUrl(url: string | null | undefined): ParsedVideoInfo | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // 1. YouTube Shorts (Vertical 9:16)
  const ytShortsMatch = trimmed.match(/(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]+)/i);
  if (ytShortsMatch) {
    const videoId = ytShortsMatch[1];
    return {
      type: "youtube",
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=0&rel=0`,
      isVertical: true,
      originalUrl: trimmed,
      videoId,
      platformName: "YouTube Shorts",
    };
  }

  // 2. YouTube Standard Video (Landscape 16:9)
  const ytStandardMatch = trimmed.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i,
  );
  if (ytStandardMatch) {
    const videoId = ytStandardMatch[1];
    return {
      type: "youtube",
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=0&rel=0`,
      isVertical: false,
      originalUrl: trimmed,
      videoId,
      platformName: "YouTube",
    };
  }

  // 3. Facebook Reel
  if (trimmed.includes("facebook.com/reel/")) {
    return {
      type: "facebook",
      embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(trimmed)}&show_text=false`,
      isVertical: true,
      originalUrl: trimmed,
      platformName: "Facebook Reel",
    };
  }

  // 4. Facebook Regular Video / fb.watch
  if (trimmed.includes("facebook.com") || trimmed.includes("fb.watch")) {
    return {
      type: "facebook",
      embedUrl: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(trimmed)}&show_text=false`,
      isVertical: false,
      originalUrl: trimmed,
      platformName: "Facebook Video",
    };
  }

  // 5. Instagram Reel or Post
  const igMatch = trimmed.match(/instagram\.com\/(?:reel|p|tv)\/([a-zA-Z0-9_-]+)/i);
  if (igMatch) {
    const code = igMatch[1];
    return {
      type: "instagram",
      embedUrl: `https://www.instagram.com/reel/${code}/embed/`,
      isVertical: true,
      originalUrl: trimmed,
      videoId: code,
      platformName: "Instagram Reel",
    };
  }

  // 6. TikTok
  const ttMatch = trimmed.match(/tiktok\.com\/(?:@[^/]+\/video\/|v\/)?(\d+)/i);
  if (ttMatch) {
    const videoId = ttMatch[1];
    return {
      type: "tiktok",
      embedUrl: `https://www.tiktok.com/embed/v2/${videoId}`,
      isVertical: true,
      originalUrl: trimmed,
      videoId,
      platformName: "TikTok",
    };
  }

  // 7. Direct video file (MP4, WebM, Ogg, MOV)
  if (/\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(trimmed)) {
    return {
      type: "direct",
      embedUrl: trimmed,
      isVertical: false,
      originalUrl: trimmed,
      platformName: "Video File",
    };
  }

  // 8. General fallback for web URLs
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return {
      type: "unknown",
      embedUrl: trimmed,
      isVertical: false,
      originalUrl: trimmed,
      platformName: "Web Video",
    };
  }

  return null;
}

/**
 * Resolves a video URL into a direct, clean video stream (.mp4) whenever possible
 * to eliminate likes, comments, and branding chrome.
 * Falls back safely to standard embed if extraction fails.
 */
export async function resolveDirectVideoUrl(
  url: string | null | undefined,
): Promise<ParsedVideoInfo | null> {
  const parsed = parseVideoUrl(url);
  if (!parsed) return null;

  // Already a direct video file
  if (parsed.type === "direct") return parsed;

  // Instagram Reel / Post: Extract clean direct MP4 stream
  if (parsed.type === "instagram" && parsed.videoId) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(`https://www.instagram.com/reel/${parsed.videoId}/embed/`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) {
        const html = await res.text();
        const match = html.match(/\\"video_url\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\"/);
        if (match) {
          const directUrl = JSON.parse(`"${match[1]}"`).replace(/\\\//g, "/");
          if (directUrl && directUrl.startsWith("http")) {
            return {
              ...parsed,
              type: "direct",
              embedUrl: directUrl,
              isVertical: true,
            };
          }
        }
      }
    } catch {
      // Graceful fallback to Instagram embed
    }
  }

  return parsed;
}
