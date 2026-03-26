import { parseArgs } from "@agent-native/core/scripts";

export default async function webFetch(args: string[]) {
  const { url, output } = parseArgs(args);

  if (!url) {
    console.error("Usage: pnpm script web-fetch --url 'https://example.com' [--output data/page.md]");
    process.exit(1);
  }

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`HTTP ${response.status}: ${response.statusText}`);
      process.exit(1);
    }

    const html = await response.text();
    const text = htmlToMarkdown(html);

    if (output) {
      const fs = await import("node:fs/promises");
      const nodePath = await import("node:path");
      await fs.mkdir(nodePath.dirname(output), { recursive: true });
      await fs.writeFile(output, text);
      console.log(`Saved to ${output} (${text.length} chars)`);
    } else {
      console.log(text);
    }
  } catch (err: any) {
    console.error("Fetch failed:", err.message);
    process.exit(1);
  }
}

function htmlToMarkdown(html: string): string {
  let text = html;
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");
  text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "\n# $1\n");
  text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n");
  text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n");
  text = text.replace(/<p[^>]*>(.*?)<\/p>/gi, "\n$1\n");
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1");
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");
  text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**");
  text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}
