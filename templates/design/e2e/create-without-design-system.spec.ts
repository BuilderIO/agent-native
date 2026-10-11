import { expect, test } from "@playwright/test";

import { appPath } from "./helpers";

test("create-design preserves an explicit no-system choice", async ({
  request,
}) => {
  let designId: string | undefined;

  try {
    const response = await request.post(
      appPath("/_agent-native/actions/create-design"),
      {
        data: {
          title: `QA no-system design ${Date.now()}`,
          designSystemId: null,
        },
      },
    );
    expect(response.ok()).toBe(true);

    const created = await response.json();
    const createdId = created.id;
    if (typeof createdId !== "string" || !createdId) {
      throw new Error("create-design response did not include an id");
    }
    designId = createdId;
    expect(created).toHaveProperty("designSystemId", null);

    const saved = await request.get(
      appPath("/_agent-native/actions/get-design"),
      { params: { id: createdId } },
    );
    expect(saved.ok()).toBe(true);
    expect(await saved.json()).toHaveProperty("designSystemId", null);
  } finally {
    if (designId) {
      await request
        .post(appPath("/_agent-native/actions/delete-design"), {
          data: { id: designId },
        })
        .catch(() => {});
    }
  }
});
