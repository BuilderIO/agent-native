import {
  type AgentWebConfig,
  type AgentWebCrawlerCategory,
  resolveAgentWebCrawlerPolicy,
} from "./config.js";

export interface AgentWebPage {
  path: string;
  title: string;
  description?: string;
  markdown?: string;
  markdownPath?: string;
  lastmod?: string | Date;
}

export interface BuildAgentWebStaticFilesOptions {
  siteName: string;
  siteUrl: string;
  description?: string;
  pages: AgentWebPage[];
  config: AgentWebConfig;
  organization?: {
    name: string;
    url?: string;
    sameAs?: string[];
  };
}

export interface AgentWebStaticFile {
  path: string;
  content: string;
}

export interface MarkdownResponseHeadersOptions {
  siteUrl: string;
  pagePath: string;
  markdownPath?: string;
  markdown: string;
}

export const AGENT_WEB_CRAWLER_USER_AGENTS: Record<
  AgentWebCrawlerCategory,
  string[]
> = {
  training: [
    "GPTBot",
    "ClaudeBot",
    "CCBot",
    "Google-Extended",
    "Applebot-Extended",
    "Bytespider",
    "Meta-ExternalAgent",
    "Amazonbot",
  ],
  search: ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot", "YouBot"],
  userTriggered: ["ChatGPT-User", "Claude-User", "Perplexity-User"],
  codingAgents: ["Claude-Code", "Gemini-CLI", "Devin", "OpenHands"],
  autonomousAgents: ["ChatGPT-Agent", "Operator", "Gemini-Deep-Research"],
};

export function buildAgentWebStaticFiles(
  options: BuildAgentWebStaticFilesOptions,
): AgentWebStaticFile[] {
  const files: AgentWebStaticFile[] = [
    {
      path: "robots.txt",
      content: buildRobotsTxt({
        siteUrl: options.siteUrl,
        config: options.config,
      }),
    },
    {
      path: "sitemap.xml",
      content: buildSitemapXml(options.pages, options.siteUrl),
    },
  ];

  if (options.config.llmsTxt) {
    files.push({
      path: "llms.txt",
      content: buildLlmsTxt(options),
    });
    files.push({
      path: "llms-full.txt",
      content: buildLlmsFullTxt(options),
    });
  }

  if (options.config.markdownTwins) {
    for (const page of options.pages) {
      if (!page.markdown) continue;
      files.push({
        path: markdownFilePathForPage(page.path, page.markdownPath),
        content: page.markdown,
      });
    }
  }

  return files;
}

export function buildRobotsTxt(options: {
  siteUrl: string;
  config: Pick<AgentWebConfig, "crawlerPolicy" | "crawlers">;
  sitemapPath?: string;
}): string {
  const decisions = resolveAgentWebCrawlerPolicy(options.config);
  const lines: string[] = [
    "# Agent Web crawler policy",
    `# Preset: ${options.config.crawlerPolicy}`,
    "",
  ];

  for (const [category, userAgents] of Object.entries(
    AGENT_WEB_CRAWLER_USER_AGENTS,
  ) as [AgentWebCrawlerCategory, string[]][]) {
    lines.push(`# ${category}: ${decisions[category]}`);
    for (const userAgent of userAgents) {
      lines.push(`User-agent: ${userAgent}`);
    }
    lines.push(decisions[category] === "allow" ? "Allow: /" : "Disallow: /");
    lines.push("");
  }

  lines.push("User-agent: *", "Allow: /", "");
  lines.push(
    `Sitemap: ${absoluteUrl(options.siteUrl, options.sitemapPath ?? "/sitemap.xml")}`,
  );

  return `${lines.join("\n")}\n`;
}

export function buildSitemapXml(
  pages: AgentWebPage[],
  siteUrl: string,
): string {
  const entries = pages
    .map((page) => {
      const lines = [
        "  <url>",
        `    <loc>${xmlEscape(absoluteUrl(siteUrl, page.path))}</loc>`,
      ];
      const lastmod = normalizeLastmod(page.lastmod);
      if (lastmod) lines.push(`    <lastmod>${xmlEscape(lastmod)}</lastmod>`);
      lines.push("  </url>");
      return lines.join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

export function buildLlmsTxt(
  options: Omit<BuildAgentWebStaticFilesOptions, "config">,
): string {
  const lines = [
    `# ${options.siteName}`,
    "",
    options.description ? `> ${options.description}` : undefined,
    options.description ? "" : undefined,
    "## Pages",
    ...options.pages.map((page) => {
      const description = page.description ? `: ${page.description}` : "";
      return `- [${page.title}](${absoluteUrl(options.siteUrl, page.path)})${description}`;
    }),
    "",
    "## Markdown",
    ...options.pages
      .filter((page) => page.markdown)
      .map(
        (page) =>
          `- [${page.title}](${absoluteUrl(
            options.siteUrl,
            markdownUrlForPage(page.path, page.markdownPath),
          )})`,
      ),
  ].filter((line): line is string => typeof line === "string");

  return `${lines.join("\n")}\n`;
}

export function buildLlmsFullTxt(
  options: Omit<BuildAgentWebStaticFilesOptions, "config">,
): string {
  const lines = [
    `# ${options.siteName}`,
    "",
    options.description ?? "",
    "",
    ...options.pages.flatMap((page) => [
      `## ${page.title}`,
      "",
      `Source: ${absoluteUrl(options.siteUrl, page.path)}`,
      page.markdown
        ? `Markdown: ${absoluteUrl(
            options.siteUrl,
            markdownUrlForPage(page.path, page.markdownPath),
          )}`
        : undefined,
      page.description ? `Description: ${page.description}` : undefined,
      "",
      page.markdown ?? "",
      "",
    ]),
  ].filter((line): line is string => typeof line === "string");

  return `${lines.join("\n").replace(/\n{4,}/g, "\n\n\n")}\n`;
}

export function buildBaseJsonLd(options: {
  siteName: string;
  siteUrl: string;
  description?: string;
  organization?: {
    name: string;
    url?: string;
    sameAs?: string[];
  };
}) {
  const siteUrl = trimTrailingSlash(options.siteUrl);
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: options.organization?.name ?? options.siteName,
      url: options.organization?.url ?? siteUrl,
      ...(options.organization?.sameAs?.length
        ? { sameAs: options.organization.sameAs }
        : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: options.siteName,
      url: siteUrl,
      ...(options.description ? { description: options.description } : {}),
    },
  ];
}

export function buildPageJsonLd(options: {
  siteName: string;
  siteUrl: string;
  page: AgentWebPage;
}) {
  const breadcrumbs = breadcrumbItemsForPath(options.page.path);
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: options.page.title,
      url: absoluteUrl(options.siteUrl, options.page.path),
      ...(options.page.description
        ? { description: options.page.description }
        : {}),
      isPartOf: {
        "@type": "WebSite",
        name: options.siteName,
        url: trimTrailingSlash(options.siteUrl),
      },
    },
    ...(breadcrumbs.length > 1
      ? [
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: breadcrumbs.map((item, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: item.name,
              item: absoluteUrl(options.siteUrl, item.path),
            })),
          },
        ]
      : []),
  ];
}

export function buildMarkdownResponseHeaders(
  options: MarkdownResponseHeadersOptions,
): Record<string, string> {
  return {
    "content-type": "text/markdown; charset=utf-8",
    "x-markdown-tokens": String(estimateMarkdownTokens(options.markdown)),
    link: `<${absoluteUrl(options.siteUrl, "/llms.txt")}>; rel="llms-txt", <${absoluteUrl(
      options.siteUrl,
      markdownUrlForPage(options.pagePath, options.markdownPath),
    )}>; rel="alternate"; type="text/markdown"`,
  };
}

export function estimateMarkdownTokens(markdown: string): number {
  const trimmed = markdown.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export function markdownUrlForPage(
  pagePath: string,
  markdownPath?: string,
): string {
  if (markdownPath) return normalizePagePath(markdownPath);
  const normalized = normalizePagePath(pagePath);
  if (normalized === "/") return "/index.md";
  return `${normalized}.md`;
}

export function markdownFilePathForPage(
  pagePath: string,
  markdownPath?: string,
): string {
  return markdownUrlForPage(pagePath, markdownPath).replace(/^\//, "");
}

export function absoluteUrl(siteUrl: string, pagePath: string): string {
  const base = trimTrailingSlash(siteUrl);
  const path = normalizePagePath(pagePath);
  return `${base}${path}`;
}

function normalizePagePath(pagePath: string): string {
  const withSlash = pagePath.startsWith("/") ? pagePath : `/${pagePath}`;
  if (withSlash.length > 1 && withSlash.endsWith("/")) {
    return withSlash.slice(0, -1);
  }
  return withSlash;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeLastmod(
  value: string | Date | undefined,
): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return parsed.toISOString().slice(0, 10);
}

function breadcrumbItemsForPath(
  pagePath: string,
): { name: string; path: string }[] {
  const normalized = normalizePagePath(pagePath);
  if (normalized === "/") return [{ name: "Home", path: "/" }];
  const segments = normalized.split("/").filter(Boolean);
  const items = [{ name: "Home", path: "/" }];
  let current = "";
  for (const segment of segments) {
    current += `/${segment}`;
    items.push({
      name: titleFromSegment(segment),
      path: current,
    });
  }
  return items;
}

function titleFromSegment(segment: string): string {
  return segment
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
