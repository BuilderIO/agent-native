import { appPath } from "./helpers";
import { expect, expectOnlyChanged, test, type App } from "./rails";

const FRAME = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><title>Selection colors</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--color-bg, #ffffff); color: var(--color-text, #111827); }
</style></head>
<body data-agent-native-layer-name="Frame" style="background:#101010"></body></html>`;

const TARGET_FRAME = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><title>Selection color target</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--color-bg, #ffffff); color: var(--color-text, #111827); }
</style></head>
<body data-agent-native-layer-name="Frame" style="background:#101010">
  <div data-agent-native-node-id="matching" data-agent-native-layer-name="Matching" style="width:120px;height:80px;background:#101010"></div>
  <div data-agent-native-node-id="other" data-agent-native-layer-name="Other" style="width:120px;height:80px;background:#ffffff"></div>
</body></html>`;

function selectionColorsSection(app: App) {
  return app.page
    .locator("section")
    .filter({
      has: app.page.getByRole("heading", {
        name: "Selection colors",
        exact: true,
      }),
    })
    .first();
}

function colorLabels(app: App) {
  return selectionColorsSection(app)
    .locator('button[aria-label^="#"]')
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    );
}

async function selectScreenRow(app: App, name: string) {
  await app.page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name, exact: true })
    .click();
  await expect.poll(() => app.selectedLayers()).toEqual([name]);
}

test("a selected frame exposes only its authored Selection color, and Find layers keeps the frame selected", async ({
  app,
}) => {
  const id = await app.seed(FRAME);
  await app.open(id);
  await app.settled();
  const seeded = await app.savedNodes(id);
  await selectScreenRow(app, "Home");

  await selectionColorsSection(app)
    .getByRole("button", { name: "Show selection colors" })
    .click();

  await expect.poll(() => colorLabels(app)).toEqual(["#101010"]);
  await selectionColorsSection(app)
    .getByRole("button", { name: "Find layers: #101010" })
    .click();
  await expect.poll(() => app.selectedLayers()).toEqual(["Home"]);
  await app.settled();
  expectOnlyChanged(seeded, await app.savedNodes(id), []);
});

// fixme: product bug: False Mixed on a colour-target selection: the Home body and Matching both have background #101010, but Fill shows 'Click + to replace
test.fixme("a Selection color target selects exactly the layers with that colour and shows their shared fill", async ({
  app,
}) => {
  const id = await app.seed(TARGET_FRAME);
  await app.open(id);
  await app.settled();
  const seeded = await app.savedNodes(id);
  await selectScreenRow(app, "Home");
  await selectionColorsSection(app)
    .getByRole("button", { name: "Show selection colors" })
    .click();
  await expect.poll(() => colorLabels(app)).toEqual(["#101010", "#ffffff"]);

  await selectionColorsSection(app)
    .getByRole("button", { name: "Find layers: #101010" })
    .click();

  await expect.poll(() => app.selectedLayers()).toEqual(["Home", "Matching"]);
  await expect(
    app.page
      .getByRole("tree", { name: "Layers" })
      .getByRole("button", { name: "Matching", exact: true }),
  ).toBeInViewport();
  await app.settled();
  expectOnlyChanged(seeded, await app.savedNodes(id), []);
  const fill = app.page
    .locator("section")
    .filter({
      has: app.page.getByRole("heading", { name: "Fill", exact: true }),
    })
    .first();
  await expect(
    fill.getByRole("textbox", { name: "Color", exact: true }),
  ).toHaveValue("101010");
});

test("URL-backed screens do not expose source Selection colors", async ({
  app,
}) => {
  const liveUrl = "https://example.test/selection-colors";
  await app.page.route(liveUrl, (route) => route.abort("failed"));
  const id = await app.seed(FRAME, { files: { "live.html": liveUrl } });
  const liveId = (await app.savedRecord(id)).files.find(
    (file) => file.filename === "live.html",
  )!.id;
  const marked = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    {
      data: {
        id,
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", liveId],
            value: { sourceType: "localhost", url: liveUrl },
          },
        ],
      },
    },
  );
  expect(marked.ok(), `update-design ${marked.status()}`).toBe(true);
  await app.open(id);
  await app.settled();
  const seeded = await app.savedNodes(id);
  const heading = app.page.getByRole("heading", {
    name: "Selection colors",
    exact: true,
  });
  await selectScreenRow(app, "Home");
  await expect(heading).toHaveCount(1);

  await selectScreenRow(app, "Live");

  await expect(heading).toHaveCount(0);
  await app.settled();
  expectOnlyChanged(seeded, await app.savedNodes(id), []);
});
