import { describe, expect, it } from "vitest";

import {
  contentCollectionConfigSchema,
  searchConsoleSiteSchema,
} from "./config";

describe("searchConsoleSiteSchema", () => {
  it("reads legacy property names while rejecting them in new input", () => {
    const stored = {
      searchConsole: { enabled: true, sites: [{ siteUrl: "example.test" }] },
    };
    expect(
      contentCollectionConfigSchema.parse(stored).searchConsole.sites,
    ).toEqual(stored.searchConsole.sites);
    expect(
      searchConsoleSiteSchema.safeParse(stored.searchConsole.sites[0]).success,
    ).toBe(false);
    expect(
      contentCollectionConfigSchema.safeParse({
        searchConsole: { sites: [{ siteUrl: 123 }] },
      }).success,
    ).toBe(false);
  });
  it("saves Domain properties as Search Console names them", () => {
    expect(
      searchConsoleSiteSchema.parse({
        siteUrl: " SC-DOMAIN:Builder.io ",
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

it("normalizes Domain properties when reading stored config", () => {
  expect(
    contentCollectionConfigSchema.parse({
      searchConsole: {
        enabled: true,
        sites: [{ siteUrl: "SC-DOMAIN:Example.test" }],
      },
    }).searchConsole.sites,
  ).toEqual([{ siteUrl: "sc-domain:example.test" }]);
});
