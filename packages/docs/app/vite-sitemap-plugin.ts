import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import type { Plugin } from "vite";
import {
  buildSitemapXml as buildAgentWebSitemapXml,
  type AgentWebPage,
} from "../../core/src/agent-web/index";
import { createAgentWebVitePlugin } from "../../core/src/vite/agent-web-plugin";

export const SITE_URL = "https://www.agent-native.com";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Returns the last git commit date for a file path, falling back to fs mtime
 * when git is unavailable (non-git contexts such as Docker/CI without history).
 */
function gitLastmod(filePath: string): Date {
  try {
    const iso = execSync(`git log -1 --format=%cI -- "${filePath}"`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (iso) return new Date(iso);
  } catch {
    // git unavailable or not a git repo — fall through
  }
  return fs.statSync(filePath).mtime;
}

/**
 * Vite plugin that auto-generates the public agent-web surface for the docs:
 * sitemap.xml, robots.txt, llms files, and Markdown mirrors for crawlable docs.
 */
export function sitemapPlugin(): Plugin {
  const rootDir = path.resolve(__dirname, "..");
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(rootDir, "package.json"), "utf8"),
  );
  return createAgentWebVitePlugin({
    siteName: "Agent-Native",
    siteUrl: SITE_URL,
    description:
      "Open source framework for building apps where AI agents and UI share one state model.",
    pages: () => buildAgentWebPages(rootDir),
    agentWeb: pkg["agent-native"]?.workspaceApp?.agentWeb,
    outputDirs: ["build/client", "dist", "dist/client", "dist/server/public"],
    organization: {
      name: "Builder.io",
      url: "https://builder.io",
      sameAs: ["https://github.com/BuilderIO/agent-native"],
    },
  }) as unknown as Plugin;
}

export function buildSitemapPaths(rootDir: string): string[] {
  return buildAgentWebPages(rootDir).map((page) => page.path);
}

export function buildAgentWebPages(rootDir: string): AgentWebPage[] {
  const docsDir = path.resolve(rootDir, "../core/docs/content");
  const templateCardPath = path.resolve(
    rootDir,
    "app/components/TemplateCard.tsx",
  );

  const docsPages = fs
    .readdirSync(docsDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => {
      const slug = name.replace(/\.md$/, "");
      const filePath = path.join(docsDir, name);
      const raw = fs.readFileSync(filePath, "utf8");
      const { data, body } = parseFrontmatter(raw);
      return {
        path: slug === "getting-started" ? "/docs" : `/docs/${slug}`,
        title: data.title || titleFromSlug(slug),
        description: data.description,
        markdown: body.trim() + "\n",
        markdownPath: `/docs/${slug}.md`,
        lastmod: gitLastmod(filePath),
      } satisfies AgentWebPage;
    });

  const templateSource = fs.readFileSync(templateCardPath, "utf8");
  const templatePages = parseTemplatePages(templateSource).map((template) => ({
    path: `/templates/${template.slug}`,
    title: `${template.name} template`,
    description: template.description,
    markdown: [
      `# ${template.name} template`,
      "",
      template.description,
      "",
      `- Replaces or augments: ${template.replaces}`,
      `- CLI: \`${template.cliCommand}\``,
      template.demoUrl ? `- Demo: ${template.demoUrl}` : undefined,
      `- Source: https://github.com/BuilderIO/agent-native/tree/main/templates/${
        template.slug === "video" ? "videos" : template.slug
      }`,
      "",
    ]
      .filter((line): line is string => typeof line === "string")
      .join("\n"),
    lastmod: gitLastmod(templateCardPath),
  }));

  return sortPages([
    {
      path: "/",
      title: "Agent-Native",
      description:
        "Framework for building agentic apps where AI agents and UI share the same database and state.",
      markdown: `# Agent-Native

Agent-Native is an open source framework for building apps where AI agents and UI share the same database, actions, and application state.
`,
      lastmod: gitLastmod(path.resolve(rootDir, "app/routes/_index.tsx")),
    },
    {
      path: "/download",
      title: "Download Agent Native",
      description: "Download the Agent Native desktop app.",
      markdown:
        "# Download Agent Native\n\nDownload the Agent Native desktop app.\n",
      lastmod: gitLastmod(path.resolve(rootDir, "app/routes/download.tsx")),
    },
    {
      path: "/privacy",
      title: "Agent-Native Privacy Policy",
      description:
        "Privacy policy for Agent-Native hosted applications, templates, and browser extensions.",
      markdown:
        "# Agent-Native Privacy Policy\n\nPrivacy policy for Agent-Native hosted applications, templates, and browser extensions. Chrome extension disclosures are included at `/privacy#clips-chrome-extension`.\n",
      lastmod: gitLastmod(path.resolve(rootDir, "app/routes/privacy.tsx")),
    },
    {
      path: "/terms",
      title: "Agent-Native Terms of Service",
      description:
        "Terms of Service for Agent-Native hosted applications, templates, demos, and official hosted services.",
      markdown:
        "# Agent-Native Terms of Service\n\nTerms of Service for Agent-Native hosted applications, templates, demos, and official hosted services.\n",
      lastmod: gitLastmod(path.resolve(rootDir, "app/routes/terms.tsx")),
    },
    {
      path: "/templates",
      title: "Agent-Native Templates",
      description: "Ready-to-fork app templates built with Agent-Native.",
      markdown:
        "# Agent-Native Templates\n\nReady-to-fork app templates built with Agent-Native.\n",
      lastmod: gitLastmod(path.resolve(rootDir, "app/routes/templates.tsx")),
    },
    {
      path: "/skills",
      title: "Agent Skills",
      description:
        "Install app-backed skills your coding agent runs as slash commands: /visual-plan and /visual-recap.",
      markdown:
        "# Agent Skills\n\nInstall app-backed skills your coding agent runs as slash commands. `/visual-plan` opens structured visual plans before you build; `/visual-recap` turns a PR diff into a high-altitude review. Install with `npx @agent-native/core@latest skills add visual-plan`.\n",
      lastmod: gitLastmod(path.resolve(rootDir, "app/routes/skills.tsx")),
    },
    ...docsPages,
    ...templatePages,
  ]);
}

export function buildSitemapXml(paths: string[]): string {
  return buildAgentWebSitemapXml(
    paths.map((pagePath) => ({
      path: pagePath,
      title: titleFromSlug(pagePath),
    })),
    SITE_URL,
  );
}

function parseFrontmatter(raw: string): {
  data: Record<string, string>;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };

  const data: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    if (m) data[m[1]] = m[2];
  }
  return { data, body: match[2] };
}

function parseTemplatePages(source: string): {
  name: string;
  slug: string;
  replaces: string;
  cliCommand: string;
  demoUrl?: string;
  description: string;
}[] {
  const pages: {
    name: string;
    slug: string;
    replaces: string;
    cliCommand: string;
    demoUrl?: string;
    description: string;
  }[] = [];
  const objectPattern = /\{\s*name:\s*"([^"]+)"([\s\S]*?)\n\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = objectPattern.exec(source)) !== null) {
    const block = `name: "${match[1]}"${match[2]}`;
    const slug = readStringField(block, "slug");
    const replaces = readStringField(block, "replaces");
    const cliCommand = readStringField(block, "cliCommand");
    const description = readStringField(block, "description");
    if (!slug || !replaces || !cliCommand || !description) continue;
    pages.push({
      name: match[1],
      slug,
      replaces,
      cliCommand,
      description,
      demoUrl: readStringField(block, "demoUrl"),
    });
  }
  return pages;
}

function readStringField(source: string, field: string): string | undefined {
  const match = source.match(new RegExp(`${field}:\\s*"([^"]+)"`));
  return match?.[1];
}

function sortPages(pages: AgentWebPage[]): AgentWebPage[] {
  const seen = new Set<string>();
  return pages
    .filter((page) => {
      if (seen.has(page.path)) return false;
      seen.add(page.path);
      return true;
    })
    .sort((a, b) => {
      if (a.path === "/") return -1;
      if (b.path === "/") return 1;
      return a.path.localeCompare(b.path);
    });
}

function titleFromSlug(slug: string): string {
  const normalized =
    slug
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .pop() || "Home";
  return normalized
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
