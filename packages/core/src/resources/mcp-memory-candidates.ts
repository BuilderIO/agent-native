import type { Candidate } from "../agent/tool-search-task.js";
import { getRequestContext } from "../server/request-context.js";
import { parseMemoryIndex } from "./memory-index.js";
import {
  readScopedResourceForMcp,
  scopedResourceExistsForMcp,
} from "./store.js";

export class MemoryCandidatesTruncatedError extends Error {
  readonly code = "memory_candidates_truncated";
  constructor() {
    super("Memory candidates exceed the lookup limit");
  }
}

/** Caller must first establish verified MCP identity and current action grants. */
export async function collectMcpMemoryCandidates(input: {
  callableActionNames: readonly string[];
  signal: AbortSignal;
}): Promise<Candidate[]> {
  input.signal.throwIfAborted();
  if (!input.callableActionNames.includes("resources")) return [];
  const context = getRequestContext();
  const scopes: Array<"personal" | "shared"> = ["personal"];
  if (context?.orgId && context.orgScope !== "personal") scopes.push("shared");
  const candidates: Candidate[] = [];
  let targetReads = 0;
  for (const scope of scopes) {
    input.signal.throwIfAborted();
    const index = await readScopedResourceForMcp({
      scope,
      path: "memory/MEMORY.md",
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    if (!index) continue;
    // At most 16,384 UTF-16 code units: no more than 65,536 UTF-8 bytes.
    if (index.content.length > 16_384)
      throw new MemoryCandidatesTruncatedError();
    const lines = index.content.split("\n");
    if (lines.length > 256) throw new MemoryCandidatesTruncatedError();
    for (const entry of parseMemoryIndex(lines.join("\n"))) {
      const { name, path, description } = entry;
      if (!name.trim() || !description.trim() || path === "memory/MEMORY.md")
        continue;
      if (
        candidates.some(
          (candidate) => candidate.id === `memory:${scope}:${path}`,
        )
      )
        continue;
      if (targetReads >= 24) throw new MemoryCandidatesTruncatedError();
      targetReads++;
      input.signal.throwIfAborted();
      const exists = await scopedResourceExistsForMcp({
        scope,
        path,
        signal: input.signal,
      });
      input.signal.throwIfAborted();
      if (!exists) continue;
      candidates.push({
        id: `memory:${scope}:${path}`,
        kind: "memory",
        name: name.slice(0, 160),
        description: description.slice(0, 400),
        use: { type: "resources", action: "read", path, scope },
        callable: true,
        reason: "Available memory",
      });
    }
  }
  return candidates;
}
