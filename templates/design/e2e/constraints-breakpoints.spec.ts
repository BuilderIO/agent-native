import { appPath, expandAllLayers } from "./helpers";
import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Constraints</title></head>
  <body style="margin:0;min-height:900px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="parent" data-agent-native-layer-name="Parent"
         style="position:absolute;left:20px;top:60px;width:280px;height:200px;background:#1f2937">
      <div data-agent-native-node-id="child" data-agent-native-layer-name="Child"
           style="position:absolute;left:20px;top:20px;width:180px;height:60px;background:#3b82f6"></div>
    </div>
    <div data-agent-native-node-id="auto-parent" data-agent-native-layer-name="Auto Parent"
         style="position:absolute;left:20px;top:320px;width:280px;display:flex;flex-direction:column;gap:12px">
      <div data-agent-native-node-id="auto-child" data-agent-native-layer-name="Auto Child"
           style="height:60px;background:#22c55e"></div>
    </div>
    <div data-agent-native-node-id="orphan" data-agent-native-layer-name="Orphan"
         style="position:absolute;left:20px;top:560px;width:180px;height:90px;background:#a855f7"></div>
  </body>
</html>`;

test.use({ viewport: { width: 1600, height: 1000 } });

async function action(app: App, name: string, input: Record<string, unknown>) {
  const response = await app.page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      `${name}: ${response.status()} ${(await response.text()).slice(0, 200)}`,
    );
  }
  return response.json();
}

async function designData(app: App, designId: string) {
  const record = await (
    await app.page.request.get(
      appPath(`/_agent-native/actions/get-design?id=${designId}`),
    )
  ).json();
  return {
    record,
    data:
      typeof record.data === "string"
        ? JSON.parse(record.data || "{}")
        : (record.data ?? {}),
  };
}

async function breakpoints(app: App, designId: string) {
  return ((await designData(app, designId)).data.breakpointSet?.breakpoints ??
    []) as { label: string; widthPx: number }[];
}

async function openFixture(app: App) {
  const id = await app.seed(FIXTURE);
  await app.open(id);
  await app.zoomToFit();
  await app.settled();
  return id;
}

async function selectLayer(app: App, name: string) {
  await expandAllLayers(app.page);
  await app.page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name, exact: true })
    .click();
  await expect.poll(() => app.selectedLayers()).toEqual([name]);
}

async function openConstraints(app: App) {
  await app.page.getByRole("button", { name: "Constraints" }).click();
  await expect(
    app.page.getByRole("combobox", { name: "Horizontal" }),
  ).toBeVisible();
}

async function setWidth(app: App, value: string) {
  const input = app.page
    .getByText("W", { exact: true })
    .first()
    .locator("xpath=following::input[1]");
  await input.fill(value);
  await input.press("Enter");
}

/** The child's box relative to its parent's, as rendered. */
async function childInParent(app: App) {
  const parent = await app.designRect("parent");
  const child = await app.designRect("child");
  return {
    left: child.x - parent.x,
    top: child.y - parent.y,
    width: child.width,
    height: child.height,
  };
}

async function editAtPhoneWidth(app: App, designId: string) {
  await action(app, "add-breakpoint", {
    designId,
    label: "Tablet",
    widthPx: 810,
  });
  await action(app, "add-breakpoint", {
    designId,
    label: "Phone",
    widthPx: 390,
  });
  await action(app, "apply-visual-edit", {
    source: { kind: "design-file", designId, filename: "index.html" },
    intent: {
      kind: "style",
      target: { nodeId: "child" },
      property: "background",
      value: "rgb(255, 0, 0)",
    },
    activeFrameWidthPx: 390,
  });
}

function mediaBounds(html: string) {
  return [...html.matchAll(/@media[^{]*max-width:\s*(\d+)px/gi)].map((match) =>
    Number(match[1]),
  );
}

test.describe("constraints", () => {
  test("a child of a frame defaults to Left and Top constraints, and opening them saves nothing", async ({
    app,
  }) => {
    const id = await openFixture(app);
    const before = await app.savedNodes(id);
    await selectLayer(app, "Child");

    await openConstraints(app);

    await expect(
      app.page.getByRole("combobox", { name: "Horizontal" }),
    ).toHaveText("Left");
    await expect(
      app.page.getByRole("combobox", { name: "Vertical" }),
    ).toHaveText("Top");
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });

  test("widening the parent keeps a Left+Top child's offset and size", async ({
    app,
  }) => {
    const id = await openFixture(app);
    const before = await app.savedNodes(id);
    expect(await childInParent(app)).toEqual({
      left: 20,
      top: 20,
      width: 180,
      height: 60,
    });
    await selectLayer(app, "Parent");

    await setWidth(app, "600");

    await expect
      .poll(async () => styleOf((await app.savedNodes(id)).get("parent")).width)
      .toBe("600px");
    await app.settled();
    expect((await app.designRect("parent")).width).toBe(600);
    expect(await childInParent(app)).toEqual({
      left: 20,
      top: 20,
      width: 180,
      height: 60,
    });
    expectOnlyChanged(before, await app.savedNodes(id), ["parent"]);
  });

  test("a Scale-constrained child keeps its share of the parent's width when the parent widens", async ({
    app,
  }) => {
    const id = await openFixture(app);
    const before = await app.savedNodes(id);
    await selectLayer(app, "Child");
    await openConstraints(app);
    await app.page.getByRole("combobox", { name: "Horizontal" }).click();
    await app.page.getByRole("option", { name: "Scale" }).click();
    await expect(
      app.page.getByRole("combobox", { name: "Horizontal" }),
    ).toHaveText("Scale");
    await app.settled();
    expect(await childInParent(app), "choosing Scale moves nothing").toEqual({
      left: 20,
      top: 20,
      width: 180,
      height: 60,
    });

    await selectLayer(app, "Parent");
    await setWidth(app, "800");

    await expect
      .poll(async () => styleOf((await app.savedNodes(id)).get("parent")).width)
      .toBe("800px");
    await app.settled();
    const scaled = await childInParent(app);
    expect(Math.abs(scaled.left - (800 * 20) / 280)).toBeLessThanOrEqual(1);
    expect(Math.abs(scaled.width - (800 * 180) / 280)).toBeLessThanOrEqual(1);
    expect({ top: scaled.top, height: scaled.height }).toEqual({
      top: 20,
      height: 60,
    });
    expectOnlyChanged(before, await app.savedNodes(id), ["parent", "child"]);
  });

  test("constraints are offered for a frame's child but not for an auto-layout child", async ({
    app,
  }) => {
    await openFixture(app);
    const constraints = app.page.getByRole("button", { name: "Constraints" });
    await selectLayer(app, "Child");
    await expect(
      constraints,
      "control: an absolute child has them",
    ).toHaveCount(1);

    await selectLayer(app, "Auto Child");
    await expect(constraints).toHaveCount(0);
  });
});

test.describe("breakpoints", () => {
  test("add-breakpoint records the width in the design's breakpointSet", async ({
    app,
  }) => {
    const id = await app.seed(FIXTURE);
    expect(await breakpoints(app, id), "precondition: none").toEqual([]);

    await action(app, "add-breakpoint", {
      designId: id,
      label: "Tablet",
      widthPx: 810,
    });

    expect(await breakpoints(app, id)).toEqual([
      expect.objectContaining({ label: "Tablet", widthPx: 810 }),
    ]);
  });

  test("a duplicate breakpoint width is ignored", async ({ app }) => {
    const id = await app.seed(FIXTURE);
    await action(app, "add-breakpoint", {
      designId: id,
      label: "Tablet",
      widthPx: 810,
    });
    const once = await breakpoints(app, id);
    expect(once.map((breakpoint) => breakpoint.widthPx)).toEqual([810]);

    await action(app, "add-breakpoint", {
      designId: id,
      label: "Tablet",
      widthPx: 810,
    }).catch(() => {});

    expect(await breakpoints(app, id)).toEqual(once);
  });

  test("an edit at a narrower breakpoint scopes to next-wider minus one", async ({
    app,
  }) => {
    const id = await app.seed(FIXTURE);
    const before = await app.savedNodes(id);

    await editAtPhoneWidth(app, id);

    const html = await app.savedHtml(id);
    expect(mediaBounds(html)).toEqual([809]);
    expect(html).toMatch(
      /@media[^{]*max-width:\s*809px[^{]*\{[^}]*\[data-agent-native-node-id="child"\][^{]*\{[^}]*background:\s*rgb\(255, 0, 0\)/,
    );
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });

  test("a breakpoint edit persists when the document has no head", async ({
    app,
  }) => {
    const id = await app.seed(
      FIXTURE.replace(/\s*<head>[\s\S]*?<\/head>/i, ""),
    );
    const before = await app.savedNodes(id);

    await editAtPhoneWidth(app, id);

    const html = await app.savedHtml(id);
    expect(mediaBounds(html)).toEqual([809]);
    expect(html.indexOf("<style")).toBeGreaterThan(html.indexOf("<html"));
    expect(html.indexOf("<style")).toBeLessThan(html.indexOf("</html>"));
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });

  test("the default device set is a desktop base plus mobile only", async ({
    app,
  }) => {
    const id = await app.seed(FIXTURE);

    const generated = await action(app, "generate-design", {
      designId: id,
      prompt: "Create a responsive constraints test fixture.",
      files: [{ filename: "index.html", content: FIXTURE, fileType: "html" }],
    });
    expect(generated.savedFiles).toHaveLength(1);

    const { record, data } = await designData(app, id);
    const screen = record.files.find(
      (file: { filename: string }) => file.filename === "index.html",
    );
    expect(data.canvasFrames?.[screen.id]?.width).toBe(1440);
    expect(data.breakpointSet?.breakpoints).toEqual([
      expect.objectContaining({ label: "Mobile", widthPx: 390 }),
    ]);
  });
});
