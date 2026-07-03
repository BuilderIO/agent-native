/**
 * run-design-audit — read-only a11y audit over a design's rendered HTML/DOM.
 *
 * Flags low-opacity text color classes as a contrast hint (real contrast
 * ratios require a DOM/CSS cascade resolver that isn't available server-side,
 * so this is not a computed ratio check), plus tap-target sizes, missing
 * alt/labels, focus visibility, and reduced-motion concerns, all by static
 * analysis of the stored HTML. Does NOT perform writes. Results are returned
 * as `A11yFinding[]` and may be persisted by the caller via
 * `create-design-review-snapshot`.
 *
 * See DESIGN-STUDIO-PLAN.md §6.5 + §7 (Review surface).
 */

import { defineAction } from "@agent-native/core";
import { getText, hasCollabState } from "@agent-native/core/collab";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import type {
  A11yFinding,
  A11yFindingCategory,
  A11ySeverity,
} from "../shared/design-review.js";

// ---------------------------------------------------------------------------
// HTML helpers (static analysis — no DOM runtime available server-side)
// ---------------------------------------------------------------------------

/** Extract all attribute values matching a simple regex over raw HTML. */
function extractAttrs(
  html: string,
  tagPattern: RegExp,
  attrName: string,
): string[] {
  const attrRegex = new RegExp(
    `${attrName}\\s*=\\s*(?:"([^"]*?)"|'([^']*?)')`,
    "gi",
  );
  const results: string[] = [];
  let match: RegExpExecArray | null;
  const tagMatches = [...html.matchAll(tagPattern)];
  for (const tm of tagMatches) {
    attrRegex.lastIndex = 0;
    while ((match = attrRegex.exec(tm[0])) !== null) {
      results.push(match[1] ?? match[2] ?? "");
    }
  }
  return results;
}

/** Pull a node id from a raw tag string (data-agent-native-node-id attr). */
function extractNodeId(tagHtml: string): string | undefined {
  const m = tagHtml.match(
    /data-agent-native-node-id\s*=\s*(?:"([^"]*?)"|'([^']*?)')/i,
  );
  return m ? (m[1] ?? m[2] ?? undefined) : undefined;
}

/** Pull a CSS selector hint from a raw tag string (id or class). */
function extractSelector(tagHtml: string, tagName: string): string | undefined {
  const idMatch = tagHtml.match(/\bid\s*=\s*(?:"([^"]*?)"|'([^']*?)')/i);
  if (idMatch) return `#${idMatch[1] ?? idMatch[2]}`;
  const classMatch = tagHtml.match(/\bclass\s*=\s*(?:"([^"]*?)"|'([^']*?)')/i);
  if (classMatch) {
    const first = (classMatch[1] ?? classMatch[2] ?? "").trim().split(/\s+/)[0];
    if (first) return `${tagName.toLowerCase()}.${first}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Individual audit checks
// ---------------------------------------------------------------------------

/** Check <img> tags without a meaningful alt attribute. */
function checkMissingAlt(html: string): A11yFinding[] {
  const findings: A11yFinding[] = [];
  const imgPattern = /<img\b[^>]*>/gi;
  let idx = 0;
  for (const m of html.matchAll(imgPattern)) {
    const tag = m[0];
    // Missing alt entirely, or empty alt on a non-decorative image (heuristic)
    const altMatch = tag.match(/\balt\s*=\s*(?:"([^"]*?)"|'([^']*?)')/i);
    if (!altMatch) {
      findings.push({
        id: `missing-alt:img-${idx}`,
        severity: "error" as A11ySeverity,
        category: "missing-alt" as A11yFindingCategory,
        message: "<img> is missing an alt attribute.",
        detail:
          'Add alt="" for decorative images or a descriptive alt for informative images.',
        nodeId: extractNodeId(tag),
        selector: extractSelector(tag, "img"),
        wcag: "1.1.1",
        fixAvailable: false,
      });
    }
    idx++;
  }
  return findings;
}

/** Check form inputs without an associated <label> or aria-label/aria-labelledby. */
function checkMissingLabels(html: string): A11yFinding[] {
  const findings: A11yFinding[] = [];
  const inputPattern = /<(?:input|select|textarea)\b[^>]*(?:\/>|>)/gi;
  let idx = 0;
  for (const m of html.matchAll(inputPattern)) {
    const tag = m[0];
    const inputStart = m.index ?? 0;
    const inputEnd = inputStart + tag.length;
    const typeMatch = tag.match(/\btype\s*=\s*(?:"([^"]*?)"|'([^']*?)')/i);
    const type = (typeMatch?.[1] ?? typeMatch?.[2] ?? "text").toLowerCase();
    // Hidden and submit/button/image inputs don't need visible labels
    if (["hidden", "submit", "button", "image", "reset"].includes(type))
      continue;

    const hasAriaLabel =
      /\baria-label\s*=/i.test(tag) ||
      /\baria-labelledby\s*=/i.test(tag) ||
      /\btitle\s*=/i.test(tag);
    const idMatch = tag.match(/\bid\s*=\s*(?:"([^"]*?)"|'([^']*?)')/i);
    const inputId = idMatch?.[1] ?? idMatch?.[2];
    const hasExplicitLabel = inputId
      ? new RegExp(`for\\s*=\\s*(?:"${inputId}"|'${inputId}')`, "i").test(html)
      : false;
    const hasImplicitLabel = isWrappedByLabel(html, inputStart, inputEnd);

    if (!hasAriaLabel && !hasExplicitLabel && !hasImplicitLabel) {
      findings.push({
        id: `missing-label:input-${idx}`,
        severity: "error" as A11ySeverity,
        category: "missing-label" as A11yFindingCategory,
        message: "Form control is missing an accessible label.",
        detail:
          "Associate a <label for> or add aria-label / aria-labelledby to identify this field.",
        nodeId: extractNodeId(tag),
        selector: extractSelector(tag, "input"),
        wcag: "1.3.1",
        fixAvailable: false,
      });
    }
    idx++;
  }
  return findings;
}

function isWrappedByLabel(
  html: string,
  inputStart: number,
  inputEnd: number,
): boolean {
  const labelOpen = html.lastIndexOf("<label", inputStart);
  if (labelOpen === -1) return false;
  const labelCloseBeforeInput = html.lastIndexOf("</label", inputStart);
  if (labelCloseBeforeInput > labelOpen) return false;
  const labelCloseAfterInput = html.indexOf("</label", inputEnd);
  return labelCloseAfterInput !== -1;
}

/**
 * Whether an interactive element already declares a minimum size that meets the
 * 44px tap-target floor. This recognises exactly what the inline auto-fix adds
 * (`min-h-[44px] min-w-[44px]`) plus equivalents — arbitrary `min-h`/`min-w`
 * values in px/rem/em ≥ 44px, the Tailwind spacing scale (`min-h-11` = 44px on a
 * 4px step), and full-bleed minimums (`min-h-full` / `min-h-screen`). Without
 * this, a fixed element keeps its original tiny `h-4` class and the audit would
 * re-flag it forever, so the audit↔fix loop would never converge.
 */
function hasAdequateMinTapSize(tag: string): boolean {
  // Arbitrary values: min-h-[44px], min-w-[2.75rem], etc.
  const arbitraryPattern = /\bmin-(?:h|w)-\[([\d.]+)(px|rem|em)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = arbitraryPattern.exec(tag)) !== null) {
    const value = Number.parseFloat(m[1] ?? "");
    if (!Number.isFinite(value)) continue;
    const px = m[2]?.toLowerCase() === "px" ? value : value * 16;
    if (px >= 44) return true;
  }
  // Tailwind spacing scale: min-h-11 / min-w-11 = 2.75rem = 44px (4px per step).
  const scalePattern = /\bmin-(?:h|w)-(\d+)\b/gi;
  while ((m = scalePattern.exec(tag)) !== null) {
    if (Number.parseInt(m[1] ?? "", 10) * 4 >= 44) return true;
  }
  // Full-bleed minimums always clear the tap floor.
  return /\bmin-(?:h|w)-(?:full|screen)\b/.test(tag);
}

/**
 * Check interactive elements that are likely too small for touch targets
 * (< ~44px heuristic via Tailwind class). Exported for unit tests that assert
 * the audit↔fix loop converges (a fixed element must stop being flagged).
 */
export function checkTapTargets(html: string): A11yFinding[] {
  const findings: A11yFinding[] = [];
  // Heuristic: buttons/links with explicit tiny size classes (h-4, h-5, w-4, w-5, size-4, size-5)
  // and no explicit larger override or sr-only are flagged.
  const interactivePattern =
    /<(button|a|input|select|textarea)\b[^>]*(?:\/>|>)/gi;
  const tinyPattern = /\b(?:h|w|size)-[345]\b/;
  const largePattern = /\b(?:h|w|size)-(?:[6-9]|[1-9]\d)/;
  const srOnlyPattern = /\bsr-only\b/;
  let idx = 0;
  for (const m of html.matchAll(interactivePattern)) {
    const tag = m[0];
    const tagName = (m[1] ?? "button").toLowerCase();
    const typeMatch = tag.match(/\btype\s*=\s*(?:"([^"]*?)"|'([^']*?)')/i);
    if (tagName === "input") {
      const type = (typeMatch?.[1] ?? typeMatch?.[2] ?? "text").toLowerCase();
      if (type === "hidden") continue;
    }
    if (
      tinyPattern.test(tag) &&
      !largePattern.test(tag) &&
      !srOnlyPattern.test(tag) &&
      !hasAdequateMinTapSize(tag)
    ) {
      findings.push({
        id: `tap-target:interactive-${idx}`,
        severity: "warning" as A11ySeverity,
        category: "tap-target" as A11yFindingCategory,
        message: "Interactive element may be too small for a touch target.",
        detail:
          "Minimum recommended tap target size is 44×44 px (WCAG 2.5.5). Consider increasing padding or size.",
        nodeId: extractNodeId(tag),
        selector: extractSelector(tag, tagName),
        wcag: "2.5.5",
        fixAvailable: true,
      });
    }
    idx++;
  }
  return findings;
}

/** Check for animations/transitions without a prefers-reduced-motion guard. */
function checkReducedMotion(html: string): A11yFinding[] {
  const findings: A11yFinding[] = [];
  // Look for <style> blocks that animate but don't include @media (prefers-reduced-motion)
  const stylePattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let styleIdx = 0;
  for (const m of html.matchAll(stylePattern)) {
    const css = m[1] ?? "";
    const hasAnimation =
      /\banimation\b/i.test(css) || /\btransition\b/i.test(css);
    const hasReducedMotionGuard = /prefers-reduced-motion/i.test(css);
    if (hasAnimation && !hasReducedMotionGuard) {
      findings.push({
        id: `reduced-motion:style-${styleIdx}`,
        severity: "warning" as A11ySeverity,
        category: "reduced-motion" as A11yFindingCategory,
        message:
          "CSS animations or transitions are present without a prefers-reduced-motion media query.",
        detail:
          "Wrap animation declarations in @media (prefers-reduced-motion: no-preference) { … } to respect user motion preferences.",
        wcag: "2.3.3",
        fixAvailable: false,
      });
    }
    styleIdx++;
  }
  // Also check inline style attrs with animation/transition
  const inlineAnimPattern =
    /style\s*=\s*(?:"[^"]*(?:animation|transition)[^"]*"|'[^']*(?:animation|transition)[^']*')/gi;
  const allTags = [...html.matchAll(/<[a-z][^>]*>/gi)];
  for (const m of allTags) {
    if (inlineAnimPattern.test(m[0])) {
      findings.push({
        id: `reduced-motion:inline-${findings.length}`,
        severity: "info" as A11ySeverity,
        category: "reduced-motion" as A11yFindingCategory,
        message:
          "Inline style contains animation or transition. Verify it respects prefers-reduced-motion.",
        nodeId: extractNodeId(m[0]),
        selector: extractSelector(m[0], m[0].match(/^<([a-z]+)/i)?.[1] ?? "*"),
        wcag: "2.3.3",
        fixAvailable: false,
      });
    }
    inlineAnimPattern.lastIndex = 0;
  }
  return findings;
}

/** Check for focus-visibility — elements with outline:none/outline:0 and no :focus-visible alternative. */
function checkFocusVisibility(html: string): A11yFinding[] {
  const findings: A11yFinding[] = [];
  const stylePattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let idx = 0;
  for (const m of html.matchAll(stylePattern)) {
    const css = m[1] ?? "";
    const hasFocusOutlineRemoval =
      /:focus\s*\{[^}]*outline\s*:\s*(?:none|0)/i.test(css) ||
      /:focus-within\s*\{[^}]*outline\s*:\s*(?:none|0)/i.test(css);
    const hasFocusVisibleReplacement = /:focus-visible/i.test(css);
    if (hasFocusOutlineRemoval && !hasFocusVisibleReplacement) {
      findings.push({
        id: `focus-visibility:style-${idx}`,
        severity: "warning" as A11ySeverity,
        category: "focus-visibility" as A11yFindingCategory,
        message:
          "outline:none on :focus detected without a :focus-visible alternative.",
        detail:
          "Remove the outline only for pointer users via :focus:not(:focus-visible), and supply a visible style on :focus-visible.",
        wcag: "2.4.7",
        fixAvailable: false,
      });
    }
    idx++;
  }
  // Tailwind outline-none/ring-0 on interactive elements (heuristic)
  const outlineNonePattern =
    /<(?:button|a|input|select|textarea)\b[^>]*\boutline-none\b[^>]*>/gi;
  let inlineIdx = 0;
  for (const m of html.matchAll(outlineNonePattern)) {
    const tag = m[0];
    // Check it's also not carrying a focus-visible ring class
    if (!/\bfocus-visible:/i.test(tag)) {
      findings.push({
        id: `focus-visibility:inline-${inlineIdx}`,
        severity: "info" as A11ySeverity,
        category: "focus-visibility" as A11yFindingCategory,
        message:
          "Interactive element uses outline-none without a focus-visible ring.",
        detail:
          "Add a focus-visible:ring-* class so keyboard users can see which element is focused.",
        nodeId: extractNodeId(tag),
        selector: extractSelector(tag, tag.match(/^<([a-z]+)/i)?.[1] ?? "*"),
        wcag: "2.4.7",
        fixAvailable: true,
      });
    }
    inlineIdx++;
  }
  return findings;
}

/** Check for inline style color declarations that are opaque but very low-contrast (rough heuristic). */
function checkContrastHint(html: string): A11yFinding[] {
  const findings: A11yFinding[] = [];
  // Static analysis cannot compute real contrast ratios without a DOM/CSS
  // cascade resolver. We flag the presence of explicit low-opacity text colors
  // as a human-review hint — the UI will show these as "info" prompts.
  const tagPattern = /<([a-z][a-z0-9:-]*)\b[^>]*>/gi;
  const textColorPattern = /\btext-(?:white|black|gray-\d+)\b/i;
  const lowOpacityPattern = /\b(?:opacity-[0-3]\d|text-opacity-[0-3]\d)\b/i;
  let idx = 0;
  for (const m of html.matchAll(tagPattern)) {
    const tag = m[0];
    const classMatch = tag.match(/\bclass\s*=\s*(?:"([^"]*?)"|'([^']*?)')/i);
    const className = classMatch?.[1] ?? classMatch?.[2] ?? "";
    if (
      !textColorPattern.test(className) ||
      !lowOpacityPattern.test(className)
    ) {
      continue;
    }
    const tagName = m[1] ?? "*";
    const nodeId = extractNodeId(tag);
    const selector = extractSelector(tag, tagName);
    findings.push({
      id: `contrast:low-opacity-${idx}`,
      severity: "info" as A11ySeverity,
      category: "contrast" as A11yFindingCategory,
      message:
        "Text element has a low-opacity modifier — verify contrast ratio meets 4.5:1 minimum.",
      detail:
        "Low-opacity text can fail WCAG 1.4.3. Run a live contrast check in the browser.",
      nodeId,
      selector,
      wcag: "1.4.3",
      fixAvailable: false,
    });
    idx++;
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Live-content helper (matches the pattern in other actions)
// ---------------------------------------------------------------------------

async function liveContent(
  fileId: string,
  storedContent: string,
): Promise<string> {
  try {
    if (await hasCollabState(fileId)) {
      const live = await getText(fileId, "content");
      if (typeof live === "string") return live;
    }
  } catch {
    // SQL content is the deterministic fallback.
  }
  return storedContent;
}

// ---------------------------------------------------------------------------
// Action definition
// ---------------------------------------------------------------------------

export default defineAction({
  description:
    "Run a read-only accessibility audit over a design's rendered HTML. " +
    "Checks contrast hints, tap-target sizes, missing alt attributes, missing " +
    "form labels, focus-visibility gaps, and reduced-motion coverage. " +
    "Returns A11yFinding[] that can be shown in the Review panel or persisted " +
    "via create-design-review-snapshot. No writes are performed.",
  schema: z.object({
    designId: z.string().describe("Design project ID to audit"),
    fileId: z
      .string()
      .optional()
      .describe(
        "Specific design_files.id to audit. Defaults to the primary index.html when omitted.",
      ),
    filename: z
      .string()
      .optional()
      .default("index.html")
      .describe(
        "Filename to audit when fileId is not provided. Defaults to index.html.",
      ),
  }),
  readOnly: true,
  http: { method: "POST" },
  run: async ({ designId, fileId, filename }) => {
    const db = getDb();

    const conditions = [
      accessFilter(schema.designs, schema.designShares),
      eq(schema.designFiles.designId, designId),
      ...(fileId
        ? [eq(schema.designFiles.id, fileId)]
        : [eq(schema.designFiles.filename, filename ?? "index.html")]),
    ];

    const [file] = await db
      .select({
        id: schema.designFiles.id,
        designId: schema.designFiles.designId,
        filename: schema.designFiles.filename,
        fileType: schema.designFiles.fileType,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(and(...conditions))
      .limit(1);

    if (!file) {
      const err = new Error("Design file not found") as Error & {
        statusCode: number;
      };
      err.statusCode = 404;
      throw err;
    }

    const html = await liveContent(file.id, file.content ?? "");

    // Run all audit checks over the static HTML.
    const findings: A11yFinding[] = [
      ...checkMissingAlt(html),
      ...checkMissingLabels(html),
      ...checkTapTargets(html),
      ...checkReducedMotion(html),
      ...checkFocusVisibility(html),
      ...checkContrastHint(html),
    ];

    // Summarise by severity for the agent context.
    const summary = {
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
      info: findings.filter((f) => f.severity === "info").length,
      total: findings.length,
    };

    return {
      designId,
      fileId: file.id,
      filename: file.filename,
      auditedAt: new Date().toISOString(),
      findings,
      summary,
    };
  },
});
