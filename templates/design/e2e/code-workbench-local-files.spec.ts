import fs from "node:fs";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";

import {
  prepareDesignConnectManifest,
  startDesignConnectBridge,
  type DesignConnectBridge,
} from "@agent-native/core/testing";
import { expect, test, type APIRequestContext } from "@playwright/test";

import { appPath } from "./helpers";

let baseURL = "http://127.0.0.1:9333";
let designId = "";
let rootPath = "";
let devServer: Server | null = null;
let bridge: DesignConnectBridge | null = null;

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

test.beforeAll(async ({ request }, workerInfo) => {
  baseURL =
    (workerInfo.project.use.baseURL as string | undefined) ??
    "http://127.0.0.1:9333";
  rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "design-code-workbench-"));
  fs.mkdirSync(path.join(rootPath, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(rootPath, "src", "App.tsx"),
    "export function App() { return <main>Original local source</main>; }\n",
  );
  fs.writeFileSync(path.join(rootPath, "Dockerfile"), "FROM scratch\n");
  fs.writeFileSync(path.join(rootPath, ".prettierrc"), '{"semi":true}\n');
  fs.writeFileSync(path.join(rootPath, ".env"), "EXAMPLE_SECRET=blocked\n");

  devServer = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><main><h1>Local workbench fixture</h1></main>");
  });
  const devPort = await listen(devServer);

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
  if (!designId || !opened.bridgeToken || !opened.previewToken) {
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

test("lists the spawned folder, preserves dirty buffers, and saves a local file", async ({
  page,
}) => {
  await page.goto(appPath(`/design/${designId}?editorView=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: "Code", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Code", exact: true }).click();

  const rootName = path.basename(rootPath);
  const localRoot = page.getByText(`LOCAL FILES — ${rootName}`, {
    exact: true,
  });
  await expect(localRoot).toBeVisible({ timeout: 20_000 });
  await expect(localRoot).toHaveAttribute("title", rootPath);

  await page.getByText("src", { exact: true }).click();
  await page.getByText("App.tsx", { exact: true }).click();
  await expect(page.getByTestId("design-code-monaco-editor")).toBeVisible();

  const localUri = await page.evaluate(async () => {
    const workbench = (
      window as typeof window & {
        __designCodeWorkbench?: {
          api: {
            getState(): { activeUri: string | null };
          };
          modelRegistry: {
            get(uri: string): {
              model: { setValue(value: string): void; getValue(): string };
            } | null;
          };
        };
      }
    ).__designCodeWorkbench;
    if (!workbench) throw new Error("Code workbench automation handle missing");
    const uri = workbench.api.getState().activeUri;
    if (!uri) throw new Error("No active local file");
    workbench.modelRegistry
      .get(uri)
      ?.model.setValue(
        "export function App() { return <main>Saved from Design Code</main>; }\n",
      );
    return uri;
  });

  await page.getByRole("button", { name: "File", exact: true }).click();
  await expect(page.getByTestId("design-code-workbench")).toBeHidden();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate((uri) => {
        const workbench = (
          window as typeof window & { __designCodeWorkbench?: any }
        ).__designCodeWorkbench;
        return {
          content: workbench?.modelRegistry.get(uri)?.model.getValue(),
          dirty: workbench?.api.getState().buffers[uri]?.dirty,
        };
      }, localUri),
    )
    .toEqual({
      content:
        "export function App() { return <main>Saved from Design Code</main>; }\n",
      dirty: true,
    });

  await page.getByTestId("design-code-monaco-editor").click();
  await page.keyboard.press("ControlOrMeta+s");
  const consent = page.getByRole("dialog", { name: "Allow file writes" });
  await expect(consent).toBeVisible();
  await expect(consent).toContainText(rootPath);
  await expect(consent).toContainText("src/App.tsx");
  await consent.getByRole("button", { name: "Allow writes" }).click();

  await expect
    .poll(() => fs.readFileSync(path.join(rootPath, "src", "App.tsx"), "utf8"))
    .toContain("Saved from Design Code");
  await expect
    .poll(() =>
      page.evaluate((uri) => {
        const workbench = (
          window as typeof window & { __designCodeWorkbench?: any }
        ).__designCodeWorkbench;
        return workbench?.api.getState().buffers[uri]?.dirty;
      }, localUri),
    )
    .toBe(false);

  await expect(page.getByText("Dockerfile", { exact: true })).toBeVisible();
  await expect(page.getByText(".prettierrc", { exact: true })).toBeVisible();
  await expect(page.getByText(".env", { exact: true })).toHaveCount(0);
});
