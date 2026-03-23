/**
 * Search for images using Google Custom Search API.
 *
 * Usage:
 *   pnpm script image-search --query "builder.io logo"
 *   pnpm script image-search --query "dark abstract background" --count 6
 *
 * Options:
 *   --query   Search query (required)
 *   --count   Number of results (default: 12, max: 12)
 *   --help    Show this help
 */

const config = async () => {
  try {
    const m = await import("dotenv");
    m.config();
  } catch {}
};

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

export default async function main(args: string[]) {
  await config();

  const parsed = parseArgs(args);

  if (parsed.help) {
    console.log(
      `
Image Search - Find images via Google Custom Search

Usage:
  pnpm script image-search --query "search terms"

Options:
  --query   Search query (required)
  --count   Number of results (default: 12, max: 12)
  --help    Show this help

Requires GOOGLE_API_KEY and GOOGLE_SEARCH_CX environment variables.
    `.trim(),
    );
    return;
  }

  const query = parsed.query;
  if (!query) {
    console.error("Error: --query is required");
    console.error('Usage: pnpm script image-search --query "search terms"');
    process.exit(1);
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;

  if (!apiKey || !cx) {
    console.error(
      "Error: GOOGLE_API_KEY and GOOGLE_SEARCH_CX environment variables are required.",
    );
    console.error("");
    console.error("To set up Google Custom Search:");
    console.error("1. Go to https://console.cloud.google.com/apis/credentials");
    console.error("2. Create an API key");
    console.error(
      "3. Enable 'Custom Search API' at https://console.cloud.google.com/apis/library/customsearch.googleapis.com",
    );
    console.error(
      "4. Create a search engine at https://programmablesearchengine.google.com/",
    );
    console.error("5. Enable 'Search the entire web' and 'Image search'");
    console.error("6. Set GOOGLE_API_KEY and GOOGLE_SEARCH_CX env vars");
    process.exit(1);
  }

  const count = Math.min(parseInt(parsed.count || "10"), 10);

  console.log(`Searching for: "${query}" (${count} results)...`);

  const params = new URLSearchParams({
    key: apiKey,
    cx,
    q: query,
    searchType: "image",
    num: String(count),
    safe: "active",
  });

  const response = await fetch(
    `https://www.googleapis.com/customsearch/v1?${params}`,
  );
  if (!response.ok) {
    const text = await response.text();
    console.error("Google API error:", text);
    process.exit(1);
  }

  const data = await response.json();
  const results = (data.items || []).map((item: any, i: number) => ({
    index: i + 1,
    url: item.link,
    title: item.title,
    width: item.image?.width,
    height: item.image?.height,
    thumbnail: item.image?.thumbnailLink,
  }));

  if (results.length === 0) {
    console.log("No results found.");
    return;
  }

  console.log(`\nFound ${results.length} images:\n`);
  for (const r of results) {
    console.log(`${r.index}. ${r.title}`);
    console.log(`   URL: ${r.url}`);
    console.log(`   Size: ${r.width}x${r.height}`);
    console.log("");
  }

  // Output JSON for programmatic use
  console.log("---JSON---");
  console.log(JSON.stringify(results, null, 2));
}
