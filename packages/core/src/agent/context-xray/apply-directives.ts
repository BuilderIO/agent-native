import type { EngineContentPart, EngineMessage } from "../engine/types.js";
import type {
  ContextDirective,
  ContextDirectiveAction,
  ContextSegmentStatus,
} from "../../shared/context-xray.js";
import { computeSegments } from "./segments.js";

export interface ApplyContextDirectivesResult {
  messages: EngineMessage[];
  appliedStatus: Map<string, ContextSegmentStatus>;
}

type PlannedTransform = "evict" | "summarize";

function clonePart(part: EngineContentPart): EngineContentPart {
  return { ...(part as any) } as EngineContentPart;
}

function plannedTransformForDirective(
  directive: ContextDirective | undefined,
): PlannedTransform | null {
  if (!directive?.active) return null;
  if (directive.action === "evict") return "evict";
  if (directive.action === "summarize") return "summarize";
  return null;
}

function statusForTransform(transform: PlannedTransform): ContextSegmentStatus {
  return transform === "evict" ? "evicted" : "summarized";
}

function summaryTextFor(
  directive: ContextDirective | undefined,
  fallbackLabel: string,
): string {
  const summary = directive?.summaryText?.trim();
  return summary || `${fallbackLabel} was summarized to reduce context size.`;
}

export function applyContextDirectives(
  messages: EngineMessage[],
  directives: Map<string, ContextDirective>,
  opts: { protectedSegmentIds: Set<string> },
): ApplyContextDirectivesResult {
  const segments = computeSegments(messages);
  const byPosition = new Map(
    segments.map((segment) => [
      `${segment.msgIndex}:${segment.partIndex}`,
      segment,
    ]),
  );
  const pairMembers = new Map<string, string[]>();
  for (const segment of segments) {
    if (!segment.pairKey) continue;
    const members = pairMembers.get(segment.pairKey) ?? [];
    members.push(segment.segmentId);
    pairMembers.set(segment.pairKey, members);
  }

  const transformById = new Map<string, PlannedTransform>();
  const appliedStatus = new Map<string, ContextSegmentStatus>();

  for (const segment of segments) {
    const directive = directives.get(segment.segmentId);
    if (!directive?.active) continue;

    if (directive.action === "pin") {
      appliedStatus.set(segment.segmentId, "pinned");
      continue;
    }

    const transform = plannedTransformForDirective(directive);
    if (!transform) continue;
    const ids = segment.pairKey
      ? (pairMembers.get(segment.pairKey) ?? [segment.segmentId])
      : [segment.segmentId];
    const hasProtectedMember = ids.some((id) =>
      opts.protectedSegmentIds.has(id),
    );
    if (hasProtectedMember) continue;
    for (const id of ids) transformById.set(id, transform);
  }

  const output: EngineMessage[] = [];
  for (const [msgIndex, message] of messages.entries()) {
    const nextParts: EngineContentPart[] = [];
    for (const [partIndex, part] of message.content.entries()) {
      const actualSegment = byPosition.get(`${msgIndex}:${partIndex}`);
      if (!actualSegment) {
        nextParts.push(clonePart(part));
        continue;
      }
      if (opts.protectedSegmentIds.has(actualSegment.segmentId)) {
        nextParts.push(clonePart(part));
        continue;
      }
      const transform = transformById.get(actualSegment.segmentId);
      if (transform === "evict") {
        appliedStatus.set(
          actualSegment.segmentId,
          statusForTransform(transform),
        );
        continue;
      }
      if (transform === "summarize") {
        const directive = directives.get(actualSegment.segmentId);
        nextParts.push({
          type: "text",
          text: `[summarized] ${summaryTextFor(directive, actualSegment.label)}`,
        });
        appliedStatus.set(
          actualSegment.segmentId,
          statusForTransform(transform),
        );
        continue;
      }
      nextParts.push(clonePart(part));
    }
    if (nextParts.length > 0) output.push({ ...message, content: nextParts });
  }

  return { messages: output, appliedStatus };
}
