import { describe, expect, it } from "vitest";

import {
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

    expect(inspectDesignHtmlDocumentIntegrity(corrupted)).toEqual({
      valid: false,
      issue: "raw-text-balance",
    });
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
