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
    console.log(`Usage: pnpm script get-twitter-article --tweet-id <id>

Options:
  --tweet-id    The tweet ID containing the article (required)`);
    return;
  }

  const { tweetId } = opts;
  if (!tweetId) fail("--tweet-id is required");

  const apiKey = process.env.TWITTER_API_KEY || "";
  if (!apiKey) fail("TWITTER_API_KEY not set");

  const response = await fetchWithRetry(
    `${TWITTER_API_BASE}/twitter/article?tweet_id=${encodeURIComponent(tweetId)}`,
    { "x-api-key": apiKey },
  );

  if (!response.ok) {
    const text = await response.text();
    fail(`Twitter API error: ${text}`);
  }

  const data = await response.json();
  const article = {
    title: data.title || "",
    previewText: data.preview_text || data.previewText || "",
    coverImageUrl: data.cover_media_img_url || data.coverImageUrl || "",
    contents: data.contents || "",
  };

  let output = `# ${article.title}\n\n`;
  if (article.previewText) output += `${article.previewText}\n\n`;
  if (article.contents) output += article.contents;

  console.log(output);
}
