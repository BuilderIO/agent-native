import { expect, test } from "@playwright/test";

import { collectAppPageErrors, renderedText } from "../../lib/app";
import {
  assertSignedInOnBeta,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import {
  authenticatableSites,
  authenticatedEntryPath,
  originFor,
} from "../../lib/fleet";
import {
  collectServerErrors,
  probeFromPage,
  visibleText,
} from "../../lib/journey-browser";
import { builderConnectionDisagreements } from "../../lib/journey-checks";
import {
  accountMenuTrigger,
  activeSettingsNavItem,
  readActiveOrganizationName,
} from "../../lib/settings";

/**
 * Settings > API keys, and the Builder connection beside it.
 *
 * Provider and connection setup is the area users most often report as
 * wrong or unrecoverable: "Connect Builder" loops, "no keys connected",
 * "provider rejected the credential", BYOK dead ends (Slack
 * #product-agent-native-feedback, 9/14 to 10/1; fixes #5041, #5764, #6123,
 * #6355, #6428 were each followed by a new report). Nothing in the beta suite
 * opened these pages; the key was installed through the API and the UI never
 * looked at. This opens them, as a user would, on three apps.
 *
 * Read-only: nothing is saved, connected, or disconnected.
 */

skipUnlessAuthed();

const PREFERRED_APPS = ["analytics", "slides", "dispatch", "clips", "design"];
const available = authenticatableSites();
const sites = PREFERRED_APPS.flatMap((id) =>
  available.filter((site) => site.id === id),
).slice(0, 3);

const APP_ERROR =
  /application error|something went wrong|internal server error|Couldn.t load your keys/i;
const CONNECTION_STATE =
  /\b(?:Connect|Disconnect|Reconnect|Connected)\b|Needs to be reconnected/;

test.describe.configure({ mode: "parallel" });

for (const site of sites) {
  test(`[journey] [settings-keys] ${site.id} Settings > API keys renders and the Builder connection agrees with the account`, async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const origin = originFor(site);
    const context = await signedInContext(browser, site, { seedModel: false });
    try {
      await assertSignedInOnBeta(context, site);
      const page = await context.newPage();
      const serverErrors = collectServerErrors(page, origin);
      const { errors: pageErrors } = collectAppPageErrors(page, origin);

      // The account chrome: what the app itself says about the connection.
      await page.goto(`${origin}${authenticatedEntryPath(site)}`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await renderedText(page, `${site.host} entry page`);
      const organization =
        (await readActiveOrganizationName(page)) ?? "Personal";
      const trigger = accountMenuTrigger(page, organization);
      await expect(
        trigger,
        `${site.host} rendered no account menu showing "${organization}"`,
      ).toBeVisible({ timeout: 60_000 });
      const entryText = await visibleText(page);
      await trigger.click();
      const menu = page.getByRole("menu");
      await expect(
        menu,
        `${site.host} account menu did not open`,
      ).toBeVisible();
      const menuText = await menu.innerText();
      await page.keyboard.press("Escape");

      const [builder, credit] = await probeFromPage(page, [
        "/_agent-native/connection-status/builder",
        "/_agent-native/actions/get-builder-credit-status",
      ]);
      expect(
        builder.status,
        `${site.host} ${builder.path} answered HTTP ${builder.status}: ${builder.text.slice(0, 300)}`,
      ).toBe(200);
      const builderBody =
        builder.parsed && builder.json && typeof builder.json === "object"
          ? (builder.json as Record<string, unknown>)
          : null;
      expect(
        typeof builderBody?.configured,
        `${site.host} ${builder.path} returned no boolean "configured": ${builder.text.slice(0, 300)}`,
      ).toBe("boolean");
      const creditBody =
        credit.status === 200 && credit.parsed
          ? credit.json === null
            ? { exhausted: false }
            : (credit.json as Record<string, unknown>)
          : null;
      const creditExhausted =
        typeof creditBody?.exhausted === "boolean"
          ? creditBody.exhausted
          : null;

      // Settings > API keys.
      await page.goto(`${origin}/settings/api-keys`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await expect(
        activeSettingsNavItem(page, "api-keys"),
        `${site.host} /settings/api-keys did not open Settings > API keys (landed on ${page.url()})`,
      ).toBeVisible({ timeout: 45_000 });
      await expect(
        page.locator('[aria-busy="true"][aria-label="Loading settings"]'),
        `${site.host} Settings > API keys is still showing its loading skeleton`,
      ).toHaveCount(0, { timeout: 45_000 });
      const keysText = await renderedText(
        page,
        `${site.host} Settings > API keys`,
      );
      expect(
        keysText,
        `${site.host} Settings > API keys rendered an error state at ${page.url()}`,
      ).not.toMatch(APP_ERROR);

      // Settings > Integrations > Builder.io.
      const statusResponse = page.waitForResponse(
        (response) =>
          response.url().includes("/_agent-native/connection-status/builder"),
        { timeout: 60_000 },
      );
      statusResponse.catch(() => undefined);
      await page.goto(`${origin}/settings/integrations/builder`, {
        waitUntil: "domcontentloaded",
        timeout: 90_000,
      });
      await statusResponse.catch((error: unknown) => {
        throw new Error(
          `${site.host} Settings > Integrations > Builder.io never asked for its connection status: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      await expect(
        activeSettingsNavItem(page, "integrations"),
        `${site.host} /settings/integrations/builder did not open Settings > Integrations (landed on ${page.url()})`,
      ).toBeVisible({ timeout: 45_000 });
      await expect
        .poll(async () => CONNECTION_STATE.test(await visibleText(page)), {
          message: `${site.host} Settings > Integrations > Builder.io never showed a connection state (Connect, Connected, Reconnect or Disconnect)`,
          timeout: 45_000,
        })
        .toBe(true);
      const builderPageText = await visibleText(page);
      expect(
        builderPageText,
        `${site.host} Settings > Integrations > Builder.io rendered an error state at ${page.url()}`,
      ).not.toMatch(APP_ERROR);

      const disagreements = builderConnectionDisagreements({
        configured: builderBody?.configured === true,
        effective:
          typeof builderBody?.effective === "string"
            ? builderBody.effective
            : null,
        settingsText: builderPageText,
        chromeText: `${entryText}\n${menuText}`,
        creditExhausted,
      });
      test.info().annotations.push({
        type: "builder-connection",
        description: `${site.id}: configured=${String(builderBody?.configured)} effective=${String(builderBody?.effective)} creditExhausted=${String(creditExhausted)} connectError=${JSON.stringify(builderBody?.connectError ?? null)} authError=${JSON.stringify(builderBody?.authError ?? null)}`,
      });
      expect(
        disagreements,
        `${site.host} shows the Builder connection inconsistently:\n- ${disagreements.join("\n- ")}\nStatus: ${builder.text.slice(0, 500)}\nCredit: ${credit.text.slice(0, 200)}`,
      ).toEqual([]);

      expect(
        serverErrors,
        `${site.host} answered 5xx while opening Settings > API keys and Settings > Integrations > Builder.io`,
      ).toEqual([]);
      expect(
        pageErrors,
        `${site.host} threw uncaught errors from its own code on the Settings pages`,
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
