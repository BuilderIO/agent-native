import { appPath, expandAllLayers } from "./helpers";
import {
  expect,
  expectOnlyChanged,
  test,
  type App,
  type SavedNode,
} from "./rails";

const LOCKED_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Locked template fixture</title></head>
  <body style="margin:0">
    <main class="artboard" data-agent-native-node-id="template-artboard" style="position:relative;width:1080px;height:1080px;overflow:hidden;background:#f3efe6">
      <div class="backdrop" style="position:absolute;inset:0;background:#eee;pointer-events:none" data-agent-native-node-id="template-background" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
      <div class="brand" style="position:absolute;top:36px;left:42px;z-index:2;display:flex;align-items:center;gap:10px;font-size:13px;font-weight:800" data-agent-native-node-id="template-logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">
        <span class="brand-mark" style="width:24px;height:24px;border-radius:50%;background:#11110f"></span><span>Northstar</span>
      </div>
      <section class="content" data-agent-native-node-id="template-content" style="position:relative;z-index:1;height:100%;display:grid;align-content:end;padding:108px 42px 42px">
        <h1 data-agent-native-node-id="template-headline" style="margin:0;font-size:82px">Make the work feel lighter.</h1>
      </section>
    </main>
  </body>
</html>`;

const LOCKED = "data-agent-native-locked";

function lockedIds(nodes: Map<string, SavedNode>) {
  return [...nodes.values()]
    .filter((node) => LOCKED in node.attrs)
    .map((node) => node.id);
}

function withoutLock(node: SavedNode | undefined) {
  const { [LOCKED]: _lock, ...attrs } = node?.attrs ?? {};
  return attrs;
}

async function agentEdit(app: App, input: Record<string, unknown>) {
  const response = await app.page.request.post(
    appPath("/_agent-native/actions/edit-design"),
    {
      data: { filename: "index.html", ...input },
    },
  );
  return { status: response.status(), body: await response.text() };
}

async function openAndUnlockBoth(app: App) {
  const id = await app.seed(LOCKED_HTML);
  await app.open(id);
  const locked = await app.savedNodes(id);
  expect(lockedIds(locked)).toEqual(["template-background", "template-logo"]);
  const staleHtml = await app.savedHtml(id);
  await expandAllLayers(app.page);

  for (const name of ["Logo", "Background"]) {
    const row = app.page.getByRole("treeitem", { name });
    await row.hover();
    await row.getByRole("button", { name: "Unlock layer" }).click();
    await expect(row.getByRole("button", { name: "Unlock layer" })).toHaveCount(
      0,
    );
  }
  await app.settled();
  const unlocked = await app.savedNodes(id);
  expect(unlocked.get("template-logo")?.attrs).toEqual(
    withoutLock(locked.get("template-logo")),
  );
  expect(unlocked.get("template-background")?.attrs).toEqual(
    withoutLock(locked.get("template-background")),
  );
  expectOnlyChanged(locked, unlocked, ["template-logo", "template-background"]);
  return { id, staleHtml, unlocked };
}

test("after the user unlocks a template's locked layers in the Layers panel, an agent edit to them saves and shows on the canvas", async ({
  app,
}) => {
  const { id, unlocked } = await openAndUnlockBoth(app);
  const brandName = [...unlocked.values()].find(
    (node) => node.parent === "template-logo" && node.text === "Northstar",
  )!.id;

  const edit = await agentEdit(app, {
    designId: id,
    edits: [{ search: "Northstar", replace: "Polestar" }],
  });

  expect(edit.status, edit.body).toBe(200);
  await expect(app.node("template-logo")).toHaveText("Polestar");
  await app.settled();
  const after = await app.savedNodes(id);
  expect(after.get(brandName)?.text).toBe("Polestar");
  expect(after.get(brandName)?.parent).toBe("template-logo");
  expectOnlyChanged(unlocked, after, [brandName]);
});

// fixme: product bug: edit-design returns HTTP 500 {"error":"Internal server error"}: assertLockedLayersPreserved (shared/locked-layers.ts:187) throws a bare
test.fixme("a stale agent whole-file write that would re-lock unlocked layers is rejected with an actionable error and saves nothing", async ({
  app,
}) => {
  const { id, staleHtml, unlocked } = await openAndUnlockBoth(app);

  const replace = await agentEdit(app, {
    designId: id,
    mode: "replace-file",
    replacementContent: staleHtml.replace(
      "Make the work feel lighter.",
      "Design at the speed of thought.",
    ),
  });

  const after = await app.savedNodes(id);
  expect(lockedIds(after)).toEqual([]);
  expect(after.get("template-headline")?.text).toBe(
    "Make the work feel lighter.",
  );
  expectOnlyChanged(unlocked, after, []);
  expect(replace.status, replace.body).toBeGreaterThanOrEqual(400);
  expect(replace.status, replace.body).toBeLessThan(500);
  expect(replace.body).toContain("the editor had unlocked");
});
