import { expect, type Page } from "@playwright/test";
import { z } from "zod";

export async function withClaimModel(
  page: Page,
  base: string,
  fakeUrl: string,
  run: () => Promise<void>,
) {
  const url = new URL(fakeUrl);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Local fake model fixture URL is invalid");
  const model = await fetch(new URL("/v1/models", url), {
    headers: { "x-fake-host": "api.anthropic.com" },
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  if (!model.ok) throw new Error("Local fake model fixture is unavailable");
  z.object({
    data: z.array(z.object({ id: z.literal("claude-sonnet-5-5") })).min(1),
  }).parse(await model.json());
  const keyName = "ANTHROPIC_API_KEY";
  const keys = async () => {
    const response = await page.request.get(
      `${base}/_agent-native/actions/list-api-keys`,
      { headers: { "x-agent-native-frontend": "1" } },
    );
    if (!response.ok()) throw new Error(`List keys HTTP ${response.status()}`);
    return z
      .object({
        keys: z.array(
          z.object({
            name: z.string(),
            scope: z.enum(["user", "org"]),
            storedScope: z.enum(["user", "workspace", "org"]),
          }),
        ),
      })
      .parse(await response.json()).keys;
  };
  if ((await keys()).some((key) => key.name === keyName))
    throw new Error("Local fake model key already exists");
  let attempted = false;
  let settled = false;
  let primaryError: unknown;
  try {
    await page.goto(`${base}/settings/model`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("button", { name: "Custom keys", exact: true })
      .click();
    await page.getByRole("button", { name: "Choose a provider" }).click();
    await page.locator("[cmdk-item]").filter({ hasText: "Anthropic" }).click();
    await page.getByRole("radio", { name: "Personal" }).check();
    await page
      .locator('input[type="password"]')
      .fill("local-fake-provider-key");
    attempted = true;
    const [response] = await Promise.all([
      page.waitForResponse(
        (item) =>
          item.request().method() === "POST" &&
          new URL(item.url()).pathname.endsWith(
            "/_agent-native/agent-engine/api-key",
          ),
        { timeout: 30000 },
      ),
      page.getByRole("button", { name: "Save", exact: true }).click(),
    ]);
    settled = true;
    if (!response.ok())
      throw new Error(`Local fake model key save HTTP ${response.status()}`);
    await expect
      .poll(
        async () =>
          (await keys()).filter(
            (key) =>
              key.name === keyName &&
              key.scope === "user" &&
              key.storedScope === "user",
          ).length,
        { timeout: 30000 },
      )
      .toBe(1);
    await expect
      .poll(
        async () => {
          const result = await page.request.get(
            `${base}/_agent-native/agent-engine/status`,
            { headers: { "x-agent-native-frontend": "1" } },
          );
          if (!result.ok())
            throw new Error(`Agent readiness HTTP ${result.status()}`);
          return z
            .object({ chatEligible: z.boolean() })
            .parse(await result.json()).chatEligible;
        },
        { timeout: 30000 },
      )
      .toBe(true);
    await run();
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      if (attempted) {
        const existing = (await keys()).filter((key) => key.name === keyName);
        if (
          existing.length > 1 ||
          existing.some(
            (key) => key.scope !== "user" || key.storedScope !== "user",
          )
        )
          throw new Error(
            "Local fake model key scope is unexpected; cleanup incomplete",
          );
        if (existing.length === 1) {
          await page.goto(
            `${base}/settings/secrets#secrets:ANTHROPIC_API_KEY`,
            { waitUntil: "domcontentloaded" },
          );
          const card = page
            .getByRole("button", { name: /^Anthropic API key/ })
            .locator("xpath=..");
          await expect(card).toHaveCount(1, { timeout: 30000 });
          await card
            .getByRole("button", { name: "Delete", exact: true })
            .click();
          await expect(
            card.getByText("Remove this saved value?"),
          ).toBeVisible();
          const [response] = await Promise.all([
            page.waitForResponse(
              (item) =>
                item.request().method() === "DELETE" &&
                new URL(item.url()).pathname.endsWith(
                  "/_agent-native/secrets/ANTHROPIC_API_KEY",
                ),
              { timeout: 30000 },
            ),
            card.getByRole("button", { name: "Confirm", exact: true }).click(),
          ]);
          if (!response.ok())
            throw new Error(
              `Local fake model key removal HTTP ${response.status()}`,
            );
        }
        await expect
          .poll(
            async () => (await keys()).some((key) => key.name === keyName),
            { timeout: 30000 },
          )
          .toBe(false);
        if (!settled)
          throw new Error(
            "Local fake model key save outcome is unknown; cleanup incomplete",
          );
        await expect
          .poll(
            async () => {
              const response = await page.request.get(
                `${base}/_agent-native/agent-engine/status`,
                { headers: { "x-agent-native-frontend": "1" } },
              );
              if (!response.ok())
                throw new Error(`Agent readiness HTTP ${response.status()}`);
              return z
                .object({ chatEligible: z.boolean() })
                .parse(await response.json()).chatEligible;
            },
            { timeout: 30000 },
          )
          .toBe(false);
      }
    } catch (cleanupError) {
      if (primaryError !== undefined)
        throw new AggregateError(
          [primaryError, cleanupError],
          "Claim flow and local fake model key cleanup failed",
        );
      throw cleanupError;
    }
  }
}
