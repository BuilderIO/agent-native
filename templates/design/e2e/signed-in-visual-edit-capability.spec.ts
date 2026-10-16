import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import path from "node:path";

import {
  prepareDesignConnectManifest,
  startDesignConnectBridge,
  type DesignConnectBridge,
} from "@agent-native/core/testing";

import { e2eBaseURL } from "./base-url";
import { App, expect, test } from "./rails";

const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
const AUTH_STATE_PATH = process.env.E2E_AUTH_DIR
  ? path.join(path.resolve(process.env.E2E_AUTH_DIR), "state.json")
  : path.join(import.meta.dirname, ".auth", "state.json");
const E2E_MENTION_EMAIL = "alice+e2e@local.test";
const E2E_PASSWORD = "password-e2e-1234";
const BRIDGE_TOKEN = `signed-in-visual-edit-${randomUUID()}`;

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve the local Visual Edit test server port");
  }
  return address.port;
}

async function closeServer(server: Server | null | undefined): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

// fixme: fails in CI on current main: {"error":"Browser visual-edit requests cannot include bridge credentials. Register the bridge through a trusted CLI or
test.fixme("signing in after opening a scoped Visual Edit link keeps the editor role", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext({
    storageState: AUTH_STATE_PATH,
  });
  const signedInViewerContext = await browser.newContext();
  // The visitor who opens the scoped link gets its own failure watcher; the default page stays unused.
  const visitorContext = await browser.newContext();
  const page = await visitorContext.newPage();
  const visitor = new App(page);
  await visitor.attach();
  let targetServer: Server | null = null;
  let bridge: DesignConnectBridge | null = null;
  let designId: string | undefined;

  try {
    targetServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        "<!doctype html><html><body><main><h1>Signed-in Visual Edit</h1></main></body></html>",
      );
    });
    const targetPort = await listen(targetServer);
    const devServerUrl = `http://127.0.0.1:${targetPort}`; // e2e-harness-ignore - this test owns its ephemeral preview server.

    const bridgePortServer = createServer();
    const bridgePort = await listen(bridgePortServer);
    await closeServer(bridgePortServer);
    const manifest = await prepareDesignConnectManifest({
      root: path.resolve(import.meta.dirname, "fixtures"),
      url: devServerUrl,
      port: bridgePort,
    });
    bridge = await startDesignConnectBridge(manifest, {
      bridgeToken: BRIDGE_TOKEN,
      allowedOrigins: [new URL(BASE_URL).origin],
    });

    const openResponse = await ownerContext.request.post(
      `${BASE_URL}/_agent-native/actions/open-visual-edit`,
      {
        data: {
          title: "Signed-in Visual Edit capability E2E",
          devServerUrl,
          bridgeUrl: manifest.bridgeUrl,
          rootPath: manifest.rootPath,
          routeManifest: manifest,
          bridgeToken: BRIDGE_TOKEN,
          paths: ["/"],
          navigate: false,
          publicReadOnly: true,
        },
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-Frontend": "1",
        },
      },
    );
    expect(openResponse.status(), await openResponse.text()).toBe(200);
    const opened = (await openResponse.json()) as {
      designId?: string;
      embedStartUrl?: string;
      publicReadOnly?: boolean;
      screens?: Array<{ id?: string }>;
    };
    const screenId = opened.screens?.[0]?.id;
    if (!opened.designId || !screenId) {
      throw new Error("open-visual-edit omitted its design or screen ID");
    }
    designId = opened.designId;
    expect(opened.publicReadOnly).toBe(true);
    expect(opened.embedStartUrl).toMatch(/^\/_agent-native\/embed\/start\?/);

    {
      const context = signedInViewerContext;
      const login = await context.request.post(
        `${BASE_URL}/_agent-native/auth/login`,
        {
          data: {
            email: E2E_MENTION_EMAIL,
            password: E2E_PASSWORD,
          },
          headers: { "Content-Type": "application/json" },
        },
      );
      expect(login.status(), await login.text()).toBe(200);
    }

    await page.goto(new URL(opened.embedStartUrl!, BASE_URL).toString());
    await expect(page).toHaveURL(
      new RegExp(`/visual-edit/${designId}(?:\\?|$)`),
    );
    await expect(page.locator("[data-design-editor]")).toBeVisible();
    await expect(
      page.locator("[data-screen-shell]").first().locator("[data-frame-title]"),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("agent-native:embed-auth-token"),
      ),
    ).toBeTruthy();
    const anonymousUpdate = await page.evaluate(
      async ({ designId, fileId, url }) => {
        const response = await fetch(
          "/_agent-native/actions/update-screen-source",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ designId, fileId, sourceType: "url", url }),
          },
        );
        return { status: response.status, body: await response.json() };
      },
      { designId, fileId: screenId, url: `${devServerUrl}/?anonymousEdit=1` },
    );
    expect(anonymousUpdate.status, JSON.stringify(anonymousUpdate.body)).toBe(
      200,
    );
    expect(anonymousUpdate.body.url).toContain("anonymousEdit=1");

    const login = await page.evaluate(
      async (credentials) => {
        const response = await fetch("/_agent-native/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(credentials),
        });
        return response.status;
      },
      { email: E2E_MENTION_EMAIL, password: E2E_PASSWORD },
    );
    expect(login).toBe(200);
    await page.reload();
    await expect(page.locator("[data-design-editor]")).toBeVisible();
    const session = await page.evaluate(async () => {
      const response = await fetch("/_agent-native/auth/session");
      return response.json();
    });
    expect(session).toMatchObject({ email: E2E_MENTION_EMAIL });

    const capabilityRead = await page.evaluate(async (id) => {
      const response = await fetch(
        `/_agent-native/actions/get-design?id=${encodeURIComponent(id)}`,
      );
      const body = await response.json();
      return {
        status: response.status,
        accessRole: body.accessRole,
        storedCapability: Boolean(
          sessionStorage.getItem("agent-native:embed-auth-token"),
        ),
      };
    }, opened.designId);
    expect(capabilityRead).toEqual({
      status: 200,
      accessRole: "editor",
      storedCapability: true,
    });

    await page
      .locator("[data-screen-shell]")
      .first()
      .locator("[data-frame-title]")
      .click();
    const capabilityScreenUrl = page.getByRole("textbox", {
      name: "Screen URL",
    });
    await expect(capabilityScreenUrl).toBeEnabled();
    await capabilityScreenUrl.fill(`${devServerUrl}/?signedInEdit=1`);
    const updateSourceResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/actions/update-screen-source") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Update" }).click();
    const updateSourceResult = await updateSourceResponse;
    const updateSourceBody = await updateSourceResult.json();
    expect(updateSourceResult.status(), JSON.stringify(updateSourceBody)).toBe(
      200,
    );
    expect(updateSourceBody).toMatchObject({
      designId: opened.designId,
      fileId: screenId,
      sourceType: "url",
    });
    expect(updateSourceBody.url).toContain("signedInEdit=1");

    const persistedUpdate = await ownerContext.request.get(
      `${BASE_URL}/_agent-native/actions/get-design`,
      { params: { id: designId, fileId: screenId } },
    );
    expect(persistedUpdate.status(), await persistedUpdate.text()).toBe(200);
    const persistedDesign = await persistedUpdate.json();
    expect(persistedDesign.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: screenId,
          content: updateSourceBody.url,
        }),
      ]),
    );

    const directRead = await signedInViewerContext.request.get(
      `${BASE_URL}/_agent-native/actions/get-design`,
      { params: { id: opened.designId } },
    );
    expect(directRead.status(), await directRead.text()).toBe(200);
    expect(await directRead.json()).toMatchObject({ accessRole: "viewer" });

    const deniedUpdate = await signedInViewerContext.request.post(
      `${BASE_URL}/_agent-native/actions/update-screen-source`,
      {
        data: {
          designId,
          fileId: screenId,
          sourceType: "url",
          url: `${devServerUrl}/?viewerEdit=1`,
        },
      },
    );
    expect(deniedUpdate.status()).toBe(403);

    const ownerUpdate = await ownerContext.request.post(
      `${BASE_URL}/_agent-native/actions/update-screen-source`,
      {
        data: {
          designId,
          fileId: screenId,
          sourceType: "url",
          url: `${devServerUrl}/?ownerEdit=1`,
        },
      },
    );
    expect(ownerUpdate.status(), await ownerUpdate.text()).toBe(200);
    expect((await ownerUpdate.json()).url).toContain("ownerEdit=1");
    await visitor.teardown(test.info());
  } finally {
    if (designId) {
      const deletion = await ownerContext.request.post(
        `${BASE_URL}/_agent-native/actions/delete-design`,
        { data: { id: designId } },
      );
      if (!deletion.ok()) {
        throw new Error(
          `Could not clean up E2E design ${designId}: ${deletion.status()} ${await deletion.text()}`,
        );
      }
    }
    await ownerContext.close();
    await visitorContext.close();
    await signedInViewerContext.close();
    await closeServer(bridge?.server ?? null);
    await closeServer(targetServer);
  }
});
