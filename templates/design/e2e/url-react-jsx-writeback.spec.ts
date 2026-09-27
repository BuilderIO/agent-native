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
import { createServer, type ViteDevServer } from "vite";

import { e2eBaseURL } from "./base-url";
import { appPath } from "./helpers";

const baseURL = e2eBaseURL();
let rootPath = "";
let designId = "";
let connectionId = "";
let viteServer: ViteDevServer | null = null;
let bridge: DesignConnectBridge | null = null;
const viteChangedFiles: string[] = [];

const sourcePath = "src/Card.tsx";

function cardSource(): string {
  return `import React from "react";
import { createRoot } from "react-dom/client";

export function Card() {
  return <article data-card style={{ color: "red" }}>Card</article>;
}

createRoot(document.getElementById("root")!).render(<Card />);
`;
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
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(
      `${actionName} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

test.describe.serial("URL-backed React JSX writeback", () => {
  test.beforeAll(async ({ request }) => {
    rootPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "design-react-writeback-"),
    );
    fs.mkdirSync(path.join(rootPath, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(rootPath, "index.html"),
      '<div id="root"></div><script type="module" src="/src/Card.tsx"></script>',
    );
    fs.writeFileSync(path.join(rootPath, sourcePath), cardSource());

    viteServer = await createServer({
      root: rootPath,
      server: { host: "127.0.0.1", port: 0, strictPort: false },
      resolve: {
        alias: {
          react: path.resolve("node_modules/react"),
          "react-dom": path.resolve("node_modules/react-dom"),
        },
      },
    });
    await viteServer.listen();
    viteServer.watcher.on("change", (changedPath) => {
      viteChangedFiles.push(changedPath);
    });
    const address = viteServer.httpServer?.address();
    if (!address || typeof address === "string")
      throw new Error("Vite did not start");
    const devServerUrl = `http://${address.address}:${address.port}`;
    const bridgeProbe = http.createServer();
    const bridgePort = await listen(bridgeProbe);
    await closeServer(bridgeProbe);
    const manifest = await prepareDesignConnectManifest({
      root: rootPath,
      url: devServerUrl,
      port: bridgePort,
    });
    const opened = await postAction(request, "open-visual-edit", {
      title: "React JSX writeback proof",
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
    bridge = await startDesignConnectBridge(manifest, {
      bridgeToken: opened.bridgeToken,
      previewToken: opened.previewToken,
      allowedOrigins: [new URL(baseURL).origin],
    });
  });

  test.afterAll(async ({ request }) => {
    if (designId)
      await postAction(request, "delete-design", { id: designId }).catch(
        () => {},
      );
    await closeServer(bridge?.server ?? null);
    await viteServer?.close();
    if (rootPath) fs.rmSync(rootPath, { recursive: true, force: true });
  });

  test("previews, persists, hot-reloads, and reloads one literal Card style", async ({
    page,
    request,
  }) => {
    const opened = await postAction(request, "add-localhost-screens", {
      connectionId,
      designId,
      paths: ["/"],
    });
    const screenId = opened.screens?.[0]?.id;
    if (!screenId) throw new Error("Missing URL-backed React screen");
    const source = fs.readFileSync(path.join(rootPath, sourcePath), "utf8");
    const anchorOffset = source.indexOf("<article");
    const line = source.slice(0, anchorOffset).split("\n").length;
    const column = anchorOffset - source.lastIndexOf("\n", anchorOffset - 1);

    await page.goto(appPath(`/design/${designId}?editorView=overview`), {
      waitUntil: "domcontentloaded",
    });
    const frame = page
      .locator(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
      )
      .contentFrame();
    const card = frame.locator("[data-card]");
    await expect(card).toHaveText("Card");
    await expect(card).toHaveCSS("color", "rgb(255, 0, 0)");

    const sourceRef = {
      kind: "local-file",
      designId,
      connectionId,
      path: sourcePath,
    };
    const intent = {
      kind: "style",
      target: {
        sourceAnchor: {
          line,
          column,
          positionPrecision: "authored",
          runtimeMultiplicity: 1,
          scope: "single-instance",
        },
      },
      property: "color",
      value: "blue",
    };
    const preview = await postAction(request, "apply-visual-edit", {
      source: sourceRef,
      intent,
      includeContent: true,
    });
    expect(preview.persisted).toBe(false);
    expect(preview.result).toMatchObject({ status: "applied", changed: true });
    expect(preview.proposedDiff).toBeDefined();
    expect(fs.readFileSync(path.join(rootPath, sourcePath), "utf8")).toContain(
      'color: "red"',
    );

    await postAction(request, "grant-localhost-write-consent", {
      designId,
      connectionId,
    });
    const persisted = await postAction(request, "apply-visual-edit", {
      source: sourceRef,
      intent,
      persist: true,
    });
    expect(persisted.persisted).toBe(true);
    expect(fs.readFileSync(path.join(rootPath, sourcePath), "utf8")).toContain(
      'color: "blue"',
    );
    await expect
      .poll(() => viteChangedFiles)
      .toContain(path.join(rootPath, sourcePath));
    await page.reload({ waitUntil: "domcontentloaded" });
    const reloadedFrame = page
      .locator(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
      )
      .contentFrame();
    await expect(reloadedFrame.locator("[data-card]")).toHaveCSS(
      "color",
      "rgb(0, 0, 255)",
    );
  });
});
