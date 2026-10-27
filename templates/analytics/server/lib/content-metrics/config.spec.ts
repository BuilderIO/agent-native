import { describe, expect, it } from "vitest";

import {
  contentCollectionConfigSchema,
  ga4PropertyIdSchema,
  searchConsoleSiteSchema,
  signupsConfigSchema,
  signupsSettingsUpdateSchema,
} from "./config";

describe("collection GA4 property", () => {
  it("leaves new and legacy collections unconfigured without borrowing the app property", () => {
    expect(contentCollectionConfigSchema.parse({}).ga4).toEqual({
      enabled: true,
      propertyId: null,
    });
    expect(
      contentCollectionConfigSchema.parse({ ga4: { enabled: true } }).ga4,
    ).toEqual({ enabled: true, propertyId: null });
  });

  it("normalizes a numeric property ID and rejects URLs and resource paths", () => {
    expect(ga4PropertyIdSchema.parse(" 123456789 ")).toBe("123456789");
    for (const value of [
      "",
      "properties/123456789",
      "https://example.test",
      "123/456",
      "-1",
    ]) {
      expect(ga4PropertyIdSchema.safeParse(value).success).toBe(false);
    }
  });
});

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

describe("signup billing caps", () => {
  it.each([signupsConfigSchema, signupsSettingsUpdateSchema])(
    "accepts the runQuery maximum and rejects larger caps",
    (schema) => {
      expect(
        schema.safeParse({ enabled: true, maxBytesBilled: 750_000_000_000 })
          .success,
      ).toBe(true);
      expect(
        schema.safeParse({ enabled: true, maxBytesBilled: 750_000_000_001 })
          .success,
      ).toBe(false);
    },
  );
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
