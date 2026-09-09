import type { PlanBlock, PlanContent } from "@shared/plan-content";

export type PlanTextDirection = "ltr" | "rtl";

const RTL_STRONG_CHAR =
  /[\u0590-\u05ff\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb1d-\ufdfd\ufe70-\ufefc]/u;
const LTR_STRONG_CHAR = /[A-Za-z\u00c0-\u024f\u0370-\u03ff\u0400-\u052f]/u;
const CODE_FENCE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]+`/g;

function stripMarkdownCode(text: string): string {
  return text.replace(CODE_FENCE, " ").replace(INLINE_CODE, " ");
}

export function detectPlanTextDirection(text: string): PlanTextDirection {
  let ltr = 0;
  let rtl = 0;

  for (const char of stripMarkdownCode(text)) {
    if (RTL_STRONG_CHAR.test(char)) rtl += 1;
    else if (LTR_STRONG_CHAR.test(char)) ltr += 1;
    if (ltr + rtl >= 240) break;
  }

  if (rtl === 0) return "ltr";
  return rtl >= ltr * 0.5 ? "rtl" : "ltr";
}

function collectBlockDirectionText(block: PlanBlock, output: string[]) {
  if (block.title) output.push(block.title);
  if (block.summary) output.push(block.summary);

  if (block.type === "rich-text") {
    output.push(block.data.markdown);
    return;
  }

  if (block.type === "callout") {
    output.push(block.data.body);
    return;
  }

  const data = (block as { data?: Record<string, unknown> }).data;
  if (!data) return;

  for (const key of [
    "body",
    "markdown",
    "text",
    "label",
    "question",
    "caption",
    "description",
  ]) {
    const value = data[key];
    if (typeof value === "string") output.push(value);
  }

  const tabs = data.tabs;
  if (Array.isArray(tabs)) {
    for (const tab of tabs) {
      if (!tab || typeof tab !== "object") continue;
      const maybeTab = tab as { label?: unknown; blocks?: unknown };
      if (typeof maybeTab.label === "string") output.push(maybeTab.label);
      if (Array.isArray(maybeTab.blocks)) {
        for (const child of maybeTab.blocks) {
          collectBlockDirectionText(child as PlanBlock, output);
        }
      }
    }
  }

  const columns = data.columns;
  if (Array.isArray(columns)) {
    for (const column of columns) {
      if (!column || typeof column !== "object") continue;
      const maybeColumn = column as { label?: unknown; blocks?: unknown };
      if (typeof maybeColumn.label === "string") output.push(maybeColumn.label);
      if (Array.isArray(maybeColumn.blocks)) {
        for (const child of maybeColumn.blocks) {
          collectBlockDirectionText(child as PlanBlock, output);
        }
      }
    }
  }

  const items = data.items;
  if (Array.isArray(items)) {
    for (const item of items) {
      if (typeof item === "string") output.push(item);
      else if (item && typeof item === "object") {
        for (const value of Object.values(item as Record<string, unknown>)) {
          if (typeof value === "string") output.push(value);
        }
      }
    }
  }
}

export function getPlanContentDirection(
  content: PlanContent,
  fallbackTitle: string,
  fallbackBrief: string,
): PlanTextDirection {
  const text = [content.title || fallbackTitle, content.brief || fallbackBrief];
  for (const block of content.blocks) collectBlockDirectionText(block, text);
  return detectPlanTextDirection(text.join("\n\n"));
}
