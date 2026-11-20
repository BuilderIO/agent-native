import type { Block } from "./types.js";

export type Page = {
  /** 1-based. Thank-you pages are numbered after the input pages. */
  number: number;
  /** The PAGE_BREAK or THANK_YOU_PAGE block that opens the page; null for page 1. */
  breakBlock: Block | null;
  /** Blocks on the page, without the opening break block. */
  blocks: Block[];
  isThankYou: boolean;
};

/**
 * Pages split at PAGE_BREAK. A THANK_YOU_PAGE block opens the end page and
 * everything after it belongs there, whatever page breaks follow.
 */
export function splitPages(blocks: readonly Block[]): Page[] {
  let current: Page = {
    number: 1,
    breakBlock: null,
    blocks: [],
    isThankYou: false,
  };
  const pages: Page[] = [current];
  for (const block of blocks) {
    if (block.type === "THANK_YOU_PAGE" && !current.isThankYou) {
      current = {
        number: pages.length + 1,
        breakBlock: block,
        blocks: [],
        isThankYou: true,
      };
      pages.push(current);
    } else if (block.type === "PAGE_BREAK" && !current.isThankYou) {
      current = {
        number: pages.length + 1,
        breakBlock: block,
        blocks: [],
        isThankYou: false,
      };
      pages.push(current);
    } else {
      current.blocks.push(block);
    }
  }
  return pages;
}

export function inputPages(pages: readonly Page[]): Page[] {
  return pages.filter((page) => !page.isThankYou);
}

export function thankYouPage(pages: readonly Page[]): Page | null {
  return pages.find((page) => page.isThankYou) ?? null;
}
