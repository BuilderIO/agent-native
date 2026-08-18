import { describe, expect, it } from "vitest";

import { extractStaticWebsiteContext } from "./website.js";

describe("extractStaticWebsiteContext", () => {
  it("preserves semantic logo and open-graph roles for review ranking", () => {
    const result = extractStaticWebsiteContext(
      `
        <html>
          <head>
            <meta property="og:image" content="/social-card.png">
            <link rel="icon" href="/favicon.svg">
          </head>
          <body>
            <img class="brand-logo" src="/wordmark.svg" alt="Acme">
            <img src="/team.jpg" alt="The team">
          </body>
        </html>
      `,
      "https://example.com/",
    );

    expect(result.assets).toEqual(
      expect.arrayContaining([
        {
          url: "https://example.com/social-card.png",
          kind: "image",
          role: "open-graph",
        },
        {
          url: "https://example.com/favicon.svg",
          kind: "image",
          role: "logo",
        },
        {
          url: "https://example.com/wordmark.svg",
          kind: "image",
          role: "logo",
        },
        { url: "https://example.com/team.jpg", kind: "image" },
      ]),
    );
  });
});
