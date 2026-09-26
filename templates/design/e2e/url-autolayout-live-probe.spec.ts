import fs from "node:fs";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";

import {
  prepareDesignConnectManifest,
  startDesignConnectBridge,
  type DesignConnectBridge,
} from "@agent-native/core/testing";
import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

async function listen(server: Server): Promise<number> {
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("server did not expose a port"));
        return;
      }
      resolve(address.port);
    });
  });
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test.describe("URL-backed live auto-layout probe", () => {
  let rootPath = "";
  let devServer: Server | null = null;
  let bridge: DesignConnectBridge | null = null;
  let targetUrl = "";
  let baseURL = "";
  let designId = "";

  async function postAction(
    request: APIRequestContext,
    name: string,
    input: Record<string, unknown>,
  ) {
    const response = await request.post(
      `${baseURL}/_agent-native/actions/${name}`,
      {
        data: input,
        headers: { "Content-Type": "application/json" },
      },
    );
    if (!response.ok())
      throw new Error(`${name}: ${response.status()} ${await response.text()}`);
    return await response.json();
  }

  test.beforeAll(async ({ request }, workerInfo) => {
    baseURL = workerInfo.project.use.baseURL as string;
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "url-autolayout-local-"));
    const source = `<!doctype html><html><head><style>
      html,body{margin:0;background:#fff}main{padding:24px;width:720px}
      #flow{display:flex;flex-direction:column;gap:16px;border:2px solid #334155;padding:16px;width:640px}
      [data-card]{height:64px;border:2px solid #0f766e;background:#ccfbf1;padding:12px;box-sizing:border-box}
      #group-grid{display:grid;grid-template-columns:repeat(4,80px);grid-template-rows:repeat(3,60px);gap:10px;border:2px solid #7c3aed;padding:10px;width:360px;margin-top:24px}
      [data-group-card]{background:#ddd6fe;border:2px solid #6d28d9;box-sizing:border-box}
      #group-occupied{grid-column:3 / 5;grid-row:2;background:#fed7aa;border-color:#c2410c}
    </style></head><body><main>
      <div id="flow" data-source-id="flow-root" data-agent-native-node-id="flow-root" data-agent-native-layer-name="Flow root" data-source-file="index.html" data-source-line="1" data-source-column="1"><div id="v1" data-source-id="v1" data-agent-native-node-id="v1" data-agent-native-layer-name="V1" data-source-file="index.html" data-source-line="1" data-source-column="2" data-card>V1</div><div id="v2" data-source-id="v2" data-agent-native-node-id="v2" data-agent-native-layer-name="V2" data-source-file="index.html" data-source-line="1" data-source-column="3" data-card>V2</div><div id="v3" data-source-id="v3" data-agent-native-node-id="v3" data-agent-native-layer-name="V3" data-source-file="index.html" data-source-line="1" data-source-column="4" data-card>V3</div></div>
      <div id="group-grid" data-source-id="group-grid" data-agent-native-node-id="group-grid" data-source-file="index.html" data-source-line="1" data-source-column="5"><div id="group-occupied" data-source-id="group-occupied" data-agent-native-node-id="group-occupied" data-agent-native-layer-name="Occupied" data-source-file="index.html" data-source-line="1" data-source-column="8" data-group-card style="grid-column:3 / 5;grid-row:2">Occupied</div><div id="group-a" data-source-id="group-a" data-agent-native-node-id="group-a" data-agent-native-layer-name="Group A" data-source-file="index.html" data-source-line="1" data-source-column="6" data-group-card style="grid-column:1;grid-row:1">A</div><div id="group-b" data-source-id="group-b" data-agent-native-node-id="group-b" data-agent-native-layer-name="Group B" data-source-file="index.html" data-source-line="1" data-source-column="7" data-group-card style="grid-column:2;grid-row:1">B</div></div>
    </main></body></html>`;
    fs.writeFileSync(path.join(rootPath, "index.html"), source);
    devServer = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(path.join(rootPath, "index.html"), "utf8"));
    });
    const devPort = await listen(devServer);
    targetUrl = `http://127.0.0.1:${devPort}`; // e2e-harness-ignore - the probe owns an ephemeral loopback app server.
    const portProbe = http.createServer();
    const bridgePort = await listen(portProbe);
    await closeServer(portProbe);
    const manifest = await prepareDesignConnectManifest({
      root: rootPath,
      url: targetUrl,
      port: bridgePort,
    });
    const opened = await postAction(request, "open-visual-edit", {
      title: "URL auto-layout local probe",
      devServerUrl: manifest.devServerUrl,
      bridgeUrl: manifest.bridgeUrl,
      rootPath,
      routeManifest: manifest,
      paths: ["/"],
      navigate: false,
      publicReadOnly: false,
    });
    designId = opened.designId;
    bridge = await startDesignConnectBridge(manifest, {
      bridgeToken: opened.bridgeToken,
      previewToken: opened.previewToken,
      allowedOrigins: [new URL(baseURL).origin],
    });
  });

  test.afterAll(async ({ request }) => {
    if (designId)
      await postAction(request, "delete-design", { id: designId }).catch(
        () => undefined,
      );
    await closeServer(bridge?.server ?? null);
    await closeServer(devServer);
    if (rootPath) fs.rmSync(rootPath, { recursive: true, force: true });
  });

  test("opens signed-out capability and inspects URL-backed frames", async ({
    page,
  }) => {
    page.on("console", (message) => {
      if (
        message.text().includes("dnd:") ||
        message.text().includes("URL probe chat")
      ) {
        console.log("URL probe console", message.text());
      }
    });
    page.on("pageerror", (error) =>
      console.log("URL probe page error", error.message),
    );
    page.on("requestfailed", (request) =>
      console.log(
        "URL probe request failed",
        request.url(),
        request.failure()?.errorText,
      ),
    );
    page.on("request", (request) => {
      if (
        /\/actions\/(read-local-file|write-local-file|request-localhost-write-consent)/.test(
          request.url(),
        )
      ) {
        console.log(
          "URL probe action request",
          request.method(),
          request.url(),
        );
      }
    });
    page.on("response", (response) => {
      if (
        /\/actions\/(read-local-file|write-local-file|request-localhost-write-consent)/.test(
          response.url(),
        )
      ) {
        console.log(
          "URL probe action response",
          response.status(),
          response.url(),
        );
      }
    });
    await page.goto(`${baseURL}/visual-edit/${designId}?editorView=overview`, {
      waitUntil: "domcontentloaded",
    });
    try {
      await expect(page.locator("[data-design-editor]")).toBeVisible({
        timeout: 90_000,
      });
    } catch (error) {
      console.log(
        "URL probe editor timeout",
        JSON.stringify({
          url: page.url(),
          title: await page.title(),
          body: (await page.locator("body").innerText()).slice(0, 1000),
        }),
      );
      throw error;
    }
    await page.evaluate(() => {
      window.__DND_DEBUG = true;
      (
        window as typeof window & { __urlProbeMessages?: unknown[] }
      ).__urlProbeMessages = [];
      window.addEventListener("message", (event) => {
        const type = event.data?.type;
        if (typeof type === "string" && type.includes("structure")) {
          (
            window as typeof window & { __urlProbeMessages?: unknown[] }
          ).__urlProbeMessages?.push({ type, data: event.data });
        }
      });
    });
    const call = (name: string, args: Record<string, unknown> = {}) =>
      page.evaluate(
        async ({ name, args }) => {
          const helper = (
            window as typeof window & {
              __agentNativeWebMcp?: {
                call: (
                  name: string,
                  args?: Record<string, unknown>,
                ) => Promise<unknown>;
              };
            }
          ).__agentNativeWebMcp;
          if (!helper) throw new Error("missing WebMCP helper");
          return await helper.call(name, args);
        },
        { name, args },
      );
    console.log(
      "URL probe webmcp",
      await page.evaluate(
        () =>
          (
            window as typeof window & {
              __agentNativeWebMcpStatus?: unknown;
            }
          ).__agentNativeWebMcpStatus,
      ),
    );
    console.log(
      "URL probe frames",
      await page.locator("iframe[data-design-preview-iframe]").count(),
    );
    console.log(
      "URL probe iframe urls",
      await page
        .locator("iframe[data-design-preview-iframe]")
        .evaluateAll((frames) =>
          frames.map((frame) => frame.getAttribute("src")),
        ),
    );
    console.log(
      "URL probe tools",
      JSON.stringify(
        await page.evaluate(async () => {
          const tools = await (
            window as typeof window & {
              __agentNativeWebMcp?: {
                tools: () => Promise<Array<{ name?: string }> | undefined>;
              };
            }
          ).__agentNativeWebMcp?.tools();
          return tools?.filter((tool: { name?: string }) =>
            [
              "get-visual-edit-prompt",
              "read-local-file",
              "request-localhost-write-consent",
              "write-local-file",
            ].includes(tool.name ?? ""),
          );
        }),
      ),
    );
    console.log(
      "URL probe prompt",
      JSON.stringify(await call("get-visual-edit-prompt")),
    );
    const initialFrame = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    console.log(
      "URL probe ids",
      await initialFrame.locator("[data-source-id]").evaluateAll((els) =>
        els.map((el) => ({
          id: el.getAttribute("data-source-id"),
          text: el.textContent,
          rect: el.getBoundingClientRect().toJSON(),
        })),
      ),
    );
    const designDump = await page.request
      .get(`${baseURL}/_agent-native/actions/get-design?id=${designId}`)
      .then((response) => response.json());
    const sourceMetadata = JSON.parse(designDump.data) as {
      sourceType?: string;
      connectionId?: string;
      screenMetadata?: Record<string, { sourceType?: string }>;
    };
    expect(sourceMetadata.sourceType).toBe("localhost");
    const screenId = Object.keys(sourceMetadata.screenMetadata ?? {})[0];
    expect(screenId).toBeTruthy();
    expect(sourceMetadata.screenMetadata?.[screenId!]?.sourceType).toBe(
      "localhost",
    );
    const connectionId = sourceMetadata.connectionId;
    expect(connectionId).toBeTruthy();
    console.log(
      "URL probe source metadata",
      JSON.stringify({
        data: designDump.data,
        files: (designDump.files ?? []).map(
          (file: { id?: string; filename?: string; content?: string }) => ({
            id: file.id,
            filename: file.filename,
            content: file.content?.slice(0, 120),
          }),
        ),
      }),
    );

    const order = () =>
      page
        .locator("iframe[data-design-preview-iframe]")
        .contentFrame()
        .locator(
          '[data-agent-native-node-id="flow-root"] > [data-agent-native-node-id]',
        )
        .evaluateAll((els) =>
          els.map((el) => el.getAttribute("data-agent-native-node-id")),
        );
    const frame = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    const source = frame.locator('[data-agent-native-node-id="v1"]');
    const target = frame.locator('[data-agent-native-node-id="v3"]');
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    if (!sourceBox || !targetBox)
      throw new Error("URL probe drag boxes missing");
    const diskBeforeDrag = fs.readFileSync(
      path.join(rootPath, "index.html"),
      "utf8",
    );
    const visualEditState = async () => {
      const result = (await call("get-visual-edit-prompt")) as {
        result?: { pendingEditCount?: number; status?: string };
      };
      return {
        pendingEditCount: result.result?.pendingEditCount ?? -1,
        status: result.result?.status ?? "unknown",
      };
    };
    const pendingEditCount = async () =>
      (await visualEditState()).pendingEditCount;
    const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(primaryModifier);
    await page.mouse.click(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.keyboard.up(primaryModifier);
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
    const heldGuides = await frame
      .locator("[data-agent-native-insertion-guide]")
      .evaluateAll((els) =>
        els.map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            display: getComputedStyle(el).display,
            width: rect.width,
            height: rect.height,
            borderTop: getComputedStyle(el).borderTopWidth,
          };
        }),
      );
    console.log("URL probe held insertion guides", JSON.stringify(heldGuides));
    expect(
      heldGuides.some(
        (guide) =>
          guide.width > 0 && guide.height > 0 && guide.display !== "none",
      ),
    ).toBe(true);
    await page.mouse.up();
    console.log(
      "URL probe structure messages",
      JSON.stringify(
        await page.evaluate(
          () =>
            (window as typeof window & { __urlProbeMessages?: unknown[] })
              .__urlProbeMessages,
        ),
      ),
    );
    await expect.poll(order, { timeout: 5_000 }).toEqual(["v2", "v3", "v1"]);
    console.log("URL probe order after drag", await order());
    await expect.poll(pendingEditCount, { timeout: 5_000 }).toBeGreaterThan(0);
    const promptAfterDrag = await call("get-visual-edit-prompt");
    expect(promptAfterDrag).toMatchObject({ result: { status: "ready" } });
    expect(await pendingEditCount()).toBeGreaterThan(0);
    console.log("URL probe prompt after drag", JSON.stringify(promptAfterDrag));
    expect(fs.readFileSync(path.join(rootPath, "index.html"), "utf8")).toBe(
      diskBeforeDrag,
    );
    console.log("URL probe source on disk changed", false);

    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(order, { timeout: 10_000 }).toEqual(["v1", "v2", "v3"]);
    await expect.poll(visualEditState, { timeout: 10_000 }).toEqual({
      pendingEditCount: 0,
      status: "empty",
    });
    expect(fs.readFileSync(path.join(rootPath, "index.html"), "utf8")).toBe(
      diskBeforeDrag,
    );
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(order, { timeout: 10_000 }).toEqual(["v2", "v3", "v1"]);
    await expect
      .poll(visualEditState, { timeout: 10_000 })
      .toMatchObject({ status: "ready" });
    await expect.poll(pendingEditCount, { timeout: 10_000 }).toBeGreaterThan(0);

    const unloadGuarded = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(unloadGuarded).toBe(true);
    console.log("URL probe pending unload guard", unloadGuarded);

    const applyUpdates = page.getByRole("button", {
      name: "Apply design updates",
      exact: true,
    });
    await expect(applyUpdates).toBeVisible({ timeout: 10_000 });
    console.log(
      "URL probe chat frame state",
      await page.evaluate(() => ({
        parentIsSelf: window.parent === window,
        frameElement: Boolean(window.frameElement),
        search: window.location.search,
      })),
    );
    await page.evaluate(() => {
      const state = window as typeof window & {
        __urlProbeHandoff?: {
          submitMessageId: string;
          tabId?: string;
          message?: string;
          context?: string;
        };
      };
      window.addEventListener("message", (event) => {
        const payload = event.data;
        if (payload?.type) {
          console.log("URL probe chat message", payload.type);
        }
        const submitMessageId = payload?.data?.submitMessageId;
        if (
          payload?.type !== "agentNative.submitChat" ||
          typeof submitMessageId !== "string"
        ) {
          return;
        }
        state.__urlProbeHandoff = {
          submitMessageId,
          tabId:
            typeof payload.data.tabId === "string"
              ? payload.data.tabId
              : undefined,
          message:
            typeof payload.data.message === "string"
              ? payload.data.message
              : undefined,
          context:
            typeof payload.data.context === "string"
              ? payload.data.context
              : undefined,
        };
        window.dispatchEvent(
          new CustomEvent("agentNative.chatSubmitResult", {
            detail: { submitMessageId, delivered: true },
          }),
        );
      });
    });
    await applyUpdates.click();
    console.log("URL probe started Apply design updates handoff");
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            document.body.innerText.includes("Verifying source and runtime"),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    console.log(
      "URL probe apply state after 1s",
      await page.evaluate(() => ({
        toolbar: document.querySelector(
          "[data-design-pending-visual-style-toolbar]",
        )?.textContent,
        dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map(
          (dialog) => ({
            text: dialog.textContent,
            hidden: (dialog as HTMLElement).hidden,
          }),
        ),
        body: document.body.innerText.includes("Verifying source and runtime"),
      })),
    );
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Boolean(
              (window as typeof window & { __urlProbeHandoff?: unknown })
                .__urlProbeHandoff,
            ),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    const sourceHandoff = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __urlProbeHandoff?: {
              submitMessageId?: string;
              message?: string;
              context?: string;
            };
          }
        ).__urlProbeHandoff,
    );
    expect(sourceHandoff?.submitMessageId).toBeTruthy();
    expect(sourceHandoff?.message).toContain("source");
    expect(sourceHandoff?.context).toContain("index.html");
    expect(sourceHandoff?.context).toContain('"sourceId": "v1"');
    expect(sourceHandoff?.context).toContain('"anchorSourceId": "v3"');
    expect(sourceHandoff?.context).toContain('"dropMode": "flow-insert"');
    console.log("URL probe source handoff acknowledged", sourceHandoff);

    const readResult = (await call("read-local-file", {
      designId,
      connectionId,
      path: "index.html",
    })) as {
      result?: { content?: string; versionHash?: string };
    };
    const sourceVersionHash = readResult.result?.versionHash;
    expect(sourceVersionHash).toMatch(/^[a-f0-9]{64}$/i);
    const sourceCardPattern = (id: string) =>
      new RegExp(`<div id="${id}"[^>]*>V${id.slice(1)}</div>`);
    const sourceV1 = diskBeforeDrag.match(sourceCardPattern("v1"))?.[0];
    expect(sourceV1).toBeTruthy();
    const sourceWithoutV1 = diskBeforeDrag.replace(sourceV1!, "");
    const sourceV3 = sourceWithoutV1.match(sourceCardPattern("v3"))?.[0];
    expect(sourceV3).toBeTruthy();
    const reorderedSource = sourceWithoutV1.replace(
      sourceV3!,
      `${sourceV3}${sourceV1}`,
    );
    expect(
      [...reorderedSource.matchAll(/\sid="(v[123])"/g)].map(
        (match) => match[1],
      ),
    ).toEqual(["v2", "v3", "v1"]);

    const consentRequest = (await call("request-localhost-write-consent", {
      designId,
      connectionId,
      files: ["index.html"],
    })) as {
      ok: boolean;
      result?: { surfaced?: boolean; alreadyGranted?: boolean };
    };
    console.log(
      "URL probe write consent request",
      JSON.stringify(consentRequest),
    );
    const consent = page.getByRole("dialog", { name: "Allow file writes" });
    expect(consentRequest).toMatchObject({
      ok: true,
      result: { surfaced: true },
    });
    await expect(consent).toBeVisible({ timeout: 10_000 });
    await consent.getByRole("button", { name: "Allow writes" }).click();
    // Wait for the close so the following bridge write cannot race the grant.
    await expect(consent).toBeHidden({ timeout: 10_000 });
    console.log("URL probe granted write consent");
    const writeResult = await call("write-local-file", {
      designId,
      connectionId,
      relPath: "index.html",
      content: reorderedSource,
      expectedVersionHash: sourceVersionHash,
      requireExpectedVersionHash: true,
    });
    console.log("URL probe source write result", JSON.stringify(writeResult));
    expect(writeResult).toMatchObject({ ok: true });

    const diskAfterApply = fs.readFileSync(
      path.join(rootPath, "index.html"),
      "utf8",
    );
    expect(diskAfterApply).toBe(reorderedSource);
    console.log(
      "URL probe source order after bridge write",
      [...diskAfterApply.matchAll(/\sid="(v[123])"/g)].map((match) => match[1]),
    );
    await expect
      .poll(
        async () => {
          const result = (await call("get-visual-edit-prompt")) as {
            result?: { pendingEditCount?: number };
          };
          return result.result?.pendingEditCount ?? -1;
        },
        { timeout: 30_000 },
      )
      .toBe(0);
    console.log("URL probe pending source verification cleared");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-design-editor]")).toBeVisible({
      timeout: 30_000,
    });
    const readReloadedOrder = async () => {
      try {
        return await page
          .locator("iframe[data-design-preview-iframe]")
          .first()
          .contentFrame()
          .locator(
            '[data-agent-native-node-id="flow-root"] > [data-agent-native-node-id]',
          )
          .evaluateAll((els) =>
            els.map((el) => el.getAttribute("data-agent-native-node-id")),
          );
      } catch (error) {
        if (error instanceof Error && /Frame was detached/.test(error.message))
          return null;
        throw error;
      }
    };
    await expect
      .poll(readReloadedOrder, { timeout: 15_000 })
      .toEqual(["v2", "v3", "v1"]);
    console.log("URL probe order after reload", await readReloadedOrder());
    console.log(
      "URL probe prompt after reload",
      JSON.stringify(await call("get-visual-edit-prompt")),
    );
  });

  test("holds a URL-backed grouped grid drag as one pending Apply unit", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1800, height: 1000 });
    await page.goto(`${baseURL}/visual-edit/${designId}?editorView=overview`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-design-editor]")).toBeVisible({
      timeout: 90_000,
    });
    const call = (name: string, args: Record<string, unknown> = {}) =>
      page.evaluate(
        async ({ name, args }) => {
          const helper = (
            window as typeof window & {
              __agentNativeWebMcp?: {
                call: (
                  name: string,
                  args?: Record<string, unknown>,
                ) => Promise<unknown>;
              };
            }
          ).__agentNativeWebMcp;
          if (!helper) throw new Error("missing WebMCP helper");
          return await helper.call(name, args);
        },
        { name, args },
      );
    const designDump = await page.request
      .get(`${baseURL}/_agent-native/actions/get-design?id=${designId}`)
      .then((response) => response.json());
    const sourceMetadata = JSON.parse(designDump.data) as {
      connectionId?: string;
    };
    const connectionId = sourceMetadata.connectionId;
    expect(connectionId).toBeTruthy();
    const frame = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    const iframe = page.locator("iframe[data-design-preview-iframe]").first();
    const groupA = frame.locator('[data-agent-native-node-id="group-a"]');
    const groupB = frame.locator('[data-agent-native-node-id="group-b"]');
    const occupied = frame.locator(
      '[data-agent-native-node-id="group-occupied"]',
    );
    await expect(groupA).toBeVisible({ timeout: 15_000 });
    await expect(
      frame.locator("[data-agent-native-editor-chrome-host]"),
    ).toHaveCount(1, { timeout: 30_000 });
    const iframeSrcBeforeDrag = await iframe.getAttribute("src");
    await iframe.evaluate((element) => {
      element.setAttribute("data-iframe-identity-regression", "stable");
    });
    let componentDetailsRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().includes("/actions/get-component-details")
      ) {
        componentDetailsRequests += 1;
      }
    });
    const diskBeforeDrag = fs.readFileSync(
      path.join(rootPath, "index.html"),
      "utf8",
    );
    const visualEditState = async () => {
      const result = (await call("get-visual-edit-prompt")) as {
        result?: { pendingEditCount?: number; status?: string };
      };
      return {
        pendingEditCount: result.result?.pendingEditCount ?? -1,
        status: result.result?.status ?? "unknown",
      };
    };
    const pendingEditCount = async () =>
      (await visualEditState()).pendingEditCount;
    const gridPlacement = () =>
      frame.locator("[data-group-card]").evaluateAll((els) =>
        Object.fromEntries(
          els.map((el) => {
            const style = getComputedStyle(el);
            return [
              el.id,
              {
                columnStart: style.gridColumnStart,
                columnEnd: style.gridColumnEnd,
                rowStart: style.gridRowStart,
                rowEnd: style.gridRowEnd,
              },
            ];
          }),
        ),
      );
    const gridOrder = () =>
      frame.locator("[data-group-card]").evaluateAll((els) =>
        els
          .map((el) => {
            const style = getComputedStyle(el);
            return {
              id: el.id,
              row: Number.parseInt(style.gridRowStart, 10),
              column: Number.parseInt(style.gridColumnStart, 10),
            };
          })
          .sort((a, b) => a.row - b.row || a.column - b.column)
          .map((entry) => entry.id),
      );
    const gridPlacementBeforeDrag = await gridPlacement();
    const gridOrderBeforeDrag = await gridOrder();
    const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";
    const groupABox = await groupA.boundingBox();
    const groupBBox = await groupB.boundingBox();
    const targetBox = await occupied.boundingBox();
    if (!groupABox || !groupBBox || !targetBox)
      throw new Error("Grouped URL probe selection boxes missing");
    await page.keyboard.down(primaryModifier);
    await page.mouse.click(
      groupABox.x + groupABox.width / 2,
      groupABox.y + groupABox.height / 2,
    );
    await page.keyboard.up(primaryModifier);
    await page.waitForTimeout(600);
    await page.keyboard.down("Shift");
    await page.keyboard.down(primaryModifier);
    await page.mouse.click(
      groupBBox.x + groupBBox.width / 2,
      groupBBox.y + groupBBox.height / 2,
    );
    await page.keyboard.up(primaryModifier);
    await page.keyboard.up("Shift");
    const selectedRows = page.locator(
      '[role="treeitem"][aria-selected="true"]',
    );
    await expect
      .poll(async () => await selectedRows.allTextContents(), {
        timeout: 5_000,
      })
      .toEqual(
        expect.arrayContaining([
          expect.stringContaining("Group A"),
          expect.stringContaining("Group B"),
        ]),
      );
    await page.waitForTimeout(500);
    expect(componentDetailsRequests).toBe(0);
    await expect(iframe).toHaveAttribute(
      "data-iframe-identity-regression",
      "stable",
    );
    await expect(iframe).toHaveAttribute("src", iframeSrcBeforeDrag ?? "");
    await page.mouse.move(
      groupABox.x + groupABox.width / 2,
      groupABox.y + groupABox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      groupABox.x + groupABox.width / 2 + 10,
      groupABox.y + groupABox.height / 2 + 6,
      { steps: 6 },
    );
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 20 },
    );
    const heldGuides = await frame
      .locator("[data-agent-native-insertion-guide]")
      .evaluateAll((els) =>
        els.map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            display: getComputedStyle(el).display,
            width: rect.width,
            height: rect.height,
          };
        }),
      );
    await expect(iframe).toHaveAttribute(
      "data-iframe-identity-regression",
      "stable",
    );
    await expect(iframe).toHaveAttribute("src", iframeSrcBeforeDrag ?? "");
    expect(
      heldGuides.some(
        (guide) =>
          guide.width > 0 && guide.height > 0 && guide.display !== "none",
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.resolve(process.cwd(), "../../.tmp/url-grouped-held.png"),
      fullPage: true,
    });
    await page.mouse.up();
    await expect.poll(pendingEditCount, { timeout: 10_000 }).toBe(1);
    const prompt = (await call("get-visual-edit-prompt")) as {
      result?: { prompt?: string; status?: string };
    };
    expect(prompt).toMatchObject({ result: { status: "ready" } });
    expect(prompt.result?.prompt).toContain('"transactionId"');
    expect(prompt.result?.prompt).toContain("group-a");
    expect(prompt.result?.prompt).toContain("group-b");
    expect(fs.readFileSync(path.join(rootPath, "index.html"), "utf8")).toBe(
      diskBeforeDrag,
    );

    const runtimeStyles = Object.fromEntries(
      await frame
        .locator("[data-group-card]")
        .evaluateAll((els) =>
          els.map((el) => [el.id, el.getAttribute("style") ?? ""]),
        ),
    );
    const runtimeGroupOrder = await frame
      .locator("[data-group-card]")
      .evaluateAll((els) => els.map((el) => el.id));
    const gridPlacementAfterDrag = await gridPlacement();
    const gridOrderAfterDrag = await gridOrder();

    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(gridPlacement, { timeout: 10_000 })
      .toEqual(gridPlacementBeforeDrag);
    await expect
      .poll(gridOrder, { timeout: 10_000 })
      .toEqual(gridOrderBeforeDrag);
    await expect.poll(visualEditState, { timeout: 10_000 }).toEqual({
      pendingEditCount: 0,
      status: "empty",
    });
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(gridPlacement, { timeout: 10_000 })
      .toEqual(gridPlacementAfterDrag);
    await expect
      .poll(gridOrder, { timeout: 10_000 })
      .toEqual(gridOrderAfterDrag);
    await expect
      .poll(visualEditState, { timeout: 10_000 })
      .toMatchObject({ status: "ready" });
    await expect.poll(pendingEditCount, { timeout: 10_000 }).toBeGreaterThan(0);
    let sourceWriteCount = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().includes("/webmcp/actions/write-local-file")
      ) {
        sourceWriteCount += 1;
      }
    });
    await page.evaluate(() => {
      const state = window as typeof window & {
        __groupedUrlProbeHandoff?: { context?: string; message?: string };
      };
      window.addEventListener("message", (event) => {
        const payload = event.data;
        const submitMessageId = payload?.data?.submitMessageId;
        if (
          payload?.type !== "agentNative.submitChat" ||
          typeof submitMessageId !== "string"
        ) {
          return;
        }
        state.__groupedUrlProbeHandoff = {
          context:
            typeof payload.data.context === "string"
              ? payload.data.context
              : undefined,
          message:
            typeof payload.data.message === "string"
              ? payload.data.message
              : undefined,
        };
        window.dispatchEvent(
          new CustomEvent("agentNative.chatSubmitResult", {
            detail: { submitMessageId, delivered: true },
          }),
        );
      });
    });
    const applyUpdates = page.getByRole("button", {
      name: "Apply design updates",
      exact: true,
    });
    await expect(applyUpdates).toBeVisible({ timeout: 10_000 });
    await applyUpdates.click();
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            document.body.innerText.includes("Verifying source and runtime"),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Boolean(
              (window as typeof window & { __groupedUrlProbeHandoff?: unknown })
                .__groupedUrlProbeHandoff,
            ),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    const groupedHandoff = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __groupedUrlProbeHandoff?: {
              context?: string;
              message?: string;
            };
          }
        ).__groupedUrlProbeHandoff,
    );
    expect(groupedHandoff?.message).toContain("source");
    expect(groupedHandoff?.context).toContain('"sourceId": "group-a"');
    expect(groupedHandoff?.context).toContain('"sourceId": "group-b"');
    expect(groupedHandoff?.context).toContain('"transactionId"');

    const readResult = (await call("read-local-file", {
      designId,
      connectionId,
      path: "index.html",
    })) as { result?: { content?: string; versionHash?: string } };
    const sourceVersionHash = readResult.result?.versionHash;
    expect(sourceVersionHash).toMatch(/^[a-f0-9]{64}$/i);
    const sourceWithRuntimeStyles = Object.entries(runtimeStyles).reduce(
      (html, [id, style]) =>
        html.replace(
          new RegExp(`(<div id="${id}"[^>]*style=")[^"]*(")`),
          `$1${style}$2`,
        ),
      diskBeforeDrag,
    );
    const groupCardPattern =
      /<div id="group-(?:a|b|occupied)"[^>]*>[^<]*<\/div>/g;
    const groupCards = [...sourceWithRuntimeStyles.matchAll(groupCardPattern)];
    expect(groupCards).toHaveLength(3);
    const cardsById = Object.fromEntries(
      groupCards.map((match) => {
        const card = match[0];
        const id = card.match(/id="([^"]+)"/)?.[1];
        if (!id) throw new Error("Grouped source card is missing its id");
        return [id, card];
      }),
    );
    let groupCardIndex = 0;
    const sourceWithRuntimeState = sourceWithRuntimeStyles.replace(
      groupCardPattern,
      () => cardsById[runtimeGroupOrder[groupCardIndex++]]!,
    );
    expect(sourceWithRuntimeState).not.toBe(diskBeforeDrag);
    const consentRequest = (await call("request-localhost-write-consent", {
      designId,
      connectionId,
      files: ["index.html"],
    })) as {
      ok: boolean;
      result?: { surfaced?: boolean; alreadyGranted?: boolean };
    };
    const consent = page.getByRole("dialog", { name: "Allow file writes" });
    expect(consentRequest).toMatchObject({ ok: true });
    if (consentRequest.result?.surfaced) {
      await expect(consent).toBeVisible({ timeout: 10_000 });
      await consent.getByRole("button", { name: "Allow writes" }).click();
      await expect(consent).toBeHidden({ timeout: 10_000 });
    } else {
      expect(consentRequest.result?.alreadyGranted).toBe(true);
    }
    const writeResult = await call("write-local-file", {
      designId,
      connectionId,
      relPath: "index.html",
      content: sourceWithRuntimeState,
      expectedVersionHash: sourceVersionHash,
      requireExpectedVersionHash: true,
    });
    expect(writeResult).toMatchObject({ ok: true });
    expect(sourceWriteCount).toBe(1);
    expect(fs.readFileSync(path.join(rootPath, "index.html"), "utf8")).toBe(
      sourceWithRuntimeState,
    );
    await expect
      .poll(
        async () =>
          (
            (await call("get-visual-edit-prompt")) as {
              result?: { pendingEditCount?: number };
            }
          ).result?.pendingEditCount ?? -1,
        { timeout: 30_000 },
      )
      .toBe(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-design-editor]")).toBeVisible({
      timeout: 30_000,
    });
    const reloadedFrame = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    await expect
      .poll(
        () =>
          reloadedFrame
            .locator("[data-group-card]")
            .evaluateAll((els) =>
              Object.fromEntries(
                els.map((el) => [el.id, el.getAttribute("style") ?? ""]),
              ),
            ),
        { timeout: 15_000 },
      )
      .toEqual(runtimeStyles);
    await page.screenshot({
      path: path.resolve(
        process.cwd(),
        "../../.tmp/url-grouped-after-reload.png",
      ),
      fullPage: true,
    });
    await expect
      .poll(
        async () =>
          (
            (await call("get-visual-edit-prompt")) as {
              result?: { pendingEditCount?: number };
            }
          ).result?.pendingEditCount ?? -1,
        { timeout: 10_000 },
      )
      .toBe(0);
  });
});
