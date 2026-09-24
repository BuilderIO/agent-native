import { describe, expect, it } from "vitest";

import { withDefaultSocialImage } from "./seo";

function metaProperty(
  meta: ReturnType<typeof withDefaultSocialImage>,
  property: string,
) {
  return meta.find(
    (item): item is { property: string; content: string } =>
      "property" in item && item.property === property,
  )?.content;
}

describe("withDefaultSocialImage", () => {
  it("backfills og:title, og:description, and og:type from the plain title/description", () => {
    const meta = withDefaultSocialImage([
      { title: "Pricing — Agent-Native" },
      {
        name: "description",
        content: "MIT licensed and free for unlimited users.",
      },
    ]);

    expect(metaProperty(meta, "og:title")).toBe("Pricing — Agent-Native");
    expect(metaProperty(meta, "og:description")).toBe(
      "MIT licensed and free for unlimited users.",
    );
    expect(metaProperty(meta, "og:type")).toBe("website");
  });

  it("does not override an explicitly provided og:title, og:description, or og:type", () => {
    const meta = withDefaultSocialImage([
      { title: "Doc — Agent-Native" },
      { name: "description", content: "Plain description." },
      { property: "og:title", content: "Custom OG title" },
      { property: "og:description", content: "Custom OG description" },
      { property: "og:type", content: "article" },
    ]);

    expect(metaProperty(meta, "og:title")).toBe("Custom OG title");
    expect(metaProperty(meta, "og:description")).toBe("Custom OG description");
    expect(metaProperty(meta, "og:type")).toBe("article");
  });

  it("skips og:title/og:description when there is no plain title/description to derive from", () => {
    const meta = withDefaultSocialImage([
      { name: "robots", content: "noindex" },
    ]);

    expect(metaProperty(meta, "og:title")).toBeUndefined();
    expect(metaProperty(meta, "og:description")).toBeUndefined();
    expect(metaProperty(meta, "og:type")).toBe("website");
  });
});
