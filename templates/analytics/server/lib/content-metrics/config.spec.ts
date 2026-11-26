import { describe, expect, it } from "vitest";

import {
  contentCollectionConfigSchema,
  contentStepConfigFingerprint,
  ga4PropertyIdSchema,
  searchConsoleSiteSchema,
  signupsConfigSchema,
  signupsSettingsUpdateSchema,
  stepEnabled,
  xAccountSchema,
  xAccountsSchema,
  xLinkTargetSchema,
  youtubeChannelSchema,
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

describe("Search Console history and queries", () => {
  it("reads saved settings from before them with 16 months and queries on", () => {
    const config = contentCollectionConfigSchema.parse({
      searchConsole: {
        enabled: true,
        sites: [{ siteUrl: "sc-domain:example.test" }],
      },
    });
    expect(config.searchConsole.historyMonths).toBe(16);
    expect(config.searchConsoleQueries).toEqual({ enabled: true, perPage: 25 });
    expect(stepEnabled(config, "search_console_queries")).toBe(true);
  });

  it("runs queries only while Search Console runs", () => {
    const config = contentCollectionConfigSchema.parse({
      searchConsole: { enabled: false, sites: [] },
    });
    expect(stepEnabled(config, "search_console_queries")).toBe(false);
  });

  it("keeps query history when only the history depth changes", () => {
    const sites = [{ siteUrl: "sc-domain:example.test" }];
    const fingerprint = (historyMonths: number, perPage: number) =>
      contentStepConfigFingerprint(
        "search_console_queries",
        contentCollectionConfigSchema.parse({
          searchConsole: { enabled: true, sites, historyMonths },
          searchConsoleQueries: { enabled: true, perPage },
        }),
      );
    expect(fingerprint(16, 25)).toBe(fingerprint(6, 25));
    expect(fingerprint(16, 25)).not.toBe(fingerprint(16, 10));
  });

  it("keeps history depth within the 16 months Search Console keeps", () => {
    expect(
      contentCollectionConfigSchema.safeParse({
        searchConsole: { enabled: true, sites: [], historyMonths: 17 },
      }).success,
    ).toBe(false);
  });
});

describe("daily.dev and YouTube", () => {
  it("reads saved settings from before them with daily.dev on and YouTube off", () => {
    const config = contentCollectionConfigSchema.parse({
      ga4: { enabled: true, propertyId: "123456789" },
    });
    expect(config.dailyDev).toEqual({ enabled: true });
    expect(config.youtube).toEqual({ enabled: false, channels: [] });
    expect(stepEnabled(config, "daily_dev")).toBe(true);
    expect(stepEnabled(config, "youtube")).toBe(false);
  });

  it("refills daily.dev history when the GA4 property changes", () => {
    const fingerprint = (propertyId: string | null) =>
      contentStepConfigFingerprint(
        "daily_dev",
        contentCollectionConfigSchema.parse({
          ga4: { enabled: true, propertyId },
        }),
      );
    expect(fingerprint("123456789")).toBe(
      contentStepConfigFingerprint(
        "ga4",
        contentCollectionConfigSchema.parse({
          ga4: { enabled: true, propertyId: "123456789" },
        }),
      ),
    );
    expect(fingerprint("123456789")).not.toBe(fingerprint("987654321"));
    expect(fingerprint(null)).toBeNull();
  });

  it("fingerprints YouTube's channels, so a read for an earlier list isn't saved", () => {
    const fingerprint = (channels: string[]) =>
      contentStepConfigFingerprint(
        "youtube",
        contentCollectionConfigSchema.parse({
          youtube: { enabled: true, channels },
        }),
      );
    expect(fingerprint(["@Builderio"])).toEqual(expect.any(String));
    expect(fingerprint(["@Builderio"])).toBe(fingerprint(["@Builderio"]));
    expect(fingerprint(["@Builderio"])).not.toBe(
      fingerprint(["@Builderio", "UC80PWRj_ZU8Zu0HSMNVwKWw"]),
    );
  });

  it("takes a channel ID or an @handle and nothing else", () => {
    expect(youtubeChannelSchema.parse(" @Builderio ")).toBe("@Builderio");
    expect(youtubeChannelSchema.parse("UCAN7TYzCJm1yd-QXbwKfoOg")).toBe(
      "UCAN7TYzCJm1yd-QXbwKfoOg",
    );
    for (const value of [
      "",
      "Builderio",
      "@ab",
      "https://www.youtube.com/@Builderio",
      "UCshort",
      "@Builder io",
    ]) {
      expect(youtubeChannelSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("X", () => {
  it("reads saved settings from before it with X off and nothing named", () => {
    const config = contentCollectionConfigSchema.parse({
      youtube: { enabled: true, channels: ["@Builderio"] },
    });
    expect(config.x).toEqual({
      enabled: false,
      accounts: [],
      links: [],
      terms: [],
    });
    expect(stepEnabled(config, "x")).toBe(false);
  });

  it("fingerprints the accounts and the counting rule, so a read under other settings isn't saved", () => {
    const fingerprint = (x: Record<string, unknown>) =>
      contentStepConfigFingerprint(
        "x",
        contentCollectionConfigSchema.parse({
          x: {
            enabled: true,
            accounts: [{ handle: "@builderio", allPosts: true }],
            links: ["builder.io/blog"],
            terms: ["Builder.io"],
            ...x,
          },
        }),
      );
    expect(fingerprint({})).toEqual(expect.any(String));
    expect(fingerprint({})).toBe(
      fingerprint({ accounts: [{ handle: "@BuilderIO", allPosts: true }] }),
    );
    expect(fingerprint({})).not.toBe(
      fingerprint({ accounts: [{ handle: "@builderio", allPosts: false }] }),
    );
    expect(fingerprint({})).not.toBe(fingerprint({ links: [] }));
    expect(fingerprint({})).not.toBe(fingerprint({ terms: ["Builder"] }));
  });

  it("takes an @handle and a host with an optional path, and nothing else", () => {
    expect(xAccountSchema.parse({ handle: " @Steve8708 " })).toEqual({
      handle: "@Steve8708",
      allPosts: false,
    });
    for (const handle of [
      "Steve8708",
      "@has space",
      "@toolonghandle12345",
      "",
    ]) {
      expect(xAccountSchema.safeParse({ handle }).success).toBe(false);
    }
    expect(xLinkTargetSchema.parse(" Builder.io/Blog ")).toBe(
      "builder.io/blog",
    );
    expect(xLinkTargetSchema.parse("agent-native.com")).toBe(
      "agent-native.com",
    );
    for (const value of ["https://builder.io/blog", "builder", "builder.io/"]) {
      expect(xLinkTargetSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rejects an account listed twice, even in another case", () => {
    const parsed = xAccountsSchema.safeParse([
      { handle: "@builderio", allPosts: true },
      { handle: "@Steve8708" },
      { handle: "@BuilderIO", allPosts: false },
    ]);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toEqual([
      expect.objectContaining({
        path: [2, "handle"],
        message: "@BuilderIO is already listed; X handles ignore case.",
      }),
    ]);
    expect(
      xAccountsSchema.safeParse([
        { handle: "@builderio" },
        { handle: "@Steve8708" },
      ]).success,
    ).toBe(true);
  });
});
