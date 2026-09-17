import { expect, test } from "@playwright/test";

import { appPath } from "./helpers";

test("No design system remains explicit when creating a blank design", async ({
  page,
  request,
}) => {
  const systemResponse = await request.post(
    appPath("/_agent-native/actions/create-design-system"),
    { data: { title: "QA optional design system", data: "{}" } },
  );
  expect(systemResponse.ok()).toBe(true);
  const system = await systemResponse.json();
  await page.goto(appPath("/home"));
  const newDesign = page.getByRole("button", {
    name: "New Design",
    exact: true,
  });
  const dismissSetup = page.getByRole("button", {
    name: "Dismiss",
    exact: true,
  });
  await expect(newDesign.or(dismissSetup).first()).toBeVisible();
  if (await dismissSetup.isVisible()) await dismissSetup.click();
  await newDesign.click();
  await page.getByRole("combobox").click();
  await page
    .getByRole("option", { name: "No design system", exact: true })
    .click();
  const creation = page.waitForResponse((response) =>
    response.url().endsWith("/_agent-native/actions/create-design"),
  );
  await page.getByRole("button", { name: "Skip prompt", exact: true }).click();
  const response = await creation;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON()).toHaveProperty(
    "designSystemId",
    null,
  );
  const created = await response.json();
  const designId = created.id;
  expect(typeof designId).toBe("string");
  try {
    await expect(page).toHaveURL(new RegExp(`/design/${designId}`));
    await page.reload();
    const saved = await request.get(
      appPath("/_agent-native/actions/get-design"),
      {
        params: { id: designId },
      },
    );
    expect(saved.ok()).toBe(true);
    expect(await saved.json()).toHaveProperty("designSystemId", null);
  } finally {
    await request.post(appPath("/_agent-native/actions/delete-design"), {
      data: { id: designId },
    });
    await request.post(appPath("/_agent-native/actions/delete-design-system"), {
      data: { id: system.id },
    });
  }
});
