import { expect, test } from "@playwright/test";

import { EDITOR, expectEditorReady, getDocument, RequestGate } from "./helpers";

test("a second tab waits for the first blank-page create to finish", async ({
  context,
  page,
}) => {
  const createGate = await RequestGate.action(page, "create-document");
  createGate.hold();
  let createRequests = 0;
  context.on("request", (request) => {
    if (
      new URL(request.url()).pathname ===
      "/_agent-native/actions/create-document"
    ) {
      createRequests += 1;
    }
  });

  try {
    await page.goto("/home", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: /New —/ })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Page", exact: true }).click();
    await expect(page).toHaveURL(/\/page\/[^/?#]+$/);
    const documentId = new URL(page.url()).pathname.split("/").at(-1)!;
    await expectEditorReady(page);
    await page.locator(EDITOR).click();
    await page.keyboard.type("Draft while the create request waits");

    await expect
      .poll(
        () =>
          page.evaluate((id) => {
            for (let index = 0; index < localStorage.length; index += 1) {
              const key = localStorage.key(index);
              if (!key?.startsWith("content-page-draft-journal-v1:")) continue;
              const raw = localStorage.getItem(key);
              if (!raw) continue;
              const entry = JSON.parse(raw);
              if (entry?.scope?.documentId === id)
                return entry.snapshot.content;
            }
            return null;
          }, documentId),
        { message: "the editor should journal text before create completes" },
      )
      .toContain("Draft while the create request waits");
    await expect.poll(() => createGate.queued).toBe(1);

    const secondTab = await context.newPage();
    await secondTab.goto("/home", { waitUntil: "domcontentloaded" });
    await expect(
      secondTab.getByRole("button", { name: /New —/ }).first(),
    ).toBeVisible();
    await secondTab.waitForTimeout(1_000);
    expect(createRequests).toBe(1);

    await createGate.release();
    await expect
      .poll(async () => (await getDocument(page, documentId)).content ?? "", {
        message: "the first tab's draft should reach the saved page",
        timeout: 30_000,
      })
      .toContain("Draft while the create request waits");
    expect(createRequests).toBe(1);
    await expect(page.locator(EDITOR)).toContainText(
      "Draft while the create request waits",
    );
  } finally {
    await createGate.release();
  }
});
