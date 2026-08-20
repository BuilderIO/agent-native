import { expect, test } from "@playwright/test";

import { collectAppPageErrors, renderedText } from "../../lib/app";
import {
  assertSignedInOnBeta,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import { originFor, selectedSites, siteById } from "../../lib/fleet";

/**
 * "My things are gone."
 *
 * Reported across apps in the same week: decks missing from Mine, a Content
 * page vanishing from personal pages, custom apps absent from Dispatch. They
 * share one cause shape — a list that scopes rows by the requesting user's
 * identity renders empty when that identity does not resolve, and an empty
 * list looks exactly like "you have nothing".
 *
 * These specs read only. They assert the signed-in surface renders its own
 * data rather than the signed-out or empty state, without creating fixtures:
 * most beta apps share a database with production, so a test that writes
 * leaves residue in real users' data.
 */

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

      await page.goto(`${origin}/`, {
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

      // "Mine" is the filter that broke: it compares each row's owner against
      // the request identity, so it empties out when identity resolution
      // fails even though the decks are still there.
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
      // The unfiltered empty state must be matched on its own wording. The
      // looser /no decks/i also matches "No decks created by you yet.", so the
      // skip below would fire in exactly the case this test exists to catch —
      // decks present, "Mine" empty — and the assertion would never run.
      const allDecksEmpty = /no decks (?:yet|found)/i.test(body);
      const mineEmpty = /No decks created by you yet\./i.test(afterFilter);

      // Only meaningful when the account owns decks at all.
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

      await page.goto(`${origin}/`, {
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
      // Positive signal, not the word "apps" — that appears in the nav of every
      // page and would make this assertion meaningless.
      expect(
        body,
        'beta.dispatch /apps did not render the "Your apps" section',
      ).toMatch(/your apps/i);

      // Clicking Instructions under settings was reported to crash the app.
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
});
