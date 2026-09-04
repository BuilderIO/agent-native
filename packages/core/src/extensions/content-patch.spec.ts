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

  it("preserves unrelated design during a focused data-loading repair", async () => {
    const content = [
      "<style>.risk-card { color: red; }</style>",
      '<main class="risk-card">',
      '  <script>const endpoint = "/api/old-risk";</script>',
      "</main>",
    ].join("\n");

    const result = await applyExtensionContentUpdate(content, {
      edits: [
        {
          op: "replace",
          find: "/api/old-risk",
          replace: "/api/current-risk",
        },
      ],
    });

    expect(result.content).toContain(
      "<style>.risk-card { color: red; }</style>",
    );
    expect(result.content).toContain('class="risk-card"');
    expect(result.content).toContain("/api/current-risk");
    expect(result.content).not.toContain("/api/old-risk");
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

  it("matches across differing whitespace and splices the replacement over the original bytes", async () => {
    const content = "<div>\n  <span>Hello   World</span>\n</div>";
    const result = await applyExtensionContentUpdate(content, {
      edits: [
        {
          op: "replace",
          find: "<span>Hello World</span>",
          replace: "<span>Hi There</span>",
        },
      ],
    });

    expect(result.content).toBe("<div>\n  <span>Hi There</span>\n</div>");
  });

  it("matches a CRLF find target against LF-normalized content", async () => {
    const content = "<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>";
    const result = await applyExtensionContentUpdate(content, {
      edits: [
        {
          op: "replace",
          find: "<li>One</li>\r\n  <li>Two</li>",
          replace: "<li>Combined</li>",
        },
      ],
    });

    expect(result.content).toBe("<ul>\n  <li>Combined</li>\n</ul>");
  });

  it("reports closest-match candidates instead of a bare miss", async () => {
    const content = [
      "<section>",
      '  <button class="save-btn">Save changes</button>',
      "</section>",
    ].join("\n");

    await expect(
      applyExtensionContentUpdate(content, {
        edits: [
          {
            op: "replace",
            find: '<button class="save-btn">Save Changes</button>',
            replace: "x",
          },
        ],
      }),
    ).rejects.toThrow(/Closest matches in the current extension:\n {2}line 2:/);
  });

  it("reports ambiguity instead of silently patching the first of several matches", async () => {
    const content = "<p>Same</p><p>Same</p>";

    await expect(
      applyExtensionContentUpdate(content, {
        edits: [
          { op: "replace", find: "<p>Same</p>", replace: "<p>Different</p>" },
        ],
      }),
    ).rejects.toThrow(/matched 2 places; pass occurrence/);
  });

  it("applies to a specific occurrence once the caller disambiguates", async () => {
    const content = "<p>Same</p><p>Same</p>";
    const result = await applyExtensionContentUpdate(content, {
      edits: [
        {
          op: "replace",
          find: "<p>Same</p>",
          replace: "<p>Different</p>",
          occurrence: 2,
        },
      ],
    });

    expect(result.content).toBe("<p>Same</p><p>Different</p>");
  });

  it("treats expectedMatches: 0 as a no-op when the target is absent", async () => {
    const result = await applyExtensionContentUpdate("<div>One</div>", {
      edits: [
        {
          op: "replace",
          find: "Missing",
          replace: "Never written",
          expectedMatches: 0,
        },
      ],
    });

    expect(result.content).toBe("<div>One</div>");
    expect(result.applied).toEqual(["replace:0"]);
  });

  it("reports ambiguity for an insert marker that appears more than once with no occurrence given", async () => {
    const content = "<p>Item</p><p>Item</p>";

    await expect(
      applyExtensionContentUpdate(content, {
        edits: [
          {
            op: "insert-after",
            marker: "<p>Item</p>",
            content: "<hr>",
          },
        ],
      }),
    ).rejects.toThrow(/matched 2 places; pass occurrence/);
  });

  it.each([0, 0.5])(
    "rejects an invalid occurrence (%s) and leaves the content untouched",
    async (occurrence) => {
      const content = "<div>One</div>";

      await expect(
        applyExtensionContentUpdate(content, {
          edits: [
            {
              op: "replace",
              find: "One",
              replace: "Two",
              occurrence,
            },
          ],
        }),
      ).rejects.toThrow(
        `occurrence must be a positive integer, got ${occurrence}`,
      );
    },
  );

  it("lets occurrence win over all when both are given", async () => {
    const content = "<p>Same</p><p>Same</p><p>Same</p>";
    const result = await applyExtensionContentUpdate(content, {
      edits: [
        {
          op: "replace",
          find: "<p>Same</p>",
          replace: "<p>Different</p>",
          occurrence: 2,
          all: true,
        },
      ],
    });

    expect(result.content).toBe("<p>Same</p><p>Different</p><p>Same</p>");
  });
});
