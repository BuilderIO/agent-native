import { describe, expect, it } from "vitest";

import { injectDocumentMarkup } from "./html-document";

describe("injectDocumentMarkup", () => {
  it("inserts before the last body closer without interpreting markup", () => {
    const sourceScript =
      '<script>const template = "</body>"; const money = "$&";</script>';
    const markup =
      '<script data-bridge>const escaped = "$&"; const template = "</body>";</script>';
    const html = `<html><body>${sourceScript}<main>screen</main></body></html>`;

    const result = injectDocumentMarkup(html, markup);

    expect(result).toBe(
      `<html><body>${sourceScript}<main>screen</main>${markup}</body></html>`,
    );
  });

  it("uses the last html closer or appends when the document has no body", () => {
    expect(injectDocumentMarkup("<html>screen</html>", "$&")).toBe(
      "<html>screen$&</html>",
    );
    expect(injectDocumentMarkup("screen", "$&")).toBe("screen$&");
  });

  it("prefers the real head closer over raw text and comments", () => {
    const sourceScript =
      '<script>const template = "</head>"; const money = "$&";</script>';
    const comment = "<!-- a literal </head> in a comment -->";
    expect(
      injectDocumentMarkup(
        `<html><head>${sourceScript}${comment}<meta content="</head>"><title>screen</title></head><body></body></html>`,
        "<script>$&</script>",
        { target: "head" },
      ),
    ).toBe(
      `<html><head>${sourceScript}${comment}<meta content="</head>"><title>screen</title><script>$&</script></head><body></body></html>`,
    );
  });
});
