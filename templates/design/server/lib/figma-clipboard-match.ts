
import type { FigmaFileDepthNode } from "./figma-node-import.js";

export interface FigmaNodeCandidate {
  id: string;
  name: string;
  texts: string[];
}

export type FigmaClipboardMatchStatus = "matched" | "ambiguous" | "none";

export type FigmaClipboardMatchReason =
  | "no-candidates"
  | "too-many-name-matches"
  | "tied-text-matches"
  | "no-text-overlap";

export interface FigmaClipboardMatch {
  id: string;
  name: string;
  reason: "name" | "text";
}

export interface FigmaClipboardMatchResult {
  status: FigmaClipboardMatchStatus;
  matches: FigmaClipboardMatch[];
  reason?: FigmaClipboardMatchReason;
  candidateNames?: string[];
}

const MAX_MULTI_MATCH = 8;
const MIN_TEXT_MATCHES = 2;

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

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

export function matchFigmaClipboardNodes(
  candidates: FigmaNodeCandidate[],
  clipboardTexts: string[],
): FigmaClipboardMatchResult {
  const clipboardTextSet = new Set(
    clipboardTexts.map(normalize).filter((text) => text.length > 0),
  );

  if (candidates.length === 0) {
    return { status: "none", matches: [], reason: "no-candidates" };
  }

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
      return {
        status: "ambiguous",
        matches: [],
        reason: "too-many-name-matches",
        candidateNames: nameMatches.map((match) => match.name),
      };
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
    return {
      status: "ambiguous",
      matches: [],
      reason: "tied-text-matches",
      candidateNames: strongTextMatches.map((entry) => entry.candidate.name),
    };
  }

  return { status: "none", matches: [], reason: "no-text-overlap" };
}
