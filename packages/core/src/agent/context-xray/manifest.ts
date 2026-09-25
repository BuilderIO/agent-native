import { createHash } from "node:crypto";

import { appStatePut } from "../../application-state/store.js";
import { buildDeepLink } from "../../server/deep-link.js";
import {
  CONTEXT_XRAY_MANIFEST_KEY,
  type ContextDirective,
  type ContextManifest,
  type ContextManifestSegment,
  type ContextManifestSourceRef,
  type ContextManifestSystemSection,
  type ContextManifestSource,
  type ContextSegmentStatus,
  type ContextTokenCountMethod,
  type ContextGovernanceTier,
  type ContextSystemProvenance,
} from "../../shared/context-xray.js";
import type { EngineMessage } from "../engine/types.js";
import { computeSegments } from "./segments.js";
import {
  countMessageTokens,
  countPartTokens,
  countTextTokens,
} from "./tokenize.js";

export { CONTEXT_XRAY_MANIFEST_KEY };

export const CONTEXT_XRAY_REQUEST_SECTIONS_KEY =
  "__agentNativeContextXraySystemSections";

export interface SystemManifestSectionInput {
  label: string;
  provenance: ContextSystemProvenance;
  governance: ContextGovernanceTier;
  content: string;
  group?: string;
  sourceRef?: ContextManifestSourceRef;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function previewText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 200) return normalized;
  return `${normalized.slice(0, 197)}...`;
}

export async function buildSystemManifestSections(
  inputs: SystemManifestSectionInput[],
): Promise<ContextManifestSystemSection[]> {
  const timestamp = Date.now();
  return await Promise.all(
    inputs
      .filter((input) => input.content.trim().length > 0)
      .map(async (input, index) => {
        const content = input.content.trim();
        const count = await countTextTokens(content);
        const identity = [
          input.provenance,
          input.label,
          input.sourceRef?.resourceId ?? "",
          input.sourceRef?.path ?? "",
          content,
          index,
        ].join("\u0000");
        return {
          kind: "system" as const,
          segmentId: `system:${sha256(identity).slice(0, 16)}`,
          group: input.group ?? "System",
          label: input.label,
          provenance: input.provenance,
          governance: input.governance,
          tokenCount: count.tokens,
          tokenMethod: count.method,
          ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
          contentHash: sha256(content),
          preview: previewText(content),
          timestamp,
        } satisfies ContextManifestSystemSection;
      }),
  );
}

type ContextXRayEvent = {
  context?: Record<string, unknown>;
};

export function setContextXraySystemSections(
  event: ContextXRayEvent,
  sections: ContextManifestSystemSection[],
): void {
  event.context = event.context ?? {};
  event.context[CONTEXT_XRAY_REQUEST_SECTIONS_KEY] = sections;
}

export function readContextXraySystemSections(
  event: ContextXRayEvent,
): ContextManifestSystemSection[] {
  const sections = event.context?.[CONTEXT_XRAY_REQUEST_SECTIONS_KEY];
  return Array.isArray(sections)
    ? (sections as ContextManifestSystemSection[])
    : [];
}

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
  systemSections?: ContextManifestSystemSection[];
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

export function contextXrayDeepLink(threadId: string): string {
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

  const systemSections = input.systemSections ?? [];
  const systemTokenTotals = systemSections.reduce(
    (acc, section) => ({
      tokens: acc.tokens + section.tokenCount,
      method: combineMethods(acc.method, section.tokenMethod),
    }),
    { tokens: 0, method: "exact" as ContextTokenCountMethod },
  );
  const conversationTokens = sentTokenTotals.tokens;
  const rawConversationTokens = rawTokenTotals.tokens;
  const totalTokens = systemTokenTotals.tokens + conversationTokens;
  const rawTokens = systemTokenTotals.tokens + rawConversationTokens;
  return {
    threadId: input.threadId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    computedAt: Date.now(),
    ...(input.model ? { model: input.model } : {}),
    totalTokens,
    rawTokens,
    reclaimedTokens: Math.max(0, rawConversationTokens - conversationTokens),
    tokenCountMethod: combineMethods(
      combineMethods(rawTokenTotals.method, sentTokenTotals.method),
      systemTokenTotals.method,
    ),
    conversationTokens,
    systemTokens: systemTokenTotals.tokens,
    source: input.source ?? "structured",
    enforceable: input.enforceable ?? true,
    segments,
    ...(systemSections.length > 0 ? { systemSections } : {}),
    url: contextXrayDeepLink(input.threadId),
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
