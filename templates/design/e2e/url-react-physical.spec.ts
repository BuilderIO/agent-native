import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";

import {
  prepareDesignConnectManifest,
  startDesignConnectBridge,
  type DesignConnectBridge,
} from "@agent-native/core/testing";
import { expect, test } from "@playwright/test";

import { expandAllLayers, installBridge } from "./helpers";

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate a local port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

test("React URL-backed drag/drop emits semantic handoff and survives coding-agent HMR", async ({
  page,
  request,
}, workerInfo) => {
  const baseURL = workerInfo.project.use.baseURL as string;
  const componentDetailsRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/actions/get-component-details")) {
      componentDetailsRequests.push(request.url());
    }
  });
  fs.mkdirSync(path.join(process.cwd(), ".tmp"), { recursive: true });
  const rootPath = fs.mkdtempSync(
    path.join(process.cwd(), ".tmp", "url-react-"),
  );
  fs.mkdirSync(path.join(rootPath, "src"));
  fs.writeFileSync(
    path.join(rootPath, "index.html"),
    '<!doctype html><html><head><title>React URL physical proof</title></head><body><main id="root"></main><script type="module" src="/src/main.tsx"></script></body></html>',
  );
  fs.writeFileSync(
    path.join(rootPath, "src/main.tsx"),
    'import { hydrateRoot } from "react-dom/client"; import { BrowserRouter } from "react-router"; import { App } from "./App"; let appRoot = hydrateRoot(document, <BrowserRouter><App /></BrowserRouter>); (window as typeof window & { __forceReactDocumentRemount?: () => void }).__forceReactDocumentRemount = () => { appRoot.unmount(); appRoot = hydrateRoot(document, <BrowserRouter><App /></BrowserRouter>); };',
  );
  fs.writeFileSync(
    path.join(rootPath, "src/App.tsx"),
    `import { useState } from "react"; import { useLocation, useNavigate } from "react-router";\nconst initialCards = [{ id: "v1", label: "V1" }, { id: "v2", label: "V2" }, { id: "v3", label: "V3" }];\nexport function App() { const [cards] = useState(initialCards); const location = useLocation(); const navigate = useNavigate(); return <html><head><title>React URL physical proof</title></head><body><main id="root" style={{ padding: 24, width: 720 }}><button type="button" onClick={() => navigate("/next")}>Go to next route</button><p data-route-label>{location.pathname === "/next" ? "Next route" : "Home route"}</p><div id="flow" data-source-id="flow-root" data-agent-native-node-id="flow-root" style={{ display: "flex", flexDirection: "column", gap: 16, border: "2px solid #334155", padding: 16, width: 640 }}>{cards.map((card) => <div key={card.id} id={card.id} data-source-id={card.id} data-agent-native-node-id={card.id} style={{ height: 64, border: "2px solid #0f766e", padding: 12 }}>{card.label}</div>)}</div></main></body></html>; }`,
  );
  const targetPort = await freePort();
  const targetUrl = `http://127.0.0.1:${targetPort}`; // e2e-harness-ignore: allocated live Vite port
  let bridge: DesignConnectBridge | null = null;
  let opened: {
    designId: string;
    bridgeToken: string;
    previewToken: string;
  } | null = null;
  let vite: ReturnType<typeof spawn> | null = null;
  let post:
    | ((
        name: string,
        input: Record<string, unknown>,
      ) => Promise<{
        designId: string;
        bridgeToken: string;
        previewToken: string;
      }>)
    | null = null;
  try {
    fs.writeFileSync(
      path.join(rootPath, "vite.config.ts"),
      `import { defineConfig } from "vite"; export default defineConfig({ server: { host: "127.0.0.1", port: ${targetPort}, strictPort: true, hmr: { host: "127.0.0.1", port: ${targetPort} } } });`,
    );
    const viteProcess = spawn(
      process.execPath,
      [
        path.resolve(
          path.dirname(createRequire(import.meta.url).resolve("vite")),
          "../../bin/vite.js",
        ),
        "--host",
        "127.0.0.1",
        "--port",
        String(targetPort),
        "--strictPort",
      ],
      { cwd: rootPath, stdio: ["ignore", "pipe", "pipe"] },
    );
    let viteError = "";
    vite = viteProcess;
    viteProcess.stderr?.on("data", (chunk) => {
      viteError += String(chunk);
    });
    await expect
      .poll(
        async () => {
          if (viteProcess.exitCode !== null)
            throw new Error(
              `Vite exited with ${viteProcess.exitCode}: ${viteError}`,
            );
          return (await fetch(targetUrl).catch(() => null))?.ok ?? false;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    post = async (name: string, input: Record<string, unknown>) => {
      const response = await request.post(
        `${baseURL}/_agent-native/actions/${name}`,
        { data: input },
      );
      if (!response.ok())
        throw new Error(
          `${name}: ${response.status()} ${await response.text()}`,
        );
      return (await response.json()) as {
        designId: string;
        bridgeToken: string;
        previewToken: string;
      };
    };
    const bridgePort = await freePort();
    const manifest = await prepareDesignConnectManifest({
      root: rootPath,
      url: targetUrl,
      port: bridgePort,
    });
    opened = await post("open-visual-edit", {
      title: "React URL physical proof",
      devServerUrl: manifest.devServerUrl,
      bridgeUrl: manifest.bridgeUrl,
      rootPath,
      routeManifest: manifest,
      paths: ["/"],
      navigate: false,
      publicReadOnly: true,
    });
    bridge = await startDesignConnectBridge(manifest, {
      bridgeToken: opened.bridgeToken,
      previewToken: opened.previewToken,
      allowedOrigins: [new URL(baseURL).origin],
    });
    await page.goto(
      `${baseURL}/visual-edit/${opened.designId}?editorView=overview`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.locator("[data-design-editor]")).toBeVisible({
      timeout: 30_000,
    });
    const call = (name: string, args: Record<string, unknown> = {}) =>
      page.evaluate(
        async ({ name, args }) =>
          await (
            window as typeof window & {
              __agentNativeWebMcp: {
                call: (
                  name: string,
                  args?: Record<string, unknown>,
                ) => Promise<unknown>;
              };
            }
          ).__agentNativeWebMcp.call(name, args),
        { name, args },
      );
    const frame = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    await frame.locator('[data-agent-native-node-id="flow-root"]').waitFor();
    await expect(
      frame.locator('[data-agent-native-edit-overlay="shield"]'),
    ).toBeAttached();
    await expect(
      frame.locator("script[data-agent-native-editor-chrome-bridge]"),
    ).toHaveAttribute("type", "module");
    await expandAllLayers(page);
    await installBridge(page);
    await page.evaluate(() => ((window as any).__bridge = []));
    const waitForAnySelection = async () => {
      const handle = await page.waitForFunction(
        () =>
          [...((window as any).__bridge ?? [])]
            .reverse()
            .find((message: any) => message.type === "element-select") ?? null,
        undefined,
        { timeout: 15_000 },
      );
      return await handle.jsonValue();
    };
    const waitForSelection = async (nodeId: string) => {
      const handle = await page.waitForFunction(
        (id) =>
          [...((window as any).__bridge ?? [])]
            .reverse()
            .find(
              (message: any) =>
                message.type === "element-select" &&
                message.payload?.selector?.includes(
                  `[data-agent-native-node-id="${id}"]`,
                ),
            ) ?? null,
        nodeId,
        { timeout: 15_000 },
      );
      return await handle.jsonValue();
    };
    const clickTarget = frame.locator('[data-agent-native-node-id="v1"]');
    const clickBox = await clickTarget.boundingBox();
    if (!clickBox) throw new Error("missing React selection geometry");
    await page.mouse.click(
      clickBox.x + clickBox.width / 2,
      clickBox.y + clickBox.height / 2,
    );
    const firstSelection = await waitForAnySelection();
    expect(firstSelection.payload.selector).toBeTruthy();
    expect(firstSelection.payload.sourceId).toBeTruthy();
    await page.evaluate(() => ((window as any).__bridge = []));
    await page.keyboard.down(
      process.platform === "darwin" ? "Meta" : "Control",
    );
    try {
      await page.mouse.click(
        clickBox.x + clickBox.width / 2,
        clickBox.y + clickBox.height / 2,
      );
    } finally {
      await page.keyboard.up(
        process.platform === "darwin" ? "Meta" : "Control",
      );
    }
    const selected = await waitForSelection("v1");
    expect(selected.payload.sourceId).toBe("v1");
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]').filter({
        hasText: "V1",
      }),
    ).toBeVisible();
    const order = (previewFrame = frame) =>
      previewFrame
        .locator(
          '[data-agent-native-node-id="flow-root"] > [data-agent-native-node-id]',
        )
        .evaluateAll((els) =>
          els.map((el) => el.getAttribute("data-agent-native-node-id")),
        );
    const sourceBox = await frame
      .locator('[data-agent-native-node-id="v1"]')
      .boundingBox();
    const targetBox = await frame
      .locator('[data-agent-native-node-id="v3"]')
      .boundingBox();
    if (!sourceBox || !targetBox) throw new Error("missing React geometry");
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2 + 10,
      sourceBox.y + sourceBox.height / 2 + 6,
      { steps: 6 },
    );
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height * 0.85,
      { steps: 20 },
    );
    const guide = await frame
      .locator("[data-agent-native-insertion-guide]")
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return {
            display: getComputedStyle(el).display,
            width: r.width,
            height: r.height,
          };
        }),
      );
    expect(
      guide.some((x) => x.display !== "none" && x.width > 0 && x.height > 0),
    ).toBe(true);
    await page.mouse.up();
    await expect.poll(order).toEqual(["v2", "v3", "v1"]);
    await expect
      .poll(
        async () =>
          (
            (await call("get-visual-edit-prompt")) as {
              result?: { pendingEditCount?: number };
            }
          ).result?.pendingEditCount ?? -1,
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    const prompt = await call("get-visual-edit-prompt");
    expect((prompt as { result: { prompt: string } }).result.prompt).toContain(
      '"operation": "move"',
    );
    expect((prompt as { result: { prompt: string } }).result.prompt).toContain(
      "semantic-source-change",
    );
    const appPath = path.join(rootPath, "src/App.tsx");
    const before = fs.readFileSync(appPath, "utf8");
    const after = before.replace(
      'const initialCards = [{ id: "v1", label: "V1" }, { id: "v2", label: "V2" }, { id: "v3", label: "V3" }];',
      'const initialCards = [{ id: "v2", label: "V2" }, { id: "v3", label: "V3" }, { id: "v1", label: "V1 updated" }];',
    );
    if (after === before)
      throw new Error("React source edit did not match App.tsx");
    fs.writeFileSync(appPath, after);
    await expect(frame.getByText("V1 updated", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-design-editor]")).toBeVisible({
      timeout: 30_000,
    });
    await installBridge(page);
    const reloaded = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    await expect(reloaded.getByText("V1 updated", { exact: true })).toBeVisible(
      { timeout: 15_000 },
    );
    await expect
      .poll(() => order(reloaded), { timeout: 15_000 })
      .toEqual(["v2", "v3", "v1"]);
    await expect
      .poll(
        () =>
          page
            .locator("iframe[data-design-preview-iframe]")
            .first()
            .evaluate((iframe) => getComputedStyle(iframe).pointerEvents),
        { timeout: 15_000 },
      )
      .toBe("auto");
    // React Router/framework hydration can replace the whole document body
    // after the iframe first boots. The editor host lives outside that tree;
    // prove a real physical click still selects after both a route render and
    // a document-level React unmount/hydrate remount rather than trusting the
    // initial bridge handshake.
    const reloadedFrame = await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .elementHandle()
      .then((iframe) => iframe?.contentFrame());
    if (!reloadedFrame) throw new Error("missing reloaded React frame");
    await reloadedFrame.evaluate(() => {
      window.history.pushState({}, "", "/next");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(reloaded.locator("[data-route-label]")).toHaveText(
      "Next route",
    );
    await reloadedFrame.evaluate(() => {
      const remount = (
        window as typeof window & {
          __forceReactDocumentRemount?: () => void;
        }
      ).__forceReactDocumentRemount;
      if (!remount) throw new Error("missing React document remount hook");
      remount();
    });
    await expect(
      reloaded.locator("[data-agent-native-editor-chrome-host]"),
    ).toHaveCount(1);
    await expect(
      reloaded.locator('[data-agent-native-edit-overlay="shield"]'),
    ).toBeAttached();
    await reloaded.locator("body").evaluate(() => {
      document
        .querySelector("[data-agent-native-editor-chrome-host]")
        ?.remove();
    });
    await expect(
      reloaded.locator("[data-agent-native-editor-chrome-host]"),
    ).toHaveCount(1);
    await reloaded.locator("body").evaluate(() => {
      const bridgeScript = document.querySelector(
        "script[data-agent-native-editor-chrome-bridge]",
      );
      if (!bridgeScript) throw new Error("missing editor bridge script");
      document.head.appendChild(bridgeScript.cloneNode(true));
    });
    await expect(
      reloaded.locator('[data-agent-native-edit-overlay="shield"]'),
    ).toBeAttached();
    await page.evaluate(() => ((window as any).__bridge = []));
    const healedTarget = reloaded.locator('[data-agent-native-node-id="v1"]');
    const healedBox = await healedTarget.boundingBox();
    if (!healedBox)
      throw new Error("missing post-hydration selection geometry");
    const healedModifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(healedModifier);
    try {
      await page.mouse.click(
        healedBox.x + healedBox.width / 2,
        healedBox.y + healedBox.height / 2,
      );
    } finally {
      await page.keyboard.up(healedModifier);
    }
    const healedSelection = await waitForSelection("v1");
    expect(healedSelection.payload.sourceId).toBe("v1");
    expect(
      await page.evaluate(
        () =>
          ((window as any).__bridge ?? []).filter(
            (message: any) =>
              message.type === "element-select" &&
              message.intent?.source === "pointer",
          ).length,
      ),
    ).toBe(1);

    // A framework hydration recovery can replace the documentElement itself,
    // which disconnects observers attached only to the previous <html> node.
    await reloaded.locator("body").evaluate(() => {
      window.setTimeout(() => {
        const currentDocumentElement = document.documentElement;
        const replacement = currentDocumentElement.cloneNode(
          true,
        ) as HTMLElement;
        replacement
          .querySelector("[data-agent-native-editor-chrome-host]")
          ?.remove();
        currentDocumentElement.replaceWith(replacement);
      }, 0);
    });
    await expect(
      reloaded.locator("[data-agent-native-editor-chrome-host]"),
    ).toHaveCount(1);
    await expect(
      reloaded.locator('[data-agent-native-edit-overlay="shield"]'),
    ).toBeAttached();
    await page.evaluate(() => ((window as any).__bridge = []));
    const rootReplacementTarget = reloaded.locator(
      '[data-agent-native-node-id="v2"]',
    );
    const rootReplacementBox = await rootReplacementTarget.boundingBox();
    if (!rootReplacementBox)
      throw new Error("missing document-root replacement geometry");
    await page.keyboard.down(healedModifier);
    try {
      await page.mouse.click(
        rootReplacementBox.x + rootReplacementBox.width / 2,
        rootReplacementBox.y + rootReplacementBox.height / 2,
      );
    } finally {
      await page.keyboard.up(healedModifier);
    }
    const rootReplacementSelection = await waitForSelection("v2");
    expect(rootReplacementSelection.payload.sourceId).toBe("v2");
    expect(componentDetailsRequests).toEqual([]);
  } finally {
    await bridge?.server.close();
    vite?.kill();
    if (opened && post)
      await post("delete-design", { id: opened.designId }).catch(
        () => undefined,
      );
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});
