import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { designFrame, enterDirectMode, gotoEditor } from "./helpers";

const CONSTRAINTS_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Constraint resize fixture</title></head>
  <body x-data="{}" style="margin:0;min-height:100vh;padding:20px;font-family:Arial,sans-serif">
    <div data-agent-native-node-id="outer-frame" style="position:relative;width:720px;height:620px;padding:30px;background:#eee">
      <div data-agent-native-node-id="nested-frame" style="position:relative;width:400px;height:300px;background:#fff">
        <div data-agent-native-node-id="left-top" style="position:absolute;left:20px;top:20px;width:60px;height:30px;background:#fecaca">Left Top</div>
        <div data-agent-native-node-id="right-bottom" style="position:absolute;left:110px;top:60px;width:70px;height:35px;background:#fed7aa">Right Bottom</div>
        <div data-agent-native-node-id="stretch" style="position:absolute;left:40px;top:110px;width:120px;height:40px;background:#fef08a">Stretch Both</div>
        <div data-agent-native-node-id="center" style="position:absolute;left:180px;top:170px;width:80px;height:45px;background:#bbf7d0">Center Both</div>
        <div data-agent-native-node-id="scale" style="position:absolute;left:80px;top:230px;width:100px;height:50px;background:#bfdbfe">Scale Both</div>
      </div>
      <div data-agent-native-node-id="auto-frame" style="position:relative;display:flex;width:400px;height:180px;margin-top:30px;gap:12px;background:#ddd6fe">
        <div data-agent-native-node-id="flow-child">Flow child</div>
        <div data-agent-native-node-id="auto-absolute" style="position:absolute;left:100px;top:60px;width:80px;height:40px;background:#f5d0fe">Auto Absolute</div>
      </div>
    </div>
  </body>
</html>`;

async function postAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:9333";
  const response = await request.post(
    `${baseUrl.replace(/\/$/, "")}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function selectFixtureLayer(page: Page, nodeId: string) {
  const layer = designFrame(page).locator(
    `[data-agent-native-node-id="${nodeId}"]`,
  );
  await expect(layer).toBeVisible();
  await layer.click({ force: true });
  await expect(page.getByRole("button", { name: "Constraints" })).toBeVisible();
}

async function chooseConstraint(
  page: Page,
  axis: "Horizontal" | "Vertical",
  option: string,
) {
  const trigger = page.getByRole("button", { name: "Constraints" });
  if ((await trigger.getAttribute("aria-pressed")) !== "true") {
    await trigger.click();
  }
  await page.getByRole("combobox", { name: axis }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

type Geometry = {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

async function relativeGeometry(page: Page, nodeId: string): Promise<Geometry> {
  return designFrame(page)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .evaluate((element) => {
      const child = element.getBoundingClientRect();
      const parent = element.parentElement!.getBoundingClientRect();
      const left = child.left - parent.left;
      const top = child.top - parent.top;
      return {
        left,
        top,
        width: child.width,
        height: child.height,
        right: parent.right - child.right,
        bottom: parent.bottom - child.bottom,
        centerX: left + child.width / 2 - parent.width / 2,
        centerY: top + child.height / 2 - parent.height / 2,
      };
    });
}

function expectClose(actual: number, expected: number, tolerance = 0.75) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

test("constraints preserve Figma geometry through real nested and auto-layout parent resizes", async ({
  page,
  request,
}) => {
  const created = await postAction(request, "create-design", {
    title: `Constraint resize ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");

  try {
    await postAction(request, "create-file", {
      designId,
      filename: "index.html",
      content: CONSTRAINTS_HTML,
      fileType: "html",
    });
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await page.getByRole("tab", { name: "Design", exact: true }).click();

    await selectFixtureLayer(page, "right-bottom");
    await chooseConstraint(page, "Horizontal", "Right");
    await chooseConstraint(page, "Vertical", "Bottom");

    await selectFixtureLayer(page, "stretch");
    await chooseConstraint(page, "Horizontal", "Left and right");
    await chooseConstraint(page, "Vertical", "Top and bottom");

    await selectFixtureLayer(page, "center");
    await chooseConstraint(page, "Horizontal", "Center");
    await chooseConstraint(page, "Vertical", "Center");

    await selectFixtureLayer(page, "scale");
    await chooseConstraint(page, "Horizontal", "Scale");
    await chooseConstraint(page, "Vertical", "Scale");

    await selectFixtureLayer(page, "auto-absolute");
    await chooseConstraint(page, "Horizontal", "Scale");
    await chooseConstraint(page, "Vertical", "Scale");

    const ids = [
      "left-top",
      "right-bottom",
      "stretch",
      "center",
      "scale",
      "auto-absolute",
    ] as const;
    const before = Object.fromEntries(
      await Promise.all(
        ids.map(async (id) => [id, await relativeGeometry(page, id)]),
      ),
    ) as Record<(typeof ids)[number], Geometry>;

    await designFrame(page)
      .locator('[data-agent-native-node-id="nested-frame"]')
      .evaluate((element) => {
        const frame = element as HTMLElement;
        frame.style.width = "600px";
        frame.style.height = "450px";
      });
    await designFrame(page)
      .locator('[data-agent-native-node-id="auto-frame"]')
      .evaluate((element) => {
        const frame = element as HTMLElement;
        frame.style.width = "600px";
        frame.style.height = "270px";
      });

    const after = Object.fromEntries(
      await Promise.all(
        ids.map(async (id) => [id, await relativeGeometry(page, id)]),
      ),
    ) as Record<(typeof ids)[number], Geometry>;

    // Left/Top: position and fixed size stay constant.
    for (const key of ["left", "top", "width", "height"] as const) {
      expectClose(after["left-top"][key], before["left-top"][key]);
    }
    // Right/Bottom: opposite-edge gaps and fixed size stay constant.
    for (const key of ["right", "bottom", "width", "height"] as const) {
      expectClose(after["right-bottom"][key], before["right-bottom"][key]);
    }
    // Dual-edge pins stretch by the parent's exact resize delta.
    expectClose(after.stretch.left, before.stretch.left);
    expectClose(after.stretch.right, before.stretch.right);
    expectClose(after.stretch.top, before.stretch.top);
    expectClose(after.stretch.bottom, before.stretch.bottom);
    expectClose(after.stretch.width, before.stretch.width + 200);
    expectClose(after.stretch.height, before.stretch.height + 150);
    // Center preserves its offset from the parent's center, never recenters.
    expectClose(after.center.centerX, before.center.centerX);
    expectClose(after.center.centerY, before.center.centerY);
    expectClose(after.center.width, before.center.width);
    expectClose(after.center.height, before.center.height);
    // Scale preserves position and size ratios on both axes.
    expectClose(after.scale.left / 600, before.scale.left / 400, 0.002);
    expectClose(after.scale.top / 450, before.scale.top / 300, 0.002);
    expectClose(after.scale.width / 600, before.scale.width / 400, 0.002);
    expectClose(after.scale.height / 450, before.scale.height / 300, 0.002);
    // Absolute children of auto-layout parents use the same proportional path.
    expectClose(
      after["auto-absolute"].left / 600,
      before["auto-absolute"].left / 400,
      0.002,
    );
    expectClose(
      after["auto-absolute"].top / 270,
      before["auto-absolute"].top / 180,
      0.002,
    );
    expectClose(
      after["auto-absolute"].width / 600,
      before["auto-absolute"].width / 400,
      0.002,
    );
    expectClose(
      after["auto-absolute"].height / 270,
      before["auto-absolute"].height / 180,
      0.002,
    );
  } finally {
    await postAction(request, "delete-design", { id: designId }).catch(
      () => {},
    );
  }
});
