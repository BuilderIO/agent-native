import { loadEnv, parseArgs, fail } from "./_utils.js";

export default async function main(args: string[]) {
  loadEnv();
  const opts = parseArgs(args);

  if (opts["help"]) {
    console.log(`Usage: pnpm script fetch-url-as-markdown --url <url>

Options:
  --url    The URL to fetch and convert to markdown (required)`);
    return;
  }

  const url = opts["url"];
  if (!url) fail("--url is required");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) fail(`Failed to fetch URL (${response.status}): ${url}`);

  const html = await response.text();
  const markdown = htmlToMarkdown(html, response.url);
  console.log(markdown);
}

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
    return inner.split("\n").map((line: string) => `> ${line}`).join("\n") + "\n\n";
  });

  content = content.replace(/<img[^>]+src=["']([^"']+)["'][^>]*alt=["']([^"']*?)["'][^>]*\/?>/gi, "![$2]($1)\n");
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
    markdown += `# ${title}\n\nSource: ${sourceUrl}\n\n---\n\n`;
  }
  markdown += content;

  return markdown;
}
