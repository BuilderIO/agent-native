export const PLAN_COMMENT_RESOLUTION_TARGETS = ["agent", "human"] as const;
export const SOURCE_AUTHOR_COMMENT_MENTION_EMAIL = "source-author@plan.local";

export type PlanCommentResolutionTarget =
  (typeof PLAN_COMMENT_RESOLUTION_TARGETS)[number];

export type PlanCommentMention = {
  email: string;
  label: string;
  role?: string;
};

export type PlanCommentAnchor = {
  x?: number;
  y?: number;
  sectionId?: string;
  sectionTitle?: string;
  screenId?: string;
  tabPanelId?: string;
  tabLabel?: string;
  snippet?: string;
  targetSelector?: string;
  targetX?: number;
  targetY?: number;
  tagName?: string;
  anchorKind?: "text" | "visual" | "point";
  textQuote?: string;
  visualLabel?: string;
  visualX?: number;
  visualY?: number;
  canvasX?: number;
  canvasY?: number;
  markupType?: "text" | "callout";
  planAnnotationId?: string;
  resolutionTarget?: PlanCommentResolutionTarget;
  mentions?: PlanCommentMention[];
  targetKind?:
    | "text"
    | "image"
    | "prototype"
    | "wireframe"
    | "canvas"
    | "diagram"
    | "table"
    | "code"
    | "control"
    | "block"
    | "unknown";
  targetLabel?: string;
  targetText?: string;
  targetAlt?: string;
  targetSrc?: string;
  contextBefore?: string;
  contextAfter?: string;
  visualContext?: string;
  blockType?: string;
  ambiguous?: boolean;
  markerSeq?: number;
  /** Stable wireframe/design node id (addressable by wireframe/design patch ops). */
  targetNodeId?: string;
  /** Human-readable path of ancestor wireframe nodes, e.g. `card > list > listItem "Acme Inc"`. */
  targetNodePath?: string;
  /** Board world width in px (for canvas comments). */
  canvasWidth?: number;
  /** Board world height in px (for canvas comments). */
  canvasHeight?: number;
};

const mentionTokenPattern = /@\[([^\]]+)\]\(mailto:([^)]+)\)/g;

export function normalizePlanCommentResolutionTarget(
  value: unknown,
): PlanCommentResolutionTarget {
  return value === "human" ? "human" : "agent";
}

export function normalizeCommentMention(
  mention: unknown,
): PlanCommentMention | null {
  if (!mention || typeof mention !== "object") return null;
  const candidate = mention as Partial<PlanCommentMention>;
  const email = candidate.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  const label = candidate.label?.trim() || email.replace(/@.*/, "");
  return {
    email,
    label,
    ...(candidate.role?.trim() ? { role: candidate.role.trim() } : {}),
  };
}

export function normalizeCommentMentions(
  mentions: unknown,
): PlanCommentMention[] {
  if (!Array.isArray(mentions)) return [];
  const seen = new Set<string>();
  const normalized: PlanCommentMention[] = [];
  for (const mention of mentions) {
    const item = normalizeCommentMention(mention);
    if (!item || seen.has(item.email)) continue;
    seen.add(item.email);
    normalized.push(item);
  }
  return normalized;
}

export function extractCommentMentions(message: string): PlanCommentMention[] {
  const mentions: PlanCommentMention[] = [];
  const seen = new Set<string>();
  mentionTokenPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = mentionTokenPattern.exec(message)) !== null) {
    const label = match[1]?.trim();
    const email = decodeURIComponent(match[2] ?? "")
      .trim()
      .toLowerCase();
    if (!label || !email || seen.has(email)) continue;
    seen.add(email);
    mentions.push({ label, email });
  }
  return mentions;
}

export function formatPlanCommentMentionToken(
  mention: PlanCommentMention,
): string {
  const label = mention.label.trim() || mention.email.replace(/@.*/, "");
  return `@[${label}](mailto:${encodeURIComponent(mention.email)})`;
}

export function parsePlanCommentAnchor(
  anchor: string | PlanCommentAnchor | null | undefined,
): PlanCommentAnchor | null {
  if (!anchor) return null;
  if (typeof anchor === "object") {
    return normalizePlanCommentAnchor(anchor);
  }
  try {
    const parsed = JSON.parse(anchor) as PlanCommentAnchor;
    return normalizePlanCommentAnchor(parsed);
  } catch {
    return null;
  }
}

function normalizePlanCommentAnchor(
  anchor: PlanCommentAnchor | null | undefined,
): PlanCommentAnchor | null {
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) {
    return null;
  }
  return {
    ...anchor,
    resolutionTarget: normalizePlanCommentResolutionTarget(
      anchor.resolutionTarget,
    ),
    mentions: normalizeCommentMentions(anchor.mentions),
  };
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed || null;
}

function sectionPrefix(anchor: PlanCommentAnchor) {
  const section =
    clean(anchor.sectionTitle) && anchor.sectionTitle !== "Visible plan area"
      ? `${clean(anchor.sectionTitle)}: `
      : "";
  const tab = clean(anchor.tabLabel) ? `${clean(anchor.tabLabel)} tab / ` : "";
  return `${tab}${section}`;
}

export function formatPlanCommentAnchorForAgent(
  anchor: PlanCommentAnchor | null,
): string {
  if (!anchor) return "";
  const prefix = sectionPrefix(anchor);
  const quote = clean(anchor.textQuote) || clean(anchor.snippet);
  if (quote) return `${prefix}"${quote}"`;

  const target = clean(anchor.targetLabel) || clean(anchor.visualLabel);
  if (anchor.planAnnotationId || anchor.canvasX !== undefined) {
    const kind =
      anchor.markupType === "callout"
        ? "callout"
        : anchor.markupType === "text"
          ? "note"
          : "markup";
    let canvasPoint = "";
    if (anchor.canvasX !== undefined && anchor.canvasY !== undefined) {
      const cx = Math.round(anchor.canvasX);
      const cy = Math.round(anchor.canvasY);
      canvasPoint =
        anchor.canvasWidth !== undefined && anchor.canvasHeight !== undefined
          ? ` at canvas ${cx}, ${cy} of ${Math.round(anchor.canvasWidth)} x ${Math.round(anchor.canvasHeight)} board px`
          : ` at canvas ${cx}, ${cy} (board px)`;
    }
    return `${prefix}${target || "canvas"} ${kind}${canvasPoint}`;
  }

  if (anchor.anchorKind === "visual") {
    const x = Math.round(anchor.visualX ?? anchor.targetX ?? anchor.x ?? 0);
    const y = Math.round(anchor.visualY ?? anchor.targetY ?? anchor.y ?? 0);
    const nodePart = anchor.targetNodePath
      ? `${anchor.targetNodePath} `
      : `${target || anchor.targetKind || "visual"} `;
    const coordPart = `${x}% across / ${y}% down within the ${anchor.targetKind || "target"}`;
    return `${prefix}${nodePart}at ${coordPart}`;
  }

  if (prefix) return prefix.replace(/: $/, "");

  // Enriched pinned fallback: document-level coordinates are better than a
  // bare "Pinned to plan" — they at least localize the pin on the page.
  if (anchor.x !== undefined && anchor.y !== undefined) {
    return `Pinned at ${Math.round(anchor.x)}% across / ${Math.round(anchor.y)}% down of the full plan document`;
  }

  return "Pinned to plan";
}

export function planCommentAnchorDetails(
  anchor: PlanCommentAnchor | null,
): string[] {
  if (!anchor) return [];
  const lines: string[] = [
    `Expected resolver: ${
      normalizePlanCommentResolutionTarget(anchor.resolutionTarget) === "human"
        ? "human reviewer"
        : "agent"
    }`,
  ];
  const location = formatPlanCommentAnchorForAgent(anchor);
  if (location) lines.push(`Location: ${location}`);
  if (anchor.targetKind || anchor.targetLabel || anchor.targetText) {
    const target = [
      anchor.targetKind ? `kind=${anchor.targetKind}` : "",
      clean(anchor.targetLabel) ? `label="${clean(anchor.targetLabel)}"` : "",
      clean(anchor.targetText) ? `text="${clean(anchor.targetText)}"` : "",
    ]
      .filter(Boolean)
      .join(", ");
    if (target) lines.push(`Target: ${target}`);
  }
  if (anchor.screenId) lines.push(`Prototype screen: ${anchor.screenId}`);
  if (anchor.targetAlt) lines.push(`Image alt: "${clean(anchor.targetAlt)}"`);
  if (anchor.targetSrc) lines.push(`Image source: ${anchor.targetSrc}`);
  if (anchor.targetSelector) lines.push(`Selector: ${anchor.targetSelector}`);
  if (anchor.targetX !== undefined && anchor.targetY !== undefined) {
    lines.push(
      `Target point: ${Math.round(anchor.targetX)}% across / ${Math.round(
        anchor.targetY,
      )}% down within the ${anchor.targetKind || "target"}`,
    );
  }
  if (anchor.canvasX !== undefined && anchor.canvasY !== undefined) {
    const cx = Math.round(anchor.canvasX);
    const cy = Math.round(anchor.canvasY);
    const canvasPointLine =
      anchor.canvasWidth !== undefined && anchor.canvasHeight !== undefined
        ? `Canvas point: canvas ${cx}, ${cy} of ${Math.round(anchor.canvasWidth)} x ${Math.round(anchor.canvasHeight)} board px`
        : `Canvas point: canvas ${cx}, ${cy} (board px)`;
    lines.push(canvasPointLine);
  }
  if (anchor.targetNodeId || anchor.targetNodePath) {
    const idPart = anchor.targetNodeId
      ? `id="${anchor.targetNodeId}" (addressable by wireframe/design patch ops)`
      : "";
    const pathPart = anchor.targetNodePath
      ? `path: ${anchor.targetNodePath}`
      : "";
    const nodeLine = [idPart, pathPart].filter(Boolean).join(", ");
    lines.push(`Wireframe node: ${nodeLine}`);
  }
  if (anchor.contextBefore) {
    lines.push(`Text before: "${clean(anchor.contextBefore)}"`);
  }
  if (anchor.contextAfter) {
    lines.push(`Text after: "${clean(anchor.contextAfter)}"`);
  }
  if (anchor.visualContext) {
    lines.push(`Visual context: ${clean(anchor.visualContext)}`);
  }
  if (anchor.blockType) lines.push(`Block type: ${anchor.blockType}`);
  if (anchor.ambiguous) {
    lines.push("Ambiguous: this quote may match more than one place.");
  }
  const mentions = normalizeCommentMentions(anchor.mentions);
  if (mentions.length > 0) {
    lines.push(
      `Mentioned: ${mentions
        .map((mention) => `${mention.label} <${mention.email}>`)
        .join(", ")}`,
    );
  }
  return lines;
}
