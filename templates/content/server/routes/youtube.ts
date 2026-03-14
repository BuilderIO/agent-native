import type { RequestHandler } from "express";

/**
 * Extract YouTube video ID from various URL formats
 */
function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const shortMatch = u.pathname.match(/^\/(?:embed|v|shorts)\/([a-zA-Z0-9_-]{11})/);
      if (shortMatch) return shortMatch[1];
    }
    if (host === "youtu.be") {
      return u.pathname.slice(1).split("/")[0] || null;
    }
  } catch {}
  return null;
}

/**
 * Check if a URL is a YouTube video URL
 */
export function isYouTubeUrl(url: string): boolean {
  return extractVideoId(url) !== null;
}

/**
 * Fetch the transcript for a YouTube video using the timedtext API.
 * Returns { title, transcript, videoId, url }
 */
export const getYouTubeTranscript: RequestHandler = async (req, res) => {
  const { url, videoId: rawVideoId } = req.query;

  const videoId =
    typeof rawVideoId === "string"
      ? rawVideoId
      : typeof url === "string"
        ? extractVideoId(url)
        : null;

  if (!videoId) {
    res.status(400).json({ error: "url or videoId parameter is required" });
    return;
  }

  try {
    // Fetch the YouTube watch page to extract caption tracks and title
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const pageRes = await fetch(watchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!pageRes.ok) {
      res.status(502).json({ error: `Failed to fetch YouTube page (${pageRes.status})` });
      return;
    }

    const html = await pageRes.text();

    // Extract title
    const titleMatch =
      html.match(/<meta\s+name="title"\s+content="([^"]+)"/i) ||
      html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.replace(/ - YouTube$/, "").trim() || `YouTube Video ${videoId}`;

    // Extract captions from playerCaptionsTracklistRenderer
    const captionsMatch = html.match(/"captions":\s*(\{[^}]*"playerCaptionsTracklistRenderer":\s*\{[^]*?\}\s*\})/);
    if (!captionsMatch) {
      // Try alternative: look for timedtext URL directly
      const timedtextMatch = html.match(/\"(https?:\/\/www\.youtube\.com\/api\/timedtext[^"]+)\"/);
      if (timedtextMatch) {
        const transcript = await fetchTranscriptFromUrl(timedtextMatch[1].replace(/\\u0026/g, "&"));
        res.json({ title, transcript, videoId, url: watchUrl });
        return;
      }
      res.status(404).json({ error: "No captions available for this video" });
      return;
    }

    // Parse caption tracks to find English or first available
    const captionTracksMatch = html.match(/"captionTracks":\s*(\[[^\]]+\])/);
    if (!captionTracksMatch) {
      res.status(404).json({ error: "No caption tracks found" });
      return;
    }

    let tracks: Array<{ baseUrl: string; languageCode: string; kind?: string }>;
    try {
      tracks = JSON.parse(captionTracksMatch[1].replace(/\\u0026/g, "&"));
    } catch {
      res.status(500).json({ error: "Failed to parse caption tracks" });
      return;
    }

    // Prefer manual English captions, then auto-generated English, then first available
    const manualEn = tracks.find((t) => t.languageCode === "en" && t.kind !== "asr");
    const autoEn = tracks.find((t) => t.languageCode === "en");
    const track = manualEn || autoEn || tracks[0];

    if (!track?.baseUrl) {
      res.status(404).json({ error: "No usable caption track found" });
      return;
    }

    const transcript = await fetchTranscriptFromUrl(track.baseUrl);
    res.json({ title, transcript, videoId, url: watchUrl });
  } catch (err: any) {
    if (err.name === "AbortError") {
      res.status(504).json({ error: "Timed out fetching YouTube page" });
      return;
    }
    res.status(500).json({ error: `Failed to fetch transcript: ${err.message}` });
  }
};

async function fetchTranscriptFromUrl(captionUrl: string): Promise<string> {
  // Fetch the timedtext XML
  const res = await fetch(captionUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch captions (${res.status})`);
  }

  const xml = await res.text();

  // Parse XML: extract text from <text> elements
  const segments: string[] = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    let text = match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\n/g, " ")
      .trim();
    if (text) segments.push(text);
  }

  return segments.join(" ");
}
