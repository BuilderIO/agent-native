import { childrenOf, expect, expectOnlyChanged, test } from "./rails";

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Text edit round trip</title></head>
  <body style="margin:0;background:#fff">
    <main data-agent-native-node-id="main" style="padding:40px">
      <h1 data-agent-native-node-id="headline" data-agent-native-layer-name="Draft headline" style="margin:0;font-size:48px">Draft headline</h1>
      <p data-agent-native-node-id="untouched" data-agent-native-layer-name="Untouched note" style="margin:24px 0 0">Keep this note unchanged.</p>
    </main>
  </body>
</html>`;

const UNDO = "ControlOrMeta+z";
const REDO = process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z";

test("inline text edit commits, undo and redo restore exact content, and reload keeps it", async ({
  app,
  page,
}) => {
  const designId = await app.seed(FIXTURE);
  await app.open(designId);
  await app.zoomToFit();
  const before = await app.savedNodes(designId);
  const originalHeadline = before.get("headline");
  expect(originalHeadline).toBeDefined();

  const rect = await app.designRect("headline");
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => app.selectedLayers()).toEqual(["Draft headline"]);

  const editable = page
    .frameLocator("iframe[data-screen-iframe-id]")
    .locator('[contenteditable="true"]');
  await page.keyboard.press("Enter");
  await expect(editable).toBeVisible();
  await expect(editable).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("Published headline");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(editable).toHaveCount(0);

  await expect
    .poll(async () => (await app.savedNodes(designId)).get("headline")?.text)
    .toBe("Published headline");
  await app.settled();
  const edited = await app.savedNodes(designId);
  const editedHeadline = edited.get("headline");
  expect(editedHeadline).toMatchObject({
    tag: "h1",
    parent: "main",
    text: "Published headline",
  });
  expect(editedHeadline?.attrs).toEqual(originalHeadline!.attrs);
  expect(editedHeadline?.attrs.style).toBe(originalHeadline!.attrs.style);
  expect(childrenOf(edited, "main")).toEqual(["headline", "untouched"]);
  expect(edited.get("untouched")).toEqual(before.get("untouched"));
  expectOnlyChanged(before, edited, ["headline"]);

  await page.keyboard.press(UNDO);
  await expect
    .poll(async () => (await app.savedNodes(designId)).get("headline")?.text)
    .toBe("Draft headline");
  await app.settled();
  const undone = await app.savedNodes(designId);
  expect(undone.get("headline")).toEqual(originalHeadline);
  expectOnlyChanged(before, undone, []);

  await page.keyboard.press(REDO);
  await expect
    .poll(async () => (await app.savedNodes(designId)).get("headline")?.text)
    .toBe("Published headline");
  await app.settled();
  const redone = await app.savedNodes(designId);
  expect(redone.get("headline")).toEqual(editedHeadline);
  expectOnlyChanged(before, redone, ["headline"]);

  await app.open(designId);
  await app.settled();
  await expect(app.node("headline")).toHaveText("Published headline");
  await expect(editable).toHaveCount(0);
  const reloaded = await app.savedNodes(designId);
  expect(reloaded.get("headline")).toEqual(editedHeadline);
  expect(reloaded.get("untouched")).toEqual(before.get("untouched"));
  expectOnlyChanged(before, reloaded, ["headline"]);
});
