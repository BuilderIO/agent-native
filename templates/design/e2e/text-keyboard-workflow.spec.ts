import { childrenOf, expect, expectOnlyChanged, test } from "./rails";

const FIXTURE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Text keyboard</title></head>
<body style="margin:0">
  <main data-agent-native-node-id="main" style="padding:40px">
    <h1 data-agent-native-node-id="title" style="margin:0;font-size:48px">Draft title</h1>
  </main>
</body></html>`;

// fixme: product bug: The duplicate's Layers row stays 'First title' after its text became 'Second title': both rows read 'First title' (duplication froze the
test.fixme("Cmd+Enter commits a text edit so Cmd+D duplicates the layer, and each copy keeps its own text and name", async ({
  app,
}) => {
  const id = await app.seed(FIXTURE);
  await app.open(id);
  await app.zoomToFit();
  await app.settled();
  const page = app.page;
  const before = await app.savedNodes(id);
  const rect = await app.designRect("title");
  const center = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await page.mouse.click(center.x, center.y);
  await expect.poll(() => app.selectedLayers()).toEqual(["Draft title"]);

  const editable = app.page
    .frameLocator("iframe[data-screen-iframe-id]")
    .locator('[contenteditable="true"]');
  await page.keyboard.press("Enter");
  await expect(editable).toBeVisible();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("First title");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(editable).toHaveCount(0);
  await expect
    .poll(async () => (await app.savedNodes(id)).get("title")?.text)
    .toBe("First title");

  await page.keyboard.press("ControlOrMeta+d");
  let copyId = "";
  await expect
    .poll(async () => {
      const nodes = await app.savedNodes(id);
      copyId =
        childrenOf(nodes, "main").find((child) => child !== "title") ?? "";
      return childrenOf(nodes, "main").length;
    }, "the duplicate is saved next to the original")
    .toBe(2);
  await page.keyboard.press("Enter");
  await expect(editable).toBeVisible();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("Second title");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(editable).toHaveCount(0);

  await expect
    .poll(async () => (await app.savedNodes(id)).get(copyId)?.text)
    .toBe("Second title");
  await app.settled();
  const after = await app.savedNodes(id);
  expect(childrenOf(after, "main")).toEqual(["title", copyId]);
  expect(after.get("title")?.text).toBe("First title");
  expect(after.get(copyId)?.tag).toBe("h1");
  expectOnlyChanged(before, after, ["title", copyId]);
  await expect
    .poll(
      () => app.selectedLayers(),
      "the copy's layer is named by its own text",
    )
    .toEqual(["Second title"]);
});
