import { RequestHandler } from "express";
import fs from "fs";
import path from "path";
import type { TwitterTweet, TwitterSaveRequest, LinkPreviewData } from "../../shared/api";

const TWITTER_API_BASE = "https://api.twitterapi.io";
const PROJECTS_DIR = path.join(process.cwd(), "content", "projects");
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 6000; // 6s for free-tier 5s rate limit

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  retries = MAX_RETRIES
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(url, { headers });
    if (response.status === 429 && attempt < retries) {
      console.log(
        `[Twitter] Rate limited (429), retrying in ${RETRY_DELAY_MS}ms (attempt ${attempt}/${retries})`
      );
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }
    return response;
  }
  // Should never reach here, but just in case
  return fetch(url, { headers });
}

function getApiKey(): string {
  return process.env.TWITTER_API_KEY || "";
}

function isValidProjectPath(project: string): boolean {
  if (!project) return false;
  const normalized = path.posix.normalize(project);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return false;
  if (normalized.includes("\0")) return false;
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length) return false;
  return segments.every((segment) => /^[a-z0-9][a-z0-9-]*$/.test(segment));
}

export const searchTwitter: RequestHandler = async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    res.status(500).json({ error: "Twitter API key not configured" });
    return;
  }

  const { query, queryType, sinceTime, untilTime, cursor, filter } = req.query;
  if (!query || typeof query !== "string") {
    res.status(400).json({ error: "query parameter is required" });
    return;
  }

  const params = new URLSearchParams({ query: String(query) });
  if (queryType) params.set("queryType", String(queryType));
  if (sinceTime) params.set("sinceTime", String(sinceTime));
  if (untilTime) params.set("untilTime", String(untilTime));
  if (cursor) params.set("cursor", String(cursor));

  const url = `${TWITTER_API_BASE}/twitter/tweet/advanced_search?${params}`;
  console.log(`[Twitter Search] Request URL: ${url}`);
  console.log(`[Twitter Search] Params:`, { query, queryType, sinceTime, untilTime, cursor });
  console.log(`[Twitter Search] API Key present: ${!!apiKey} (length: ${apiKey.length})`);

  try {
    const response = await fetchWithRetry(url, { "x-api-key": apiKey });

    console.log(`[Twitter Search] Response status: ${response.status}`);

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Twitter Search] API error response: ${text}`);
      // Return user-friendly error for rate limits
      if (response.status === 429) {
        res.status(429).json({
          error: "Rate limited by Twitter API. Please wait a few seconds and try again.",
          retryAfter: 6,
        });
        return;
      }
      res.status(response.status).json({ error: `Twitter API error: ${text}` });
      return;
    }

    const data = await response.json();
    console.log(`[Twitter Search] Raw response keys:`, Object.keys(data));
    console.log(`[Twitter Search] Tweet count in response:`, data.tweets?.length ?? 0);
    if (data.tweets?.length > 0) {
      console.log(`[Twitter Search] First tweet ALL KEYS:`, Object.keys(data.tweets[0]));
      console.log(`[Twitter Search] First tweet type:`, data.tweets[0].type);
      console.log(`[Twitter Search] First tweet card:`, JSON.stringify(data.tweets[0].card).slice(0, 300));
      console.log(`[Twitter Search] First tweet article field:`, JSON.stringify(data.tweets[0].article).slice(0, 300));
      const articlesFound = data.tweets.filter((t: any) => t.article != null);
      console.log(`[Twitter Search] Tweets with article field set:`, articlesFound.length);
      console.log(`[Twitter Search] Tweet types:`, [...new Set(data.tweets.map((t: any) => t.type))]);
      console.log(`[Twitter Search] Filter requested:`, filter || 'none');
    } else {
      console.log(`[Twitter Search] Full response (no tweets):`, JSON.stringify(data).slice(0, 500));
    }

    // Normalize tweets from API response
    const tweets: TwitterTweet[] = (data.tweets || []).map((t: any) => ({
      id: t.id,
      url: t.url,
      text: t.text,
      createdAt: t.createdAt,
      lang: t.lang,
      type: t.type,
      likeCount: t.likeCount || 0,
      retweetCount: t.retweetCount || 0,
      replyCount: t.replyCount || 0,
      quoteCount: t.quoteCount || 0,
      viewCount: t.viewCount || 0,
      bookmarkCount: t.bookmarkCount || 0,
      media: t.extendedEntities?.media?.map((m: any) => ({
        type: m.type,
        url: m.media_url_https || m.url,
        thumbnailUrl: m.media_url_https || m.url,
      })) || t.media?.map((m: any) => ({
        type: m.type || "photo",
        url: m.media_url_https || m.url,
        thumbnailUrl: m.media_url_https || m.url,
      })) || undefined,
      author: {
        id: t.author?.id,
        userName: t.author?.userName,
        name: t.author?.name,
        profilePicture: t.author?.profilePicture,
        isBlueVerified: t.author?.isBlueVerified,
        followers: t.author?.followers,
      },
      isReply: t.isReply,
      quotedTweet: t.quoted_tweet || t.quotedTweet || undefined,
      article: t.article ? {
        title: t.article.title || "",
        previewText: t.article.preview_text || t.article.previewText || "",
        coverImageUrl: t.article.cover_media_img_url || t.article.coverImageUrl || "",
      } : undefined,
    }));

    // Filter by type if requested
    let filteredTweets = tweets;
    if (filter === "articles") {
      // Filter for native X Articles (long-form blog-style content)
      filteredTweets = tweets.filter((t) => t.article != null);
      console.log(`[Twitter Search] Articles filter: ${tweets.length} -> ${filteredTweets.length} tweets with native articles`);
    } else if (filter === "links") {
      // Filter for tweets with external links
      filteredTweets = tweets.filter((t, i) => {
        const raw = data.tweets[i];
        const hasLink = /https?:\/\/t\.co\/\w+/.test(t.text);
        return hasLink;
      });
      console.log(`[Twitter Search] Links filter: ${tweets.length} -> ${filteredTweets.length} tweets`);
    } else if (filter === "media") {
      filteredTweets = tweets.filter((t) => t.media && t.media.length > 0);
      console.log(`[Twitter Search] Media filter: ${tweets.length} -> ${filteredTweets.length} tweets`);
    }

    // Sort by engagement when queryType is "Top" to ensure best results first
    const sortedTweets = String(queryType) === "Top"
      ? filteredTweets.sort((a, b) => {
          const scoreA = (a.likeCount || 0) + (a.retweetCount || 0) * 2 + (a.bookmarkCount || 0) * 3;
          const scoreB = (b.likeCount || 0) + (b.retweetCount || 0) * 2 + (b.bookmarkCount || 0) * 3;
          return scoreB - scoreA;
        })
      : filteredTweets;

    res.json({
      tweets: sortedTweets,
      nextCursor: data.next_cursor || data.nextCursor || null,
      hasNextPage: data.has_next_page ?? data.hasNextPage ?? !!data.next_cursor,
    });
  } catch (err: any) {
    console.error(`[Twitter Search] Exception:`, err.message, err.stack);
    res.status(500).json({ error: `Failed to search Twitter: ${err.message}` });
  }
};

export const getArticle: RequestHandler = async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    res.status(500).json({ error: "Twitter API key not configured" });
    return;
  }

  const { tweetId } = req.query;
  if (!tweetId || typeof tweetId !== "string") {
    res.status(400).json({ error: "tweetId parameter is required" });
    return;
  }

  try {
    const response = await fetchWithRetry(
      `${TWITTER_API_BASE}/twitter/article?tweet_id=${encodeURIComponent(tweetId)}`,
      { "x-api-key": apiKey }
    );

    if (!response.ok) {
      const text = await response.text();
      res.status(response.status).json({ error: `Twitter API error: ${text}` });
      return;
    }

    const data = await response.json();
    res.json({
      title: data.title || "",
      previewText: data.preview_text || data.previewText || "",
      coverImageUrl: data.cover_media_img_url || data.coverImageUrl || "",
      contents: data.contents || "",
    });
  } catch (err: any) {
    res.status(500).json({ error: `Failed to fetch article: ${err.message}` });
  }
};

export const saveResults: RequestHandler = async (req, res) => {
  const body: TwitterSaveRequest = req.body;
  if (!body?.query || !body?.tweets?.length) {
    res.status(400).json({ error: "query and tweets are required" });
    return;
  }

  let projectSlug = body.projectSlug;

  // Create new project if needed
  if (!projectSlug && body.newProjectName) {
    const slug = body.newProjectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const group = body.newProjectGroup || "";
    projectSlug = group ? `${group}/${slug}` : slug;

    const projectDir = path.join(PROJECTS_DIR, projectSlug);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(
        path.join(projectDir, ".project.json"),
        JSON.stringify({ name: body.newProjectName }, null, 2)
      );
      fs.writeFileSync(
        path.join(projectDir, "draft.md"),
        `# ${body.newProjectName}\n\n`
      );
      fs.mkdirSync(path.join(projectDir, "resources"), { recursive: true });
    }
  }

  if (!projectSlug || !isValidProjectPath(projectSlug)) {
    res.status(400).json({ error: "Valid project slug is required" });
    return;
  }

  const projectDir = path.join(PROJECTS_DIR, projectSlug);
  if (!fs.existsSync(projectDir)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const resourcesDir = path.join(projectDir, "resources");
  if (!fs.existsSync(resourcesDir)) {
    fs.mkdirSync(resourcesDir, { recursive: true });
  }

  const filePath = path.join(resourcesDir, "twitter-research.json");

  // Merge with existing results if any
  let existing: { searches: any[] } = { searches: [] };
  if (fs.existsSync(filePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {}
  }

  existing.searches.push({
    query: body.query,
    savedAt: new Date().toISOString(),
    tweetCount: body.tweets.length,
    tweets: body.tweets,
  });

  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf-8");

  res.json({
    success: true,
    projectSlug,
    filePath: "resources/twitter-research.json",
  });
};

export const previewLink: RequestHandler = async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url parameter is required" });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LinkPreview/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const finalUrl = response.url;
    const status = response.status;

    // If it's a 404 or other error, we might still want to return a basic object
    // but without trying to parse HTML if it's not HTML or we don't care
    const html = response.headers.get('content-type')?.includes('text/html') ? await response.text() : "";
    const domain = new URL(finalUrl || url).hostname.replace(/^www\./, "");

    // Extract metadata from HTML
    const titleMatch =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i);

    const descMatch =
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i) ||
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);

    const imageMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

    const preview: LinkPreviewData = {
      url: finalUrl || url,
      title: titleMatch?.[1]?.trim() || domain,
      description: descMatch?.[1]?.trim() || "",
      image: imageMatch?.[1]?.trim() || undefined,
      domain,
      status,
    };

    res.json(preview);
  } catch (err: any) {
    if (err.name === "AbortError") {
      res.status(504).json({ error: "Timed out fetching URL" });
      return;
    }
    res.status(500).json({ error: `Failed to fetch URL: ${err.message}` });
  }
};

export const fetchAsMarkdown: RequestHandler = async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url parameter is required" });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      res.status(502).json({ error: `Failed to fetch URL (${response.status})` });
      return;
    }

    const html = await response.text();
    const markdown = htmlToMarkdown(html, response.url);
    res.json({ markdown, url: response.url });
  } catch (err: any) {
    if (err.name === "AbortError") {
      res.status(504).json({ error: "Timed out fetching URL" });
      return;
    }
    res.status(500).json({ error: `Failed to fetch URL: ${err.message}` });
  }
};

function htmlToMarkdown(html: string, sourceUrl: string): string {
  let content = html;

  content = content.replace(/<script[\s\S]*?<\/script>/gi, "");
  content = content.replace(/<style[\s\S]*?<\/style>/gi, "");
  content = content.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  content = content.replace(/<!--[\s\S]*?-->/g, "");

  const mainMatch =
    content.match(/<article[\s\S]*?<\/article>/i) ||
    content.match(/<main[\s\S]*?<\/main>/i) ||
    content.match(/<div[^>]+(?:class|id)=["'][^"']*(?:content|article|post|entry|main)[\s\S]*?<\/div>/i);

  if (mainMatch) {
    content = mainMatch[0];
  } else {
    const bodyMatch = content.match(/<body[\s\S]*?<\/body>/i);
    if (bodyMatch) content = bodyMatch[0];
  }

  content = content.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  content = content.replace(/<header[\s\S]*?<\/header>/gi, "");
  content = content.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  content = content.replace(/<aside[\s\S]*?<\/aside>/gi, "");

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const title = ogTitle?.[1]?.trim() || titleMatch?.[1]?.trim() || "";

  content = content.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n\n");
  content = content.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n\n");
  content = content.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n\n");
  content = content.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n\n");
  content = content.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n\n");
  content = content.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n\n");

  content = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n\n");
  content = content.replace(/<br\s*\/?>/gi, "\n");
  content = content.replace(/<hr\s*\/?>/gi, "\n---\n\n");

  content = content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  content = content.replace(/<\/?[ou]l[^>]*>/gi, "\n");

  content = content.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  content = content.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**");
  content = content.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*");

  content = content.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  content = content.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n\n");

  content = content.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) => {
    return inner
      .split("\n")
      .map((line: string) => `> ${line}`)
      .join("\n") + "\n\n";
  });

  content = content.replace(
    /<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']*?)["'][^>]*\/?>/gi,
    "![$2]($1)\n"
  );
  content = content.replace(/<img[^>]+src=["']([^"']+)["'][^>]*\/?>/gi, "![]($1)\n");

  content = content.replace(/<[^>]+>/g, "");

  content = content
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&mdash;/g, "---")
    .replace(/&ndash;/g, "--")
    .replace(/&hellip;/g, "...");

  content = content.replace(/\n{3,}/g, "\n\n");
  content = content.replace(/[ \t]+/g, " ");
  content = content.trim();

  let markdown = "";
  if (title) {
    markdown += `# ${title}\n\n`;
    markdown += `Source: ${sourceUrl}\n\n---\n\n`;
  }
  markdown += content;

  return markdown;
}
