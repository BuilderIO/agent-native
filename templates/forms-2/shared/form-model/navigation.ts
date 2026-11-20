import { evaluatePage, type PageState } from "./logic.js";
import type { Page } from "./pages.js";
import type { Answers } from "./types.js";

export type NextStep = { kind: "page"; page: number } | { kind: "end" };

/** The 1-based page, or a loud failure: a page number outside the form is a bug. */
export function pageAt(pages: readonly Page[], number: number): Page {
  const page = pages[number - 1];
  if (!page) throw new Error(`The form has no page ${number}.`);
  return page;
}

function hasContent(page: Page, answers: Answers): boolean {
  return evaluatePage(page, answers).visibleBlocks.length > 0;
}

/**
 * Where Next goes from `current`: the first matched jump, else the next page
 * that still shows something. Past the last input page, or onto a thank-you
 * page, the form ends. A jump to a block that no longer exists is ignored.
 */
export function resolveNextStep(
  pages: readonly Page[],
  current: number,
  answers: Answers,
): NextStep {
  const state = evaluatePage(pageAt(pages, current), answers);
  if (state.jumpTarget === "end") return { kind: "end" };
  if (state.jumpTarget) {
    const target = pages.find(
      (page) => page.breakBlock?.uuid === state.jumpTarget,
    );
    if (target) {
      return target.isThankYou
        ? { kind: "end" }
        : { kind: "page", page: target.number };
    }
  }
  for (let number = current + 1; number <= pages.length; number++) {
    const page = pageAt(pages, number);
    if (page.isThankYou) return { kind: "end" };
    if (hasContent(page, answers)) return { kind: "page", page: number };
  }
  return { kind: "end" };
}

/** The visited-pages stack Back pops, starting on page 1. */
export type PageStack = readonly number[];

export const initialStack: PageStack = [1];

export function currentPage(stack: PageStack): number {
  const last = stack[stack.length - 1];
  if (last === undefined) throw new Error("The page stack is empty.");
  return last;
}

export function pushPage(stack: PageStack, page: number): PageStack {
  return [...stack, page];
}

export function popPage(stack: PageStack): PageStack {
  return stack.length > 1 ? stack.slice(0, -1) : stack;
}

export type ButtonKind = "next" | "submit" | "hidden";

export function buttonFor(
  pages: readonly Page[],
  current: number,
  answers: Answers,
  state: PageState,
): ButtonKind {
  if (state.hideButton) return "hidden";
  return resolveNextStep(pages, current, answers).kind === "end"
    ? "submit"
    : "next";
}

/** The input pages a respondent with these answers passes through, in order. */
export function walkPages(
  pages: readonly Page[],
  answers: Answers,
): { page: Page; state: PageState }[] {
  const visited: { page: Page; state: PageState }[] = [];
  const seen = new Set<number>();
  let number = 1;
  while (!seen.has(number)) {
    const page = pageAt(pages, number);
    if (page.isThankYou) break;
    seen.add(number);
    visited.push({ page, state: evaluatePage(page, answers) });
    const next = resolveNextStep(pages, number, answers);
    if (next.kind === "end") break;
    number = next.page;
  }
  return visited;
}
