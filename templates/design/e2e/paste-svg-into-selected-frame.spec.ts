import { childrenOf, expect, expectOnlyChanged, styleOf, test } from "./rails";

const FRAME_WITH_CHILD = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#ffffff">
  <main data-agent-native-node-id="page" data-agent-native-layer-name="Page" style="position:relative;width:640px;height:480px">
    <section data-agent-native-node-id="paste-target" data-agent-native-layer-name="Paste target" data-an-primitive="frame" style="position:absolute;left:80px;top:90px;width:260px;height:180px;background:#eeeeee">
      <div data-agent-native-node-id="existing-child" data-agent-native-layer-name="Existing child" style="position:absolute;left:8px;top:8px;width:24px;height:20px;background:#ff0000"></div>
    </section>
    <p data-agent-native-node-id="caption" data-agent-native-layer-name="Caption" style="position:absolute;left:80px;top:320px;margin:0">Caption</p>
  </main>
</body></html>`;

const SVG =
  '<svg width="80" height="40" viewBox="0 0 80 40"><g><path d="M0 0h30v30z" fill="#f97316"/><path d="M50 0h30v30z" fill="#16a34a"/></g></svg>';

// fixme: product bug: The paste lands on top in the Layers panel but is drawn underneath 'Existing child' on the canvas: stripRootPosition saves it with no
test.fixme("Cmd+V of SVG markup while a frame is selected appends the SVG as the frame's topmost child, drawn above its siblings, and selects it", async ({
  app,
  page,
}) => {
  const id = await app.seed(FRAME_WITH_CHILD);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await app.open(id);
  await app.zoomToFit();
  const before = await app.savedNodes(id);
  expect(childrenOf(before, "paste-target")).toEqual(["existing-child"]);
  const frame = await app.designRect("paste-target");
  const center = await app.pagePoint(
    frame.x + frame.width / 2,
    frame.y + frame.height / 2,
  );
  await page.mouse.click(center.x, center.y);
  await expect.poll(() => app.selectedLayers()).toEqual(["Paste target"]);

  await page.evaluate((svg) => navigator.clipboard.writeText(svg), SVG);
  await page.keyboard.press("ControlOrMeta+V");
  await expect.poll(() => app.selectedLayers()).toEqual(["Pasted SVG"]);
  await app.settled();

  const after = await app.savedNodes(id);
  const added = [...after.values()].filter((node) => !before.has(node.id));
  const svg = added.find((node) => node.tag === "svg");
  expect(svg?.attrs["data-agent-native-layer-name"]).toBe("Pasted SVG");
  expect(childrenOf(after, "paste-target")).toEqual([
    "existing-child",
    svg?.id,
  ]);
  expect(styleOf(svg)).toMatchObject({ width: "80px", height: "40px" });
  expect(
    added.map((node) => [node.tag, after.get(node.parent ?? "")?.tag]),
  ).toEqual([
    ["svg", "section"],
    ["g", "svg"],
    ["path", "g"],
    ["path", "g"],
  ]);
  expectOnlyChanged(
    before,
    after,
    added.map((node) => node.id),
  );
  expect(await app.designRect(svg!.id)).toEqual({
    x: 80,
    y: 90,
    width: 80,
    height: 40,
  });
  const drawnOnTop = await app.node(svg!.id).evaluate((root) => {
    const topmost = root.ownerDocument
      .elementsFromPoint(106, 108)
      .find(
        (element) =>
          root.contains(element) ||
          element.matches('[data-agent-native-node-id="existing-child"]'),
      );
    return topmost && root.contains(topmost)
      ? "Pasted SVG"
      : topmost?.getAttribute("data-agent-native-layer-name");
  });
  expect(
    drawnOnTop,
    "the SVG is listed above Existing child, so it must be drawn above it where they overlap",
  ).toBe("Pasted SVG");
});
