import type { ContextManifestSystemSection } from "../../shared/context-xray.js";
import { applyContextDirectives } from "../context-xray/apply-directives.js";
import { loadContextDirectives } from "../context-xray/directives-store.js";
import {
  buildManifest,
  writeContextManifest,
} from "../context-xray/manifest.js";
import { computeProtectedSegmentIds } from "../context-xray/segments.js";
import type { EngineMessage } from "./types.js";

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
