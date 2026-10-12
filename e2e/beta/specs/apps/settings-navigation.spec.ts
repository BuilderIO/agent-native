import { expect, test, type Page } from "@playwright/test";

import {
  collectAppPageErrors,
  pressUntilVisible,
  renderedText,
} from "../../lib/app";
import {
  assertSignedInOnBeta,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import {
  authenticatableSites,
  authenticatedEntryPath,
  originFor,
  type BetaSite,
} from "../../lib/fleet";
import {
  LEGACY_SETTINGS_REDIRECTS,
  SETTINGS_DEFAULT_PAGE,
  accountMenuTrigger,
  activeSettingsNavItem,
  landsOnSettingsPage,
  newSettingsPath,
  readActiveOrganizationName,
} from "../../lib/settings";

/**
 * Getting to Settings, in every app with a signed-in session.
 *
 * The account menu replaced the per-app Settings entries, so a broken menu
 * or shortcut leaves a user with no way into Settings at all. Legacy links
 * (templates, OAuth callbacks, sent emails) all go through one redirect
 * table; three of them are sampled here per app.
 *
 * Read-only: nothing here writes app data.
 */

skipUnlessAuthed();

/** The apps in the Settings verification matrix that CI can sign in to. */
const SETTINGS_APPS = new Set([
  "analytics",
  "brain",
  "clips",
  "design",
  "dispatch",
  "slides",
]);

const sites = authenticatableSites().filter((site) =>
  SETTINGS_APPS.has(site.id),
);

const APP_ERROR = /application error|something went wrong/i;

test.describe.configure({ mode: "parallel" });

async function openEntry(page: Page, site: BetaSite) {
  await page.goto(`${originFor(site)}${authenticatedEntryPath(site)}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await renderedText(page, `${site.host} entry page`);
  const organization = (await readActiveOrganizationName(page)) ?? "Personal";
  const trigger = accountMenuTrigger(page, organization);
  await expect(
    trigger,
    `${site.host} rendered no account menu showing "${organization}", so the only way into Settings is missing`,
  ).toBeVisible({ timeout: 45_000 });
  return { trigger, organization };
}

/** Where Settings opens: Profile. */
async function expectSettingsOpened(page: Page, site: BetaSite, how: string) {
  await expect(
    activeSettingsNavItem(page, SETTINGS_DEFAULT_PAGE),
    `${how} on ${site.host} did not open Settings › Profile (landed on ${page.url()})`,
  ).toBeVisible({ timeout: 30_000 });
  // Some apps (Clips) open Settings through a legacy link, which the shell
  // rewrites to the page's own path a moment after the nav item is marked
  // current, so the address settles; it is not set when the page paints.
  try {
    await expect
      .poll(
        () =>
          landsOnSettingsPage(new URL(page.url()).pathname, {
            page: SETTINGS_DEFAULT_PAGE,
          }),
        { timeout: 15_000 },
      )
      .toBe(true);
  } catch (error) {
    throw new Error(
      `${how} on ${site.host} left the address at ${page.url()}, not ${newSettingsPath({ page: SETTINGS_DEFAULT_PAGE })}.\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const body = await renderedText(page, `${site.host} Settings via ${how}`);
  expect(
    body,
    `${site.host} Settings via ${how} rendered an error`,
  ).not.toMatch(APP_ERROR);
}

for (const site of sites) {
  test.describe(`${site.id} settings navigation`, () => {
    test("the account menu shows the account and opens Settings", async ({
      browser,
    }) => {
      const context = await signedInContext(browser, site, {
        seedModel: false,
      });
      try {
        await assertSignedInOnBeta(context, site);
        const page = await context.newPage();
        const { errors } = collectAppPageErrors(page, originFor(site));
        const { trigger, organization } = await openEntry(page, site);

        await expect(
          trigger,
          `${site.host} account menu button does not show the organization`,
        ).toContainText(organization);
        await trigger.click();
        const menu = page.getByRole("menu");
        await expect(
          menu,
          `${site.host} account menu did not open`,
        ).toBeVisible();
        // Order and removals are the spec's (§3.1): Settings with its
        // shortcut hint, Usage, Log out; no Organization settings, no
        // Invite member.
        await expect(
          menu.getByRole("menuitem", { name: /^Settings/ }),
        ).toContainText(/⌘,|Ctrl\+,/);
        await expect(
          menu.getByRole("menuitem", { name: /^Usage/ }),
        ).toBeVisible();
        await expect(
          menu.getByRole("menuitem", { name: /^Log out/ }),
        ).toBeVisible();
        await expect(
          menu.getByRole("menuitem", {
            name: /Organization settings|Invite member/,
          }),
        ).toHaveCount(0);

        await menu.getByRole("menuitem", { name: /^Settings/ }).click();
        await expectSettingsOpened(page, site, "account menu › Settings");
        expect(
          errors,
          `${site.host} threw uncaught errors from its own code opening Settings from the account menu`,
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });

    test("⌘, opens Settings", async ({ browser }) => {
      const context = await signedInContext(browser, site, {
        seedModel: false,
      });
      try {
        await assertSignedInOnBeta(context, site);
        const page = await context.newPage();
        const { errors } = collectAppPageErrors(page, originFor(site));
        await openEntry(page, site);

        // Headless Chromium hands ⌘, (Ctrl+, off macOS) to the page. A
        // desktop browser on macOS may keep it for its own preferences, which
        // is why ⌘K › Settings is its own test: it is the keyboard path every
        // browser allows.
        await page.keyboard.press("ControlOrMeta+Comma");
        await expectSettingsOpened(page, site, "⌘,");
        test.info().annotations.push({
          type: "browser-behavior",
          description: `${site.id}: headless Chromium delivered ControlOrMeta+Comma to the page`,
        });

        // Inside Settings the shortcut is a no-op.
        const before = page.url();
        await page.keyboard.press("ControlOrMeta+Comma");
        await page.waitForTimeout(1_500);
        expect(page.url(), `${site.host} ⌘, moved away from Settings`).toBe(
          before,
        );
        expect(
          errors,
          `${site.host} threw uncaught errors from its own code opening Settings with ⌘,`,
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });

    test("⌘K › Settings opens Settings", async ({ browser }) => {
      const context = await signedInContext(browser, site, {
        seedModel: false,
      });
      try {
        await assertSignedInOnBeta(context, site);
        const page = await context.newPage();
        const { errors } = collectAppPageErrors(page, originFor(site));
        await openEntry(page, site);

        // The menu's own key handler attaches after the page paints, and the
        // shortcut is ignored while a text field has focus, so the menu is
        // opened with retries and a miss reports what held focus.
        await pressUntilVisible(
          page,
          "ControlOrMeta+KeyK",
          page.locator("[cmdk-input]").first(),
        );
        const command = page
          .locator("[cmdk-item]")
          .filter({ hasText: /^\s*Settings/ })
          .first();
        await expect(
          command,
          `${site.host} ⌘K menu opened but has no Settings command, so there is no keyboard path to Settings where the browser keeps ⌘,`,
        ).toBeVisible({ timeout: 15_000 });
        await command.click();
        await expectSettingsOpened(page, site, "⌘K › Settings");
        expect(
          errors,
          `${site.host} threw uncaught errors from its own code opening Settings from ⌘K`,
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });

    test("legacy Settings links land on their new pages", async ({
      browser,
    }) => {
      const context = await signedInContext(browser, site, {
        seedModel: false,
      });
      try {
        await assertSignedInOnBeta(context, site);
        const page = await context.newPage();
        const origin = originFor(site);
        const { errors } = collectAppPageErrors(page, origin);
        await openEntry(page, site);

        for (const link of LEGACY_SETTINGS_REDIRECTS) {
          await page.goto(`${origin}${link.from}`, {
            waitUntil: "domcontentloaded",
            timeout: 90_000,
          });
          await expect(
            activeSettingsNavItem(page, link.page),
            `${site.host} ${link.from} (${link.reason}) did not open Settings › ${link.page}; landed on ${page.url()}`,
          ).toBeVisible({ timeout: 30_000 });
          await expect
            .poll(() => new URL(page.url()).pathname, {
              message: `${site.host} ${link.from} was not rewritten to ${newSettingsPath(link)}`,
              timeout: 15_000,
            })
            .toMatch(new RegExp(`${newSettingsPath(link)}$`));
          const body = await renderedText(page, `${site.host} ${link.from}`);
          expect
            .soft(body, `${site.host} ${link.from} rendered an error`)
            .not.toMatch(APP_ERROR);
        }
        expect(
          errors,
          `${site.host} threw uncaught errors from its own code following legacy Settings links`,
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });
  });
}
