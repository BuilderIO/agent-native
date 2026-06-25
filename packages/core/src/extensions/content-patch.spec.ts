import { describe, expect, it } from "vitest";

import { applyExtensionContentUpdate } from "./content-patch.js";

describe("extension content patching", () => {
  it("applies marker inserts without rewriting the whole document", async () => {
    const result = await applyExtensionContentUpdate("<div>One</div>", {
      edits: [
        {
          op: "insert-after",
          marker: "<div>",
          content: "<span>Two</span>",
        },
      ],
    });

    expect(result.content).toBe("<div><span>Two</span>One</div>");
    expect(result.applied).toEqual(["insert-after:1"]);
  });

  it("fails loudly when a required literal replacement target is missing", async () => {
    await expect(
      applyExtensionContentUpdate("<div>One</div>", {
        patches: [{ find: "Two", replace: "Three" }],
      }),
    ).rejects.toThrow("replace found no matches");
  });

  it("replaces section contents while preserving stable section markers", async () => {
    const content = [
      "<main>",
      "<!-- agent-native:section metrics -->",
      "<div>Old</div>",
      "<!-- /agent-native:section metrics -->",
      "</main>",
    ].join("\n");

    const result = await applyExtensionContentUpdate(content, {
      edits: [
        {
          op: "replace-section",
          section: "metrics",
          content: "\n<div>New</div>\n",
        },
      ],
    });

    expect(result.content).toContain("<!-- agent-native:section metrics -->");
    expect(result.content).toContain("<div>New</div>");
    expect(result.content).not.toContain("<div>Old</div>");
  });

  it("wraps a marked section for small structural edits", async () => {
    const content = [
      "<!-- section:chart -->",
      "<section>Chart</section>",
      "<!-- /section:chart -->",
    ].join("\n");

    const result = await applyExtensionContentUpdate(content, {
      edits: [
        {
          op: "wrap-section",
          section: "chart",
          before: '\n<div class="wrapper">',
          after: "</div>\n",
        },
      ],
    });

    expect(result.content).toContain('<div class="wrapper">');
    expect(result.content).toContain("<section>Chart</section>");
    expect(result.content).toContain("<!-- /section:chart -->");
  });

  it("supports regex replacements with explicit match counts", async () => {
    const result = await applyExtensionContentUpdate("<p>a</p><p>b</p>", {
      edits: [
        {
          op: "regex-replace",
          pattern: "<p>(.*?)</p>",
          replace: "<span>$1</span>",
          all: true,
          expectedMatches: 2,
        },
      ],
    });

    expect(result.content).toBe("<span>a</span><span>b</span>");
  });

  it("formats the final HTML when requested", async () => {
    const result = await applyExtensionContentUpdate(
      "<div><span>Hi</span></div>",
      {
        format: true,
      },
    );

    expect(result.formatted).toBe(true);
    expect(result.content).toContain("<span>Hi</span>");
  });
});
