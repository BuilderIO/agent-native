import fs from "node:fs";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";

import {
  prepareDesignConnectManifest,
  startDesignConnectBridge,
  type DesignConnectBridge,
} from "@agent-native/core/testing";
import { type APIRequestContext, type Page } from "@playwright/test";
import { build } from "esbuild";

import { e2eBaseURL } from "./base-url";
import { appPath, cdpScreenshot, designFrame, selectByText } from "./helpers";
import { expect, test } from "./rails";

let baseURL = e2eBaseURL();
let designId = "";
let connectionId = "";
let rootPath = "";
let reactBundlePath = "";
let reactAppUrl = "";
let devServer: Server | null = null;
let bridge: DesignConnectBridge | null = null;
const snapshotFailurePaths = new Set<string>();

function reactFixtureSource(): string {
  const source = `import React from "react";
import { createRoot } from "react-dom/client";

function PrimaryButton({ variant = "primary", children, ...props }) {
  const buttonRef = (button) => {
    if (!button) return;
    Object.defineProperty(button, "__reactFiber$component-parity", {
      configurable: true,
      enumerable: true,
      value: {
        type: "button",
        _debugSource: {
          fileName: "src/Component.jsx",
          lineNumber: __HOST_LINE__,
          columnNumber: __HOST_COLUMN__,
        },
        return: {
          type: PrimaryButton,
          key: "button-1",
          _debugSource: {
            fileName: "src/Component.jsx",
            lineNumber: __LINE__,
            columnNumber: __COLUMN__,
          },
        },
      },
    });
  };
  return (
    <button ref={buttonRef} {...props}>
      {children ?? variant}
    </button>
  );
}

function App() {
  return (
    <main data-agent-native-node-id="react-root" data-agent-native-layer-name="React App Root">
      <PrimaryButton
        data-agent-native-node-id="react-button-1"
        data-agent-native-layer-name="React Primary Button"
        style={{ minWidth: "160px", minHeight: "48px", margin: "96px" }}
        variant="primary"
      />
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
`;
  const anchor = source.indexOf("<PrimaryButton");
  const hostAnchor = source.indexOf("<button ref");
  if (anchor < 0 || hostAnchor < 0)
    throw new Error("React fixture source anchor is missing");
  const line = source.slice(0, anchor).split("\n").length;
  const previousNewline = source.lastIndexOf("\n", anchor - 1);
  const column = anchor - previousNewline;
  const hostLine = source.slice(0, hostAnchor).split("\n").length;
  const hostPreviousNewline = source.lastIndexOf("\n", hostAnchor - 1);
  const hostColumn = hostAnchor - hostPreviousNewline;
  return source
    .split("__LINE__")
    .join(String(line))
    .split("__COLUMN__")
    .join(String(column))
    .split("__HOST_LINE__")
    .join(String(hostLine))
    .split("__HOST_COLUMN__")
    .join(String(hostColumn));
}

async function bundleReactFixture(): Promise<void> {
  await build({
    absWorkingDir: path.resolve(import.meta.dirname, ".."),
    bundle: true,
    entryPoints: [path.join(rootPath, "src", "Component.jsx")],
    format: "iife",
    logLevel: "silent",
    nodePaths: [
      path.resolve(import.meta.dirname, "..", "node_modules"),
      path.resolve(import.meta.dirname, "..", "..", "node_modules"),
    ],
    outfile: reactBundlePath,
    platform: "browser",
  });
}

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function postAction(
  request: APIRequestContext,
  actionName: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await request.post(
    `${baseURL}/_agent-native/actions/${actionName}`,
    {
      data: input,
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok()) {
    throw new Error(
      `${actionName} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function openDesignWithLocalNetworkPermission(page: Page): Promise<void> {
  await page.context().grantPermissions(["local-network-access"], {
    origin: new URL(baseURL).origin,
  });
  await page.goto(appPath(`/visual-edit/${designId}?editorView=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (
            await navigator.permissions.query({
              name: "local-network-access" as PermissionName,
            })
          ).state,
      ),
    )
    .toBe("granted");
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("tree", { name: "Layers" })).toBeVisible();
  await expect(
    page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Connect your local screens" }),
  ).toHaveCount(0);
}

test.beforeAll(async ({ request }, workerInfo) => {
  baseURL =
    (workerInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();
  rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "design-code-workbench-"));
  reactBundlePath = path.join(rootPath, "react-app.js");
  fs.mkdirSync(path.join(rootPath, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(rootPath, "src", "App.tsx"),
    "export function App() { return <main>Original local source</main>; }\n",
  );
  fs.writeFileSync(
    path.join(rootPath, "src", "Component.jsx"),
    reactFixtureSource(),
  );
  fs.writeFileSync(
    path.join(rootPath, "src", "Component.vue"),
    '<template><section class="card">{{ title }}</section></template>\n<script setup>const title = "Vue"</script>\n<style>.card { color: blue; }</style>\n',
  );
  fs.writeFileSync(
    path.join(rootPath, "src", "Component.svelte"),
    '<script>const title = "Svelte";</script>\n<section class="card">{title}</section>\n<style>.card { color: green; }</style>\n',
  );
  fs.writeFileSync(
    path.join(rootPath, "src", "Component.astro"),
    '---\nconst title = "Astro";\n---\n<section class="card">{title}</section>\n',
  );
  fs.writeFileSync(path.join(rootPath, "Dockerfile"), "FROM scratch\n");
  fs.writeFileSync(path.join(rootPath, ".prettierrc"), '{"semi":true}\n');
  fs.writeFileSync(path.join(rootPath, ".env"), "EXAMPLE_SECRET=blocked\n");
  await bundleReactFixture();

  devServer = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (snapshotFailurePaths.has(pathname)) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      res.end("Snapshot fixture unavailable.");
      return;
    }
    if (pathname === "/react") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><div id="root"></div><script src="${reactAppUrl}/react-app.js"></script>`,
      );
      return;
    }
    if (pathname === "/react-app.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(fs.readFileSync(reactBundlePath));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><main><h1>Local workbench fixture</h1></main></body></html>',
    );
  });
  const devPort = await listen(devServer);
  const devAddress = devServer.address();
  if (!devAddress || typeof devAddress === "string") {
    throw new Error("React fixture server did not expose a bound address");
  }
  reactAppUrl = `http://${devAddress.address}:${devAddress.port}`;

  const bridgePortServer = http.createServer();
  const bridgePort = await listen(bridgePortServer);
  await closeServer(bridgePortServer);

  const manifest = await prepareDesignConnectManifest({
    root: rootPath,
    url: `http://127.0.0.1:${devPort}`,
    port: bridgePort,
  });
  const opened = await postAction(request, "open-visual-edit", {
    title: "E2E local Code workbench",
    devServerUrl: manifest.devServerUrl,
    bridgeUrl: manifest.bridgeUrl,
    rootPath,
    routeManifest: manifest,
    paths: ["/"],
    navigate: false,
    publicReadOnly: false,
  });
  designId = opened.designId;
  connectionId = opened.connectionId;
  if (
    !designId ||
    !connectionId ||
    !opened.bridgeToken ||
    !opened.previewToken
  ) {
    throw new Error(`open-visual-edit returned incomplete data: ${opened}`);
  }

  bridge = await startDesignConnectBridge(manifest, {
    bridgeToken: opened.bridgeToken,
    previewToken: opened.previewToken,
    allowedOrigins: [new URL(baseURL).origin],
  });
});

test.afterAll(async ({ request }) => {
  if (designId) {
    await postAction(request, "delete-design", { id: designId }).catch(
      () => {},
    );
  }
  await closeServer(bridge?.server ?? null);
  await closeServer(devServer);
  if (rootPath) fs.rmSync(rootPath, { recursive: true, force: true });
});

function workbenchBuffer(page: Page, uri: string) {
  return page.evaluate((target) => {
    const workbench = (
      window as typeof window & { __designCodeWorkbench?: any }
    ).__designCodeWorkbench;
    return {
      content: workbench?.modelRegistry.get(target)?.model.getValue(),
      dirty: workbench?.api.getState().buffers[target]?.dirty,
    };
  }, uri);
}

// fixme: product bug: opening the localhost design's Code panel answers get-motion-timeline for its screen with 422 before any file is touched
test.fixme("lists the spawned folder, preserves dirty buffers, and saves a local file", async ({
  app,
  page,
  request,
}) => {
  await postAction(request, "revoke-localhost-write-consent", {
    designId,
    connectionId,
  });
  app.allowFailure(
    /http 428 POST \/_agent-native\/actions\/write-local-file|status of 428/,
    "the first save asks for file-write consent",
  );
  // The rail has no Code entry; the panel opens from its deep link, as the app's own "edit code" actions do.
  await page.goto(
    appPath(`/design/${designId}?editorView=overview&panel=code`),
    { waitUntil: "domcontentloaded" },
  );
  const rootName = path.basename(rootPath);
  const localRoot = page.getByText(`LOCAL FILES — ${rootName}`, {
    exact: true,
  });
  await expect(localRoot).toBeVisible({ timeout: 30_000 });
  await expect(localRoot).toHaveAttribute("title", rootPath);
  const localTree = page.getByRole("tree", {
    name: `LOCAL FILES — ${rootName}`,
    exact: true,
  });
  await expect(
    localTree.getByText("Dockerfile", { exact: true }),
  ).toBeVisible();
  await expect(
    localTree.getByText(".prettierrc", { exact: true }),
  ).toBeVisible();
  await expect(localTree.getByText(".env", { exact: true })).toHaveCount(0);
  await localTree.getByText("src", { exact: true }).click();

  for (const [filename, language] of [
    ["App.tsx", "typescript"],
    ["Component.jsx", "javascript"],
    ["Component.vue", "html"],
    ["Component.svelte", "html"],
    ["Component.astro", "html"],
  ] as const) {
    await localTree.getByText(filename, { exact: true }).click();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const workbench = (
              window as typeof window & { __designCodeWorkbench?: any }
            ).__designCodeWorkbench;
            const state = workbench?.api.getState();
            const uri = state?.activeUri;
            const buffer = uri ? state?.buffers[uri] : null;
            return {
              path:
                state?.tabs.find((entry: { uri: string }) => entry.uri === uri)
                  ?.path ?? null,
              loading: buffer?.loading ?? null,
              error: buffer?.error ?? null,
              language: uri
                ? (workbench?.modelRegistry.get(uri)?.model.getLanguageId() ??
                  null)
                : null,
            };
          }),
        { message: `${filename} loads into the expected Monaco language` },
      )
      .toEqual({
        path: `src/${filename}`,
        loading: false,
        error: null,
        language,
      });
  }

  await localTree.getByText("App.tsx", { exact: true }).click();
  const uri: string = await page.evaluate(
    () =>
      (
        window as typeof window & { __designCodeWorkbench?: any }
      ).__designCodeWorkbench.api.getState().activeUri,
  );
  const edited =
    "export function App() { return <main>Saved from Design Code</main>; }\n";
  await page
    .getByTestId("design-code-monaco-editor")
    .locator(".view-line")
    .first()
    .click({ clickCount: 3 });
  await page.keyboard.insertText(edited);
  await expect
    .poll(() => workbenchBuffer(page, uri))
    .toEqual({ content: edited, dirty: true });
  expect(
    fs.readFileSync(path.join(rootPath, "src", "App.tsx"), "utf8"),
    "nothing is written before save",
  ).toBe(
    "export function App() { return <main>Original local source</main>; }\n",
  );

  await page.keyboard.press("ControlOrMeta+s");
  const consent = page.getByRole("dialog", { name: "Allow file writes" });
  await expect(consent).toContainText(rootPath);
  await expect(consent).toContainText("src/App.tsx");
  await consent.getByRole("button", { name: "Allow writes" }).click();

  await expect
    .poll(() => fs.readFileSync(path.join(rootPath, "src", "App.tsx"), "utf8"))
    .toBe(edited);
  await expect
    .poll(() => workbenchBuffer(page, uri))
    .toEqual({ content: edited, dirty: false });
});

test("puts a URL screen's route, Reload and Open in browser in the top bar", async ({
  page,
}, testInfo) => {
  await page.context().grantPermissions(["local-network-access"], {
    origin: new URL(baseURL).origin,
  });
  await page.goto(appPath(`/design/${designId}?editorView=overview`), {
    waitUntil: "domcontentloaded",
  });
  const controls = page.locator(
    "[data-design-top-bar-center] [data-design-url-screen-controls]",
  );
  await expect(controls).toBeVisible({ timeout: 30_000 });
  await expect(
    controls.locator("[data-design-url-screen-route] [data-design-route-path]"),
  ).toHaveText("/");
  await cdpScreenshot(page, testInfo.outputPath("url-screen-top-bar.png"));

  // Reload is on the bar. Its remount is the same per-screen nonce Interact's
  // Reload uses (interact-toolbar-layout.spec.ts); this fixture's live editor
  // does not finish mounting its frame on this route, so there is none to watch.
  await controls.getByRole("button", { name: "Reload preview" }).click();
  await expect(controls).toBeVisible();

  // Open in browser is a new tab that cannot reach back into the editor.
  const open = controls.locator("a[data-design-url-screen-open]");
  await expect(open).toHaveAttribute("target", "_blank");
  const [popup] = await Promise.all([page.waitForEvent("popup"), open.click()]);
  await popup.waitForLoadState("domcontentloaded");
  expect(new URL(popup.url()).origin).toBe(new URL(reactAppUrl).origin);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();

  // Interact has its own route controls and no inspector.
  await page.locator('[data-design-mode="interact"]').click();
  await expect(controls).toHaveCount(0);
  await expect(
    page.locator('[data-design-chrome-region="right-panel"]'),
  ).toHaveCount(0);
  await page.locator('[data-design-mode="edit"]').click();
  await expect(controls).toBeVisible();
});

test("updates only the selected URL screen from the Screen inspector", async ({
  page,
  request,
}, testInfo) => {
  await postAction(request, "add-localhost-screens", {
    designId,
    paths: ["/screen-inspector-secondary"],
  });
  const readDesign = async () => {
    const response = await page.request.get(
      `${baseURL}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    );
    if (!response.ok()) {
      throw new Error(
        `get-design failed: ${response.status()} ${await response.text()}`,
      );
    }
    return response.json();
  };
  const initial = await readDesign();

  await openDesignWithLocalNetworkPermission(page);
  await expect
    .poll(async () => {
      const current = await readDesign();
      const data = JSON.parse(current.data ?? "{}") as Record<string, any>;
      return typeof data.boardFileId === "string" && data.boardObjects === null;
    })
    .toBe(true);
  const before = await readDesign();
  const beforeData = JSON.parse(before.data ?? "{}") as Record<string, any>;

  const screenRow = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .first();
  await expect(screenRow).toBeVisible();
  const screenId = await screenRow.getAttribute("data-layer-node-id");
  if (!screenId) throw new Error("Selected screen row has no file id");
  await screenRow.click();
  const screen = initial.files.find(
    (file: { id?: string; content?: string; fileType?: string }) =>
      file.id === screenId &&
      file.fileType === "html" &&
      (file.content?.startsWith("http://") ||
        file.content?.startsWith("https://")),
  );
  expect(screen?.id).toBe(screenId);
  await expect(
    page.locator("h3.design-sidebar-section-title", { hasText: "Screen" }),
  ).toBeVisible();
  const screenInspectorSection = page
    .locator("h3[aria-label='Screen']")
    .locator("xpath=ancestor::section[@data-design-inspector-section]");
  await expect(screenInspectorSection.getByLabel("Add screen")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /remove screen/i }),
  ).toBeVisible();

  const urlInput = page.getByLabel("Screen URL");
  await expect(urlInput).toHaveValue(/127\.0\.0\.1/);
  const nextPath = "/?visual-edit-e2e=updated";
  const expectedScreenUrl = new URL(nextPath, screen!.content).toString();
  await urlInput.fill(nextPath);
  await page.getByRole("button", { name: "Update", exact: true }).click();

  await expect.poll(readDesign).toMatchObject({
    files: expect.arrayContaining([
      expect.objectContaining({
        id: screenId,
        content: expect.stringContaining("visual-edit-e2e=updated"),
      }),
    ]),
  });
  const after = await readDesign();
  const afterData = JSON.parse(after.data ?? "{}") as Record<string, any>;
  const stripSelectedMetadata = (data: Record<string, any>) => {
    const next = { ...data };
    for (const key of ["screenMetadata", "localhostScreens"]) {
      if (!data[key] || typeof data[key] !== "object") continue;
      const rest = { ...data[key] };
      delete rest[screenId];
      next[key] = rest;
    }
    return next;
  };
  expect(stripSelectedMetadata(afterData)).toEqual(
    stripSelectedMetadata(beforeData),
  );
  expect(afterData.screenMetadata?.[screenId]).toMatchObject({
    sourceType: "localhost",
    path: nextPath,
  });
  await expect(urlInput).toHaveValue(expectedScreenUrl);
  const screenPreviewIframe = page.locator(
    `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
  );
  await expect
    .poll(() =>
      screenPreviewIframe.getAttribute("src").then((src) => {
        if (!src) return null;
        return new URL(src, baseURL).searchParams.get("url");
      }),
    )
    .toBe(expectedScreenUrl);
  await expect(
    screenPreviewIframe.contentFrame().getByText("Local workbench fixture"),
  ).toBeVisible();
  await cdpScreenshot(page, testInfo.outputPath("screen-source-settings.png"));

  const staticSourceResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/update-screen-source") &&
      response.request().method() === "POST",
  );
  await page.getByRole("tab", { name: "Static", exact: true }).click();
  const staticSourceResponse = await staticSourceResponsePromise;
  expect(staticSourceResponse.ok(), await staticSourceResponse.text()).toBe(
    true,
  );
  await expect
    .poll(async () => {
      const current = await readDesign();
      const file = current.files.find(
        (candidate: { id?: string }) => candidate.id === screenId,
      );
      const data = JSON.parse(current.data ?? "{}") as Record<string, any>;
      return {
        content: file?.content,
        screenMetadata: data.screenMetadata?.[screenId],
        localhostScreens: data.localhostScreens?.[screenId],
      };
    })
    .toMatchObject({
      content: expect.stringContaining("Local workbench fixture"),
      screenMetadata: { sourceType: "inline", previewState: "static" },
      localhostScreens: { sourceType: "inline", previewState: "static" },
    });
  const staticDesign = await readDesign();
  const staticData = JSON.parse(staticDesign.data ?? "{}") as Record<
    string,
    any
  >;
  expect(staticData.screenMetadata?.[screenId]).toMatchObject({
    sourceType: "inline",
    previewState: "static",
  });
  await expect(page.getByLabel("Screen URL")).toHaveCount(0);
  await expect(
    page.getByText("Preparing live editor...", { exact: true }),
  ).toHaveCount(0);
  await expect(
    screenPreviewIframe.contentFrame().getByText("Local workbench fixture"),
  ).toBeVisible();
  await cdpScreenshot(page, testInfo.outputPath("screen-source-static.png"));
});

// fixme: product bug: The inspector's W and H fields read 0px for a URL-backed React button rendered at 160x48 (min-width/min-height 160/48); the canvas badge
test.fixme("promotes and edits a URL-backed React component through the live iframe", async ({
  app,
  page,
  request,
}, testInfo) => {
  await postAction(request, "revoke-localhost-write-consent", {
    designId,
    connectionId,
  });
  app.allowFailure(
    /http 428 POST \/_agent-native\/actions\/create-component|status of 428/,
    "the first create-component asks for file-write consent",
  );
  const opened = await postAction(request, "add-localhost-screens", {
    connectionId,
    designId,
    paths: ["/react"],
  });
  const screenId = opened.screens?.[0]?.id;
  if (!screenId) {
    throw new Error(`Missing React screen metadata: ${JSON.stringify(opened)}`);
  }

  const source = fs.readFileSync(
    path.join(rootPath, "src", "Component.jsx"),
    "utf8",
  );
  const anchor = source.indexOf("<PrimaryButton");
  const hostAnchor = source.indexOf("<button ref");
  if (anchor < 0) throw new Error("React fixture source anchor is missing");
  const line = source.slice(0, anchor).split("\n").length;
  const column = anchor - source.lastIndexOf("\n", anchor - 1);
  const hostLine = source.slice(0, hostAnchor).split("\n").length;
  const hostColumn = hostAnchor - source.lastIndexOf("\n", hostAnchor - 1);

  await openDesignWithLocalNetworkPermission(page);

  const screenRow = page
    .getByRole("tree", { name: "Layers" })
    .locator(`[data-layer-row-button][data-layer-node-id="${screenId}"]`);
  await expect(screenRow).toBeVisible({ timeout: 20_000 });
  await screenRow.click();
  await page.evaluate((id) => {
    document
      .querySelector<HTMLIFrameElement>(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${id}"]`,
      )
      ?.contentWindow?.postMessage({ type: "clear-selection" }, "*");
  }, screenId);

  const iframe = page.locator(
    `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
  );
  await expect
    .poll(() => iframe.contentFrame().locator("body").innerHTML())
    .toContain("primary");
  const button = iframe
    .contentFrame()
    .locator('[data-agent-native-node-id="react-button-1"]');
  await expect(button).toHaveAttribute(
    "data-agent-native-layer-name",
    "React Primary Button",
  );
  await expect(button).not.toHaveAttribute("data-agent-native-component");
  await expect(button).toHaveText("primary");

  const selection: any = await selectByText(page, "primary", { screenId });
  expect(selection.provenance).toMatchObject({
    component: "PrimaryButton",
    framework: "react",
    method: "debug-source",
    sourceFile: "src/Component.jsx",
    line: hostLine,
    column: hostColumn,
  });
  expect(selection.componentAnnotation).toBeUndefined();
  await expect
    .soft(
      page.getByLabel("W size in pixels"),
      "the inspector reports the rendered width",
    )
    .toHaveValue("160px");
  await expect
    .soft(
      page.getByLabel("H size in pixels"),
      "the inspector reports the rendered height",
    )
    .toHaveValue("48px");
  expect(selection.runtimeComponent).toMatchObject({
    name: "PrimaryButton",
    framework: "react",
    instanceId: "react-button-1",
    writeCapability: "authored-jsx-literal",
    sourceFile: "src/Component.jsx",
    line,
    column,
    props: [],
  });

  const createComponent = page.getByRole("button", {
    name: "Create component",
    exact: true,
  });
  await expect(createComponent).toBeVisible();
  await createComponent.click();
  const createForm = page.locator("form").filter({
    has: page.locator("#create-component-name"),
  });
  await expect(createForm).toBeVisible();
  await createForm.locator("#create-component-name").fill("PrimaryButton");
  const createResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/create-component") &&
      response.request().method() !== "OPTIONS",
  );
  await createForm.getByRole("button", { name: "Create", exact: true }).click();
  await createResponse;
  const consentDialog = page.getByRole("dialog");
  await expect(consentDialog).toContainText("Allow file writes");
  const retryCreateResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/create-component") &&
      response.request().method() !== "OPTIONS",
  );
  await consentDialog.getByRole("button", { name: "Allow writes" }).click();
  expect((await retryCreateResponse).ok()).toBe(true);
  await expect
    .poll(() =>
      fs.readFileSync(path.join(rootPath, "src", "Component.jsx"), "utf8"),
    )
    .toContain('data-agent-native-component="PrimaryButton"');
  await expect
    .poll(() =>
      fs.readFileSync(path.join(rootPath, "src", "Component.jsx"), "utf8"),
    )
    .toContain('data-agent-native-prop-variant="primary"');

  await bundleReactFixture();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page
      .getByRole("tree", { name: "Layers" })
      .locator(`[data-layer-row-button][data-layer-node-id="${screenId}"]`),
  ).toBeVisible({ timeout: 20_000 });
  await page
    .getByRole("tree", { name: "Layers" })
    .locator(`[data-layer-row-button][data-layer-node-id="${screenId}"]`)
    .click();
  await expect(
    page
      .locator(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
      )
      .contentFrame()
      .locator('[data-agent-native-node-id="react-button-1"]'),
  ).toHaveAttribute("data-agent-native-component", "PrimaryButton");

  const reloadedButton = page
    .locator(
      `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
    )
    .contentFrame()
    .locator('[data-agent-native-node-id="react-button-1"]');
  await expect(reloadedButton).toHaveText("primary");
  await selectByText(page, "primary", {
    screenId,
    clearPreviousSelection: true,
  });
  const componentSection = page.getByTestId("component-section");
  await expect(componentSection).toContainText("PrimaryButton");
  await expect(componentSection).toContainText("src/Component.jsx");
  const variantInput = componentSection.locator("input").first();
  await expect(variantInput).toHaveValue("primary");
  await variantInput.fill("secondary");
  const propResponse = page.waitForResponse(
    (response) =>
      response
        .url()
        .includes("/_agent-native/actions/apply-component-prop-edit") &&
      response.request().method() !== "OPTIONS",
  );
  await variantInput.press("Enter");
  expect((await propResponse).ok()).toBe(true);

  await expect
    .poll(() =>
      fs.readFileSync(path.join(rootPath, "src", "Component.jsx"), "utf8"),
    )
    .toContain('variant="secondary"');
  await expect
    .poll(() =>
      fs.readFileSync(path.join(rootPath, "src", "Component.jsx"), "utf8"),
    )
    .toContain('data-agent-native-prop-variant="secondary"');

  await expect(variantInput).toHaveValue("secondary");
  await variantInput.fill("tertiary");
  const secondPropResponse = page.waitForResponse(
    (response) =>
      response
        .url()
        .includes("/_agent-native/actions/apply-component-prop-edit") &&
      response.request().method() !== "OPTIONS",
  );
  await variantInput.press("Enter");
  expect((await secondPropResponse).ok()).toBe(true);
  await expect
    .poll(() =>
      fs.readFileSync(path.join(rootPath, "src", "Component.jsx"), "utf8"),
    )
    .toContain('variant="tertiary"');
  await expect
    .poll(() =>
      fs.readFileSync(path.join(rootPath, "src", "Component.jsx"), "utf8"),
    )
    .toContain('data-agent-native-prop-variant="tertiary"');
  await bundleReactFixture();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("tree", { name: "Layers" })
    .locator(`[data-layer-row-button][data-layer-node-id="${screenId}"]`)
    .click();
  await page.evaluate((id) => {
    document
      .querySelector<HTMLIFrameElement>(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${id}"]`,
      )
      ?.contentWindow?.postMessage({ type: "clear-selection" }, "*");
  }, screenId);
  await expect(
    page
      .locator(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
      )
      .contentFrame()
      .locator('[data-agent-native-node-id="react-button-1"]'),
  ).toHaveAttribute("data-agent-native-prop-variant", "tertiary");
  await expect(
    page
      .locator(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
      )
      .contentFrame()
      .getByText("tertiary", { exact: true }),
  ).toBeVisible();
  await cdpScreenshot(
    page,
    testInfo.outputPath("url-react-component-parity.png"),
  );
});

/** Writes the fixture with PrimaryButton already promoted to a component, then rebuilds the bundle the screen loads. */
async function writePromotedReactFixture(): Promise<void> {
  fs.writeFileSync(
    path.join(rootPath, "src", "Component.jsx"),
    reactFixtureSource().replace(
      'data-agent-native-node-id="react-button-1"',
      'data-agent-native-node-id="react-button-1" data-agent-native-component="PrimaryButton" data-agent-native-prop-variant="primary"',
    ),
  );
  await bundleReactFixture();
}

async function pendingVisualEdits(page: Page) {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/get-visual-edit-pending?designId=${encodeURIComponent(designId)}`,
    ),
  );
  expect(response.ok(), `get-visual-edit-pending ${response.status()}`).toBe(
    true,
  );
  const { pendingEditCount, status } = await response.json();
  return { pendingEditCount, status };
}

test("duplicates a URL-backed React component through undo and redo", async ({
  app,
  page,
  request,
}) => {
  await writePromotedReactFixture();
  const opened = await postAction(request, "add-localhost-screens", {
    connectionId,
    designId,
    paths: ["/react"],
  });
  const screenId: string = opened.screens[0].id;
  await openDesignWithLocalNetworkPermission(page);
  await page
    .getByRole("tree", { name: "Layers" })
    .locator(`[data-layer-row-button][data-layer-node-id="${screenId}"]`)
    .click();
  const frame = page
    .locator(
      `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
    )
    .contentFrame();
  const original = frame.locator(
    '[data-agent-native-node-id="react-button-1"]',
  );
  await expect(original).toHaveAttribute(
    "data-agent-native-component",
    "PrimaryButton",
  );
  const instances = frame.locator(
    '[data-agent-native-component="PrimaryButton"]',
  );
  const instanceIds = () =>
    instances.evaluateAll((elements) =>
      elements.map((element) =>
        element.getAttribute("data-agent-native-node-id"),
      ),
    );
  const box = (await original.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect
    .poll(() => app.selectedLayers())
    .toEqual(["React Primary Button"]);
  expect(await pendingVisualEdits(page)).toEqual({
    pendingEditCount: 0,
    status: "empty",
  });
  const pendingToolbar = page.locator(
    "[data-design-pending-visual-style-toolbar]",
  );

  await page.keyboard.press("ControlOrMeta+d");

  await expect(instances).toHaveCount(2);
  const duplicated = await instanceIds();
  const cloneId = duplicated[1]!;
  expect(duplicated).toStrictEqual(["react-button-1", cloneId]);
  expect(cloneId).toMatch(/^copy-[0-9a-f-]{36}$/);
  expect(
    await instances.evaluateAll((elements) =>
      elements.map((element) =>
        element.getAttribute("data-agent-native-runtime-instance-id"),
      ),
    ),
    "only the clone gets its own runtime instance",
  ).toStrictEqual([null, cloneId]);
  await expect(instances.nth(1)).toHaveAttribute(
    "data-agent-native-layer-name",
    "React Primary Button",
  );
  await expect(pendingToolbar).toBeVisible();
  await expect
    .poll(() => pendingVisualEdits(page))
    .toEqual({ pendingEditCount: 1, status: "ready" });

  await page.keyboard.press("ControlOrMeta+z");
  await expect(instances).toHaveCount(1);
  expect(
    await instanceIds(),
    "undo removes the clone, not the original",
  ).toStrictEqual(["react-button-1"]);
  await expect(pendingToolbar).toBeHidden();
  await expect
    .poll(() => pendingVisualEdits(page))
    .toEqual({ pendingEditCount: 0, status: "empty" });

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(instances).toHaveCount(2);
  expect(await instanceIds()).toStrictEqual(["react-button-1", cloneId]);
  await expect(pendingToolbar).toBeVisible();
  await expect
    .poll(() => pendingVisualEdits(page))
    .toEqual({ pendingEditCount: 1, status: "ready" });
});

// fixme: product bug: The failure toast shows the bridge's raw JSON: 'Bridge snapshot failed (503): { "ok": false, "source": "agent-native-design-connect", ...
test.fixme("keeps a URL screen selected when its static snapshot fails", async ({
  app,
  page,
  request,
}) => {
  app.allowFailure(
    /status of 503/,
    "the dead route's snapshot fixture answers 503",
  );
  app.allowFailure(
    /http 424 POST \/_agent-native\/actions\/update-screen-source|status of 424/,
    "switching the dead route to Static must fail",
  );
  app.allowFailure(
    /error toast/,
    "the failed snapshot is reported in a toast; its text is asserted in the test",
  );
  const unavailablePath = "/visual-edit-dead";
  const expectedUrl = new URL(unavailablePath, reactAppUrl).toString();
  snapshotFailurePaths.add(unavailablePath);
  let unavailablePreviewMatcher: ((url: URL) => boolean) | undefined;
  let blockedPreviewRequests = 0;
  try {
    await openDesignWithLocalNetworkPermission(page);

    unavailablePreviewMatcher = (url) =>
      url.pathname === "/live-edit" &&
      url.searchParams.get("url") === expectedUrl;
    await page.route(unavailablePreviewMatcher, (route) => {
      blockedPreviewRequests += 1;
      return route.abort();
    });

    const opened = await postAction(request, "add-localhost-screens", {
      designId,
      paths: [unavailablePath],
    });
    const screenId = opened.screens?.[0]?.id;
    if (!screenId) throw new Error(`Missing dead-route screen: ${opened}`);

    const readDesign = async () => {
      const response = await page.request.get(
        `${baseURL}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
      );
      if (!response.ok()) {
        throw new Error(
          `get-design failed: ${response.status()} ${await response.text()}`,
        );
      }
      return response.json();
    };

    const beforeDesign = await readDesign();
    const beforeData = JSON.parse(beforeDesign.data ?? "{}") as Record<
      string,
      any
    >;
    const beforeFile = beforeDesign.files.find(
      (file: { id?: string }) => file.id === screenId,
    );
    if (typeof beforeFile?.content !== "string") {
      throw new Error(`URL screen ${screenId} has no readable source file`);
    }
    expect(beforeData.screenMetadata?.[screenId]).toMatchObject({
      sourceType: "localhost",
      url: expectedUrl,
      path: unavailablePath,
      connectionId,
    });

    await page.reload({ waitUntil: "commit" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("tree", { name: "Layers" })).toBeVisible();
    await expect.poll(() => blockedPreviewRequests).toBeGreaterThan(0);

    const screenRow = page
      .getByRole("tree", { name: "Layers" })
      .locator(`[data-layer-row-button][data-layer-node-id="${screenId}"]`);
    await expect(screenRow).toBeVisible();
    await screenRow.click();
    const screenUrlInput = page.getByLabel("Screen URL");
    await expect(screenUrlInput).toHaveValue(expectedUrl);

    const updateRequestPromise = page.waitForRequest(
      (nextRequest) =>
        nextRequest
          .url()
          .includes("/_agent-native/actions/update-screen-source") &&
        nextRequest.method() === "POST",
    );
    const updateResponsePromise = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes("/_agent-native/actions/update-screen-source") &&
        response.request().method() === "POST",
    );
    await page.getByRole("tab", { name: "Static", exact: true }).click();

    const updateRequest = await updateRequestPromise;
    const updateInput = updateRequest.postDataJSON() as Record<string, unknown>;
    expect(updateInput).toMatchObject({
      designId,
      fileId: screenId,
      sourceType: "static",
    });
    expect(updateInput).not.toHaveProperty("snapshotHtml");

    const updateResponse = await updateResponsePromise;
    expect(updateResponse.status()).toBe(424);
    const updateError = await updateResponse.json();
    expect(updateError.error).toMatch(/snapshot failed \(503\)/i);

    await expect(screenUrlInput).toBeVisible();
    await expect(screenUrlInput).toHaveValue(expectedUrl);
    const failureToast = page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Bridge snapshot failed (503)" });
    await expect(failureToast).toBeVisible({ timeout: 10_000 });
    expect
      .soft(
        await failureToast.innerText(),
        "the toast explains the failure instead of dumping the bridge's JSON",
      )
      .not.toContain("{");

    const afterDesign = await readDesign();
    const afterData = JSON.parse(afterDesign.data ?? "{}") as Record<
      string,
      any
    >;
    const afterFile = afterDesign.files.find(
      (file: { id?: string }) => file.id === screenId,
    );
    expect(afterFile?.content).toBe(beforeFile.content);
    expect(afterData.screenMetadata?.[screenId]).toMatchObject({
      sourceType: "localhost",
      url: expectedUrl,
      path: unavailablePath,
      connectionId,
    });
    expect(afterData.localhostScreens?.[screenId]).toMatchObject({
      sourceType: "localhost",
      url: expectedUrl,
      path: unavailablePath,
      connectionId,
    });
  } finally {
    if (unavailablePreviewMatcher) {
      await page.unroute(unavailablePreviewMatcher);
    }
    snapshotFailurePaths.delete(unavailablePath);
  }
});

// fixme: product bug: In a design with a localhost screen, the selected inline (seeded) screen's inspector shows Source = URL with the raw '<!doctype html>…'
test.fixme("registers an inactive local Screen at its current bridge endpoint", async ({
  app,
  page,
  request,
}) => {
  const isolatedDesignId = await app.seed(
    '<!doctype html><html><body><main data-agent-native-node-id="active-static">Editable static screen</main></body></html>',
    { title: "Inactive local preview" },
  );
  const staticScreenId = (await app.savedRecord(isolatedDesignId)).files.find(
    (file) => file.filename === "index.html",
  )!.id;

  const opened = await postAction(request, "add-localhost-screens", {
    designId: isolatedDesignId,
    connectionId,
    paths: ["/inactive-preview"],
  });
  const localScreenId = opened.screens?.[0]?.id;
  if (!localScreenId) {
    throw new Error("add-localhost-screens returned no local Screen");
  }
  const expectedBridgeUrl = String(opened.bridgeUrl ?? "");
  if (!expectedBridgeUrl) {
    throw new Error("add-localhost-screens returned no bridge URL");
  }
  const expectedBridgeOrigin = new URL(expectedBridgeUrl).origin;
  const staleBridgeOrigin = new URL(baseURL).origin;
  await postAction(request, "update-design", {
    id: isolatedDesignId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", localScreenId, "bridgeUrl"],
        value: staleBridgeOrigin,
      },
      {
        op: "set",
        path: ["screenMetadata", localScreenId, "previewToken"],
        value: "stale-preview-token",
      },
    ],
  });

  const successfulRegistrations: string[] = [];
  const registrationAttempts: Array<{
    origin: string;
    hasPreviewToken: boolean;
    usedStaleMetadataToken: boolean;
  }> = [];
  const failedRegistrations: Array<{ origin: string; status: number }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname !== "/live-edit-bridge" || request.method() !== "POST") {
      return;
    }
    const payload = request.postDataJSON() as { designId?: string };
    if (payload.designId !== isolatedDesignId) return;
    const previewToken = request.headers()["x-design-preview-token"];
    registrationAttempts.push({
      origin: url.origin,
      hasPreviewToken: Boolean(previewToken),
      usedStaleMetadataToken: previewToken === "stale-preview-token",
    });
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (
      url.pathname !== "/live-edit-bridge" ||
      response.request().method() !== "POST"
    ) {
      return;
    }
    const payload = response.request().postDataJSON() as {
      designId?: string;
    };
    if (payload.designId === isolatedDesignId) {
      if (response.ok()) {
        successfulRegistrations.push(payload.designId);
      } else {
        failedRegistrations.push({
          origin: url.origin,
          status: response.status(),
        });
      }
    }
  });

  await page.context().grantPermissions(["local-network-access"], {
    origin: new URL(baseURL).origin,
  });
  await page.goto(
    appPath(
      `/design/${isolatedDesignId}?editorView=overview&screen=${encodeURIComponent(staticScreenId)}`,
    ),
    { waitUntil: "domcontentloaded" },
  );
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("tree", { name: "Layers" })).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("screen"))
    .toBe(staticScreenId);
  await expect(
    page.getByRole("button", { name: "All screens", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const staticScreenRow = page.locator('[data-screen-row][title="index.html"]');
  await expect(staticScreenRow).toBeVisible();
  await expect(staticScreenRow).not.toHaveAttribute("aria-current", "page");
  await expect(
    page.locator(
      `[data-screen-shell][data-frame-id="${localScreenId}"] iframe[data-design-preview-iframe]`,
    ),
  ).toBeAttached();
  await expect
    .poll(() => successfulRegistrations.length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  expect(registrationAttempts.length).toBeGreaterThan(0);
  expect(
    registrationAttempts.every(
      (attempt) =>
        attempt.origin === expectedBridgeOrigin &&
        attempt.hasPreviewToken &&
        !attempt.usedStaleMetadataToken,
    ),
  ).toBe(true);
  expect(failedRegistrations).toEqual([]);
  await expect(
    designFrame(page, localScreenId).getByText("Local workbench fixture"),
  ).toBeVisible();
  await expect
    .soft(
      page.getByLabel("Screen URL"),
      "the selected inline screen is inspected as Static, not as a URL",
    )
    .toHaveCount(0);
});
