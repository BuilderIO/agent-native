import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

/**
 * Extract YouTube video ID from various URL formats
 */
function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const shortMatch = u.pathname.match(
        /^\/(?:embed|v|shorts)\/([a-zA-Z0-9_-]{11})/,
      );
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
export const getYouTubeTranscript = defineEventHandler(
  async (event: H3Event) => {
    const query = getQuery(event);
    const url = query.url as string | undefined;
    const rawVideoId = query.videoId as string | undefined;

    const videoId = rawVideoId
      ? rawVideoId
      : url
        ? extractVideoId(url)
        : null;

    if (!videoId) {
      setResponseStatus(event, 400);
      return { error: "url or videoId parameter is required" };
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
        setResponseStatus(event, 502);
        return {
          error: `Failed to fetch YouTube page (${pageRes.status})`,
        };
      }

      const html = await pageRes.text();

      // Extract title
      const titleMatch =
        html.match(/<meta\s+name="title"\s+content="([^"]+)"/i) ||
        html.match(/<title>([^<]+)<\/title>/i);
      const title =
        titleMatch?.[1]?.replace(/ - YouTube$/, "").trim() ||
        `YouTube Video ${videoId}`;

      // Extract captions from playerCaptionsTracklistRenderer
      const captionsMatch = html.match(
        /"captions":\s*(\{[^}]*"playerCaptionsTracklistRenderer":\s*\{[^]*?\}\s*\})/,
      );
      if (!captionsMatch) {
        // Try alternative: look for timedtext URL directly
        const timedtextMatch = html.match(
          /\"(https?:\/\/www\.youtube\.com\/api\/timedtext[^"]+)\"/,
        );
        if (timedtextMatch) {
          const transcript = await fetchTranscriptFromUrl(
            timedtextMatch[1].replace(/\\u0026/g, "&"),
          );
          return { title, transcript, videoId, url: watchUrl };
        }
        setResponseStatus(event, 404);
        return { error: "No captions available for this video" };
      }

      // Parse caption tracks to find English or first available
      const captionTracksMatch = html.match(/"captionTracks":\s*(\[[^\]]+\])/);
      if (!captionTracksMatch) {
        setResponseStatus(event, 404);
        return { error: "No caption tracks found" };
      }

      let tracks: Array<{
        baseUrl: string;
        languageCode: string;
        kind?: string;
      }>;
      try {
        tracks = JSON.parse(captionTracksMatch[1].replace(/\\u0026/g, "&"));
      } catch {
        setResponseStatus(event, 500);
        return { error: "Failed to parse caption tracks" };
      }

      // Prefer manual English captions, then auto-generated English, then first available
      const manualEn = tracks.find(
        (t) => t.languageCode === "en" && t.kind !== "asr",
      );
      const autoEn = tracks.find((t) => t.languageCode === "en");
      const track = manualEn || autoEn || tracks[0];

      if (!track?.baseUrl) {
        setResponseStatus(event, 404);
        return { error: "No usable caption track found" };
      }

      const transcript = await fetchTranscriptFromUrl(track.baseUrl);
      return { title, transcript, videoId, url: watchUrl };
    } catch (err: any) {
      if (err.name === "AbortError") {
        setResponseStatus(event, 504);
        return { error: "Timed out fetching YouTube page" };
      }
      setResponseStatus(event, 500);
      return { error: `Failed to fetch transcript: ${err.message}` };
    }
  },
);

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
