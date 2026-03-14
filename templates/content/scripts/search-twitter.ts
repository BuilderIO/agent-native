import { loadEnv, parseArgs, camelCaseArgs, fail } from "./_utils.js";

const TWITTER_API_BASE = "https://api.twitterapi.io";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 6000;

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  retries = MAX_RETRIES,
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(url, { headers });
    if (response.status === 429 && attempt < retries) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }
    return response;
  }
  return fetch(url, { headers });
}

export default async function main(args: string[]) {
  loadEnv();
  const raw = parseArgs(args);
  const opts = camelCaseArgs(raw);

  if (raw["help"]) {
    console.log(`Usage: pnpm script search-twitter --query "..." [options]

Options:
  --query       Search query (required)
  --query-type  Sort: Top or Latest (default: Top)
  --filter      Filter: articles, links, or media
  --cursor      Pagination cursor from previous search`);
    return;
  }

  const { query, queryType, filter, cursor } = opts;
  if (!query) fail("--query is required");

  const apiKey = process.env.TWITTER_API_KEY || "";
  if (!apiKey) fail("TWITTER_API_KEY not set");

  const params = new URLSearchParams({ query });
  if (queryType) params.set("queryType", queryType);
  if (cursor) params.set("cursor", cursor);

  const url = `${TWITTER_API_BASE}/twitter/tweet/advanced_search?${params}`;
  const response = await fetchWithRetry(url, { "x-api-key": apiKey });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 429)
      fail("Rate limited by Twitter API. Wait a few seconds and try again.");
    fail(`Twitter API error (${response.status}): ${text}`);
  }

  const data = await response.json();

  const tweets = (data.tweets || []).map((t: any) => ({
    id: t.id,
    url: t.url,
    text: t.text,
    createdAt: t.createdAt,
    likeCount: t.likeCount || 0,
    retweetCount: t.retweetCount || 0,
    replyCount: t.replyCount || 0,
    quoteCount: t.quoteCount || 0,
    viewCount: t.viewCount || 0,
    bookmarkCount: t.bookmarkCount || 0,
    media:
      t.extendedEntities?.media?.map((m: any) => ({
        type: m.type,
        url: m.media_url_https || m.url,
      })) ||
      t.media?.map((m: any) => ({
        type: m.type || "photo",
        url: m.media_url_https || m.url,
      })) ||
      undefined,
    author: {
      userName: t.author?.userName,
      name: t.author?.name,
      followers: t.author?.followers,
      isBlueVerified: t.author?.isBlueVerified,
    },
    article: t.article
      ? {
          title: t.article.title || "",
          previewText: t.article.preview_text || t.article.previewText || "",
        }
      : undefined,
  }));

  // Apply filters
  let filtered = tweets;
  if (filter === "articles")
    filtered = tweets.filter((t: any) => t.article != null);
  else if (filter === "links")
    filtered = tweets.filter((t: any) => /https?:\/\/t\.co\/\w+/.test(t.text));
  else if (filter === "media")
    filtered = tweets.filter((t: any) => t.media && t.media.length > 0);

  // Sort by engagement for Top
  if (!queryType || queryType === "Top") {
    filtered.sort((a: any, b: any) => {
      const scoreA = a.likeCount + a.retweetCount * 2 + a.bookmarkCount * 3;
      const scoreB = b.likeCount + b.retweetCount * 2 + b.bookmarkCount * 3;
      return scoreB - scoreA;
    });
  }

  const nextCursor = data.next_cursor || data.nextCursor || null;
  const hasNextPage =
    data.has_next_page ?? data.hasNextPage ?? !!data.next_cursor;

  let output = `Found ${filtered.length} tweets for "${query}"`;
  if (filter) output += ` (filter: ${filter})`;
  output += "\n\n";

  for (const tweet of filtered.slice(0, 20)) {
    output += "---\n";
    output += `@${tweet.author.userName} (${tweet.author.name})`;
    if (tweet.author.isBlueVerified) output += " [verified]";
    output += "\n";
    output += `${tweet.text}\n`;
    output += `Likes: ${tweet.likeCount} | RT: ${tweet.retweetCount} | Views: ${tweet.viewCount} | Bookmarks: ${tweet.bookmarkCount}\n`;
    if (tweet.article) output += `Article: ${tweet.article.title}\n`;
    output += `URL: ${tweet.url}\n\n`;
  }

  if (hasNextPage && nextCursor) {
    output += `\n[More results available — use --cursor "${nextCursor}"]`;
  }

  console.log(output);
}
