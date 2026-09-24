import { createHash } from "node:crypto";

import type {
  ContextSegmentRole,
  ContextSegmentType,
} from "../../shared/context-xray.js";
import type { EngineContentPart, EngineMessage } from "../engine/types.js";
import {
  normalizeToolCallInputForIdentity,
  parseToolInputForIdentity,
  stableStringify,
  toolPairKey,
} from "./identity.js";

export interface ContextSegment {
  segmentId: string;
  msgIndex: number;
  partIndex: number;
  role: ContextSegmentRole;
  type: ContextSegmentType;
  label: string;
  group: string;
  canonicalContent: string;
  hash: string;
  dupIndex: number;
  pairKey?: string;
  part: EngineContentPart;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function dataHash(data: string): string {
  return sha256(data || "");
}

function canonicalContent(part: EngineContentPart): string {
  if (part.type === "text") return part.text;
  if (part.type === "tool-call") {
    return `${part.name}:${stableStringify(
      normalizeToolCallInputForIdentity(part.input),
    )}`;
  }
  if (part.type === "tool-result") {
    return `${part.toolName}:${stableStringify(
      normalizeToolCallInputForIdentity(
        parseToolInputForIdentity(part.toolInput),
      ),
    )}`;
  }
  if (part.type === "file") {
    return `${dataHash(part.data)}:${part.mediaType}:${part.filename ?? ""}`;
  }
  if (part.type === "image") {
    return `${dataHash(part.data)}:${part.mediaType}`;
  }
  return part.text;
}

function compactText(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
}

function labelForPart(
  role: ContextSegmentRole,
  part: EngineContentPart,
): string {
  if (part.type === "text") return `${role}: ${compactText(part.text, "text")}`;
  if (part.type === "tool-call") return `call ${part.name}`;
  if (part.type === "tool-result") return `${part.toolName} result`;
  if (part.type === "file") return part.filename ?? `file ${part.mediaType}`;
  if (part.type === "image") return `image ${part.mediaType}`;
  return "thinking";
}

function groupForPart(part: EngineContentPart): string {
  if (part.type === "tool-call" || part.type === "tool-result") {
    return "Tool results";
  }
  if (part.type === "file" || part.type === "image") return "Files read";
  if (part.type === "thinking") return "Thinking";
  return "Conversation";
}

function basePairKeyForPart(part: EngineContentPart): string | undefined {
  if (part.type === "tool-call") return toolPairKey(part.name, part.input);
  if (part.type === "tool-result") {
    return toolPairKey(part.toolName, part.toolInput);
  }
  return undefined;
}

export function computeSegments(messages: EngineMessage[]): ContextSegment[] {
  const dupCounts = new Map<string, number>();
  const toolCallPairCounts = new Map<string, number>();
  const toolResultPairCounts = new Map<string, number>();
  const segments: ContextSegment[] = [];

  messages.forEach((message, msgIndex) => {
    message.content.forEach((part, partIndex) => {
      const canonical = canonicalContent(part);
      const hash = sha256(canonical).slice(0, 16);
      const role = message.role;
      const type = part.type;
      const dupKey = `${role}:${type}:${hash}`;
      const dupIndex = dupCounts.get(dupKey) ?? 0;
      dupCounts.set(dupKey, dupIndex + 1);
      const basePairKey = basePairKeyForPart(part);
      let pairKey: string | undefined;
      if (basePairKey) {
        const counts =
          part.type === "tool-call" ? toolCallPairCounts : toolResultPairCounts;
        const pairIndex = counts.get(basePairKey) ?? 0;
        counts.set(basePairKey, pairIndex + 1);
        pairKey = `${basePairKey}:${pairIndex}`;
      }
      segments.push({
        segmentId: `${role}:${type}:${hash}:${dupIndex}`,
        msgIndex,
        partIndex,
        role,
        type,
        label: labelForPart(role, part),
        group: groupForPart(part),
        canonicalContent: canonical,
        hash,
        dupIndex,
        ...(pairKey ? { pairKey } : {}),
        part,
      });
    });
  });

  return segments;
}

export function computeProtectedSegmentIds(
  messages: EngineMessage[],
): Set<string> {
  const protectedIds = new Set<string>();
  const segments = computeSegments(messages);
  const byPosition = new Map(
    segments.map((segment) => [
      `${segment.msgIndex}:${segment.partIndex}`,
      segment,
    ]),
  );

  let latestUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      latestUserIndex = i;
      break;
    }
  }
  if (latestUserIndex >= 0) {
    messages[latestUserIndex]?.content.forEach((_part, partIndex) => {
      const segment = byPosition.get(`${latestUserIndex}:${partIndex}`);
      if (segment) protectedIds.add(segment.segmentId);
    });
  }

  let latestAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") {
      latestAssistantIndex = i;
      break;
    }
  }
  if (latestAssistantIndex >= 0) {
    messages[latestAssistantIndex]?.content.forEach((part, partIndex) => {
      if (part.type !== "thinking") return;
      const segment = byPosition.get(`${latestAssistantIndex}:${partIndex}`);
      if (segment) protectedIds.add(segment.segmentId);
    });
  }

  const unresolvedToolCalls = new Map<string, ContextSegment>();
  for (const segment of segments) {
    if (segment.part.type === "tool-call") {
      unresolvedToolCalls.set(segment.part.id, segment);
    } else if (segment.part.type === "tool-result") {
      unresolvedToolCalls.delete(segment.part.toolCallId);
    }
  }
  for (const segment of unresolvedToolCalls.values()) {
    protectedIds.add(segment.segmentId);
  }

  return protectedIds;
}
