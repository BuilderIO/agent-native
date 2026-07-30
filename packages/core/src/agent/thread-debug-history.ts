import { createHash } from "node:crypto";

export const MAX_THREAD_DEBUG_RUNS = 50;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hashThreadDebugPrompt(prompt: string): string {
  return `sha256:${createHash("sha256").update(prompt).digest("hex")}`;
}

function compactDebugEntry(
  value: unknown,
  prompts: Map<string, string>,
): UnknownRecord | null {
  if (!isRecord(value)) return null;

  const entry = { ...value };
  if (typeof entry.systemPrompt === "string") {
    const promptHash = hashThreadDebugPrompt(entry.systemPrompt);
    prompts.set(promptHash, entry.systemPrompt);
    entry.systemPromptHash = promptHash;
    delete entry.systemPrompt;
  }
  return entry;
}

/**
 * Append one run's diagnostics while keeping repeated system prompts out of
 * every history entry. Existing full-prompt history is migrated on write.
 */
export function appendThreadDebugHistory(
  threadData: UnknownRecord,
  currentDebug: UnknownRecord,
): UnknownRecord {
  const promptCandidates = new Map<string, string>();
  if (isRecord(threadData._debugPrompts)) {
    for (const [hash, prompt] of Object.entries(threadData._debugPrompts)) {
      if (typeof prompt === "string") promptCandidates.set(hash, prompt);
    }
  }

  const previousRuns = Array.isArray(threadData._debugRuns)
    ? threadData._debugRuns
        .map((entry) => compactDebugEntry(entry, promptCandidates))
        .filter((entry): entry is UnknownRecord => entry !== null)
    : [];
  const compactCurrent = compactDebugEntry(currentDebug, promptCandidates) ?? {
    ...currentDebug,
  };
  const debugRuns = [...previousRuns, compactCurrent].slice(
    -MAX_THREAD_DEBUG_RUNS,
  );

  const referencedHashes = new Set<string>();
  for (const entry of debugRuns) {
    if (typeof entry.systemPromptHash === "string") {
      referencedHashes.add(entry.systemPromptHash);
    }
  }
  if (typeof compactCurrent.systemPromptHash === "string") {
    referencedHashes.add(compactCurrent.systemPromptHash);
  }

  const debugPrompts = Object.fromEntries(
    [...referencedHashes].sort().flatMap((hash) => {
      const prompt = promptCandidates.get(hash);
      return prompt === undefined ? [] : [[hash, prompt]];
    }),
  );

  const result: UnknownRecord = {
    ...threadData,
    _debug: compactCurrent,
    _debugRuns: debugRuns,
  };
  if (Object.keys(debugPrompts).length > 0) {
    result._debugPrompts = debugPrompts;
  } else {
    delete result._debugPrompts;
  }
  return result;
}
