import type { ContextManifestSystemSection } from "../../shared/context-xray.js";
import { applyContextDirectives } from "../context-xray/apply-directives.js";
import { loadContextDirectives } from "../context-xray/directives-store.js";
import {
  buildManifest,
  writeContextManifest,
} from "../context-xray/manifest.js";
import { computeProtectedSegmentIds } from "../context-xray/segments.js";
import type { EngineMessage } from "./types.js";

/**
 * Context X-Ray transform for one `runAgentLoop` iteration: loads any
 * directives for the thread (evict/pin/restore), applies them to the raw
 * message history, and best-effort persists a manifest describing what was
 * sent to the model.
 *
 * Returns the transformed messages, or the original `messages` array
 * unchanged (by reference) if the transform throws — the transform is a
 * hardening/observability layer, never a gate, so a failure here must not
 * break the turn. The manifest write is fire-and-forget (not awaited) so it
 * never adds latency to the model-call path.
 *
 * Moved verbatim out of `runAgentLoop`'s per-iteration setup — behavior
 * unchanged. Caller is still responsible for gating this on `threadId` being
 * present and for the separate Observational Memory pass that runs after it.
 */
export async function applyContextXrayTransformForIteration(opts: {
  threadId: string;
  ownerEmail?: string | null;
  turnId?: string;
  model: string;
  messages: EngineMessage[];
  systemSections?: ContextManifestSystemSection[];
}): Promise<EngineMessage[]> {
  const { threadId, ownerEmail, turnId, model, messages, systemSections } =
    opts;
  try {
    const directives = await loadContextDirectives(threadId, {
      ownerEmail: ownerEmail ?? null,
    });
    const protectedSegmentIds = computeProtectedSegmentIds(messages);
    const { messages: transformedMessages, appliedStatus } =
      applyContextDirectives(messages, directives, {
        protectedSegmentIds,
      });
    const manifest = await buildManifest({
      threadId,
      ...(turnId ? { turnId } : {}),
      model,
      rawMessages: messages,
      sentMessages: transformedMessages,
      appliedStatus,
      directives,
      protectedSegmentIds,
      ...(systemSections ? { systemSections } : {}),
      source: "structured",
      enforceable: true,
    });
    void writeContextManifest(threadId, manifest).catch((err) => {
      console.warn(
        "[context-xray] failed to write manifest:",
        err instanceof Error ? err.message : String(err),
      );
    });
    return transformedMessages;
  } catch (err) {
    console.warn(
      "[context-xray] context transform skipped:",
      err instanceof Error ? err.message : String(err),
    );
    return messages;
  }
}
