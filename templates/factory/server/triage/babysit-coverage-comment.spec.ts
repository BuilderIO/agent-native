import { describe, expect, it } from "vitest";

import {
  parseCoverageCommentLines,
  parseInlineDisposition,
} from "./babysit-coverage-comment.js";

describe("babysit coverage comment", () => {
  it("parses structured coverage lines", () => {
    const entries = parseCoverageCommentLines(`
Thread templates/factory/server/triage/pr-babysit.ts:270 — Optional — skipping: style nit only
Thread #discussion_r4008351550 — Required — fixed: renamed helper
`);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.disposition).toBe("optional-skipping");
    expect(entries[1]?.disposition).toBe("required-fixed");
  });

  it("parses inline disposition prefixes", () => {
    expect(parseInlineDisposition("Required — fixed: done")).toBe(
      "required-fixed",
    );
    expect(parseInlineDisposition("Optional — skipping: won't change")).toBe(
      "optional-skipping",
    );
    expect(parseInlineDisposition("looks good")).toBeNull();
  });
});
