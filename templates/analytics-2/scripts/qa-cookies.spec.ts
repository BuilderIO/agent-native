import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";

import { playwrightCookiesFromCdp } from "../e2e/qa-cookies.js";

const cookie = {
  name: "fixture",
  value: "fixture-value",
  domain: "qa.example.test",
  path: "/",
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: "None",
};

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});

it("preserves both Chromium ancestor bits and unpartitioned cookies through Playwright", async () => {
  const context = await browser.newContext();
  try {
    await context.addCookies(
      playwrightCookiesFromCdp(
        [
          {
            ...cookie,
            name: "first-party",
            partitionKey: {
              topLevelSite: "https://example.test",
              hasCrossSiteAncestor: false,
            },
          },
          {
            ...cookie,
            name: "cross-site",
            partitionKey: {
              topLevelSite: "https://example.test",
              hasCrossSiteAncestor: true,
            },
          },
          { ...cookie, name: "unpartitioned" },
        ],
        "https://qa.example.test/",
      ),
    );
    const cdp = await browser.newBrowserCDPSession();
    const { browserContextIds } = await cdp.send("Target.getBrowserContexts");
    expect(browserContextIds).toHaveLength(1);
    const result = await cdp.send("Storage.getCookies", {
      browserContextId: z.string().parse(browserContextIds[0]),
    });
    expect(
      result.cookies
        .map(({ name, partitionKey }) => ({ name, partitionKey }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ).toEqual([
      {
        name: "cross-site",
        partitionKey: {
          topLevelSite: "https://example.test",
          hasCrossSiteAncestor: true,
        },
      },
      {
        name: "first-party",
        partitionKey: {
          topLevelSite: "https://example.test",
          hasCrossSiteAncestor: false,
        },
      },
      { name: "unpartitioned", partitionKey: undefined },
    ]);
  } finally {
    await context.close();
  }
});

it.each([
  { partitionKey: { topLevelSite: "https://example.test" } },
  {
    partitionKey: {
      topLevelSite: "https://example.test",
      hasCrossSiteAncestor: "false",
    },
  },
  { partitionKey: { topLevelSite: "invalid", hasCrossSiteAncestor: false } },
  { partitionKey: "https://example.test" },
  { partitionKey: null },
  { partitionKeyOpaque: true },
])("rejects unreadable partition metadata %#", (metadata) => {
  expect(() =>
    playwrightCookiesFromCdp(
      [{ ...cookie, ...metadata }],
      "https://qa.example.test/",
    ),
  ).toThrow();
});

it("ignores unrelated domain and app-path metadata before validating partitions", () => {
  const unrelated = { ...cookie, partitionKeyOpaque: true };
  expect(
    playwrightCookiesFromCdp(
      [
        { ...unrelated, domain: "unrelated.test" },
        { ...unrelated, domain: "a.example.test" },
        { ...unrelated, path: "/mail-2" },
        { ...unrelated, path: "/analytics-20" },
        { ...cookie, path: "/analytics-2" },
      ],
      "https://qa.example.test/analytics-2/",
    ),
  ).toEqual([{ ...cookie, path: "/analytics-2" }]);
});
