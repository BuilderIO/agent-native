import { describe, expect, it } from "vitest";

import { searchConsoleSiteSchema } from "./config";

describe("searchConsoleSiteSchema", () => {
  it("saves Domain properties as Search Console names them", () => {
    expect(
      searchConsoleSiteSchema.parse({
        siteUrl: " sc-domain:builder.io ",
        pathPrefix: "/blog/",
      }),
    ).toEqual({ siteUrl: "sc-domain:builder.io", pathPrefix: "/blog/" });
  });

  it("rejects a bare domain with the property to use instead", () => {
    const result = searchConsoleSiteSchema.safeParse({
      siteUrl: "agent-native.com",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      '"agent-native.com" isn\'t a Search Console property. For a Domain property, use sc-domain:agent-native.com.',
    );
  });
});
