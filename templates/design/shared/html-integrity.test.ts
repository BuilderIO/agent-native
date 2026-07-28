import { describe, expect, it } from "vitest";

import {
  assertDesignHtmlCreateIntegrity,
  assertDesignHtmlEditIntegrity,
  DESIGN_HTML_INTEGRITY_ERROR_CODE,
  inspectDesignHtmlDocumentIntegrity,
} from "./html-integrity";

const DOCUMENT = `<!doctype html>
<html><head><style data-agent-native-breakpoints>
@media (max-width: 1279px) { [data-agent-native-node-id="an-1"] { font-family: Poppins, sans-serif; } }
</style></head><body x-data="{ open: true }"><template x-if="open"><p>Hi</p></template></body></html>`;

describe("Design HTML integrity", () => {
  it("accepts complete Alpine documents and balanced managed raw-text blocks", () => {
    expect(inspectDesignHtmlDocumentIntegrity(DOCUMENT)).toEqual({
      valid: true,
    });
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: DOCUMENT,
        nextContent: DOCUMENT.replace("Hi", "Hello"),
        fileType: "html",
      }),
    ).not.toThrow();
  });

  it("rejects the screenshot-like missing managed style opener", () => {
    const corrupted = DOCUMENT.replace(
      "<style data-agent-native-breakpoints>",
      'data-agent-native-breakpoints">',
    );

    // The structural pass reaches this before the raw-text count does, and
    // reports the stray `</style>` with its line instead of the unlocated
    // "raw text is unbalanced somewhere" verdict. Same rejection, narrower cause.
    const result = inspectDesignHtmlDocumentIntegrity(corrupted);
    expect(result.valid).toBe(false);
    expect(result.issue).toBe("close-tag-orphaned");
    expect(result.detail?.[0]).toMatchObject({ tag: "style", line: 4 });
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: DOCUMENT,
        nextContent: corrupted,
        fileType: "html",
      }),
    ).toThrow(DESIGN_HTML_INTEGRITY_ERROR_CODE);
  });

  it.each([
    ["style close", DOCUMENT.replace("</style>", "")],
    ["body close", DOCUMENT.replace("</body>", "")],
    ["root close", DOCUMENT.replace("</html>", "")],
    [
      "orphaned marker",
      DOCUMENT.replace("</style>", '</style>data-agent-native-breakpoints">'),
    ],
    [
      "duplicate managed style",
      DOCUMENT.replace(
        "</head>",
        "<style data-agent-native-breakpoints>.x{color:red}</style></head>",
      ),
    ],
    ["raw prefix", `@media(max-width:1px){}${DOCUMENT}`],
  ])("rejects a malformed %s transition", (_label, corrupted) => {
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: DOCUMENT,
        nextContent: corrupted,
        fileType: "html",
      }),
    ).toThrow(DESIGN_HTML_INTEGRITY_ERROR_CODE);
  });

  it("does not reject Alpine/template fragments that are intentionally not documents", () => {
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent:
          '<section x-data="{}"><template x-for="x in xs"></template></section>',
        nextContent:
          '<section x-data="{ open: true }"><template x-if="open"><p>Hi</p></template></section>',
        fileType: "html",
      }),
    ).not.toThrow();
  });

  it("does not mistake tag-shaped Alpine attributes, comments, or script strings for a document root", () => {
    for (const fragment of [
      `<section x-data="{ sample: '<html><body></body></html>' }"><p>Hi</p></section>`,
      `<section x-data="{ sample: '>' + '<html><body></body></html>' }"><p>Hi</p></section>`,
      `<section><!-- example: <html><body></body></html> --><p>Hi</p></section>`,
      `<section><script>const sample = '<html><body></body></html>'</script><template x-if="true"><p>Hi</p></template></section>`,
    ]) {
      expect(inspectDesignHtmlDocumentIntegrity(fragment)).toEqual({
        valid: true,
      });
      expect(() =>
        assertDesignHtmlEditIntegrity({
          previousContent: fragment,
          nextContent: fragment.replace("Hi", "Hello"),
          fileType: "html",
        }),
      ).not.toThrow();
    }
  });

  it("ignores tag and managed-marker strings inside legitimate raw-text bodies", () => {
    const withCodeStrings = DOCUMENT.replace(
      "</head>",
      `<script>
        const example = '<html><body><style data-agent-native-motion>.x{}</style></body></html>';
        const selector = 'style[data-agent-native-breakpoints]';
      </script></head>`,
    );
    expect(inspectDesignHtmlDocumentIntegrity(withCodeStrings)).toEqual({
      valid: true,
    });
  });

  it("does not count root or raw-text tags inside Alpine attributes and comments", () => {
    const withMarkupExamples = DOCUMENT.replace(
      '<body x-data="{ open: true }">',
      `<body x-data="{ open: true, sample: '<style></style><body></body>' }">
        <!-- example only: <script></script><html><head></head><body></body></html> -->`,
    );

    expect(inspectDesignHtmlDocumentIntegrity(withMarkupExamples)).toEqual({
      valid: true,
    });
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: DOCUMENT,
        nextContent: withMarkupExamples,
        fileType: "html",
      }),
    ).not.toThrow();
  });

  it("allows a malformed legacy document to be repaired but not re-saved malformed", () => {
    const corrupted = DOCUMENT.replace(
      "</style>",
      '</style>data-agent-native-breakpoints">',
    );
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: corrupted,
        nextContent: DOCUMENT,
        fileType: "html",
      }),
    ).not.toThrow();
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: corrupted,
        nextContent: corrupted.replace("Hi", "Still broken"),
        fileType: "html",
      }),
    ).toThrow(DESIGN_HTML_INTEGRITY_ERROR_CODE);
  });

  it("does not police CSS, JSX, or asset files", () => {
    for (const fileType of ["css", "jsx", "asset"]) {
      expect(() =>
        assertDesignHtmlEditIntegrity({
          previousContent: DOCUMENT,
          nextContent: "not html",
          fileType,
        }),
      ).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Structural pass
//
// Every case below persisted silently before this pass existed: the counting
// checks are blind to nesting, so an unclosed element or a stray closing tag
// left all root-tag counts intact. The browser's HTML parser recovers from all
// of them without an error, which is why nothing downstream ever reported them.
// ---------------------------------------------------------------------------

const SCREEN = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8">
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<style>:root { --color-accent: #0EA5E9; }</style>
</head><body class="bg-white"><div class="rounded-xl p-6"><h1 class="text-3xl">Hi</h1></div></body></html>`;

describe("Design HTML structural integrity", () => {
  it("accepts a well-formed generated screen", () => {
    expect(inspectDesignHtmlDocumentIntegrity(SCREEN)).toEqual({ valid: true });
  });

  it("names the unterminated attribute rather than the root tags it swallows", () => {
    const corrupted = SCREEN.replace(
      'src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"',
      'src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4',
    );
    const result = inspectDesignHtmlDocumentIntegrity(corrupted);
    expect(result.valid).toBe(false);
    // The counting pass would have reported `document-root` here — accurate as a
    // symptom, useless as a fix, because <html> is present and correct.
    expect(result.issue).toBe("attribute-unterminated");
    expect(result.detail?.[0]).toMatchObject({
      tag: "script",
      attribute: "src",
    });
    expect(result.detail?.[0]?.line).toBe(3);
  });

  it("detects an unterminated attribute even when a later quote re-syncs the tokenizer", () => {
    const corrupted = SCREEN.replace('class="bg-white"', 'class="bg-white');
    expect(inspectDesignHtmlDocumentIntegrity(corrupted).issue).toBe(
      "attribute-unterminated",
    );
  });

  it("detects an unclosed element and names what closed it instead", () => {
    const result = inspectDesignHtmlDocumentIntegrity(
      SCREEN.replace("</div></body>", "</body>"),
    );
    expect(result.issue).toBe("element-unclosed");
    expect(result.detail?.[0]).toMatchObject({
      tag: "div",
      closedBy: { tag: "body" },
    });
  });

  it("detects a closing tag with no opener", () => {
    const result = inspectDesignHtmlDocumentIntegrity(
      SCREEN.replace("<h1", "</section><h1"),
    );
    expect(result.issue).toBe("close-tag-orphaned");
    expect(result.detail?.[0]?.tag).toBe("section");
  });

  it("detects crossed nesting", () => {
    const result = inspectDesignHtmlDocumentIntegrity(
      SCREEN.replace(
        '<h1 class="text-3xl">Hi</h1></div>',
        '<h1 class="text-3xl">Hi</div></h1>',
      ),
    );
    expect(result.issue).toBe("element-unclosed");
    expect(result.detail?.[0]?.tag).toBe("h1");
  });

  it("detects a payload cut off mid-attribute", () => {
    const truncated = SCREEN.slice(0, SCREEN.indexOf('class="rounded-xl') + 12);
    expect(inspectDesignHtmlDocumentIntegrity(truncated).valid).toBe(false);
  });

  it("distinguishes a cut-off tag from an unterminated quote", () => {
    // Every quote here is closed; the TAG is what got cut off. Deciding this by
    // "is there a quote anywhere after this point" told the author to close a
    // quote that was already closed.
    const result = inspectDesignHtmlDocumentIntegrity(
      '<!doctype html><html><head></head><body><div class="a" data-y',
    );
    expect(result.issue).toBe("content-truncated");
    expect(
      inspectDesignHtmlDocumentIntegrity(
        '<!doctype html><html><head></head><body><div class="a',
      ).issue,
    ).toBe("attribute-unterminated");
  });

  it("reads a spaced closing tag as a close, not a second open", () => {
    expect(
      inspectDesignHtmlDocumentIntegrity(
        "<!doctype html><html><head></head><body><div>x< /div></body></html>",
      ),
    ).toEqual({ valid: true });
  });

  it("detects an unterminated comment", () => {
    expect(
      inspectDesignHtmlDocumentIntegrity(SCREEN.replace("<h1", "<!-- note <h1"))
        .issue,
    ).toBe("content-truncated");
  });

  it("checks fragments too — an unterminated quote is not a document-only defect", () => {
    expect(
      inspectDesignHtmlDocumentIntegrity(
        `<section class="grid gap-4><div class="card">Hi</div></section>`,
      ).issue,
    ).toBe("attribute-unterminated");
  });

  it.each([
    [
      "omitted </td> and </tr>",
      "<table><tbody><tr><td>a<td>b<tr><td>c</tbody></table>",
    ],
    ["omitted </li> and </p>", "<ul><li>a<li>b</ul><p>one<p>two"],
    [
      "void and self-closing elements",
      '<img src="x.png"><br><svg viewBox="0 0 4 4"><circle cx="2" cy="2" r="1"/></svg>',
    ],
    [
      "closing tags inside script text",
      "<script>const s = '</div></body>'</script><div>ok</div>",
    ],
    [
      "closing tags inside a style body",
      "<style>/* </div> */ .a{color:red}</style><div>ok</div>",
    ],
  ])("does not flag legal authoring: %s", (_label, body) => {
    const document = SCREEN.replace(
      '<div class="rounded-xl p-6"><h1 class="text-3xl">Hi</h1></div>',
      body,
    );
    expect(inspectDesignHtmlDocumentIntegrity(document)).toEqual({
      valid: true,
    });
  });

  it("reports a missing Tailwind runtime as advisory, not a rejection", () => {
    const result = inspectDesignHtmlDocumentIntegrity(
      SCREEN.replace(/<script[^>]*><\/script>/, ""),
    );
    expect(result.valid).toBe(true);
    expect(result.advisory?.[0]?.issue).toBe("runtime-missing");
  });

  it("caps cascading reports so one defect cannot flood a tool result", () => {
    const nested = `<!doctype html><html><head></head><body>${"<div><section><article>".repeat(
      6,
    )}</body></html>`;
    const result = inspectDesignHtmlDocumentIntegrity(nested);
    expect(result.valid).toBe(false);
    expect(result.detail!.length).toBeLessThanOrEqual(3);
  });
});

describe("assertDesignHtmlCreateIntegrity", () => {
  it("throws a located, explanatory error naming the file", () => {
    const corrupted = SCREEN.replace('class="bg-white"', 'class="bg-white');
    let message = "";
    try {
      assertDesignHtmlCreateIntegrity({
        content: corrupted,
        fileType: "html",
        filename: "index.html",
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(DESIGN_HTML_INTEGRITY_ERROR_CODE);
    expect(message).toContain("index.html");
    expect(message).toContain("never closed");
    // The excerpt is what makes the error actionable without a re-read.
    expect(message).toContain("class=");
  });

  it("returns advisory findings instead of throwing when the document is well-formed", () => {
    expect(
      assertDesignHtmlCreateIntegrity({
        content: SCREEN,
        fileType: "html",
        filename: "index.html",
      }),
    ).toEqual([]);
  });

  it("leaves non-HTML file types alone", () => {
    for (const fileType of ["css", "jsx", "asset"]) {
      expect(
        assertDesignHtmlCreateIntegrity({
          content: "export default function Broken() { return <div>; }",
          fileType,
          filename: "Card.jsx",
        }),
      ).toEqual([]);
    }
  });

  it("does not grant creation the legacy-repair leniency edits get", () => {
    const corrupted = SCREEN.replace("</div></body>", "</body>");
    // An edit from malformed to malformed is tolerated so legacy screens stay
    // repairable; a brand-new file has no such history to protect.
    expect(() =>
      assertDesignHtmlEditIntegrity({
        previousContent: corrupted,
        nextContent: corrupted.replace("Hi", "Hello"),
        fileType: "html",
      }),
    ).toThrow();
    expect(() =>
      assertDesignHtmlCreateIntegrity({
        content: corrupted,
        fileType: "html",
        filename: "index.html",
      }),
    ).toThrow(DESIGN_HTML_INTEGRITY_ERROR_CODE);
  });
});
