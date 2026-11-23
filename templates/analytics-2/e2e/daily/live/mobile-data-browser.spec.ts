import { randomUUID } from "node:crypto";

import { safeRequest } from "../../safe-request.js";
import { expect, test } from "./fixtures";

test("report M5-MOBILE-B5: the notebook Data browser panel fills the phone screen", async ({
  page,
  context,
  base,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const call = async (name: string, data: Record<string, string>) => {
    const response = await safeRequest(
      `POST /_agent-native/actions/${name}`,
      () =>
        context.request.post(`${base}/_agent-native/actions/${name}`, {
          data,
        }),
    );
    expect(response.ok(), name).toBe(true);
    return response.json();
  };
  const created = await call("create-project", {
    title: `QA phone data browser ${randomUUID()}`,
  });
  const projectId: string = created.id;
  try {
    await page.goto(`${base}/project/${encodeURIComponent(projectId)}/latest`);
    await page
      .getByRole("link", { name: "Notebook", exact: true })
      .or(page.getByRole("tab", { name: "Notebook", exact: true }))
      .or(page.getByRole("button", { name: "Notebook", exact: true }))
      .first()
      .click();
    await page
      .getByRole("button", { name: "Data browser", exact: true })
      .click();
    const panel = page.getByRole("complementary", { name: "Data browser" });
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    console.log("DATA_BROWSER_PANEL_BOX", JSON.stringify(box));
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(400);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.width).toBeGreaterThanOrEqual(300);
    await expect(
      panel.getByRole("heading", { name: "Data browser" }),
    ).toBeInViewport({ ratio: 1 });
    await expect(panel).toBeInViewport({ ratio: 0.5 });
  } finally {
    await call("trash-project", { projectId });
    await call("delete-project", { projectId });
  }
});
