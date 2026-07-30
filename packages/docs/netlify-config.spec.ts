import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const netlifyConfig = readFileSync(
  new URL("./netlify.toml", import.meta.url),
  "utf8",
);

describe("docs Netlify config", () => {
  it("redirects the apex domain to the canonical www origin", () => {
    expect(netlifyConfig).toMatch(
      /\[\[redirects\]\]\s+from = "https:\/\/agent-native\.com\/\*"\s+to = "https:\/\/www\.agent-native\.com\/:splat"\s+status = 301\s+force = true/,
    );
  });
});
