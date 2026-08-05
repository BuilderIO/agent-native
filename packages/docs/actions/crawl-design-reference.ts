import { defineAction } from "@agent-native/core/action";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { z } from "zod";

const MAX_HTML_BYTES = 512_000;
const MAX_CSS_BYTES = 192_000;
const MAX_STYLESHEETS = 3;

async function readBoundedText(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new Error("That page is too large to inspect.");
  }

  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error("That page is too large to inspect.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    );
}

function cleanText(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function getTagAttribute(tag: string, attribute: string) {
  const match = tag.match(
    new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, "i"),
  );
  return match?.[1]?.trim() ?? "";
}

function getMetaContent(html: string, names: string[]) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const name = (
      getTagAttribute(tag, "name") || getTagAttribute(tag, "property")
    ).toLowerCase();
    if (names.includes(name)) return getTagAttribute(tag, "content");
  }
  return "";
}

function truncateWords(value: string, maxWords: number) {
  return cleanText(value).split(/\s+/).filter(Boolean).slice(0, maxWords).join(" ");
}

function normalizeColor(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return /^(#[\da-f]{3,8}|(?:rgb|hsl)a?\([^)]{3,80}\))$/i.test(trimmed)
    ? trimmed
    : null;
}

function findCustomProperty(css: string, names: RegExp[]) {
  for (const name of names) {
    const match = css.match(
      new RegExp(`--[\\w-]*${name.source}[\\w-]*\\s*:\\s*([^;}{]+)`, "i"),
    );
    const color = normalizeColor(match?.[1]);
    if (color) return color;
  }
  return null;
}

function findColors(css: string, themeColor: string) {
  const candidates = [
    ...css.matchAll(/#[\da-f]{6}\b|#[\da-f]{3}\b|(?:rgb|hsl)a?\([^)]{3,80}\)/gi),
  ]
    .map((match) => normalizeColor(match[0]))
    .filter((value): value is string => Boolean(value));
  const unique = [...new Set(candidates)];
  const primary =
    findCustomProperty(css, [/primary/, /brand/, /main/]) ||
    normalizeColor(themeColor) ||
    unique[0] ||
    null;
  const accent =
    findCustomProperty(css, [/accent/, /highlight/, /secondary/]) ||
    unique.find((color) => color !== primary) ||
    null;
  return { primary, accent };
}

function cleanFontFamily(value: string | undefined) {
  return (
    value
      ?.split(",")[0]
      ?.replace(/["']/g, "")
      .trim() || null
  );
}

function findFont(css: string, selectors: RegExp[]) {
  for (const selector of selectors) {
    const match = css.match(
      new RegExp(`${selector.source}[^{}]*\\{[^{}]*font-family\\s*:\\s*([^;}]+)`, "i"),
    );
    const font = cleanFontFamily(match?.[1]);
    if (font) return font;
  }
  return null;
}

async function fetchText(url: string, maxBytes: number) {
  const response = await ssrfSafeFetch(
    url,
    {
      headers: {
        accept: "text/html,text/css;q=0.9",
        "user-agent": "Agent-Native-Design-Reference/1.0",
      },
      signal: AbortSignal.timeout(8_000),
    },
    { maxRedirects: 3 },
  );
  if (!response.ok) throw new Error(`That URL returned ${response.status}.`);
  return { response, text: await readBoundedText(response, maxBytes) };
}

export default defineAction({
  description:
    "Inspect a public website and return bounded visual style metadata for a slide-deck prompt.",
  schema: z.object({
    url: z.string().url().max(2_048),
  }),
  outputSchema: z.object({
    title: z.string(),
    description: z.string(),
    primaryColor: z.string().nullable(),
    accentColor: z.string().nullable(),
    headingFont: z.string().nullable(),
    bodyFont: z.string().nullable(),
  }),
  outputErrorStrategy: "strict",
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  agentTool: false,
  run: async ({ url }) => {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error("Enter a public HTTP or HTTPS URL.");
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error("URLs with embedded credentials are not supported.");
    }

    const { response, text: html } = await fetchText(parsedUrl.href, MAX_HTML_BYTES);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error("That URL did not return a web page.");
    }

    const title = cleanText(
      getMetaContent(html, ["og:title", "twitter:title"]) ||
        html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
        parsedUrl.hostname,
    ).slice(0, 120);
    const description = truncateWords(
      getMetaContent(html, ["description", "og:description", "twitter:description"]),
      14,
    );
    const themeColor = getMetaContent(html, ["theme-color"]);
    const inlineCss = (html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) ?? [])
      .map((style) => style.replace(/^<style\b[^>]*>|<\/style>$/gi, ""))
      .join("\n");
    const stylesheetUrls = (html.match(/<link\b[^>]*>/gi) ?? [])
      .filter((tag) => /rel\s*=\s*["'][^"']*stylesheet/i.test(tag))
      .map((tag) => getTagAttribute(tag, "href"))
      .filter(Boolean)
      .slice(0, MAX_STYLESHEETS)
      .map((href) => new URL(href, response.url || parsedUrl.href).href);

    const externalCss = await Promise.all(
      stylesheetUrls.map(async (stylesheetUrl) => {
        try {
          return (await fetchText(stylesheetUrl, MAX_CSS_BYTES)).text;
        } catch {
          return "";
        }
      }),
    );
    const css = `${inlineCss}\n${externalCss.join("\n")}`;
    const colors = findColors(css, themeColor);
    const bodyFont =
      findFont(css, [/body/, /html/]) ||
      cleanFontFamily(css.match(/--[\w-]*(?:body-)?font[\w-]*\s*:\s*([^;}]+)/i)?.[1]);
    const headingFont =
      findFont(css, [/h1\b/, /h2\b/, /heading/]) ||
      cleanFontFamily(css.match(/--[\w-]*(?:heading|display|title)-font[\w-]*\s*:\s*([^;}]+)/i)?.[1]) ||
      bodyFont;

    return {
      title,
      description,
      primaryColor: colors.primary,
      accentColor: colors.accent,
      headingFont,
      bodyFont,
    };
  },
});
