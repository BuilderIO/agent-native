import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";
import { readLiveSourceFile } from "../server/source-workspace.js";
import type {
  A11yFinding,
  A11yFindingCategory,
  A11ySeverity,
} from "../shared/design-review.js";
import {
  describeDesignHtmlIntegrityIssue,
  inspectDesignHtmlDocumentIntegrity,
} from "../shared/html-integrity.js";

function extractNodeId(tagHtml: string): string | undefined {
  const m = tagHtml.match(
    /data-agent-native-node-id\s*=\s*(?:"([^"]*?)"|'([^']*?)')/i,
  );
  return m ? (m[1] ?? m[2] ?? undefined) : undefined;
}

function extractSelector(tagHtml: string, tagName: string): string | undefined {
  const idMatch = tagHtml.match(/\bid\s*=\s*(?:"([^"]*?)"|'([^']*?)')/i);
  if (idMatch) return `#${idMatch[1] ?? idMatch[2]}`;
  const classMatch = tagHtml.match(/\bclass\s*=\s*(?:"([^"]*?)"|'([^']*?)')/i);
  if (classMatch) {
    const classNames = (classMatch[1] ?? classMatch[2] ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (classNames.length > 0) {
      return `${tagName.toLowerCase()}.${classNames.join(".")}`;
    }
  }
  return undefined;
}

function checkMissingAlt(html: string): A11yFinding[] {
  const findings: A11yFinding[] = [];
  const imgPattern = /<img\b[^>]*>/gi;
  let idx = 0;
  for (const m of html.matchAll(imgPattern)) {
    const tag = m[0];
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
    if (["hidden", "submit", "button", "image", "reset"].includes(type))
      continue;

    const hasAriaLabel =
      /\baria-label\s*=/i.test(tag) ||
      /\baria-labelledby\s*=/i.test(tag) ||
      /\btitle\s*=/i.test(tag);
    const idMatch = tag.match(/\bid\s*=\s*(?:"([^"]*?)"|'([^']*?)')/i);
    const inputId = idMatch?.[1] ?? idMatch?.[2];
    const hasExplicitLabel = inputId
      ? new RegExp(
          `for\\s*=\\s*(?:"${escapeRegExp(inputId)}"|'${escapeRegExp(inputId)}')`,
          "i",
        ).test(html)
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

function hasAdequateMinTapSize(tag: string): boolean {
  const arbitraryPattern = /\bmin-(?:h|w)-\[([\d.]+)(px|rem|em)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = arbitraryPattern.exec(tag)) !== null) {
    const value = Number.parseFloat(m[1] ?? "");
    if (!Number.isFinite(value)) continue;
    const px = m[2]?.toLowerCase() === "px" ? value : value * 16;
    if (px >= 44) return true;
  }
  const scalePattern = /\bmin-(?:h|w)-(\d+)\b/gi;
  while ((m = scalePattern.exec(tag)) !== null) {
    if (Number.parseInt(m[1] ?? "", 10) * 4 >= 44) return true;
  }
  return /\bmin-(?:h|w)-(?:full|screen)\b/.test(tag);
}

export function checkTapTargets(html: string): A11yFinding[] {
  const findings: A11yFinding[] = [];
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

export function checkRenderBlockingOverlays(html: string): A11yFinding[] {
  const result = inspectDesignHtmlDocumentIntegrity(html);
  const issues = [...(result.detail ?? []), ...(result.advisory ?? [])].filter(
    (issue) =>
      issue.issue === "runtime-overlay-unhidden" ||
      issue.issue === "runtime-cloak-missing" ||
      issue.issue === "runtime-alpine-missing",
  );

  return issues.map((issue, index) => ({
    id: `render-blocking-overlay:${issue.issue}-${index}`,
    severity: "error" as A11ySeverity,
    category: "render-blocking-overlay" as A11yFindingCategory,
    message:
      "An Alpine-controlled element can cover the screen before Alpine starts.",
    detail: describeDesignHtmlIntegrityIssue(issue),
    fixAvailable: false,
  }));
}

function checkReducedMotion(html: string): A11yFinding[] {
  const findings: A11yFinding[] = [];
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
  const outlineNonePattern =
    /<(?:button|a|input|select|textarea)\b[^>]*\boutline-none\b[^>]*>/gi;
  let inlineIdx = 0;
  for (const m of html.matchAll(outlineNonePattern)) {
    const tag = m[0];
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

function checkContrastHint(html: string): A11yFinding[] {
  const findings: A11yFinding[] = [];
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

// Multi-screen token-drift check
//
// design-generation/SKILL.md's "Multi-screen consistency contract" requires
// every screen's `:root` token block to match index.html's byte-for-byte, but
// nothing enforced it — an agent could silently let a screen's palette drift.
// This extracts each screen's `:root { --name: value; ... }` custom-property
// map and flags any screen whose property VALUES diverge from the design's
// reference screen (index.html, or the first screen when index.html is
// absent). Screens that legitimately have no `:root` block (e.g. a bare
// fragment) are skipped, not flagged — there is nothing to reconcile.

/** One screen's parsed `:root` custom-property map (property name → value). */
export interface RootTokenMap {
  filename: string;
  tokens: Record<string, string>;
}

export function extractRootTokens(html: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  const rootMatch = html.match(/:root\s*\{([^}]*)\}/i);
  if (!rootMatch) return tokens;
  const body = rootMatch[1] ?? "";
  const declPattern = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = declPattern.exec(body)) !== null) {
    const name = m[1]?.trim();
    const value = m[2]?.trim();
    if (name && value !== undefined) tokens[name] = value;
  }
  return tokens;
}

export function checkTokenDrift(
  screens: Array<{ filename: string; html: string }>,
  referenceFilename = "index.html",
): A11yFinding[] {
  const findings: A11yFinding[] = [];
  if (screens.length < 2) return findings;

  const reference =
    screens.find((s) => s.filename === referenceFilename) ?? screens[0];
  const referenceTokens = extractRootTokens(reference.html);
  if (Object.keys(referenceTokens).length === 0) return findings;

  let idx = 0;
  for (const screen of screens) {
    if (screen.filename === reference.filename) continue;
    const screenTokens = extractRootTokens(screen.html);
    if (Object.keys(screenTokens).length === 0) continue;

    for (const [property, referenceValue] of Object.entries(referenceTokens)) {
      const screenValue = screenTokens[property];
      if (screenValue === undefined || screenValue === referenceValue) {
        continue;
      }
      findings.push({
        id: `token-drift:${screen.filename}:${property}-${idx}`,
        severity: "warning" as A11ySeverity,
        category: "token-drift" as A11yFindingCategory,
        message: `"${property}" diverges from ${reference.filename} on ${screen.filename}.`,
        detail:
          `${reference.filename} defines ${property}: ${referenceValue}; ` +
          `${screen.filename} defines ${property}: ${screenValue}. Reconcile ` +
          `the :root token block so every screen shares one set of tokens.`,
        selector: ":root",
        fixAvailable: false,
      });
      idx++;
    }
  }
  return findings;
}

async function liveContent(
  fileId: string,
  storedContent: string,
): Promise<string> {
  return (
    await readLiveSourceFile({
      id: fileId,
      designId: "",
      filename: "index.html",
      fileType: "html",
      content: storedContent,
      createdAt: null,
      updatedAt: null,
    })
  ).content;
}

export default defineAction({
  description:
    "Run a read-only accessibility audit over a design's rendered HTML. " +
    "Checks contrast hints, tap-target sizes, missing alt attributes, missing " +
    "form labels, focus-visibility gaps, reduced-motion coverage, and — for " +
    "multi-screen designs — token drift (the audited screen's :root custom " +
    "properties diverging from index.html's). " +
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
      accessFilter(schema.designs, schema.designShares, undefined, "viewer", {
        includePublic: true,
      }),
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

    const otherHtmlFiles = await db
      .select({
        id: schema.designFiles.id,
        filename: schema.designFiles.filename,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.designId, designId),
          eq(schema.designFiles.fileType, "html"),
        ),
      );

    const screens = await Promise.all(
      otherHtmlFiles.map(async (f) => ({
        filename: f.filename,
        html:
          f.id === file.id ? html : await liveContent(f.id, f.content ?? ""),
      })),
    );

    const isReferenceScreen = file.filename === "index.html";
    const tokenDriftFindings = checkTokenDrift(screens).filter(
      (finding) =>
        isReferenceScreen ||
        finding.id.includes(`token-drift:${file.filename}:`),
    );

    const findings: A11yFinding[] = [
      ...checkMissingAlt(html),
      ...checkMissingLabels(html),
      ...checkTapTargets(html),
      ...checkReducedMotion(html),
      ...checkFocusVisibility(html),
      ...checkContrastHint(html),
      ...checkRenderBlockingOverlays(html),
      ...tokenDriftFindings,
    ];

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
