/**
 * Conservative matcher: figures out which top-level Figma frame(s) a clipboard
 * paste corresponds to, without ever risking an unintended whole-file import.
 *
 * Why this exists: Figma's clipboard `figmeta` marker (see
 * `app/lib/figma-clipboard.ts`) only carries a `fileKey` — it has no node ids,
 * and the `pasteID` it does carry is server-side/ephemeral (not resolvable to
 * a node through the public REST API). So a clipboard paste alone can't name
 * an exact node the way a copied frame LINK can (`?node-id=...`). Instead we
 * fetch the file's shallow structure (see `fetchFileStructure(fileKey, 3)` in
 * `figma-node-import.ts`: pages -> top-level frames -> their direct children)
 * and heuristically match it against the *visible* clipboard HTML fallback
 * (frame/layer names and text layer contents tend to reappear as literal text
 * in that fallback markup).
 *
 * This is deliberately conservative: pure name/text equality only, no fuzzy
 * matching, and it only ever returns a `matched` result when the evidence is
 * unambiguous. Anything else — `none` or `ambiguous` — must fall back to the
 * legacy HTML-paste path (see `import-figma-clipboard.ts`) rather than guess
 * at a node import, since importing the wrong node is worse than importing a
 * lossy but honest HTML approximation.
 */

import type { FigmaFileDepthNode } from "./figma-node-import.js";

export interface FigmaNodeCandidate {
  id: string;
  name: string;
  /** Text layer `characters` found among this node's direct children. */
  texts: string[];
}

export type FigmaClipboardMatchStatus = "matched" | "ambiguous" | "none";

export interface FigmaClipboardMatch {
  id: string;
  name: string;
  reason: "name" | "text";
}

export interface FigmaClipboardMatchResult {
  status: FigmaClipboardMatchStatus;
  matches: FigmaClipboardMatch[];
}

/** Caps a "multi-select copy" match so a huge/garbled name-match list still degrades to ambiguous. */
const MAX_MULTI_MATCH = 8;
/** Minimum distinct visible-text overlaps required before trusting a text-only match (no name match). */
const MIN_TEXT_MATCHES = 2;

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Extracts distinct non-empty visible text lines from clipboard fallback HTML
 * (already stripped of the hidden figmeta/figbuffer markers by
 * `parseVisibleClipboardHtml`). Deliberately simple: strip tags, split on the
 * resulting line breaks, trim, dedupe — good enough for literal-text overlap
 * matching without pulling in an HTML parser.
 */
export function extractVisibleTexts(html: string | undefined | null): string[] {
  if (!html) return [];
  const withoutTagContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n");
  const decoded = withoutTagContent
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawLine of decoded.split("\n")) {
    const line = rawLine.trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

function collectTextCharacters(node: FigmaFileDepthNode | undefined): string[] {
  if (!node) return [];
  const out: string[] = [];
  const characters = (node as { characters?: unknown }).characters;
  if (typeof characters === "string" && characters.trim()) out.push(characters);
  for (const child of node.children ?? [])
    out.push(...collectTextCharacters(child));
  return out;
}

/**
 * Builds match candidates from a `depth=3` file-structure fetch: one
 * candidate per top-level frame across every page, each carrying its own
 * name plus the visible text found among its (one level of) children.
 * Intentionally scoped to top-level frames only — never deeper — so a match
 * can only ever resolve to whole frames a user could plausibly have copied,
 * not to arbitrary nested layers.
 */
export function buildFigmaNodeCandidates(
  document: FigmaFileDepthNode | undefined,
): FigmaNodeCandidate[] {
  const candidates: FigmaNodeCandidate[] = [];
  for (const page of document?.children ?? []) {
    for (const frame of page.children ?? []) {
      if (!frame?.id) continue;
      candidates.push({
        id: frame.id,
        name: frame.name ?? "",
        texts: collectTextCharacters(frame),
      });
    }
  }
  return candidates;
}

/**
 * Decision rules (see module doc for the "why"):
 *
 * 1. Any candidate whose *name* exactly equals (case/whitespace-insensitive)
 *    one of the clipboard's visible text lines is a "name match" — the
 *    strongest signal, since a frame's name reappearing verbatim in the copy
 *    is unlikely by chance.
 *      - Exactly one name match -> matched (single frame copy).
 *      - 2..MAX_MULTI_MATCH name matches -> matched, all of them (multi-select
 *        copy of several named frames).
 *      - More than MAX_MULTI_MATCH -> ambiguous (too many to trust).
 * 2. No name match: fall back to counting distinct visible-text overlaps
 *    between each candidate's own text layers and the clipboard text.
 *      - Exactly one candidate reaches MIN_TEXT_MATCHES -> matched (text
 *        match).
 *      - Zero or 2+ candidates reach MIN_TEXT_MATCHES -> ambiguous/none.
 * 3. No candidate clears either bar -> none.
 */
export function matchFigmaClipboardNodes(
  candidates: FigmaNodeCandidate[],
  clipboardTexts: string[],
): FigmaClipboardMatchResult {
  const clipboardTextSet = new Set(
    clipboardTexts.map(normalize).filter((text) => text.length > 0),
  );

  const nameMatches = candidates.filter((candidate) =>
    clipboardTextSet.has(normalize(candidate.name)),
  );

  if (nameMatches.length === 1) {
    const [match] = nameMatches;
    return {
      status: "matched",
      matches: [{ id: match!.id, name: match!.name, reason: "name" }],
    };
  }
  if (nameMatches.length > 1) {
    if (nameMatches.length > MAX_MULTI_MATCH) {
      return { status: "ambiguous", matches: [] };
    }
    return {
      status: "matched",
      matches: nameMatches.map((match) => ({
        id: match.id,
        name: match.name,
        reason: "name" as const,
      })),
    };
  }

  const textScores = candidates.map((candidate) => {
    const matchedTexts = new Set(
      candidate.texts
        .map(normalize)
        .filter((text) => text.length > 0 && clipboardTextSet.has(text)),
    );
    return { candidate, score: matchedTexts.size };
  });
  const strongTextMatches = textScores.filter(
    (entry) => entry.score >= MIN_TEXT_MATCHES,
  );

  if (strongTextMatches.length === 1) {
    const { candidate } = strongTextMatches[0]!;
    return {
      status: "matched",
      matches: [{ id: candidate.id, name: candidate.name, reason: "text" }],
    };
  }
  if (strongTextMatches.length > 1) {
    return { status: "ambiguous", matches: [] };
  }

  return { status: "none", matches: [] };
}
