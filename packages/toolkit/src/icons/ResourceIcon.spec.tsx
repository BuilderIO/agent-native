import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ResourceIcon } from "./ResourceIcon.js";

describe("ResourceIcon", () => {
  it("preserves a complete emoji grapheme and accessible label", () => {
    const markup = renderToStaticMarkup(
      <ResourceIcon
        value={{ version: 1, kind: "emoji", emoji: "👩🏽‍💻" }}
        label="Developer"
      />,
    );
    expect(markup).toContain("👩🏽‍💻");
    expect(markup).toContain('aria-label="Developer"');
  });

  it("renders images only through a caller-provided resolver", () => {
    const value = {
      version: 1,
      kind: "image",
      assetId: "asset_123",
      authority: "workspace:example",
      alt: "Team logo",
    } as const;
    expect(
      renderToStaticMarkup(<ResourceIcon value={value} fallback="missing" />),
    ).toBe("missing");
    expect(
      renderToStaticMarkup(
        <ResourceIcon
          value={value}
          resolveImageUrl={() => "/icons/asset_123"}
        />,
      ),
    ).toContain('src="/icons/asset_123"');
  });
});
