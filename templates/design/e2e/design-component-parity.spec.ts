import fs from "node:fs";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";

import {
  prepareDesignConnectManifest,
  startDesignConnectBridge,
  type DesignConnectBridge,
} from "@agent-native/core/testing";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  buildCodeLayerProjection,
  readCodeLayerNodeTextContent,
} from "../shared/code-layer.js";
import { sourceContentHash } from "../shared/source-workspace.js";
import { e2eBaseURL } from "./base-url";
import {
  designFrame,
  enterDirectMode,
  gotoEditor,
  installBridge,
} from "./helpers";

const INLINE_FIXTURE = new URL(
  "./fixtures/design-component-react/inline-component.html",
  import.meta.url,
);
const REACT_FIXTURE = new URL(
  "./fixtures/design-component-react/index.html",
  import.meta.url,
);

type DesignFile = {
  id: string;
  filename: string;
  fileType: string;
  content: string | null;
};

type DesignRecord = {
  data?: string | null;
  files: DesignFile[];
};

let baseURL = "";
let rootPath = "";
let devServer: Server | null = null;
let bridge: DesignConnectBridge | null = null;
let manifest: Awaited<ReturnType<typeof prepareDesignConnectManifest>>;

async function listen(server: Server): Promise<{ host: string; port: number }> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || !address) {
        reject(new Error("The fixture server did not expose a bound address."));
        return;
      }
      resolve({ host: address.address, port: address.port });
    });
  });
}

async function close(server: Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await request.post(
    baseURL + "/_agent-native/actions/" + name,
    {
      data: input,
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok()) {
    throw new Error(
      name + ": " + response.status() + " " + (await response.text()),
    );
  }
  return response.json();
}

async function readAction(
  request: APIRequestContext,
  name: string,
  input: Record<string, string>,
): Promise<any> {
  const response = await request.get(
    baseURL +
      "/_agent-native/actions/" +
      name +
      "?" +
      new URLSearchParams(input).toString(),
  );
  if (!response.ok()) {
    throw new Error(
      name + ": " + response.status() + " " + (await response.text()),
    );
  }
  return response.json();
}

async function readDesign(
  request: APIRequestContext,
  designId: string,
): Promise<DesignRecord> {
  const response = await request.get(
    baseURL +
      "/_agent-native/actions/get-design?id=" +
      encodeURIComponent(designId),
  );
  if (!response.ok()) {
    throw new Error(
      "get-design: " + response.status() + " " + (await response.text()),
    );
  }
  return response.json() as Promise<DesignRecord>;
}

async function indexFile(
  request: APIRequestContext,
  designId: string,
): Promise<DesignFile> {
  const design = await readDesign(request, designId);
  const file = design.files.find(
    (candidate) => candidate.filename === "index.html",
  );
  if (!file) throw new Error("index.html was not created");
  return file;
}

async function source(
  request: APIRequestContext,
  designId: string,
): Promise<string> {
  return (await indexFile(request, designId)).content ?? "";
}

async function expectedFiles(
  request: APIRequestContext,
  designId: string,
): Promise<Array<{ fileId: string; versionHash: string }>> {
  const design = await readDesign(request, designId);
  return design.files
    .filter((file) => file.fileType === "html")
    .map((file) => ({
      fileId: file.id,
      versionHash: sourceContentHash(file.content ?? ""),
    }));
}

function attributeValue(tag: string, name: string): string | undefined {
  for (const quote of ['"', "'"]) {
    const marker = name + "=" + quote;
    const start = tag.indexOf(marker);
    if (start < 0) continue;
    const valueStart = start + marker.length;
    const valueEnd = tag.indexOf(quote, valueStart);
    if (valueEnd >= 0) return tag.slice(valueStart, valueEnd);
  }
  return undefined;
}

function elementTags(html: string): string[] {
  return html.match(/<[^!?][^>]*>/g) ?? [];
}

function componentRoots(
  html: string,
  componentId: string,
): Array<{
  tag: string;
  nodeId: string;
  name: string | undefined;
  layerName: string | undefined;
  main: boolean;
}> {
  return elementTags(html)
    .map((tag) => ({
      tag,
      nodeId: attributeValue(tag, "data-agent-native-node-id"),
      name: attributeValue(tag, "data-agent-native-component"),
      layerName: attributeValue(tag, "data-agent-native-layer-name"),
      main:
        attributeValue(tag, "data-agent-native-component-id") === componentId,
    }))
    .filter((entry): entry is typeof entry & { nodeId: string } =>
      Boolean(
        entry.nodeId &&
        (entry.main ||
          attributeValue(entry.tag, "data-agent-native-component-ref") ===
            componentId),
      ),
    );
}

function tagForNode(html: string, nodeId: string): string | undefined {
  return elementTags(html).find(
    (tag) => attributeValue(tag, "data-agent-native-node-id") === nodeId,
  );
}

function tagForSourceNode(
  html: string,
  sourceNodeId: string,
): string | undefined {
  return elementTags(html).find(
    (tag) =>
      attributeValue(tag, "data-agent-native-component-source-node-id") ===
      sourceNodeId,
  );
}

function projectedNode(html: string, nodeId: string) {
  return buildCodeLayerProjection(html).nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === nodeId,
  );
}

function nodeText(html: string, nodeId: string): string | null {
  const node = projectedNode(html, nodeId);
  return node ? readCodeLayerNodeTextContent(html, node) : null;
}

function parentIdentity(html: string, nodeId: string): string | null {
  const projection = buildCodeLayerProjection(html);
  const node = projection.nodes.find(
    (candidate) =>
      candidate.dataAttributes["data-agent-native-node-id"] === nodeId,
  );
  if (!node?.parentId) return null;
  const parent = projection.nodes.find(
    (candidate) => candidate.id === node.parentId,
  );
  if (!parent) return null;
  return (
    parent.dataAttributes["data-agent-native-component-source-node-id"] ??
    parent.dataAttributes["data-agent-native-node-id"] ??
    null
  );
}

async function selectNodeById(
  page: Page,
  nodeId: string,
  screenId?: string,
): Promise<void> {
  await enterDirectMode(page);
  const selector = '[data-agent-native-node-id="' + nodeId + '"]';
  const node = designFrame(page, screenId).locator(selector);
  await expect(node).toBeVisible();
  await installBridge(page);
  const iframe = screenId
    ? page.locator(
        'iframe[data-design-preview-iframe][data-screen-iframe-id="' +
          screenId +
          '"]',
      )
    : page.locator("iframe[data-design-preview-iframe]").last();
  await iframe.evaluate((element, targetSelector) => {
    (element as HTMLIFrameElement).contentWindow?.postMessage(
      {
        type: "select-element",
        selector: targetSelector,
        selectorCandidates: [targetSelector],
      },
      "*",
    );
  }, selector);
  await expect(
    designFrame(page, screenId).locator(
      '[data-agent-native-edit-overlay="selection"]',
    ),
  ).toBeAttached();
}

test.beforeAll(async ({}, workerInfo) => {
  baseURL =
    (workerInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();
  rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "design-component-parity-"));
  devServer = http.createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fs.readFileSync(REACT_FIXTURE, "utf8"));
  });
  const devAddress = await listen(devServer);
  const bridgePortServer = http.createServer();
  const bridgeAddress = await listen(bridgePortServer);
  await close(bridgePortServer);
  manifest = await prepareDesignConnectManifest({
    root: rootPath,
    url: "http://" + devAddress.host + ":" + devAddress.port,
    port: bridgeAddress.port,
  });
});

test.afterAll(async () => {
  await close(bridge?.server ?? null);
  await close(devServer);
  if (rootPath) fs.rmSync(rootPath, { recursive: true, force: true });
});

test("Design components preserve identity across inline and URL-backed React boundaries", async ({
  page,
  request,
}) => {
  let designId = "";
  try {
    const created = await action(request, "create-design", {
      title: "Design component parity fixture",
      projectType: "prototype",
    });
    designId = created.id ?? created.data?.id ?? "";
    if (!designId) throw new Error("create-design returned no id");
    await action(request, "create-file", {
      designId,
      filename: "index.html",
      content: fs.readFileSync(INLINE_FIXTURE, "utf8"),
      fileType: "html",
    });

    await gotoEditor(page, designId);
    await selectNodeById(page, "card-main");
    const promoted = await action(request, "create-component", {
      designId,
      nodeId: "card-main",
      name: "ReusableCard",
    });
    expect(promoted.persisted).toBe(true);
    await expect
      .poll(() => source(request, designId))
      .toContain('data-agent-native-component="ReusableCard"');
    await page.reload({ waitUntil: "domcontentloaded" });

    let html = await source(request, designId);
    const mainTag = tagForNode(html, "card-main");
    const componentId = mainTag
      ? attributeValue(mainTag, "data-agent-native-component-id")
      : undefined;
    expect(componentId).toBeTruthy();
    const id = componentId!;

    await selectNodeById(page, "card-main");
    await page.keyboard.press("ControlOrMeta+d");
    await expect
      .poll(
        async () => componentRoots(await source(request, designId), id).length,
      )
      .toBe(2);
    html = await source(request, designId);
    let roots = componentRoots(html, id);
    const main = roots.find((root) => root.main);
    const reference = roots.find((root) => !root.main);
    expect(main?.nodeId).toBe("card-main");
    expect(reference?.nodeId).toBeTruthy();
    expect(new Set(roots.map((root) => root.nodeId)).size).toBe(2);
    expect(roots.map((root) => root.layerName)).toEqual([
      "Card Main",
      "Card Main",
    ]);
    const referenceId = reference!.nodeId;
    const referenceTitleId = attributeValue(
      tagForSourceNode(html, "card-title-text") ?? "",
      "data-agent-native-node-id",
    );
    expect(referenceTitleId).toBeTruthy();
    expect(
      attributeValue(
        tagForSourceNode(html, "card-title-text") ?? "",
        "data-agent-native-component-source-node-id",
      ),
    ).toBe("card-title-text");

    await selectNodeById(page, referenceId);
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(
        async () => componentRoots(await source(request, designId), id).length,
      )
      .toBe(1);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(
        async () => componentRoots(await source(request, designId), id).length,
      )
      .toBe(2);

    const mainEdit = await action(request, "apply-visual-edit", {
      source: { kind: "design-file", designId, filename: "index.html" },
      intent: {
        kind: "textContent",
        target: { nodeId: "card-title-text" },
        value: "Main edit",
      },
    });
    expect(mainEdit.persisted, JSON.stringify(mainEdit)).toBe(true);
    await expect
      .poll(async () => {
        const current = await source(request, designId);
        const currentRoots = componentRoots(current, id);
        const currentReference = currentRoots.find((root) => !root.main);
        const currentTitle = currentReference
          ? attributeValue(
              tagForSourceNode(current, "card-title-text") ?? "",
              "data-agent-native-node-id",
            )
          : undefined;
        return [
          nodeText(current, "card-title-text"),
          currentTitle ? nodeText(current, currentTitle) : null,
        ];
      })
      .toEqual(["Main edit", "Main edit"]);

    const instanceEdit = await action(request, "apply-visual-edit", {
      source: { kind: "design-file", designId, filename: "index.html" },
      intent: {
        kind: "textContent",
        target: { nodeId: referenceTitleId },
        value: "Instance override",
      },
    });
    expect(instanceEdit.persisted).toBe(true);
    html = await source(request, designId);
    expect(html).toContain("data-agent-native-component-overrides");
    expect(nodeText(html, "card-title-text")).toBe("Main edit");
    const afterOverrideReferenceTitle = attributeValue(
      tagForSourceNode(html, "card-title-text") ?? "",
      "data-agent-native-node-id",
    );
    expect(afterOverrideReferenceTitle).toBeTruthy();
    expect(nodeText(html, afterOverrideReferenceTitle!)).toBe(
      "Instance override",
    );

    const secondMainEdit = await action(request, "apply-visual-edit", {
      source: { kind: "design-file", designId, filename: "index.html" },
      intent: {
        kind: "textContent",
        target: { nodeId: "card-title-text" },
        value: "Main edit again",
      },
    });
    expect(secondMainEdit.persisted).toBe(true);
    html = await source(request, designId);
    expect(nodeText(html, "card-title-text")).toBe("Main edit again");
    expect(nodeText(html, afterOverrideReferenceTitle!)).toBe(
      "Instance override",
    );

    const file = await indexFile(request, designId);
    const reparented = await action(request, "apply-component-prop-edit", {
      designId,
      fileId: file.id,
      nodeId: "card-main",
      edit: {
        kind: "structure",
        intents: [
          {
            kind: "moveNode",
            target: { nodeId: "card-button" },
            anchor: { nodeId: "card-slot" },
            placement: "inside",
          },
        ],
      },
      source: { expectedFiles: await expectedFiles(request, designId) },
    });
    expect(reparented.persisted).toBe(true);
    html = await source(request, designId);
    roots = componentRoots(html, id);
    const currentReference = roots.find((root) => !root.main);
    expect(currentReference?.nodeId).toBe(referenceId);
    const referenceButtonTag = elementTags(html).find(
      (tag) =>
        attributeValue(tag, "data-agent-native-component-source-node-id") ===
        "card-button",
    );
    expect(referenceButtonTag).toBeTruthy();
    const referenceButtonId = attributeValue(
      referenceButtonTag ?? "",
      "data-agent-native-node-id",
    );
    expect(parentIdentity(html, "card-button")).toBe("card-slot");
    expect(parentIdentity(html, referenceButtonId!)).toBe("card-slot");

    const indexed = await action(request, "index-components", {
      designId,
      fileId: file.id,
    });
    expect(indexed.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "ReusableCard" }),
      ]),
    );

    const sameName = await action(request, "rename-component", {
      designId,
      componentId: id,
      newName: "ReusableCard",
    });
    expect(sameName.renamed).toBe(false);

    const renamed = await action(request, "rename-component", {
      designId,
      componentId: id,
      newName: "RenamedCard",
    });
    expect(renamed.renamed).toBe(true);
    html = await source(request, designId);
    roots = componentRoots(html, id);
    expect(roots.map((root) => root.name)).toEqual([
      "RenamedCard",
      "RenamedCard",
    ]);
    expect(roots.map((root) => root.layerName)).toEqual([
      "Card Main",
      "Card Main",
    ]);
    expect(tagForNode(html, "legacy-copy")).toContain(
      'data-agent-native-component="ReusableCard"',
    );

    const details = await readAction(request, "get-component-details", {
      designId,
      nodeId: "card-main",
      fileId: file.id,
    });
    expect(details).toMatchObject({
      name: "RenamedCard",
      instance: {
        name: "RenamedCard",
        instanceId: "card-main",
        nodeId: "card-main",
      },
    });
    const legacyDetails = await readAction(request, "get-component-details", {
      designId,
      nodeId: "legacy-copy",
      fileId: file.id,
    });
    expect(legacyDetails).toMatchObject({
      name: "ReusableCard",
      instance: {
        name: "ReusableCard",
        instanceId: "legacy-copy",
        nodeId: "legacy-copy",
      },
    });

    const collision = await request.post(
      baseURL + "/_agent-native/actions/rename-component",
      {
        data: {
          designId,
          componentId: id,
          newName: "ReusableCard",
        },
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(collision.status()).toBe(409);
    expect(await source(request, designId)).toContain(
      'data-agent-native-component="RenamedCard"',
    );

    const refOnlyFile = await action(request, "create-file", {
      designId,
      filename: "ref-only.html",
      content:
        '<main><section data-agent-native-node-id="ref-only" data-agent-native-component-ref="' +
        id +
        '"><h2 data-agent-native-layer-name="Ref-only title">Ref only</h2></section></main>',
      fileType: "html",
    });
    const refOnlyFileId = refOnlyFile.id ?? refOnlyFile.data?.id ?? "";
    expect(refOnlyFileId).toBeTruthy();
    const refOnlyResolution = await action(request, "go-to-main-component", {
      designId,
      nodeId: "ref-only",
      fileId: refOnlyFileId,
    });
    expect(refOnlyResolution).toMatchObject({
      isMain: false,
      componentName: "RenamedCard",
      instanceCount: 3,
      main: { nodeId: "card-main" },
    });

    const mainResolution = await action(request, "go-to-main-component", {
      designId,
      nodeId: referenceId,
      fileId: file.id,
    });
    expect(mainResolution).toMatchObject({
      isMain: false,
      instanceCount: 3,
      main: { nodeId: "card-main" },
    });
    await selectNodeById(page, referenceId, file.id);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(async () =>
        parentIdentity(await source(request, designId), referenceButtonId!),
      )
      .toBe("card-slot");
    html = await source(request, designId);
    expect(nodeText(html, "card-title-text")).toBe("Main edit again");
    expect(nodeText(html, afterOverrideReferenceTitle!)).toBe(
      "Instance override",
    );

    const opened = await action(request, "open-visual-edit", {
      designId,
      devServerUrl: manifest.devServerUrl,
      bridgeUrl: manifest.bridgeUrl,
      rootPath,
      routes: [
        {
          path: "/",
          title: "React component route",
          sourceKind: "react-router",
          sourceFile: "src/App.tsx",
        },
      ],
      navigate: false,
      publicReadOnly: false,
    });
    bridge = await startDesignConnectBridge(manifest, {
      bridgeToken: opened.bridgeToken,
      previewToken: opened.previewToken,
      allowedOrigins: [new URL(baseURL).origin],
    });
    const screenId = opened.screens?.[0]?.id;
    expect(screenId).toBeTruthy();
    await gotoEditor(page, designId);
    const design = await readDesign(request, designId);
    const data = JSON.parse(design.data ?? "{}") as Record<string, any>;
    expect(data.screenMetadata?.[screenId!]).toMatchObject({
      sourceType: "localhost",
      sourceKind: "react-router",
      sourceFile: "src/App.tsx",
    });
    const iframe = page.locator(
      'iframe[data-screen-iframe-id="' + screenId + '"]',
    );
    await expect(iframe).toBeVisible();
    const urlFrame = designFrame(page, screenId);
    await expect(
      urlFrame.locator('[data-agent-native-node-id="react-screen"]'),
    ).toHaveAttribute("data-agent-native-source-kind", "react");
    await expect(
      urlFrame.locator('[data-agent-native-node-id="react-screen"]'),
    ).toHaveAttribute("data-agent-native-source-file", "src/App.tsx");
    await expect(
      urlFrame.locator('[data-agent-native-node-id="react-screen"]'),
    ).toHaveAttribute("data-agent-native-source-line", "1");
    await expect(
      urlFrame.locator('[data-agent-native-node-id="card-main"]'),
    ).toHaveAttribute("data-agent-native-source-file", "src/App.tsx");
    await expect(
      urlFrame.locator('[data-agent-native-node-id="card-main"]'),
    ).toHaveAttribute("data-agent-native-source-line", "3");
    const urlDetails = await readAction(request, "get-component-details", {
      designId,
      nodeId: "card-main",
      fileId: screenId!,
    });
    expect(urlDetails).toMatchObject({
      sourceType: "localhost",
      name: "ReusableCard",
      instance: {
        name: "ReusableCard",
        instanceId: "card-main",
        nodeId: "card-main",
      },
      sourceLocation: {
        filePath: "src/App.tsx",
        line: 3,
        column: 1,
        componentName: "ReusableCard",
      },
    });
    const urlCard = urlFrame.locator('[data-agent-native-node-id="card-main"]');
    const urlCardInstanceId = await urlCard.getAttribute(
      "data-agent-native-node-id",
    );
    expect(urlCardInstanceId).toBe("card-main");
    const urlCardSelector =
      '[data-agent-native-node-id="' + urlCardInstanceId + '"]';
    await expect(urlFrame.locator(urlCardSelector)).toHaveCount(1);
    const screenURL = design.files.find(
      (candidate) => candidate.id === screenId,
    )?.content;
    expect(screenURL).toBeTruthy();
    expect(new URL(screenURL ?? "").port).not.toBe("");
  } finally {
    if (designId) {
      await action(request, "delete-design", { id: designId }).catch(
        () => undefined,
      );
    }
  }
});
