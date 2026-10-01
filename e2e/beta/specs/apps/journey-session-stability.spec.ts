import { expect, test, type Page } from "@playwright/test";

import {
  assertSignedInOnBeta,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import {
  authenticatableSites,
  authenticatedEntryPath,
  originFor,
  siteById,
  type BetaSite,
} from "../../lib/fleet";
import {
  assertSignedInApp,
  installSignInWatch,
  storedCookies,
  type SignInWatch,
} from "../../lib/journey-browser";
import {
  SETTINGS_DEFAULT_PAGE,
  accountMenuTrigger,
  activeSettingsNavItem,
  readActiveOrganizationName,
} from "../../lib/settings";

/**
 * Session stability: a signed-in user must never be shown, or sent to, the
 * sign-in surface.
 *
 * Users keep reporting "flashes to sign-in then returns", "signs me out",
 * "login loop", "auth with Google 3x" (Slack #product-agent-native-feedback,
 * 8/18 to 10/1; ENG-13992). Each fix landed next to a different one of the
 * several readers that decide signed-in or signed-out, and the loop moved to
 * the next seam. These journeys exercise the seams from the outside: hard
 * reloads, in-app navigation, a slow session check on a slow network, and two
 * apps signed in side by side in one browser. Every main-frame URL is
 * recorded, and a visible sign-in surface in the DOM at any moment counts.
 *
 * Read-only: nothing here writes app data.
 */

skipUnlessAuthed();

const SESSION_APPS = ["slides", "design", "analytics", "clips", "dispatch"];
const sites = authenticatableSites().filter((site) =>
  SESSION_APPS.includes(site.id),
);

const RELOADS = 5;
/** Slow-4G-ish: 300 ms of latency, ~6 Mbps down, ~2.4 Mbps up. */
const SLOW_NETWORK = {
  offline: false,
  latency: 300,
  downloadThroughput: 750 * 1024,
  uploadThroughput: 300 * 1024,
} as const;
const UNTHROTTLED = {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
} as const;
const SLOW_SESSION_CHECK_MS = 3_000;

test.describe.configure({ mode: "parallel" });

function entryUrl(site: BetaSite): string {
  return `${originFor(site)}${authenticatedEntryPath(site)}`;
}

async function openAccountMenuSettings(
  page: Page,
  site: BetaSite,
  watch: SignInWatch,
): Promise<void> {
  watch.step("in-app navigation 1: account menu > Settings");
  const organization = (await readActiveOrganizationName(page)) ?? "Personal";
  await accountMenuTrigger(page, organization).click();
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: /^Settings/ })
    .click();
  await expect(
    activeSettingsNavItem(page, SETTINGS_DEFAULT_PAGE),
    `${site.host}: account menu > Settings did not open Settings > Profile (at ${page.url()})`,
  ).toBeVisible({ timeout: 45_000 });
  await watch.assertClean(`${site.host} after account menu > Settings`);
}

async function switchSettingsPage(
  page: Page,
  site: BetaSite,
  watch: SignInWatch,
): Promise<void> {
  watch.step("in-app navigation 2: Settings > Preferences");
  await page
    .locator('aside [data-settings-page="preferences"]:visible')
    .first()
    .click();
  await expect(
    activeSettingsNavItem(page, "preferences"),
    `${site.host}: Settings nav did not open Preferences (at ${page.url()})`,
  ).toBeVisible({ timeout: 30_000 });
  await watch.assertClean(`${site.host} after Settings > Preferences`);
}

async function backToApp(
  page: Page,
  site: BetaSite,
  watch: SignInWatch,
): Promise<void> {
  watch.step("in-app navigation 3: Settings > Back to app");
  await page
    .getByRole("link", { name: /^Back to / })
    .first()
    .click();
  await expect(
    page,
    `${site.host}: "Back to app" stayed in Settings (at ${page.url()})`,
  ).not.toHaveURL(/\/settings(?:\/|\?|$)/, { timeout: 30_000 });
  await assertSignedInApp(page, site, watch, "after returning from Settings");
}

for (const site of sites) {
  const origin = originFor(site);

  test.describe(`${site.id} session stability`, () => {
    test(`[journey] [session] ${site.id} stays signed in across ${RELOADS} reloads and 3 in-app navigations`, async ({
      browser,
    }) => {
      test.setTimeout(420_000);
      const context = await signedInContext(browser, site, {
        seedModel: false,
      });
      try {
        await assertSignedInOnBeta(context, site);
        const watch = await installSignInWatch(context, [origin]);
        const page = await context.newPage();
        watch.watch(page);

        watch.step("initial load");
        await page.goto(entryUrl(site), {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        await assertSignedInApp(page, site, watch, "initial load");

        for (let reload = 1; reload <= RELOADS; reload += 1) {
          watch.step(`reload ${reload}/${RELOADS}`);
          await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
          await assertSignedInApp(
            page,
            site,
            watch,
            `reload ${reload}/${RELOADS}`,
          );
        }

        await openAccountMenuSettings(page, site, watch);
        await switchSettingsPage(page, site, watch);
        await backToApp(page, site, watch);
      } finally {
        await context.close();
      }
    });

    test(`[journey] [session] ${site.id} stays signed in when the network and the session check are slow`, async ({
      browser,
    }) => {
      test.setTimeout(600_000);
      const context = await signedInContext(browser, site, {
        seedModel: false,
      });
      try {
        await assertSignedInOnBeta(context, site);
        const watch = await installSignInWatch(context, [origin]);
        const page = await context.newPage();
        watch.watch(page);

        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.emulateNetworkConditions", SLOW_NETWORK);
        // A slow answer from the session endpoints is exactly the window in
        // which an "unauthenticated until proven otherwise" reader redirects.
        const slowSessionRoute =
          /\/_agent-native\/(?:auth\/session|org\/me)(?:\?|$)/;
        await page.route(slowSessionRoute, async (route) => {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, SLOW_SESSION_CHECK_MS),
          );
          try {
            await route.continue();
          } catch {
            // The page was closed while the answer was being held back.
          }
        });

        watch.step("slow network: initial load");
        await page.goto(entryUrl(site), {
          waitUntil: "domcontentloaded",
          timeout: 180_000,
        });
        await assertSignedInApp(page, site, watch, "slow initial load", {
          timeoutMs: 150_000,
        });

        await cdp.send("Network.emulateNetworkConditions", UNTHROTTLED);
        await page.unroute(slowSessionRoute);
        watch.step("recovered network: reload");
        await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
        await assertSignedInApp(page, site, watch, "reload after recovery");
      } finally {
        await context.close();
      }
    });
  });
}

/**
 * Sign in to one app, then open a second in a new tab of the same browser
 * context. Both stored sessions live in the one cookie jar, so a cookie that
 * is scoped too widely makes the second sign-in overwrite the first: the
 * "auth with Google 3x" and "signs me out when I switch apps" shape.
 */
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["slides", "design"],
  ["analytics", "dispatch"],
  ["clips", "slides"],
];
const selectedIds = new Set(sites.map((site) => site.id));

for (const [firstId, secondId] of PAIRS) {
  if (!selectedIds.has(firstId) || !selectedIds.has(secondId)) continue;
  const first = siteById(firstId);
  const second = siteById(secondId);

  test(`[journey] [session] ${firstId} then ${secondId} in a new tab: still signed in on arrival, neither session clobbers the other`, async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const context = await signedInContext(browser, first, {
      seedModel: false,
    });
    try {
      await context.addCookies(storedCookies(second.id));
      const watch = await installSignInWatch(context, [
        originFor(first),
        originFor(second),
      ]);

      const firstTab = await context.newPage();
      watch.watch(firstTab);
      watch.step(`${firstId}: first tab load`);
      await firstTab.goto(entryUrl(first), {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await assertSignedInApp(firstTab, first, watch, "first tab load");

      const secondTab = await context.newPage();
      watch.watch(secondTab);
      watch.step(`${secondId}: new tab arrival`);
      await secondTab.goto(entryUrl(second), {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await assertSignedInApp(
        secondTab,
        second,
        watch,
        `new tab arrival after signing in to ${firstId}`,
      );

      await firstTab.bringToFront();
      watch.step(`${firstId}: reload after ${secondId} arrived`);
      await firstTab.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
      await assertSignedInApp(
        firstTab,
        first,
        watch,
        `reload after ${secondId} was opened`,
      );

      await secondTab.bringToFront();
      watch.step(`${secondId}: reload after ${firstId} reloaded`);
      await secondTab.reload({
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await assertSignedInApp(
        secondTab,
        second,
        watch,
        `reload after ${firstId} was reloaded`,
      );
    } finally {
      await context.close();
    }
  });
}
