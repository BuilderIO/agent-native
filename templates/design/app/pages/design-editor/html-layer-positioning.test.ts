// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { getBodyInlineStyles } from "./html-layer-positioning";

describe("getBodyInlineStyles", () => {
  it("names a page background set by a body rule", () => {
    // The generated shape: no inline style on <body>, and a `background:`
    // shorthand holding var() leaves the longhand empty.
    expect(
      getBodyInlineStyles(
        `<!doctype html><html><head><style>
           :root{--color-background:#f4f4f4}
           body{margin:0;background:var(--color-background)}
         </style></head><body><main>x</main></body></html>`,
      ).backgroundColor,
    ).toBe("var(--color-background)");
  });

  it("prefers the body's own inline background over the rule", () => {
    expect(
      getBodyInlineStyles(
        `<!doctype html><html><head><style>body{background:var(--from-rule)}</style></head>` +
          `<body style="background-color:var(--from-inline)"></body></html>`,
      ).backgroundColor,
    ).toBe("var(--from-inline)");
  });

  it("reports no background when the page sets none", () => {
    expect(
      getBodyInlineStyles(
        `<!doctype html><html><head><style>body{margin:0}</style></head><body></body></html>`,
      ).backgroundColor,
    ).toBeFalsy();
  });
});
