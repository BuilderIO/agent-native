import { loadEnv, parseArgs, fail } from "./_utils.js";

export default async function main(args: string[]) {
  loadEnv();
  const opts = parseArgs(args);

  if (opts["help"]) {
    console.log(`Usage: pnpm script preview-link --url <url>

Options:
  --url    The URL to preview (required)`);
    return;
  }

  const url = opts["url"];
  if (!url) fail("--url is required");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

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
  const html = await response.text();
  const domain = new URL(finalUrl).hostname.replace(/^www\./, "");

  const titleMatch =
    html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    ) ||
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    ) ||
    html.match(/<title[^>]*>([^<]+)<\/title>/i);

  const descMatch =
    html.match(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    ) ||
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i,
    ) ||
    html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    ) ||
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
    );

  const imageMatch =
    html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    ) ||
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    );

  const title = titleMatch?.[1]?.trim() || domain;
  const description = descMatch?.[1]?.trim() || "";
  const image = imageMatch?.[1]?.trim() || undefined;

  let output = `${title}\n${domain}\n`;
  if (description) output += `\n${description}\n`;
  if (image) output += `\nImage: ${image}\n`;
  output += `\nURL: ${finalUrl}`;

  console.log(output);
}
