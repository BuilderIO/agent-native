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
  fs.mkdirSync(path.join(process.cwd(), ".tmp"), { recursive: true });
  const rootPath = fs.mkdtempSync(
    path.join(process.cwd(), ".tmp", "url-react-"),
  );
  fs.mkdirSync(path.join(rootPath, "src"));
  fs.writeFileSync(
    path.join(rootPath, "index.html"),
    '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  );
  fs.writeFileSync(
    path.join(rootPath, "src/main.tsx"),
    'import { createRoot } from "react-dom/client"; import { App } from "./App"; createRoot(document.getElementById("root")!).render(<App />);',
  );
  fs.writeFileSync(
    path.join(rootPath, "src/App.tsx"),
    `import { useState } from "react";\nconst initialCards = [{ id: "v1", label: "V1" }, { id: "v2", label: "V2" }, { id: "v3", label: "V3" }];\nexport function App() { const [cards] = useState(initialCards); return <main style={{ padding: 24, width: 720 }}><div id="flow" data-source-id="flow-root" data-agent-native-node-id="flow-root" style={{ display: "flex", flexDirection: "column", gap: 16, border: "2px solid #334155", padding: 16, width: 640 }}>{cards.map((card) => <div key={card.id} id={card.id} data-source-id={card.id} data-agent-native-node-id={card.id} style={{ height: 64, border: "2px solid #0f766e", padding: 12 }}>{card.label}</div>)}</div></main>; }`,
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
    const order = () =>
      frame
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
    const reloaded = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    await expect(reloaded.getByText("V1 updated", { exact: true })).toBeVisible(
      { timeout: 15_000 },
    );
    expect(await order()).toEqual(["v2", "v3", "v1"]);
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
