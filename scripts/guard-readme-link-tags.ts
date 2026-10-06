#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

import {
  execGuardCommand,
  GUARD_EXIT_COULD_NOT_RUN,
} from "./lib/changed-lines.mjs";

const AGENT_NATIVE_HOST = "agent-native.com";
const IGNORED_PATH_RE = /(?:^|\/)(?:node_modules|fixtures?|__snapshots__)\//u;
// Each holds inline content; an HTML anchor opened in one can't span into the next.
const INLINE_CONTAINERS = new Set(["paragraph", "heading", "tableCell"]);
const FIX_HINT =
  "Add ?utm_source=<github|npm>&utm_medium=referral&utm_content=<placement> before any #fragment (github for repo READMEs, npm for published package READMEs, <template>-readme for template placements).";

export interface ReadmeFile {
  path: string;
  text: string;
}

export interface ReadmeLink {
  line: number;
  url: string;
}

export interface UntaggedLink {
  path: string;
  line: number;
  url: string;
}

export function selectReadmePaths(paths: readonly string[]): string[] {
  return paths.filter(
    (file) =>
      path.posix.basename(file) === "README.md" && !IGNORED_PATH_RE.test(file),
  );
}

type MarkdownRoot = ReturnType<typeof fromMarkdown>;
type MarkdownNode = MarkdownRoot | MarkdownRoot["children"][number];
type HtmlNode = DefaultTreeAdapterMap["node"];

/** Every `<a href>` in a piece of raw HTML, with the line its href is on. */
function htmlAnchorLinks(html: string, firstLine: number): ReadmeLink[] {
  const links: ReadmeLink[] = [];
  const visit = (node: HtmlNode) => {
    if ("tagName" in node && node.tagName === "a") {
      const href = node.attrs.find((attr) => attr.name === "href");
      const line = node.sourceCodeLocation?.attrs?.href?.startLine ?? 1;
      if (href) links.push({ line: firstLine + line - 1, url: href.value });
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
    if ("content" in node) visit(node.content);
  };
  visit(parseFragment(html, { sourceCodeLocationInfo: true }));
  return links;
}

/**
 * Every clickable link in a README, whatever its host, as GitHub renders it:
 * code, images, link text, and unused or image-only reference definitions
 * aren't links. Destinations come back decoded, so `&amp;` reads as `&`.
 */
export function findReadmeLinks(text: string): ReadmeLink[] {
  const tree = fromMarkdown(text, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const links: ReadmeLink[] = [];
  const definitions = new Map<string, ReadmeLink>();
  const referenced = new Set<string>();
  // Inside an inline <a>, a bare URL is the anchor's text, not a second link.
  let insideAnchor = false;

  const visit = (node: MarkdownNode, parentLine: number) => {
    const line = node.position?.start.line ?? parentLine;
    if (INLINE_CONTAINERS.has(node.type)) insideAnchor = false;
    switch (node.type) {
      case "link":
        if (!insideAnchor) links.push({ line, url: node.url });
        return;
      case "linkReference":
        referenced.add(node.identifier);
        return;
      case "definition":
        // The first definition of a label is the one references use.
        if (!definitions.has(node.identifier)) {
          definitions.set(node.identifier, { line, url: node.url });
        }
        return;
      case "html":
        links.push(...htmlAnchorLinks(node.value, line));
        if (/^<a[\s/>]/iu.test(node.value)) insideAnchor = true;
        if (/^<\/a\s*>$/iu.test(node.value)) insideAnchor = false;
        return;
    }
    if ("children" in node) {
      for (const child of node.children) visit(child, line);
    }
  };
  visit(tree, 1);

  for (const identifier of referenced) {
    const definition = definitions.get(identifier);
    if (definition) links.push(definition);
  }
  return links.sort((a, b) => a.line - b.line);
}

function agentNativeUrl(raw: string): URL | undefined {
  let parsed: URL;
  try {
    parsed = new URL(raw, "https://relative.invalid");
  } catch {
    // coercion-ok: text that doesn't parse as a URL isn't a link to check.
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return undefined;
  }
  // A trailing dot ("agent-native.com.") names the same host.
  const host = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  return host === AGENT_NATIVE_HOST || host.endsWith(`.${AGENT_NATIVE_HOST}`)
    ? parsed
    : undefined;
}

export function findUntaggedLinks(
  files: readonly ReadmeFile[],
): UntaggedLink[] {
  return files.flatMap((file) =>
    findReadmeLinks(file.text).flatMap((link) => {
      const url = agentNativeUrl(link.url);
      if (!url || url.searchParams.get("utm_source")?.trim()) return [];
      return [{ path: file.path, line: link.line, url: link.url }];
    }),
  );
}

function readTrackedReadmes(): ReadmeFile[] {
  const tracked = execGuardCommand(
    "git",
    ["ls-files", "-z", "--", "*README.md"],
    {
      encoding: "utf8",
      maxBuffer: 1 << 28,
    },
  )
    .split("\0")
    .filter(Boolean);

  return selectReadmePaths(tracked).flatMap((file) => {
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) return [];
    try {
      return [{ path: file, text: readFileSync(file, "utf8") }];
    } catch (error) {
      console.error(`guard:readme-link-tags: could not read ${file}: ${error}`);
      process.exit(GUARD_EXIT_COULD_NOT_RUN);
    }
  });
}

export function main(): void {
  const files = readTrackedReadmes();
  if (files.length === 0) {
    console.error(
      "guard:readme-link-tags: found no tracked README.md files to inspect.",
    );
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }

  const violations = findUntaggedLinks(files);
  if (violations.length > 0) {
    console.error(
      [
        "README links to agent-native.com without a utm_source tag:",
        "",
        ...violations.map(
          (violation) =>
            `  - ${violation.path}:${violation.line} ${violation.url}`,
        ),
        "",
        FIX_HINT,
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  console.log(`guard:readme-link-tags: clean (${files.length} READMEs)`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}
