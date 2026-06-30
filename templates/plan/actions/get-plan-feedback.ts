import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { loadPlanBundle } from "../server/plans.js";
import {
  formatPlanCommentAnchorForAgent,
  parsePlanCommentAnchor,
  planCommentAnchorDetails,
  type PlanCommentAnchor,
} from "../shared/comment-context.js";
import type { PlanBlock, PlanContent } from "../shared/plan-content.js";
import type { PlanComment } from "../shared/types.js";

function commentAnchorContext(anchor: PlanCommentAnchor | null) {
  const context = formatPlanCommentAnchorForAgent(anchor);
  // Treat the generic fallback ("Pinned to plan" or enriched coordinate variants)
  // as having no usable anchor context. Only a bare "Pinned to plan" exact match
  // is filtered here; enriched strings like "Pinned at X%..." pass through as
  // they carry real location info.
  return context && context !== "Pinned to plan" ? context : null;
}

/**
 * Normalize text for quote matching. Quotes are captured from rendered DOM
 * text while block fragments are raw markdown, so inline markdown syntax
 * (emphasis markers, code ticks, link wrappers) must be stripped before
 * comparing. The same normalization is applied to both sides, so aggressive
 * stripping stays symmetric and safe.
 */
function normalizeForQuoteMatch(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Collect all searchable text strings from a single content block.
 * Returns an array of normalized text fragments.
 */
function blockTextFragments(block: PlanBlock): string[] {
  const frags: string[] = [];
  switch (block.type) {
    case "rich-text":
      if (block.data.markdown) frags.push(block.data.markdown);
      break;
    case "callout":
      if (block.data.body) frags.push(block.data.body);
      break;
    case "checklist":
      for (const item of block.data.items) {
        if (item.label) frags.push(item.label);
        if (item.note) frags.push(item.note);
      }
      break;
    case "table":
      for (const row of block.data.rows) {
        for (const cell of row) frags.push(cell);
      }
      for (const col of block.data.columns) frags.push(col);
      break;
    case "code":
      if (block.data.code) frags.push(block.data.code);
      if (block.data.caption) frags.push(block.data.caption);
      break;
    case "code-tabs":
      for (const tab of block.data.tabs) {
        frags.push(tab.label);
        frags.push(tab.code);
        if (tab.caption) frags.push(tab.caption);
      }
      break;
    case "implementation-map":
      for (const file of block.data.files) {
        frags.push(file.path);
        frags.push(file.note);
        if (file.title) frags.push(file.title);
        if (file.snippet) frags.push(file.snippet);
      }
      break;
    case "tabs":
      for (const tab of block.data.tabs) {
        frags.push(tab.label);
        for (const child of tab.blocks) {
          frags.push(...blockTextFragments(child));
        }
      }
      break;
    case "columns":
      for (const col of block.data.columns) {
        if (col.label) frags.push(col.label);
        for (const child of col.blocks) {
          frags.push(...blockTextFragments(child));
        }
      }
      break;
    case "mermaid":
      if (block.data.source) frags.push(block.data.source);
      break;
    case "diff":
      frags.push(block.data.before, block.data.after);
      break;
    case "annotated-code":
      frags.push(block.data.code);
      for (const ann of block.data.annotations ?? []) frags.push(ann.note);
      break;
    default:
      // Other block types (wireframe, diagram, image, etc.) have no prose to match.
      break;
  }
  // Also include block-level title/summary
  if (block.title) frags.push(block.title);
  if (block.summary) frags.push(block.summary);
  return frags.filter(Boolean);
}

/**
 * Check whether a quoted snippet still exists in the plan content.
 * Returns true when found, false when definitely gone.
 * Scopes to a sectionId block when provided; searches all blocks when not.
 * Returns true (not detached) for ambiguous cases to avoid false positives.
 */
function quoteExistsInContent(
  quote: string,
  content: PlanContent | null | undefined,
  sectionId: string | null | undefined,
): boolean {
  if (!content?.blocks?.length) return true; // can't determine — be conservative
  const needle = normalizeForQuoteMatch(quote);
  if (!needle) return true;

  let blocks = content.blocks;
  if (sectionId) {
    const scoped = blocks.filter((b) => b.id === sectionId);
    // If the sectionId didn't resolve to any block, fall back to all blocks to
    // avoid marking the quote as detached when the section just changed id.
    if (scoped.length > 0) {
      blocks = scoped;
    }
  }

  for (const block of blocks) {
    const frags = blockTextFragments(block);
    for (const frag of frags) {
      if (normalizeForQuoteMatch(frag).includes(needle)) return true;
    }
  }
  return false;
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

function withAgentAnchorContext<T extends PlanComment>(
  comment: T,
  content?: PlanContent | null,
) {
  const anchor = commentAnchorForAgent(comment);
  // Detach detection only applies to text anchors: visual/point anchors carry
  // a snippet (button labels, section titles) that legitimately may not appear
  // in prose blocks, so checking them would produce false positives.
  const quote =
    anchor?.anchorKind !== "visual" && anchor?.anchorKind !== "point"
      ? anchor?.textQuote
      : undefined;
  const detached =
    typeof quote === "string" && quote.length > 0 && content !== undefined
      ? !quoteExistsInContent(quote, content, anchor?.sectionId)
      : false;
  return {
    ...comment,
    anchorContext: commentAnchorContext(anchor),
    anchorDetails: planCommentAnchorDetails(anchor),
    detached,
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
  feedbackComments: Array<PlanComment & { detached?: boolean }>,
) {
  const byId = new Map(allComments.map((comment) => [comment.id, comment]));
  const feedbackIds = new Set(feedbackComments.map((comment) => comment.id));
  const detachedById = new Map(
    feedbackComments.filter((c) => c.detached).map((c) => [c.id, true]),
  );
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
      // A thread is detached if the root comment's quoted text no longer exists
      // in the current plan content. We use the pre-computed map from
      // feedbackComments; roots not in the feedback set default to false.
      const detached = detachedById.get(root.id) ?? false;
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
        detached,
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
    detached: thread.detached,
  };
}

export default defineAction({
  description:
    "Get unconsumed human comments, corrections, questions, and annotations for an Agent-Native Plan. Call this before acting on a plan to surface reviewer feedback, open threads, and recent edit events. A resolved thread remains in results until consumed — resolve-plan-comment marks the thread done for reviewers but does not remove it; call consume-plan-feedback to exclude it from future results.",
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
    const planContent = bundle.plan.content ?? null;
    const comments = bundle.comments
      .filter((comment) => comment.createdBy === "human" && !comment.consumedAt)
      .map((comment) => withAgentAnchorContext(comment, planContent));
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
    const detachedThreads = threads.filter((thread) => thread.detached);
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
        detachedCount: detachedThreads.length,
        feedbackImageBudget,
        overflowVisualCount: overflowVisual.length,
      },
      detachedThreads: detachedThreads.map((thread) => ({
        id: thread.id,
        anchorContext: thread.anchorContext,
        messageExcerpt: thread.root.message.slice(0, 120),
      })),
      overflowVisual,
      recentReviewEvents,
      instructions: [
        "Treat actionableThreads as agent-owned work. Human-review threads are visible context unless the user asks you to reply or resolve them.",
        "Each thread includes anchorDetails with the exact selected text, nearby text, canvas point, visual target, selector, or section context available for that comment.",
        "Focused screenshot attachments (embedded-app chats only; not available over bare MCP), when present in the chat, are ordered to match visual actionable feedback first. Each screenshot includes a red ring around the comment point.",
        "If overflowVisual is non-empty, some visual comments were not screenshotted because of the image budget; use their anchorDetails and ask for more visual context before making pixel-sensitive changes.",
        "Use recentReviewEvents to understand human edits made alongside comments; event payloads include targeted content patch metadata when available.",
        ...(detachedThreads.length > 0
          ? [
              "Comments marked detached no longer match their quoted text (the prose was rewritten); reconcile them against the current content — do not silently drop them.",
            ]
          : []),
      ],
      summary: bundle.summary,
    };
  },
});
