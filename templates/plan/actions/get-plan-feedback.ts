import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { loadPlanBundle } from "../server/plans.js";
import {
  formatPlanCommentAnchorForAgent,
  parsePlanCommentAnchor,
  planCommentAnchorDetails,
  type PlanCommentAnchor,
} from "../shared/comment-context.js";
import type { PlanComment } from "../shared/types.js";

function commentAnchorContext(anchor: PlanCommentAnchor | null) {
  const context = formatPlanCommentAnchorForAgent(anchor);
  return context && context !== "Pinned to plan" ? context : null;
}

function commentAnchorForAgent(comment: PlanComment) {
  const parsedAnchor = parsePlanCommentAnchor(comment.anchor);
  if (!parsedAnchor) return null;
  return {
    ...parsedAnchor,
    resolutionTarget: comment.resolutionTarget ?? parsedAnchor.resolutionTarget,
    mentions:
      comment.mentions && comment.mentions.length > 0
        ? comment.mentions
        : parsedAnchor.mentions,
  };
}

function withAgentAnchorContext<T extends PlanComment>(comment: T) {
  const anchor = commentAnchorForAgent(comment);
  return {
    ...comment,
    anchorContext: commentAnchorContext(anchor),
    anchorDetails: planCommentAnchorDetails(anchor),
  };
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
      const rootAnchor = commentAnchorForAgent(root);
      return {
        id: root.id,
        root: withAgentAnchorContext(root),
        replies: comments
          .filter((comment) => comment.id !== root.id)
          .map((comment) => withAgentAnchorContext(comment)),
        comments: comments.map((comment) => withAgentAnchorContext(comment)),
        status: comments.some((comment) => comment.status === "open")
          ? "open"
          : "resolved",
        commentCount: comments.length,
        anchorContext: commentAnchorContext(rootAnchor),
        anchorDetails: planCommentAnchorDetails(rootAnchor),
      };
    });
}

function threadResolutionTarget(
  thread: ReturnType<typeof buildFeedbackThreads>[number],
) {
  const root = thread.root as PlanComment & {
    resolutionTarget?: "agent" | "human";
  };
  const anchor = commentAnchorForAgent(root);
  return root.resolutionTarget ?? anchor?.resolutionTarget ?? "agent";
}

function isVisualFeedbackThread(
  thread: ReturnType<typeof buildFeedbackThreads>[number],
) {
  const anchor = commentAnchorForAgent(thread.root);
  if (!anchor) return false;
  if (anchor.anchorKind === "text" && anchor.textQuote) return false;
  return Boolean(
    anchor.planAnnotationId ||
    anchor.canvasX !== undefined ||
    anchor.anchorKind === "visual" ||
    anchor.anchorKind === "point" ||
    anchor.targetKind === "image" ||
    anchor.targetKind === "prototype" ||
    anchor.targetKind === "wireframe" ||
    anchor.targetKind === "canvas" ||
    anchor.targetKind === "diagram",
  );
}

function feedbackTargetId(
  thread: ReturnType<typeof buildFeedbackThreads>[number],
) {
  const anchor = commentAnchorForAgent(thread.root);
  if (anchor?.planAnnotationId)
    return `canvas-annotation:${anchor.planAnnotationId}`;
  if (anchor?.sectionId) return `section:${anchor.sectionId}`;
  if (anchor?.targetSelector) return `selector:${anchor.targetSelector}`;
  if (anchor?.sectionTitle) return `section-title:${anchor.sectionTitle}`;
  return `thread:${thread.id}`;
}

function buildFeedbackTargets(
  threads: ReturnType<typeof buildFeedbackThreads>,
) {
  const targets = new Map<
    string,
    {
      targetId: string;
      kind: string;
      sectionTitle: string | null;
      anchorContext: string | null;
      threads: Array<{
        id: string;
        status: string;
        resolutionTarget: "agent" | "human";
        anchorDetails: string[];
        comments: Array<{
          id: string;
          createdBy: string;
          authorEmail?: string | null;
          authorName?: string | null;
          message: string;
          createdAt: string;
        }>;
      }>;
    }
  >();

  for (const thread of threads) {
    const anchor = commentAnchorForAgent(thread.root);
    const targetId = feedbackTargetId(thread);
    const target = targets.get(targetId) ?? {
      targetId,
      kind: anchor?.targetKind ?? anchor?.anchorKind ?? "plan",
      sectionTitle: anchor?.sectionTitle ?? null,
      anchorContext: commentAnchorContext(anchor),
      threads: [],
    };
    target.threads.push({
      id: thread.id,
      status: thread.status,
      resolutionTarget: threadResolutionTarget(thread),
      anchorDetails: planCommentAnchorDetails(anchor),
      comments: thread.comments.map((comment) => ({
        id: comment.id,
        createdBy: comment.createdBy,
        authorEmail: comment.authorEmail,
        authorName: comment.authorName,
        message: comment.message,
        createdAt: comment.createdAt,
      })),
    });
    targets.set(targetId, target);
  }

  return Array.from(targets.values()).sort((a, b) => {
    const aActionable = a.threads.some(
      (thread) =>
        thread.status === "open" && thread.resolutionTarget === "agent",
    );
    const bActionable = b.threads.some(
      (thread) =>
        thread.status === "open" && thread.resolutionTarget === "agent",
    );
    if (aActionable !== bActionable) return aActionable ? -1 : 1;
    return a.targetId.localeCompare(b.targetId);
  });
}

function feedbackThreadManifest(
  thread: ReturnType<typeof buildFeedbackThreads>[number],
) {
  return {
    ...thread,
    resolutionTarget: threadResolutionTarget(thread),
    isVisual: isVisualFeedbackThread(thread),
  };
}

export default defineAction({
  description:
    "Get unconsumed human comments, corrections, questions, and annotations for an Agent-Native Plan. Call this before acting on a plan to surface reviewer feedback, open threads, and recent edit events.",
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
  mcpApp: {
    compactCatalog: true,
  },
  run: async (args) => {
    const bundle = await loadPlanBundle(args.planId);
    const comments = bundle.comments
      .filter((comment) => comment.createdBy === "human" && !comment.consumedAt)
      .map((comment) => withAgentAnchorContext(comment));
    const threads = buildFeedbackThreads(bundle.comments, comments).map(
      feedbackThreadManifest,
    );
    const actionableThreads = threads.filter(
      (thread) =>
        thread.status === "open" && thread.resolutionTarget === "agent",
    );
    const humanReviewThreads = threads.filter(
      (thread) =>
        thread.status === "open" && thread.resolutionTarget === "human",
    );
    const visualThreads = threads.filter((thread) => thread.isVisual);
    const feedbackImageBudget = 8;
    const overflowVisual = visualThreads
      .slice(feedbackImageBudget)
      .map((thread) => ({
        id: thread.id,
        anchorContext: thread.anchorContext,
        anchorDetails: thread.anchorDetails,
        resolutionTarget: thread.resolutionTarget,
        commentIds: thread.comments.map((comment) => comment.id),
      }));
    const recentReviewEvents = bundle.events
      .filter((event) => event.type === "plan.updated")
      .slice(-10)
      .map((event) => ({
        id: event.id,
        message: event.message,
        createdBy: event.createdBy,
        createdAt: event.createdAt,
        payload: event.payload,
      }));
    return {
      plan: bundle.plan,
      sections: bundle.sections,
      comments,
      threads,
      actionableThreads,
      humanReviewThreads,
      targets: buildFeedbackTargets(threads),
      feedbackSummary: {
        openThreadCount: threads.filter((thread) => thread.status === "open")
          .length,
        resolvedThreadCount: threads.filter(
          (thread) => thread.status === "resolved",
        ).length,
        actionableThreadCount: actionableThreads.length,
        humanReviewThreadCount: humanReviewThreads.length,
        visualThreadCount: visualThreads.length,
        feedbackImageBudget,
        overflowVisualCount: overflowVisual.length,
      },
      overflowVisual,
      recentReviewEvents,
      instructions: [
        "Treat actionableThreads as agent-owned work. Human-review threads are visible context unless the user asks you to reply or resolve them.",
        "Each thread includes anchorDetails with the exact selected text, nearby text, canvas point, visual target, selector, or section context available for that comment.",
        "Focused screenshot attachments, when present in the chat, are ordered to match visual actionable feedback first. Each screenshot includes a red ring around the comment point.",
        "If overflowVisual is non-empty, some visual comments were not screenshotted because of the image budget; use their anchorDetails and ask for more visual context before making pixel-sensitive changes.",
        "Use recentReviewEvents to understand human edits made alongside comments; event payloads include targeted content patch metadata when available.",
      ],
      summary: bundle.summary,
    };
  },
});
