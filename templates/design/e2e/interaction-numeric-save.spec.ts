import { designFrame, selectByText } from "./helpers";
import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

const TARGET_ID = "workflow-numeric-save-target";
const HTML = `<!doctype html><html><head></head><body style="margin:0;min-height:100vh;background:#fff"><div data-agent-native-node-id="${TARGET_ID}" data-agent-native-layer-name="Numeric save target" style="position:absolute;left:10px;top:12px;width:120px;height:80px;background:#2563eb">Numeric save target</div></body></html>`;

async function savedBox(app: App, designId: string) {
  const style = styleOf((await app.savedNodes(designId)).get(TARGET_ID));
  return {
    width: style.width,
    height: style.height,
    left: style.left,
    top: style.top,
  };
}

async function liveBox(app: App) {
  return designFrame(app.page)
    .locator(`[data-agent-native-node-id="${TARGET_ID}"]`)
    .evaluate((node) => {
      const style = (node as HTMLElement).style;
      return {
        width: style.width,
        height: style.height,
        left: style.left,
        top: style.top,
      };
    });
}

async function openTarget(app: App) {
  const id = await app.seed(HTML);
  await app.open(id);
  await app.settled();
  const before = await app.savedNodes(id);
  await selectByText(app.page, "Numeric save target");
  return { id, before };
}

test("rapid W/H/X/Y inspector Enter edits persist without a save conflict", async ({
  app,
}) => {
  const { id, before } = await openTarget(app);
  const page = app.page;

  for (const [label, value] of [
    ["W size in pixels", "137"],
    ["H size in pixels", "93"],
    ["X-position", "37"],
    ["Y-position", "51"],
  ] as const) {
    const input = page.locator(`input[aria-label="${label}"]`);
    await input.fill(value);
    await input.press("Enter");
  }

  const expected = {
    width: "137px",
    height: "93px",
    left: "37px",
    top: "51px",
  };
  await expect.poll(() => savedBox(app, id)).toEqual(expected);
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), [TARGET_ID]);

  await page.reload();
  await expect(
    designFrame(page).locator(`[data-agent-native-node-id="${TARGET_ID}"]`),
  ).toBeAttached();
  expect(await savedBox(app, id)).toEqual(expected);
  expect(await liveBox(app)).toEqual(expected);
});

test("numeric inspector matches unary and exponent precedence", async ({
  app,
}) => {
  const { id, before } = await openTarget(app);
  const page = app.page;
  const x = page.getByRole("textbox", { name: "X-position", exact: true });
  for (const [expression, expected] of [
    ["-2^2", "-4"],
    ["-(2+3)", "-5"],
    ["2^-2", "-5"],
    ["2^(-2)", "0.25"],
  ] as const) {
    await x.fill(expression);
    await x.press("Enter");
    await expect(x).toHaveValue(`${expected}px`);
    await expect
      .poll(async () => (await liveBox(app)).left)
      .toBe(`${expected}px`);
  }
  const y = page.getByRole("textbox", { name: "Y-position", exact: true });
  await y.fill("0.75");
  await y.press("Enter");
  await expect(y).toHaveValue("0.75px");

  await expect
    .poll(() => savedBox(app, id))
    .toEqual({ width: "120px", height: "80px", left: "0.25px", top: "0.75px" });
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), [TARGET_ID]);

  await page.reload();
  await selectByText(page, "Numeric save target");
  await expect(x).toHaveValue("0.25px");
  await expect(y).toHaveValue("0.75px");
  expect((await liveBox(app)).left).toBe("0.25px");
});
