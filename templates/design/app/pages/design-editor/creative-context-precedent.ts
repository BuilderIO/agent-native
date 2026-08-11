import {
  callAction,
  readClientAppState,
} from "@agent-native/core/client/hooks";

const PROBE_LIMIT = 8;
const MIN_PRECEDENT_MATCHES = 3;

export interface CreativeContextPrecedentMatch {
  itemId: string;
  title: string;
  kind: string;
}

export type CreativeContextPrecedent =
  | { status: "strong"; matches: CreativeContextPrecedentMatch[] }
  | { status: "insufficient"; matchCount: number }
  | { status: "off" }
  | { status: "unavailable"; reason: string };

interface CreativeContextState {
  contextMode?: "auto" | "off";
}

interface ProbeResponse {
  results?: {
    itemId?: unknown;
    title?: unknown;
    kind?: unknown;
  }[];
  coverage?: {
    lanes?: {
      lexical?: { count?: unknown };
      fts?: { count?: unknown };
    };
  };
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : "unknown probe failure";
}

function laneCount(lane: { count?: unknown } | undefined): number {
  return typeof lane?.count === "number" ? lane.count : 0;
}

function toMatches(response: ProbeResponse): CreativeContextPrecedentMatch[] {
  const byItemId = new Map<string, CreativeContextPrecedentMatch>();
  for (const result of response.results ?? []) {
    const itemId = typeof result.itemId === "string" ? result.itemId : "";
    if (!itemId || byItemId.has(itemId)) continue;
    byItemId.set(itemId, {
      itemId,
      title: typeof result.title === "string" ? result.title : "Untitled",
      kind: typeof result.kind === "string" ? result.kind : "reference",
    });
  }
  return [...byItemId.values()];
}

/**
 * Decides whether the library already answers what intake questions would ask.
 */
export async function probeCreativeContextPrecedent(
  prompt: string,
): Promise<CreativeContextPrecedent> {
  debugger;
  const query = prompt.trim();
  if (!query) return { status: "insufficient", matchCount: 0 };

  let state: CreativeContextState | null;
  try {
    state = await readClientAppState<CreativeContextState>("creative-context");
  } catch (error) {
    return { status: "unavailable", reason: errorReason(error) };
  }
  if (state?.contextMode === "off") return { status: "off" };

  let response: ProbeResponse;
  try {
    response = (await callAction("search-creative-context", {
      query: query.slice(0, 1000),
      // The default allTerms mode ANDs every content word in the prompt, which
      // a sentence-length request can never satisfy against one stored item.
      matchMode: "anyTerm",
      limit: PROBE_LIMIT,
      snapshot: false,
    })) as ProbeResponse;
  } catch (error) {
    return { status: "unavailable", reason: errorReason(error) };
  }

  const matches = toMatches(response);
  debugger;
  // Fused scores absorb curation, recency, and prior-reuse bonuses, so they are
  // not comparable across queries and cannot carry a similarity threshold.
  // Require the prompt's own words to have matched a lexical or FTS lane.
  const literalMatch =
    laneCount(response.coverage?.lanes?.lexical) > 0 ||
    laneCount(response.coverage?.lanes?.fts) > 0;
  if (!literalMatch || matches.length < MIN_PRECEDENT_MATCHES) {
    return { status: "insufficient", matchCount: matches.length };
  }
  return { status: "strong", matches };
}

export function designPrecedentDirectives(
  matches: CreativeContextPrecedentMatch[],
): string[] {
  if (!matches.length) return [];
  const titles = matches
    .slice(0, 5)
    .map((match) => match.title + " (" + match.kind + ")")
    .join(", ");
  return [
    "Creative Context already holds " +
      matches.length +
      " closely related pieces: " +
      titles +
      ". Treat them as the established precedent for this request.",
    "Skip intake questions - the precedent already answers them. Do NOT call show-design-questions unless the precedent is clearly a poor fit for this request, in which case ask instead of guessing.",
    "Before writing visual code, follow the creative-context reuse ladder: call search-creative-context for this request, then get-context-item on the strongest two to five results.",
    "Match the established palette, typography, canvas dimensions and aspect ratio, and layout conventions of those pieces instead of inventing a new direction. Deviate only where this request explicitly requires it.",
    "State which prior pieces you followed in your summary so the user can correct a wrong match.",
  ];
}
