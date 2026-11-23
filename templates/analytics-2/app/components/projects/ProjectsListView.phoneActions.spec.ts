import { describe, expect, it } from "vitest";

import projectsCss from "./projects.css?raw";

function mediaBlocks(css: string): { query: string; body: string }[] {
  const blocks: { query: string; body: string }[] = [];
  const start = /@media\s+([^{]+)\{/g;
  for (let match = start.exec(css); match; match = start.exec(css)) {
    let depth = 1;
    let end = start.lastIndex;
    while (depth > 0 && end < css.length) {
      const char = css[end++];
      if (char === "{") depth++;
      else if (char === "}") depth--;
    }
    blocks.push({
      query: (match[1] ?? "").trim(),
      body: css.slice(start.lastIndex, end - 1),
    });
  }
  return blocks;
}

describe("project row actions on a phone-width viewport", () => {
  it("reveals the more-actions, favorite and status controls without hover", () => {
    const phone = mediaBlocks(projectsCss).filter(({ query }) =>
      /max-width:\s*767px/.test(query),
    );
    const revealing = phone.filter(
      ({ body }) =>
        /\.ws-projects-row-actions/.test(body) &&
        /\.ws-projects-row-favorite/.test(body) &&
        /\.ws-projects-add-status/.test(body) &&
        /opacity:\s*1/.test(body),
    );
    expect(revealing).toHaveLength(1);
  });

  it("keeps the touch-device reveal", () => {
    const touch = mediaBlocks(projectsCss).filter(
      ({ query }) =>
        query.includes("hover: none") && query.includes("pointer: coarse"),
    );
    expect(touch.some(({ body }) => /opacity:\s*1/.test(body))).toBe(true);
  });
});
