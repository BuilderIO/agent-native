import { expect, test } from "@playwright/test";

import { collectAppPageErrors, renderedText } from "../../lib/app";
import {
  assertSignedInOnBeta,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import {
  authenticatedEntryPath,
  chatSites,
  originFor,
  selectedSites,
  siteById,
} from "../../lib/fleet";

skipUnlessAuthed();

const selected = new Set(selectedSites().map((site) => site.id));

function whenSelected(id: string) {
  return () =>
    test.skip(!selected.has(id), `${id} not in this run's selection`);
}

test.describe.configure({ mode: "parallel" });

test.describe("slides deck list", () => {
  test.beforeEach(whenSelected("slides"));

  test("renders the deck list without collapsing to the signed-out state", async ({
    browser,
  }) => {
    const site = siteById("slides");
    const origin = originFor(site);
    const context = await signedInContext(browser, site, { seedModel: false });
    try {
      await assertSignedInOnBeta(context, site);
      const page = await context.newPage();
      const { errors } = collectAppPageErrors(page, origin);

      await page.goto(`${origin}${authenticatedEntryPath(site)}`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      const body = await renderedText(page, "beta.slides deck list");
      expect(
        body,
        "beta.slides showed a signed-out surface to a signed-in session",
      ).not.toMatch(/sign in with google|create an account or sign in/i);
      expect(
        errors,
        "beta.slides threw uncaught errors from its own code on the deck list",
      ).toEqual([]);

      const mine = page.locator('[aria-label="Show decks created by me"]');
      test.skip(
        (await mine.count()) === 0,
        "deck list did not render a Mine filter",
      );
      await mine.first().click();
      await page.waitForTimeout(3_000);

      const afterFilter = await renderedText(
        page,
        'beta.slides deck list with "Mine" applied',
      );
      const allDecksEmpty = /no decks (?:yet|found)/i.test(body);
      const mineEmpty = /No decks created by you yet\./i.test(afterFilter);

      test.skip(
        allDecksEmpty,
        "this account owns no decks on beta.slides, so Mine has nothing to show",
      );
      expect(
        mineEmpty,
        'beta.slides lists decks but "Mine" is empty — the owner comparison is not resolving this session\'s identity, which is what users reported as "I am not seeing any of my decks under Mine"',
      ).toBe(false);
    } finally {
      await context.close();
    }
  });
});

test.describe("content workspace", () => {
  test.beforeEach(whenSelected("content"));

  test("opens a document surface for a signed-in user", async ({ browser }) => {
    const site = siteById("content");
    const origin = originFor(site);
    const context = await signedInContext(browser, site, { seedModel: false });
    try {
      await assertSignedInOnBeta(context, site);
      const page = await context.newPage();
      const { errors } = collectAppPageErrors(page, origin);

      await page.goto(`${origin}${authenticatedEntryPath(site)}`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      const body = await renderedText(page, "beta.content document surface");
      expect(
        body,
        "beta.content showed a signed-out surface to a signed-in session",
      ).not.toMatch(/sign in with google|create an account or sign in/i);
      expect(
        errors,
        "beta.content threw uncaught errors from its own code",
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe("forms list", () => {
  test.beforeEach(whenSelected("forms"));

  test("does not show the signed-out prompt to a signed-in user", async ({
    browser,
  }) => {
    const site = siteById("forms");
    const origin = originFor(site);
    const context = await signedInContext(browser, site, { seedModel: false });
    try {
      await assertSignedInOnBeta(context, site);
      const page = await context.newPage();
      await page.goto(`${origin}/`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      const body = await renderedText(page, "beta.forms list");
      expect(
        body,
        'beta.forms told a signed-in user to "Sign in to see your forms." — the session is not reaching the list query',
      ).not.toContain("Sign in to see your forms.");
    } finally {
      await context.close();
    }
  });
});

test.describe("clips recorder", () => {
  test.beforeEach(whenSelected("clips"));

  test("opens the library and idle recorder without a stuck capture state", async ({
    browser,
  }) => {
    const site = siteById("clips");
    const origin = originFor(site);
    const context = await signedInContext(browser, site, { seedModel: false });
    try {
      await assertSignedInOnBeta(context, site);
      const page = await context.newPage();
      const { errors } = collectAppPageErrors(page, origin);

      await page.goto(`${origin}/library`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      const libraryBody = await renderedText(page, "beta.clips library");
      expect(
        libraryBody,
        "beta.clips showed a signed-out surface to a signed-in session",
      ).not.toMatch(/sign in with google|create an account or sign in/i);

      await page.goto(`${origin}/record`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      const recorderBody = await renderedText(page, "beta.clips idle recorder");
      expect(recorderBody).toMatch(/Clips recorder/i);
      expect(recorderBody).not.toMatch(
        /preparing sources|recording your screen|saving your recording|already recording/i,
      );
      await expect(
        page.getByRole("button", { name: /back to library/i }),
        "beta.clips recorder did not render a safe way back before capture starts",
      ).toBeVisible({ timeout: 30_000 });
      expect(
        errors,
        "beta.clips threw uncaught errors from its own code while opening the library and recorder",
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe("dispatch workspace", () => {
  test.beforeEach(whenSelected("dispatch"));

  test("lists workspace apps and opens settings without crashing", async ({
    browser,
  }) => {
    const site = siteById("dispatch");
    const origin = originFor(site);
    const context = await signedInContext(browser, site, { seedModel: false });
    try {
      await assertSignedInOnBeta(context, site);
      const page = await context.newPage();
      const { errors } = collectAppPageErrors(page, origin);

      await page.goto(`${origin}/apps`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      const body = await renderedText(page, "beta.dispatch /apps");
      expect(
        body,
        "beta.dispatch /apps rendered an application error",
      ).not.toMatch(/application error|something went wrong/i);
      expect(
        body,
        'beta.dispatch /apps did not render the "Your apps" section',
      ).toMatch(/your apps/i);

      for (const path of [
        "/settings/general",
        "/settings/agent/resources/instructions",
      ]) {
        await page.goto(`${origin}${path}`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        const settingsBody = await renderedText(page, `beta.dispatch ${path}`);
        expect(
          settingsBody,
          `beta.dispatch ${path} rendered an application error`,
        ).not.toMatch(/application error|something went wrong/i);
      }

      expect(
        errors,
        "beta.dispatch threw uncaught errors from its own code while navigating apps and settings",
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("opens a listed app through its Dispatch workspace route", async ({
    browser,
  }) => {
    const site = siteById("dispatch");
    const origin = originFor(site);
    const context = await signedInContext(browser, site, { seedModel: false });
    try {
      await assertSignedInOnBeta(context, site);
      const page = await context.newPage();
      const { errors } = collectAppPageErrors(page, origin);

      await page.goto(`${origin}/apps`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      const openApp = page.locator("button.app-open-actions__primary").first();
      test.skip(
        (await openApp.count()) === 0,
        "this account has no ready workspace app with an Open app action",
      );

      await openApp.click();
      await expect(
        page.locator("[data-dispatch-workspace-app-host]"),
        "Dispatch did not render a workspace app host after clicking Open app",
      ).toBeVisible({ timeout: 60_000 });

      expect(new URL(page.url()).pathname).toMatch(/\/apps\/[^/]+$/);
      const body = await renderedText(
        page,
        "beta.dispatch opened workspace app",
      );
      expect(
        body,
        "beta.dispatch opened an app route that rendered the missing-app or error pane",
      ).not.toMatch(
        /app not found|page not found|application error|something went wrong/i,
      );
      expect(
        errors,
        "beta.dispatch threw uncaught errors from its own code while opening a workspace app",
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe("app-local chat history", () => {
  for (const site of chatSites()) {
    test(`${site.id} does not return another app's local threads`, async ({
      browser,
    }) => {
      const origin = originFor(site);
      const context = await signedInContext(browser, site, {
        seedModel: false,
      });
      try {
        await assertSignedInOnBeta(context, site);
        const page = await context.newPage();
        await page.goto(
          `${origin}${authenticatedEntryPath(site)}?agentSidebar=open`,
          {
            waitUntil: "domcontentloaded",
            timeout: 90_000,
          },
        );

        const result = await page.evaluate(async () => {
          const response = await fetch(
            "/_agent-native/agent-chat/threads?limit=100",
            { headers: { accept: "application/json" } },
          );
          const payload = (await response.json()) as {
            threads?: Array<{
              source?: { appId?: string | null } | null;
            }>;
          };
          return {
            status: response.status,
            threads: payload.threads ?? [],
          };
        });

        expect(
          result.status,
          `${site.host} did not return an authenticated local thread list`,
        ).toBe(200);
        const foreignAppIds = result.threads
          .map((thread) => thread.source?.appId ?? null)
          .filter(
            (appId): appId is string => Boolean(appId) && appId !== site.id,
          );
        expect(
          foreignAppIds,
          `${site.host} returned local chat threads sourced from another app; switching back to this app can show the wrong conversation`,
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
