import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

export async function checkUsersSettings(
  page: Page,
  base: string,
  expectedAdmin?: boolean,
): Promise<void> {
  const response = await page
    .context()
    .request.get(`${base}/_agent-native/actions/get-workspace-shell`, {
      headers: { "x-agent-native-frontend": "1" },
    });
  expect(response.ok()).toBe(true);
  const shell = z
    .object({
      user: z.object({ email: z.literal("qa-fleet@builder.io") }),
      features: z.object({ isAdmin: z.boolean() }),
    })
    .parse(await response.json());
  expect(shell.user.email).toBe("qa-fleet@builder.io");
  const isAdmin = shell.features.isAdmin;
  if (expectedAdmin !== undefined) expect(isAdmin).toBe(expectedAdmin);

  await page.goto(`${base}/settings/users`, { waitUntil: "domcontentloaded" });
  for (const reload of [false, true]) {
    if (reload) await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Users", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("List of users in your workspace.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Search people")).toBeVisible();
    const invite = page.getByRole("heading", {
      name: "Invite link",
      exact: true,
    });
    const requests = page.getByRole("heading", {
      name: "Role requests",
      exact: true,
    });
    if (isAdmin) {
      await expect(invite).toBeVisible();
      await expect(requests).toBeVisible();
    } else {
      await expect(invite).toHaveCount(0);
      await expect(requests).toHaveCount(0);
      await expect(
        page.getByText("Share a link that opens the workspace invitation", {
          exact: false,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Invite members", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: /^(Request admin access|Request sent)$/,
        }),
      ).toBeVisible();
    }
  }
  const directory = resolve(".tmp/analytics-owner");
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: resolve(
      directory,
      `users-settings-${isAdmin ? "admin" : "member"}.png`,
    ),
  });
  console.log(
    `PASS M5-T2-F-03 ${isAdmin ? "admin" : "member"}: QA identity, Users title, description, member search and panel visibility; reload verified`,
  );
}
