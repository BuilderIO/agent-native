import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { loadPlanBundle } from "../server/plans.js";

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
  if (parsed.anchorKind === "visual") {
    const label = parsed.visualLabel || parsed.sectionTitle || "visual";
    const x = Math.round(parsed.visualX ?? parsed.x ?? 0);
    const y = Math.round(parsed.visualY ?? parsed.y ?? 0);
    return `${section}${label} at ${x}% across / ${y}% down`;
  }
  return section ? section.replace(/: $/, "") : null;
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
      summary: bundle.summary,
    };
  },
});
