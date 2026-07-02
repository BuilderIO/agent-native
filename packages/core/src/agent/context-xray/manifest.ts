import { appStatePut } from "../../application-state/store.js";
import { buildDeepLink } from "../../server/deep-link.js";
import {
  CONTEXT_XRAY_MANIFEST_KEY,
  type ContextDirective,
  type ContextManifest,
  type ContextManifestSegment,
  type ContextManifestSource,
  type ContextSegmentStatus,
  type ContextTokenCountMethod,
} from "../../shared/context-xray.js";
import type { EngineMessage } from "../engine/types.js";
import { computeSegments } from "./segments.js";
import {
  countMessageTokens,
  countPartTokens,
  countTextTokens,
} from "./tokenize.js";

export { CONTEXT_XRAY_MANIFEST_KEY };

export interface BuildManifestInput {
  threadId: string;
  turnId?: string;
  model?: string;
  rawMessages: EngineMessage[];
  sentMessages: EngineMessage[];
  appliedStatus: Map<string, ContextSegmentStatus>;
  directives: Map<string, ContextDirective>;
  protectedSegmentIds?: Set<string>;
  source?: ContextManifestSource;
  enforceable?: boolean;
}

function combineMethods(
  left: ContextTokenCountMethod,
  right: ContextTokenCountMethod,
): ContextTokenCountMethod {
  return left === "estimate" || right === "estimate" ? "estimate" : "exact";
}

function statusForSegment(
  segmentId: string,
  appliedStatus: Map<string, ContextSegmentStatus>,
  directives: Map<string, ContextDirective>,
): ContextSegmentStatus {
  const applied = appliedStatus.get(segmentId);
  if (applied) return applied;
  const directive = directives.get(segmentId);
  if (directive?.active && directive.action === "pin") return "pinned";
  return "active";
}

async function summaryTokenCount(
  segmentId: string,
  status: ContextSegmentStatus,
  directives: Map<string, ContextDirective>,
): Promise<number | undefined> {
  if (status !== "summarized") return undefined;
  const text = directives.get(segmentId)?.summaryText;
  if (!text) return undefined;
  return (await countTextTokens(text)).tokens;
}

function contextXrayUrl(threadId: string): string {
  const to = `/?contextXray=1&threadId=${encodeURIComponent(threadId)}`;
  return buildDeepLink({
    app: "agent-native",
    view: "context-xray",
    to,
    params: { threadId },
  });
}

export async function buildManifest(
  input: BuildManifestInput,
): Promise<ContextManifest> {
  const rawSegments = computeSegments(input.rawMessages);
  const rawCounts = await Promise.all(
    rawSegments.map((segment) => countPartTokens(segment.part)),
  );
  const rawTokenTotals = rawCounts.reduce(
    (acc, count) => ({
      tokens: acc.tokens + count.tokens,
      method: combineMethods(acc.method, count.method),
    }),
    { tokens: 0, method: "exact" as ContextTokenCountMethod },
  );
  const sentTokenTotals = await countMessageTokens(input.sentMessages);

  const segments: ContextManifestSegment[] = [];
  for (const [index, segment] of rawSegments.entries()) {
    const tokenCount = rawCounts[index] ?? { tokens: 1, method: "estimate" };
    const status = statusForSegment(
      segment.segmentId,
      input.appliedStatus,
      input.directives,
    );
    const protectedSegment = input.protectedSegmentIds?.has(segment.segmentId);
    const summaryTokens = await summaryTokenCount(
      segment.segmentId,
      status,
      input.directives,
    );
    segments.push({
      segmentId: segment.segmentId,
      type: segment.type,
      role: segment.role,
      group: status === "pinned" ? "Pinned" : segment.group,
      label: segment.label,
      tokenCount: tokenCount.tokens,
      tokenMethod: tokenCount.method,
      status: protectedSegment && status !== "pinned" ? "active" : status,
      ...(protectedSegment ? { protected: true } : {}),
      ...(summaryTokens ? { summaryTokenCount: summaryTokens } : {}),
      ...(segment.pairKey ? { pairKey: segment.pairKey } : {}),
      msgIndex: segment.msgIndex,
      partIndex: segment.partIndex,
    });
  }

  const totalTokens = sentTokenTotals.tokens;
  const rawTokens = rawTokenTotals.tokens;
  return {
    threadId: input.threadId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    computedAt: Date.now(),
    ...(input.model ? { model: input.model } : {}),
    totalTokens,
    rawTokens,
    reclaimedTokens: Math.max(0, rawTokens - totalTokens),
    tokenCountMethod: combineMethods(
      rawTokenTotals.method,
      sentTokenTotals.method,
    ),
    source: input.source ?? "structured",
    enforceable: input.enforceable ?? true,
    segments,
    url: contextXrayUrl(input.threadId),
  };
}

export async function writeContextManifest(
  threadId: string,
  manifest: ContextManifest,
): Promise<void> {
  await appStatePut(
    threadId,
    CONTEXT_XRAY_MANIFEST_KEY,
    manifest as unknown as Record<string, unknown>,
    {
      requestSource: "context-xray",
    },
  );
}

export function updateManifestSegmentStatus(
  manifest: ContextManifest,
  segmentId: string,
  status: ContextSegmentStatus,
): ContextManifest {
  let delta = 0;
  const segments = manifest.segments.map((segment) => {
    if (segment.segmentId !== segmentId) return segment;
    const previous = segment.status;
    if (previous !== "evicted" && status === "evicted") {
      delta -= segment.tokenCount;
    } else if (previous === "evicted" && status !== "evicted") {
      delta += segment.tokenCount;
    }
    return {
      ...segment,
      status: segment.protected && status !== "pinned" ? "active" : status,
      group: status === "pinned" ? "Pinned" : segment.group,
    };
  });
  const totalTokens = Math.max(0, manifest.totalTokens + delta);
  return {
    ...manifest,
    computedAt: Date.now(),
    totalTokens,
    reclaimedTokens: Math.max(0, manifest.rawTokens - totalTokens),
    segments,
  };
}
