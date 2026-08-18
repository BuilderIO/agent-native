import type { NodeRewriteTarget } from "@shared/node-rewrite";

const MAX_SUBTREE_EXCERPT_LENGTH = 4_000;

export const NODE_REPROMPT_RESOLVED_EVENT = "design:node-reprompt-resolved";
export const NODE_REPROMPT_PRESENTED_EVENT = "design:node-reprompt-presented";

export type NodeRepromptSendMode = "preview" | "ask";

const QUESTION_OPENING =
  /^(?:what|why|how|which|where|when|who|should|would|could|can|do|does|is|are)\b/i;
const QUESTION_INTENT =
  /\b(?:explain|review|critique|feedback|thoughts|opinion|recommend|suggest(?:ion)?s?|ideas?|compare)\b/i;
const EDIT_INTENT =
  /\b(?:make|change|replace|add|remove|delete|use|set|turn|update|rewrite|reword|shorten|lengthen|move|resize|align|center|increase|decrease|darken|lighten|tighten|loosen|swap|convert|style|restyle|redesign|improve|fix|create|generate|show)\b/i;
const POLITE_EDIT_INTENT =
  /^(?:please\s+)?(?:can|could|would)\s+you\s+(?:please\s+)?(?:make|change|replace|add|remove|delete|use|set|turn|update|rewrite|reword|shorten|lengthen|move|resize|align|center|increase|decrease|darken|lighten|tighten|loosen|swap|convert|style|restyle|redesign|improve|fix|create|generate|show)\b/i;

export function inferNodeRepromptSendMode(
  instruction: string,
  options: { hasEditableTarget: boolean },
): NodeRepromptSendMode {
  const value = instruction.trim();
  if (!value || !options.hasEditableTarget) return "ask";
  if (POLITE_EDIT_INTENT.test(value)) return "preview";
  if (QUESTION_OPENING.test(value) || value.endsWith("?")) return "ask";
  if (QUESTION_INTENT.test(value) && !EDIT_INTENT.test(value)) return "ask";
  if (EDIT_INTENT.test(value) || /\bgive\s+(?:this|it)\b/i.test(value)) {
    return "preview";
  }
  return "ask";
}

function targetLabel(target: NodeRewriteTarget): string {
  return target.nodeId ?? target.selector ?? "unknown";
}

export function nodeRepromptSubtreeExcerpt(html?: string | null): string {
  const value = html?.trim() ?? "";
  if (value.length <= MAX_SUBTREE_EXCERPT_LENGTH) return value;
  return `${value.slice(0, MAX_SUBTREE_EXCERPT_LENGTH)}\n<!-- excerpt truncated -->`;
}

interface NodeRepromptSubmissionArgs {
  repromptId: string;
  designId: string;
  fileId: string;
  target: NodeRewriteTarget;
  baseVersionHash: string;
  instruction: string;
  subtreeHtml?: string | null;
  priorProposalId?: string;
}

type NodeSelectionQuestionArgs = Omit<
  NodeRepromptSubmissionArgs,
  "repromptId" | "baseVersionHash" | "priorProposalId"
>;

function formatNodeRepromptContext(args: NodeRepromptSubmissionArgs): string {
  return [
    "[Reprompt selection]",
    `repromptId: ${args.repromptId}`,
    `designId: ${args.designId}`,
    `fileId: ${args.fileId}`,
    `baseVersionHash: ${args.baseVersionHash}`,
    `target: ${targetLabel(args.target)}`,
    args.target.nodeId ? `targetNodeId: ${args.target.nodeId}` : "",
    args.target.selector ? `targetSelector: ${args.target.selector}` : "",
    args.priorProposalId ? `priorProposalId: ${args.priorProposalId}` : "",
    "--- selected subtree (outerHTML excerpt, truncated) ---",
    nodeRepromptSubtreeExcerpt(args.subtreeHtml),
    "--- instruction ---",
    args.instruction.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatNodeRepromptSubmission(
  args: NodeRepromptSubmissionArgs,
): { message: string; context: string } {
  return {
    message: args.instruction.trim(),
    context: formatNodeRepromptContext(args),
  };
}

export function formatNodeSelectionQuestion(args: NodeSelectionQuestionArgs): {
  message: string;
  context: string;
} {
  return {
    message: args.instruction.trim(),
    context: [
      "[Selection question]",
      `designId: ${args.designId}`,
      `fileId: ${args.fileId}`,
      `target: ${targetLabel(args.target)}`,
      args.target.nodeId ? `targetNodeId: ${args.target.nodeId}` : "",
      args.target.selector ? `targetSelector: ${args.target.selector}` : "",
      "--- selected subtree (outerHTML excerpt, truncated) ---",
      nodeRepromptSubtreeExcerpt(args.subtreeHtml),
      "--- question ---",
      args.instruction.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
