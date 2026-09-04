import type {
  CodeLayerNode,
  CodeLayerSource,
  EditIntentTarget,
} from "./code-layer.js";
import { resolveCodeLayerTarget } from "./code-layer.js";
import { assertDesignHtmlEditIntegrity } from "./html-integrity.js";
import { annotateScreenHtmlForPersist } from "./screen-annotation.js";

export const DESIGN_REPROMPT_PENDING_STATE_PREFIX = "design-reprompt-pending:";
export const DESIGN_REPROMPT_PROPOSAL_STATE_PREFIX =
  "design-reprompt-proposal:";
export const MAX_NODE_REWRITE_PROPOSAL_BYTES = 256 * 1024;

export type NodeRewriteTarget = EditIntentTarget;

export interface PendingDesignReprompt {
  status?: "pending";
  repromptId: string;
  designId: string;
  fileId: string;
  target: NodeRewriteTarget;
  baseVersionHash: string;
  instruction: string;
  createdAt: string;
  priorProposalId?: string;
  priorRepromptId?: string;
}

export interface NodeRewriteResolutionClaim extends Omit<
  PendingDesignReprompt,
  "status"
> {
  status: "resolving";
  claimId: string;
  proposalId: string;
  resolution: "accept";
}

export interface NodeRewriteVariant {
  html: string;
  summary: string;
}

export interface NodeRewriteProposal {
  proposalId: string;
  repromptId: string;
  designId: string;
  fileId: string;
  filename: string;
  target: NodeRewriteTarget;
  resolvedTarget: Required<NodeRewriteTarget>;
  baseVersionHash: string;
  variants: NodeRewriteVariant[];
  chosenIndex: number;
  createdAt: string;
}

export function isNodeRewriteProposal(
  value: unknown,
): value is NodeRewriteProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proposal = value as Partial<NodeRewriteProposal>;
  return (
    typeof proposal.proposalId === "string" &&
    typeof proposal.repromptId === "string" &&
    typeof proposal.designId === "string" &&
    typeof proposal.fileId === "string" &&
    typeof proposal.baseVersionHash === "string" &&
    Boolean(proposal.target) &&
    Boolean(proposal.resolvedTarget) &&
    Array.isArray(proposal.variants) &&
    proposal.variants.length > 0
  );
}

export function isPendingDesignReprompt(
  value: unknown,
): value is PendingDesignReprompt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pending = value as Partial<PendingDesignReprompt>;
  return (
    (pending.status === undefined || pending.status === "pending") &&
    typeof pending.repromptId === "string" &&
    typeof pending.designId === "string" &&
    typeof pending.fileId === "string" &&
    typeof pending.baseVersionHash === "string" &&
    typeof pending.instruction === "string" &&
    typeof pending.createdAt === "string" &&
    Boolean(pending.target)
  );
}

export function isNodeRewriteResolutionClaim(
  value: unknown,
): value is NodeRewriteResolutionClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claim = value as Partial<NodeRewriteResolutionClaim>;
  return (
    claim.status === "resolving" &&
    typeof claim.claimId === "string" &&
    typeof claim.proposalId === "string" &&
    claim.resolution === "accept" &&
    typeof claim.repromptId === "string" &&
    typeof claim.designId === "string" &&
    typeof claim.fileId === "string" &&
    typeof claim.baseVersionHash === "string" &&
    typeof claim.instruction === "string" &&
    typeof claim.createdAt === "string" &&
    Boolean(claim.target)
  );
}

export interface NodeHtmlPreviewBridgeMessage {
  type: "node-html-preview";
  proposalId: string;
  target: NodeRewriteTarget;
  operation: "preview" | "restore";
  html?: string;
}

export function designRepromptPendingStateKey(
  designId: string,
  fileId: string,
): string {
  return `${DESIGN_REPROMPT_PENDING_STATE_PREFIX}${designId}:${fileId}`;
}

export function designRepromptProposalStateKey(
  designId: string,
  fileId: string,
  repromptId: string,
): string {
  return `${DESIGN_REPROMPT_PROPOSAL_STATE_PREFIX}${designId}:${fileId}:${repromptId}`;
}

export function designRepromptProposalStatePrefix(
  designId: string,
  fileId?: string,
): string {
  return `${DESIGN_REPROMPT_PROPOSAL_STATE_PREFIX}${designId}:${fileId ? `${fileId}:` : ""}`;
}

function assertSingleElementFragment(
  html: string,
  source: CodeLayerSource,
): void {
  if (!html.trim()) throw new Error("Variant HTML must not be empty.");
  if (/<\/?(?:html|head|body)\b|<!doctype\b/i.test(html)) {
    throw new Error("Variant HTML must be one subtree, not a full document.");
  }

  const { projection } = resolveCodeLayerTarget(
    html,
    { selector: "__node_rewrite_validation_target__" },
    { source },
  );
  if (projection.rootNodeIds.length !== 1) {
    throw new Error("Variant HTML must contain exactly one root element.");
  }
  const root = projection.nodes.find(
    (node) => node.id === projection.rootNodeIds[0],
  );
  if (!root?.source) {
    throw new Error("Variant HTML could not be parsed as an element subtree.");
  }
  if (
    html.slice(0, root.source.start).trim() ||
    html.slice(root.source.end).trim()
  ) {
    throw new Error("Variant HTML must contain exactly one root element.");
  }

  const voidElements = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  const unclosed = projection.nodes.find(
    (node) =>
      node.source &&
      !voidElements.has(node.tag) &&
      node.source.closeEnd === undefined,
  );
  if (unclosed) {
    throw new Error(`Variant HTML has an unclosed <${unclosed.tag}> element.`);
  }
}

export function validateNodeRewriteVariant(
  variant: NodeRewriteVariant,
  source: CodeLayerSource,
): NodeRewriteVariant {
  const html = variant.html.trim();
  assertSingleElementFragment(html, source);
  return { html, summary: variant.summary.trim() };
}

export function resolveNodeRewriteTarget(
  content: string,
  target: NodeRewriteTarget,
  source: CodeLayerSource,
): CodeLayerNode {
  const { resolution } = resolveCodeLayerTarget(content, target, { source });
  if (resolution.status !== "resolved" || !resolution.node?.source) {
    throw new Error(
      `Target missing — re-anchor the selection. ${resolution.message ?? "The selected node no longer exists."}`,
    );
  }
  return resolution.node;
}

export function spliceNodeRewriteVariant(args: {
  content: string;
  target: NodeRewriteTarget;
  variant: NodeRewriteVariant;
  source: CodeLayerSource;
  fileType: string;
}): { content: string; node: CodeLayerNode; variant: NodeRewriteVariant } {
  const node = resolveNodeRewriteTarget(args.content, args.target, args.source);
  const variant = validateNodeRewriteVariant(args.variant, args.source);
  const replacement = annotateScreenHtmlForPersist(variant.html, args.fileType);
  const nextContent = `${args.content.slice(0, node.source!.start)}${replacement}${args.content.slice(node.source!.end)}`;
  assertDesignHtmlEditIntegrity({
    previousContent: args.content,
    nextContent,
    fileType: args.fileType,
  });
  return {
    content: nextContent,
    node,
    variant: { ...variant, html: replacement },
  };
}
