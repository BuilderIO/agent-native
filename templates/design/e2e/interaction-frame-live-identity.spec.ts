import { expect, test, type Page } from "@playwright/test";
import { parse } from "parse5";

import {
  appPath,
  designFrame,
  expandAllLayers,
  gotoEditor,
  pickFrameMode,
} from "./helpers";

const EMPTY_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Frame live identity</title></head>
  <body style="margin:0;min-height:900px;background:#0f1115"></body>
</html>`;

type DesignRecord = {
  data?: unknown;
  files?: Array<{ id: string; filename?: string; content?: string }>;
};

type ParentIdentity = {
  tag: string | null;
  id: string | null;
  name: string | null;
};

type NodeSummary = {
  id: string;
  name: string | null;
  primitive: string | null;
  style: string | null;
  parent: ParentIdentity | null;
};

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function createBlankDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: `Frame live identity ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (typeof designId !== "string") {
    throw new Error(`create-design returned no id: ${JSON.stringify(created)}`);
  }
  await postAction(page, "create-file", {
    designId,
    filename: "index.html",
    content: EMPTY_SCREEN,
    fileType: "html",
  });
  return designId;
}

async function readDesign(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()) as DesignRecord;
}

function parentIdentity(node: Record<string, any>): ParentIdentity | null {
  const parent = node.parentNode as Record<string, any> | undefined;
  if (!parent) return null;
  const attr = (name: string) =>
    parent.attrs?.find((candidate: { name: string }) => candidate.name === name)
      ?.value ?? null;
  return {
    tag: parent.tagName ?? null,
    id: attr("data-agent-native-node-id"),
    name: attr("data-agent-native-layer-name"),
  };
}

function sourceNodes(source: string, nodeId: string): NodeSummary[] {
  const document = parse(source) as unknown as Record<string, any>;
  const summaries: NodeSummary[] = [];
  const visit = (node: Record<string, any>) => {
    if (node.tagName) {
      const attrs = node.attrs as Array<{ name: string; value: string }>;
      const attr = (name: string) =>
        attrs?.find((candidate) => candidate.name === name)?.value ?? null;
      if (attr("data-agent-native-node-id") === nodeId) {
        summaries.push({
          id: nodeId,
          name: attr("data-agent-native-layer-name"),
          primitive: attr("data-an-primitive"),
          style: attr("style"),
          parent: parentIdentity(node),
        });
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(document);
  return summaries;
}

function screenSource(record: DesignRecord, screenId: string): string {
  return record.files?.find((file) => file.id === screenId)?.content ?? "";
}

async function liveNodes(page: Page, screenId: string, nodeId: string) {
  return designFrame(page, screenId)
    .locator("body")
    .evaluate((body, id) => {
      const matches = Array.from(
        body.ownerDocument.querySelectorAll<HTMLElement>(
          `[data-agent-native-node-id="${CSS.escape(id)}"]`,
        ),
      );
      return matches.map((element) => {
        const parent = element.parentElement;
        const sourceOwned = element as HTMLElement & {
          __anSource?: boolean;
          __anSourceMeta?: {
            attrs?: string[];
            className?: string;
            style?: string;
          };
        };
        return {
          id,
          name: element.getAttribute("data-agent-native-layer-name"),
          primitive: element.getAttribute("data-an-primitive"),
          style: element.getAttribute("style"),
          outerHTML: element.outerHTML,
          sourceOwned: sourceOwned.__anSource === true,
          sourceMeta: sourceOwned.__anSourceMeta
            ? {
                attrs: sourceOwned.__anSourceMeta.attrs ?? null,
                className: sourceOwned.__anSourceMeta.className ?? null,
                style: sourceOwned.__anSourceMeta.style ?? null,
              }
            : null,
          sameAsOriginal:
            (
              body.ownerDocument.defaultView as
                | (Window & {
                    __frameLiveIdentityOriginalNodes?: Element[];
                  })
                | null
            )?.__frameLiveIdentityOriginalNodes?.includes(element) ?? false,
          parent: parent
            ? {
                tag: parent.tagName.toLowerCase(),
                id: parent.getAttribute("data-agent-native-node-id"),
                name: parent.getAttribute("data-agent-native-layer-name"),
              }
            : null,
          computed: {
            position: getComputedStyle(element).position,
            display: getComputedStyle(element).display,
            flexDirection: getComputedStyle(element).flexDirection,
          },
        };
      });
    }, nodeId);
}

async function bindBridgeTraceNode(
  page: Page,
  screenId: string,
  nodeId: string,
) {
  await designFrame(page, screenId)
    .locator("body")
    .evaluate((body, id) => {
      const win = body.ownerDocument.defaultView as
        | (Window & {
            __frameLiveIdentityNodeId?: string;
            __frameLiveIdentityOriginalNodes?: Element[];
            __frameLiveIdentityBridgeEvents?: Array<Record<string, unknown>>;
          })
        | null;
      if (!win) throw new Error("preview has no Window");
      win.__frameLiveIdentityNodeId = id;
      win.__frameLiveIdentityOriginalNodes = Array.from(
        win.document.querySelectorAll(
          `[data-agent-native-node-id="${CSS.escape(id)}"]`,
        ),
      );
      win.__frameLiveIdentityBridgeEvents = [];
    }, nodeId);
}

async function bridgeTrace(page: Page, screenId: string) {
  return designFrame(page, screenId)
    .locator("body")
    .evaluate((body) => {
      const win = body.ownerDocument.defaultView as
        | (Window & {
            __frameLiveIdentityBridgeEvents?: Array<Record<string, unknown>>;
          })
        | null;
      return win?.__frameLiveIdentityBridgeEvents ?? [];
    });
}

function layerButton(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem", { name: new RegExp(`^${name}\\b`) })
    .getByRole("button", { name, exact: true });
}

test("Frame rename, flow conversion, and auto layout preserve its live identity", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    type TracedWindow = Window & {
      __frameLiveIdentityNodeId?: string;
      __frameLiveIdentityBridgeEvents?: Array<Record<string, unknown>>;
    };
    const win = window as TracedWindow;
    win.addEventListener(
      "message",
      (event) => {
        const nodeId = win.__frameLiveIdentityNodeId;
        const data = event.data as Record<string, unknown> | null;
        if (
          !nodeId ||
          !data ||
          (data.type !== "style-change" &&
            data.type !== "replace-document-content")
        ) {
          return;
        }
        const selector = `[data-agent-native-node-id="${CSS.escape(nodeId)}"]`;
        const liveState = () =>
          Array.from(win.document.querySelectorAll<HTMLElement>(selector)).map(
            (element) => {
              const sourceOwned = element as HTMLElement & {
                __anSource?: boolean;
                __anSourceMeta?: {
                  attrs?: string[];
                  className?: string;
                  style?: string;
                };
              };
              return {
                outerHTML: element.outerHTML,
                sourceOwned: sourceOwned.__anSource === true,
                sourceMeta: sourceOwned.__anSourceMeta
                  ? {
                      attrs: sourceOwned.__anSourceMeta.attrs ?? null,
                      className: sourceOwned.__anSourceMeta.className ?? null,
                      style: sourceOwned.__anSourceMeta.style ?? null,
                    }
                  : null,
              };
            },
          );
        const sourceNodes =
          data.type === "replace-document-content" &&
          typeof data.content === "string"
            ? Array.from(
                new DOMParser()
                  .parseFromString(data.content, "text/html")
                  .querySelectorAll<HTMLElement>(selector),
              ).map((element) => element.outerHTML)
            : null;
        const eventSnapshot = {
          type: data.type,
          at: win.performance.now(),
          selector: typeof data.selector === "string" ? data.selector : null,
          property: typeof data.property === "string" ? data.property : null,
          value: typeof data.value === "string" ? data.value : null,
          forceFullDocument: data.forceFullDocument === true,
          phase: "init-script-capture-before-bridge",
          live: liveState(),
          incomingSourceNodes: sourceNodes,
        };
        (win.__frameLiveIdentityBridgeEvents ??= []).push(eventSnapshot);
        win.setTimeout(() => {
          win.__frameLiveIdentityBridgeEvents?.push({
            ...eventSnapshot,
            at: win.performance.now(),
            phase: "after-message-dispatch",
            live: liveState(),
          });
        }, 0);
      },
      true,
    );
  });
  const designId = await createBlankDesign(page);
  await gotoEditor(page, designId);
  await expandAllLayers(page);

  const initial = await readDesign(page, designId);
  const screenId = initial.files?.find(
    (file) => file.filename === "index.html",
  )?.id;
  if (!screenId) throw new Error("blank design has no index.html screen");
  const before = screenSource(initial, screenId);
  const priorIds = new Set(
    Array.from(before.matchAll(/data-agent-native-node-id=["']([^"']+)["']/g))
      .map((match) => match[1])
      .filter((id): id is string => Boolean(id)),
  );

  const frame = page.locator(
    `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
  );
  const liveDocumentMarker = `frame-live-identity-${Date.now()}`;
  await frame.evaluate((element, marker) => {
    ((element as HTMLIFrameElement).contentWindow as any)[
      "__frameLiveIdentityMarker"
    ] = marker;
  }, liveDocumentMarker);
  const frameBox = await frame.boundingBox();
  const contentWidth = await designFrame(page, screenId)
    .locator("body")
    .evaluate((body) => body.ownerDocument.documentElement.clientWidth);
  if (!frameBox || !contentWidth) {
    throw new Error("blank Screen has no measurable preview bounds");
  }
  const scale = frameBox.width / contentWidth;
  await pickFrameMode(page, "Frame");
  await page.mouse.move(frameBox.x + 40 * scale, frameBox.y + 120 * scale);
  await page.mouse.down();
  await page.mouse.move(frameBox.x + 300 * scale, frameBox.y + 320 * scale, {
    steps: 16,
  });
  await page.mouse.up();

  let frameId = "";
  await expect
    .poll(async () => {
      const record = await readDesign(page, designId);
      const html = screenSource(record, screenId);
      const parsed = parse(html) as unknown as Record<string, any>;
      const candidates: string[] = [];
      const visit = (node: Record<string, any>) => {
        if (node.tagName) {
          const attrs = node.attrs as Array<{ name: string; value: string }>;
          const attr = (name: string) =>
            attrs?.find((candidate) => candidate.name === name)?.value;
          const id = attr("data-agent-native-node-id");
          if (
            id &&
            !priorIds.has(id) &&
            attr("data-an-primitive") === "frame"
          ) {
            candidates.push(id);
          }
        }
        for (const child of node.childNodes ?? []) visit(child);
      };
      visit(parsed);
      if (candidates.length === 1) frameId = candidates[0]!;
      return candidates.length;
    })
    .toBe(1);

  let originalParent: ParentIdentity | null | undefined;
  const assertCheckpoint = async (step: string, expectedName: string) => {
    const record = await readDesign(page, designId);
    const html = screenSource(record, screenId);
    const source = sourceNodes(html, frameId);
    const live = await liveNodes(page, screenId, frameId);
    await page.waitForTimeout(10);
    const marker = await frame.evaluate(
      (element) =>
        ((element as HTMLIFrameElement).contentWindow as any)?.[
          "__frameLiveIdentityMarker"
        ] ?? null,
    );
    const checkpoint = {
      step,
      designId,
      screenId,
      nodeId: frameId,
      saved: source,
      live,
      liveDocumentMarker: marker,
      bridgeEvents: await bridgeTrace(page, screenId),
    };
    console.log("frame-live-identity-checkpoint", JSON.stringify(checkpoint));
    expect(source, `${step}: saved source has one durable node`).toHaveLength(
      1,
    );
    expect(source[0]?.name, `${step}: saved layer name`).toBe(expectedName);
    if (originalParent === undefined)
      originalParent = source[0]?.parent ?? null;
    expect(source[0]?.parent, `${step}: saved parent remains stable`).toEqual(
      originalParent,
    );
    expect(source[0]?.parent?.tag, `${step}: saved parent element`).toBe(
      "body",
    );
    expect(
      live.map((node) => node.name),
      `${step}: every live copy has the expected layer name`,
    ).toEqual(Array.from({ length: live.length }, () => expectedName));
    expect(
      live.map((node) => node.parent?.tag),
      `${step}: every live copy has a body parent`,
    ).toEqual(Array.from({ length: live.length }, () => "body"));
    expect(
      live.map((node) => node.parent),
      `${step}: live parent identity matches saved source`,
    ).toEqual(Array.from({ length: live.length }, () => source[0]?.parent));
    expect(
      live.map((node) => node.parent),
      `${step}: every live copy remains under the original parent`,
    ).toEqual(Array.from({ length: live.length }, () => originalParent));
    expect(marker, `${step}: preview iframe was not replaced or reloaded`).toBe(
      liveDocumentMarker,
    );
    expect(live, `${step}: live iframe has one durable node`).toHaveLength(1);
    expect(live[0]?.id).toBe(frameId);
  };

  await expect
    .poll(
      async () =>
        sourceNodes(
          screenSource(await readDesign(page, designId), screenId),
          frameId,
        )[0]?.name,
    )
    .toBe("Frame");
  await assertCheckpoint("frame-drawn", "Frame");
  await bindBridgeTraceNode(page, screenId, frameId);

  const createdFrameRow = layerButton(page, "Frame");
  await expect(createdFrameRow).toBeVisible();
  await createdFrameRow.click();
  const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${primaryModifier}+r`);
  const renameInput = page.locator(
    '[role="treeitem"] input[aria-label="Rename layer"]',
  );
  await expect(renameInput).toBeVisible();
  await renameInput.fill("Workspace");
  await renameInput.press("Enter");
  await expect
    .poll(
      async () =>
        sourceNodes(
          screenSource(await readDesign(page, designId), screenId),
          frameId,
        )[0]?.name,
    )
    .toBe("Workspace");
  await assertCheckpoint("renamed-workspace", "Workspace");

  await layerButton(page, "Workspace").click();
  const absolutePosition = page.getByRole("button", {
    name: "Absolute position",
    exact: true,
  });
  await expect(absolutePosition).toHaveAttribute("aria-pressed", "true");
  await absolutePosition.click();
  await expect(absolutePosition).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(
      async () =>
        sourceNodes(
          screenSource(await readDesign(page, designId), screenId),
          frameId,
        )[0]?.style,
    )
    .toMatch(/position:\s*relative/i);
  await assertCheckpoint("absolute-position-off", "Workspace");

  await page.keyboard.press("Shift+a");
  const layoutHeading = page.getByRole("heading", {
    name: "Auto layout",
    exact: true,
  });
  await expect(layoutHeading).toBeVisible();
  await expect
    .poll(
      async () =>
        sourceNodes(
          screenSource(await readDesign(page, designId), screenId),
          frameId,
        )[0]?.style,
    )
    .toMatch(/display:\s*flex/i);
  await assertCheckpoint("auto-layout-added", "Workspace");

  const layout = layoutHeading.locator("xpath=ancestor::section");
  await layout.getByRole("button", { name: "Horizontal", exact: true }).click();
  await expect
    .poll(
      async () =>
        sourceNodes(
          screenSource(await readDesign(page, designId), screenId),
          frameId,
        )[0]?.style,
    )
    .toMatch(/flex-direction:\s*row/i);
  await assertCheckpoint("horizontal-auto-layout", "Workspace");
  const finalLive = await liveNodes(page, screenId, frameId);
  expect(finalLive, "auto layout keeps the original live frame").toHaveLength(
    1,
  );
  expect(finalLive[0]?.sameAsOriginal).toBe(true);
});
