import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { loadPlanBundle } from "../server/plans.js";
import type { PlanComment } from "../shared/types.js";

type FeedbackAnchor = {
  x?: number;
  y?: number;
  sectionTitle?: string;
  snippet?: string;
  textQuote?: string;
  anchorKind?: "text" | "visual" | "point";
  visualLabel?: string;
  visualX?: number;
  visualY?: number;
  canvasX?: number;
  canvasY?: number;
  markupType?: "text" | "callout";
  planAnnotationId?: string;
};

function parseFeedbackAnchor(anchor: unknown): FeedbackAnchor | null {
  if (!anchor) return null;
  if (typeof anchor === "object") return anchor as FeedbackAnchor;
  if (typeof anchor !== "string") return null;
  try {
    const parsed = JSON.parse(anchor) as FeedbackAnchor;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function summarizeFeedbackAnchor(anchor: unknown) {
  const parsed = parseFeedbackAnchor(anchor);
  if (!parsed) return null;
  const section =
    parsed.sectionTitle && parsed.sectionTitle !== "Visible plan area"
      ? `${parsed.sectionTitle}: `
      : "";
  const quote = parsed.textQuote || parsed.snippet;
  if (quote) return `${section}"${quote}"`;
  if (parsed.planAnnotationId || parsed.canvasX !== undefined) {
    const label = parsed.visualLabel || "canvas";
    const kind =
      parsed.markupType === "callout"
        ? "callout"
        : parsed.markupType === "text"
          ? "note"
          : "markup";
    const canvasPoint =
      parsed.canvasX !== undefined && parsed.canvasY !== undefined
        ? ` at canvas ${Math.round(parsed.canvasX)}, ${Math.round(parsed.canvasY)}`
        : "";
    return `${section}${label} ${kind}${canvasPoint}`;
  }
  if (parsed.anchorKind === "visual") {
    const label = parsed.visualLabel || parsed.sectionTitle || "visual";
    const x = Math.round(parsed.visualX ?? parsed.x ?? 0);
    const y = Math.round(parsed.visualY ?? parsed.y ?? 0);
    return `${section}${label} at ${x}% across / ${y}% down`;
  }
  return section ? section.replace(/: $/, "") : null;
}

function commentTime(comment: PlanComment) {
  const time = Date.parse(comment.createdAt);
  return Number.isFinite(time) ? time : 0;
}

function sortComments(comments: PlanComment[]) {
  return [...comments].sort((a, b) => {
    const delta = commentTime(a) - commentTime(b);
    return delta === 0 ? a.id.localeCompare(b.id) : delta;
  });
}

function threadRootFor(comment: PlanComment, byId: Map<string, PlanComment>) {
  let current = comment;
  const seen = new Set<string>();
  while (current.parentCommentId) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    const parent = byId.get(current.parentCommentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

function buildFeedbackThreads(
  allComments: PlanComment[],
  feedbackComments: PlanComment[],
) {
  const byId = new Map(allComments.map((comment) => [comment.id, comment]));
  const feedbackIds = new Set(feedbackComments.map((comment) => comment.id));
  const threads = new Map<
    string,
    { root: PlanComment; comments: PlanComment[] }
  >();

  for (const comment of sortComments(allComments)) {
    const root = threadRootFor(comment, byId);
    const thread =
      threads.get(root.id) ??
      ({ root, comments: [] } satisfies {
        root: PlanComment;
        comments: PlanComment[];
      });
    thread.comments.push(comment);
    threads.set(root.id, thread);
  }

  return Array.from(threads.values())
    .filter((thread) =>
      thread.comments.some((comment) => feedbackIds.has(comment.id)),
    )
    .map((thread) => {
      const comments = sortComments(thread.comments);
      const root =
        comments.find((comment) => comment.id === thread.root.id) ??
        thread.root;
      return {
        id: root.id,
        root: {
          ...root,
          anchorContext: summarizeFeedbackAnchor(root.anchor),
        },
        replies: comments
          .filter((comment) => comment.id !== root.id)
          .map((comment) => ({
            ...comment,
            anchorContext: summarizeFeedbackAnchor(comment.anchor),
          })),
        comments: comments.map((comment) => ({
          ...comment,
          anchorContext: summarizeFeedbackAnchor(comment.anchor),
        })),
        status: comments.some((comment) => comment.status === "open")
          ? "open"
          : "resolved",
        commentCount: comments.length,
        anchorContext: summarizeFeedbackAnchor(root.anchor),
      };
    });
}

export default defineAction({
  description:
    "Get unconsumed human comments, corrections, questions, and annotations for an active Agent-Native Plan.",
  schema: z.object({
    planId: z.string().describe("Plan ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: {
    expose: true,
    readOnly: true,
    requiresAuth: true,
    title: "Get Plan Feedback",
    description:
      "Read plan annotations and feedback the agent has not consumed yet.",
  },
  run: async (args) => {
    const bundle = await loadPlanBundle(args.planId);
    const comments = bundle.comments
      .filter((comment) => comment.createdBy === "human" && !comment.consumedAt)
      .map((comment) => ({
        ...comment,
        anchorContext: summarizeFeedbackAnchor(comment.anchor),
      }));
    return {
      plan: bundle.plan,
      sections: bundle.sections,
      comments,
      threads: buildFeedbackThreads(bundle.comments, comments),
      summary: bundle.summary,
    };
  },
});
