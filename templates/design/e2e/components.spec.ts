import { type Page } from "@playwright/test";

import { appPath } from "./helpers";
import {
  childrenOf,
  expect,
  expectOnlyChanged,
  test,
  type SavedNode,
} from "./rails";

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Components</title></head>
  <body style="margin:0;min-height:900px;background:#0f1115;color:#fff">
    <button data-agent-native-node-id="btn-a" data-agent-native-layer-name="Button A"
            data-variant="primary"
            style="position:absolute;left:20px;top:60px;width:160px;height:44px;background:#3b82f6">Buy now</button>
    <button data-agent-native-node-id="btn-b" data-agent-native-layer-name="Button B"
            style="position:absolute;left:20px;top:140px;width:160px;height:44px;background:#22c55e">Sign up</button>
    <div data-agent-native-node-id="card" data-agent-native-layer-name="Card"
         style="position:absolute;left:20px;top:220px;width:280px;height:120px;background:#1f2937">
      <p data-agent-native-node-id="card-text" data-agent-native-layer-name="Card Text"
         style="margin:0;padding:12px">Card body</p>
    </div>
  </body>
</html>`;

const LINKED_COMPONENT_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Linked components</title></head>
  <body style="margin:0;min-height:900px;background:#0f1115;color:#fff">
    <button data-agent-native-node-id="btn-a" data-agent-native-layer-name="Primary main"
            data-agent-native-component="PrimaryButton" data-agent-native-component-id="cmp-primary"
            style="position:absolute;left:20px;top:60px;width:160px;height:44px;background:#3b82f6">Buy now</button>
    <button data-agent-native-node-id="btn-a-instance" data-agent-native-layer-name="Primary instance"
            data-agent-native-component="PrimaryButton" data-agent-native-component-ref="cmp-primary"
            data-agent-native-component-source-node-id="btn-a"
            style="position:absolute;left:220px;top:60px;width:160px;height:44px;background:#3b82f6">Buy now</button>
    <button data-agent-native-node-id="btn-b" data-agent-native-layer-name="Secondary main"
            data-agent-native-component="SecondaryButton" data-agent-native-component-id="cmp-secondary"
            style="position:absolute;left:20px;top:140px;width:160px;height:44px;background:#22c55e">Sign up</button>
    <button data-agent-native-node-id="btn-b-instance" data-agent-native-layer-name="Secondary instance"
            data-agent-native-component="SecondaryButton" data-agent-native-component-ref="cmp-secondary"
            data-agent-native-component-source-node-id="btn-b"
            style="position:absolute;left:220px;top:140px;width:160px;height:44px;background:#22c55e">Sign up</button>
  </body>
</html>`;

function textOf(nodes: Map<string, SavedNode>, nodeId: string) {
  return childrenOf(nodes, nodeId)
    .map((child) => nodes.get(child)?.text)
    .join("");
}

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  expect(
    response.ok(),
    `${name}: ${response.status()} ${(await response.text()).slice(0, 300)}`,
  ).toBe(true);
  return response.json();
}

test("create-component stamps the name and the variant prop on the promoted node only", async ({
  app,
}) => {
  const id = await app.seed(FIXTURE);
  const before = await app.savedNodes(id);

  await postAction(app.page, "create-component", {
    designId: id,
    nodeId: "btn-a",
    name: "PrimaryButton",
  });

  const after = await app.savedNodes(id);
  expect(after.get("btn-a")?.attrs).toEqual({
    ...before.get("btn-a")?.attrs,
    "data-agent-native-component": "PrimaryButton",
    "data-agent-native-component-id": expect.any(String),
    "data-agent-native-prop-variant": "primary",
  });
  expect(textOf(after, "btn-a")).toBe("Buy now");
  expectOnlyChanged(before, after, ["btn-a"]);
});

test("a promoted component is listed by list-design-components", async ({
  app,
}) => {
  const id = await app.seed(FIXTURE);
  await postAction(app.page, "create-component", {
    designId: id,
    nodeId: "btn-a",
    name: "PrimaryButton",
  });

  const response = await app.page.request.get(
    appPath(`/_agent-native/actions/list-design-components?designId=${id}`),
  );
  expect(response.ok()).toBe(true);
  const listed = (await response.json()) as {
    totalComponents: number;
    components: { name: string }[];
  };

  expect(listed.components.map((component) => component.name)).toStrictEqual([
    "PrimaryButton",
  ]);
  expect(listed.totalComponents).toBe(1);
});

test("detach removes only the instance's component linkage and keeps its content and style", async ({
  app,
}) => {
  const id = await app.seed(LINKED_COMPONENT_FIXTURE);
  const before = await app.savedNodes(id);

  await postAction(app.page, "detach-component-instance", {
    designId: id,
    nodeId: "btn-a-instance",
  });

  const after = await app.savedNodes(id);
  const {
    "data-agent-native-component": _name,
    "data-agent-native-component-ref": _ref,
    "data-agent-native-component-source-node-id": _source,
    ...unlinked
  } = before.get("btn-a-instance")!.attrs;
  expect(after.get("btn-a-instance")?.attrs).toEqual(unlinked);
  expect(textOf(after, "btn-a-instance")).toBe("Buy now");
  expectOnlyChanged(before, after, ["btn-a-instance"]);
});

// fixme: product bug: Swap copies the other SecondaryButton instance's markup wholesale, including its position: the instance jumps from top:60px to top:140px
test.fixme("swap relinks the instance to the target component and gives it the target's content", async ({
  app,
}) => {
  const id = await app.seed(LINKED_COMPONENT_FIXTURE);
  const before = await app.savedNodes(id);

  await postAction(app.page, "swap-component-instance", {
    designId: id,
    nodeId: "btn-a-instance",
    targetComponentName: "SecondaryButton",
  });

  const after = await app.savedNodes(id);
  expect(after.get("btn-a-instance")?.attrs).toEqual({
    "data-agent-native-node-id": "btn-a-instance",
    "data-agent-native-layer-name": "Secondary instance",
    "data-agent-native-component": "SecondaryButton",
    "data-agent-native-component-ref": "cmp-secondary",
    "data-agent-native-component-source-node-id": "btn-b",
    style:
      "position:absolute;left:220px;top:60px;width:160px;height:44px;background:#22c55e",
  });
  expect(textOf(after, "btn-a-instance")).toBe("Sign up");
  expectOnlyChanged(before, after, [
    "btn-a-instance",
    ...childrenOf(before, "btn-a-instance"),
    ...childrenOf(after, "btn-a-instance"),
  ]);
});

test("same-named component mains remain independent identities", async ({
  app,
}) => {
  const id = await app.seed(FIXTURE);
  await postAction(app.page, "create-component", {
    designId: id,
    nodeId: "btn-a",
    name: "Btn",
  });
  await postAction(app.page, "create-component", {
    designId: id,
    nodeId: "btn-b",
    name: "Btn",
  });
  const before = await app.savedNodes(id);
  expect([
    before.get("btn-a")?.attrs["data-agent-native-component"],
    before.get("btn-b")?.attrs["data-agent-native-component"],
  ]).toStrictEqual(["Btn", "Btn"]);

  await postAction(app.page, "apply-visual-edit", {
    source: { kind: "design-file", designId: id, filename: "index.html" },
    intent: {
      kind: "style",
      target: { nodeId: "btn-a" },
      property: "background",
      value: "rgb(255, 0, 0)",
    },
  });

  const after = await app.savedNodes(id);
  expect(after.get("btn-a")?.attrs.style).toBe(
    "position:absolute;left:20px;top:60px;width:160px;height:44px;background: rgb(255, 0, 0)",
  );
  expectOnlyChanged(before, after, ["btn-a"]);
});
