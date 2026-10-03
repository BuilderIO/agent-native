#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  execGuardCommand,
  GUARD_EXIT_COULD_NOT_RUN,
} from "./lib/changed-lines.mjs";

const AGENT_NATIVE_HOST = "agent-native.com";
const IGNORED_PATH_RE = /(?:^|\/)(?:node_modules|fixtures?|__snapshots__)\//u;
const FIX_HINT =
  "Add ?utm_source=<github|npm>&utm_medium=referral&utm_content=<placement> before any #fragment (github for repo READMEs, npm for published package READMEs, <template>-readme for template placements).";

export interface ReadmeFile {
  path: string;
  text: string;
}

export interface ReadmeLink {
  line: number;
  url: string;
  start: number;
  end: number;
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

// Masking keeps every offset and newline, so link positions in the masked text
// are positions in the original file.
function blank(text: string): string {
  return text.replace(/[^\r\n]/gu, " ");
}

function maskFencedCode(text: string): string {
  let fence: { char: string; length: number } | undefined;
  return text
    .split("\n")
    .map((line) => {
      const marker = /^[ \t]*(`{3,}|~{3,})(.*)\r?$/u.exec(line);
      if (!fence) {
        if (!marker || (marker[1][0] === "`" && marker[2].includes("`"))) {
          return line;
        }
        fence = { char: marker[1][0], length: marker[1].length };
        return blank(line);
      }
      if (
        marker &&
        marker[1][0] === fence.char &&
        marker[1].length >= fence.length &&
        marker[2].trim() === ""
      ) {
        fence = undefined;
      }
      return blank(line);
    })
    .join("\n");
}

function maskInlineCode(text: string): string {
  const segments: string[] = [];
  let cursor = 0;
  let index = 0;
  while (index < text.length) {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    if (text[index] !== "`") {
      index += 1;
      continue;
    }
    let runEnd = index;
    while (text[runEnd] === "`") runEnd += 1;
    const ticks = runEnd - index;
    // A code span cannot cross a blank line.
    const paragraphEnd = /\n[ \t\r]*\n/u.exec(text.slice(runEnd));
    const limit = paragraphEnd ? runEnd + paragraphEnd.index : text.length;
    let closeEnd = -1;
    for (let probe = runEnd; probe < limit; ) {
      if (text[probe] !== "`") {
        probe += 1;
        continue;
      }
      let probeEnd = probe;
      while (text[probeEnd] === "`") probeEnd += 1;
      if (probeEnd - probe === ticks) {
        closeEnd = probeEnd;
        break;
      }
      probe = probeEnd;
    }
    if (closeEnd === -1) {
      index = runEnd;
      continue;
    }
    segments.push(
      text.slice(cursor, index),
      blank(text.slice(index, closeEnd)),
    );
    cursor = closeEnd;
    index = closeEnd;
  }
  segments.push(text.slice(cursor));
  return segments.join("");
}

function matchingOpenBracket(text: string, closeIndex: number): number {
  let depth = 1;
  for (let index = closeIndex - 1; index >= 0; index -= 1) {
    if (text[index - 1] === "\\") continue;
    if (text[index] === "]") depth += 1;
    if (text[index] === "[") depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function parseInlineDestination(
  text: string,
  from: number,
): { start: number; end: number; close: number } | undefined {
  let start = from;
  while (/[ \t\r\n]/u.test(text[start] ?? "")) start += 1;

  let end = start;
  if (text[start] === "<") {
    end = text.indexOf(">", start + 1);
    if (end === -1 || text.slice(start, end).includes("\n")) return undefined;
    start += 1;
  } else {
    let depth = 0;
    while (end < text.length && !/\s/u.test(text[end])) {
      if (text[end] === "(") depth += 1;
      if (text[end] === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
      end += 1;
    }
  }
  if (end === start) return undefined;

  let close = end + (text[end] === ">" ? 1 : 0);
  while (/[ \t\r\n]/u.test(text[close] ?? "")) close += 1;
  const titleOpen = text[close];
  if (titleOpen === '"' || titleOpen === "'" || titleOpen === "(") {
    const titleClose = text.indexOf(
      titleOpen === "(" ? ")" : titleOpen,
      close + 1,
    );
    if (titleClose === -1) return undefined;
    close = titleClose + 1;
    while (/[ \t\r\n]/u.test(text[close] ?? "")) close += 1;
  }
  return text[close] === ")" ? { start, end, close } : undefined;
}

function trimBareUrl(url: string): string {
  let trimmed = url;
  for (;;) {
    const last = trimmed[trimmed.length - 1];
    const unbalancedParen =
      last === ")" && trimmed.split(")").length > trimmed.split("(").length;
    if (last && (/[?!.,:;*_~'"\]]/u.test(last) || unbalancedParen)) {
      trimmed = trimmed.slice(0, -1);
      continue;
    }
    return trimmed;
  }
}

/** Every clickable link in a README, whatever its host. */
export function findReadmeLinks(text: string): ReadmeLink[] {
  const masked = maskInlineCode(
    maskFencedCode(text).replace(/<!--[\s\S]*?-->/gu, blank),
  );
  const links: ReadmeLink[] = [];
  const consumed: Array<[number, number]> = [];

  const add = (start: number, end: number) => {
    links.push({
      line: masked.slice(0, start).split("\n").length,
      url: masked.slice(start, end),
      start,
      end,
    });
  };

  const isConsumed = (index: number) =>
    consumed.some(([start, end]) => index >= start && index < end);

  for (let close = masked.indexOf("]("); close !== -1; ) {
    const open = matchingOpenBracket(masked, close);
    const destination =
      open === -1 ? undefined : parseInlineDestination(masked, close + 2);
    if (destination) {
      const isImage = masked[open - 1] === "!";
      consumed.push([isImage ? open - 1 : open, destination.close + 1]);
      if (!isImage) add(destination.start, destination.end);
    }
    close = masked.indexOf("](", close + 1);
  }

  for (const match of masked.matchAll(
    /^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]*>|\S+)/gmu,
  )) {
    const wrapped = match[1].startsWith("<");
    const end = match.index + match[0].length - (wrapped ? 1 : 0);
    add(end - match[1].length + (wrapped ? 2 : 0), end);
    consumed.push([match.index, match.index + match[0].length]);
  }

  for (const match of masked.matchAll(
    /<(https?:\/\/[^\s<>]+)>|<\/?([A-Za-z][A-Za-z0-9-]*)\b[^<>]*>/gu,
  )) {
    const tagStart = match.index;
    const tagEnd = tagStart + match[0].length;
    if (isConsumed(tagStart)) continue;
    if (match[1]) {
      add(tagStart + 1, tagEnd - 1);
      consumed.push([tagStart, tagEnd]);
      continue;
    }
    let consumedEnd = tagEnd;
    if (match[2].toLowerCase() === "a" && match[0][1] !== "/") {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/iu.exec(
        match[0],
      );
      if (href) {
        const value = href[1] ?? href[2] ?? href[3];
        const valueStart = tagStart + href.index + href[0].lastIndexOf(value);
        add(valueStart, valueStart + value.length);
      }
      const closing = masked.indexOf("</a>", tagEnd);
      if (closing !== -1) consumedEnd = closing + 4;
    }
    consumed.push([tagStart, consumedEnd]);
  }

  for (const match of masked.matchAll(
    /(?<![^\s*_~(])(?:https?:\/\/|www\.)[^\s<]+/gu,
  )) {
    if (isConsumed(match.index)) continue;
    const url = trimBareUrl(match[0]);
    add(match.index, match.index + url.length);
  }

  return links.sort((a, b) => a.start - b.start);
}

function agentNativeUrl(raw: string): URL | undefined {
  const absolute = /^www\./iu.test(raw) ? `https://${raw}` : raw;
  let parsed: URL;
  try {
    parsed = new URL(
      absolute.replaceAll("&amp;", "&"),
      "https://relative.invalid",
    );
  } catch {
    // coercion-ok: text that doesn't parse as a URL isn't a link to check.
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return undefined;
  }
  const host = parsed.hostname.toLowerCase();
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
