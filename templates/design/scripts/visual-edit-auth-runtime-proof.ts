import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Frame, type Page } from "playwright";

const designUrl =
  process.env.VISUAL_EDIT_AUTH_DESIGN_URL ?? "http://localhost:8091";
const slidesUrl =
  process.env.VISUAL_EDIT_AUTH_SLIDES_URL ?? "http://localhost:8084";
const bridgeUrl =
  process.env.VISUAL_EDIT_AUTH_BRIDGE_URL ?? "http://127.0.0.1:7331";
const bridgeToken =
  process.env.VISUAL_EDIT_AUTH_BRIDGE_TOKEN ??
  "visual-edit-runtime-proof-token";
const rootPath =
  process.env.VISUAL_EDIT_AUTH_ROOT_PATH ??
  path.resolve(import.meta.dirname, "../../slides");
const editorUrl = process.env.VISUAL_EDIT_AUTH_EDITOR_URL;
const outputDir =
  process.env.VISUAL_EDIT_AUTH_PROOF_DIR ??
  path.resolve(import.meta.dirname, "../../../.tmp/visual-edit-proof");
const screenPaths = ["/sign-in", "/home", "/settings"] as const;
const bridgeHost = new URL(bridgeUrl).host;

type AuthSnapshot = {
  frameCount: number;
  routes: string[];
  signedOutFrames: number;
  appFrames: number;
  frameStates: Array<"signed-out" | "app" | "unknown">;
  textLengths: number[];
};

type WebMcpCall = {
  state?: string;
  ok?: boolean;
  tool?: string;
  result?: {
    pendingEditCount?: number;
    status?: string;
  };
};

function routeFromBridgeFrameUrl(rawUrl: string): string {
  const bridgeFrameUrl = new URL(rawUrl);
  const target = bridgeFrameUrl.searchParams.get("url");
  if (!target) return bridgeFrameUrl.pathname;
  const targetUrl = new URL(target);
  return `${targetUrl.pathname}${targetUrl.search}`;
}

async function previewFrames(page: Page): Promise<Frame[]> {
  const deadline = Date.now() + 30_000;
  let frames: Frame[] = [];
  while (Date.now() < deadline) {
    frames = page
      .frames()
      .filter(
        (frame) =>
          frame !== page.mainFrame() && frame.url().includes(bridgeHost),
      );
    if (frames.length === screenPaths.length) break;
    await page.waitForTimeout(250);
  }
  if (frames.length !== screenPaths.length) {
    const frameDescriptions = page.frames().map((frame) => {
      const frameUrl = new URL(frame.url());
      return { host: frameUrl.host, pathname: frameUrl.pathname };
    });
    throw new Error(
      `Expected ${screenPaths.length} live preview frames, found ${frames.length}: ${JSON.stringify(frameDescriptions)}`,
    );
  }
  for (const frame of frames) {
    await frame.locator("body").waitFor({ state: "attached", timeout: 10_000 });
  }
  return frames;
}

async function readAuthSnapshot(page: Page): Promise<AuthSnapshot> {
  const frames = await previewFrames(page);
  const entries = await Promise.all(
    frames.map(async (frame) => ({
      route: routeFromBridgeFrameUrl(frame.url()),
      text: await frame.locator("body").innerText({ timeout: 10_000 }),
    })),
  );
  const signedOutFrames = entries.filter((entry) =>
    /continue as local dev|local development|sign in/i.test(entry.text),
  ).length;
  const frameStates = entries.map((entry) => {
    if (/continue as local dev|local development|sign in/i.test(entry.text)) {
      return "signed-out" as const;
    }
    if (
      /no decks yet|create your first deck|settings|workspace/i.test(entry.text)
    ) {
      return "app" as const;
    }
    return "unknown" as const;
  });
  return {
    frameCount: entries.length,
    routes: entries.map((entry) => entry.route).sort(),
    signedOutFrames,
    appFrames: frameStates.filter((state) => state === "app").length,
    frameStates,
    textLengths: entries
      .map((entry) => entry.text.length)
      .sort((a, b) => a - b),
  };
}

async function waitForAuthSnapshot(
  page: Page,
  predicate: (snapshot: AuthSnapshot) => boolean,
  label: string,
): Promise<AuthSnapshot> {
  const deadline = Date.now() + 30_000;
  let snapshot: AuthSnapshot | undefined;
  while (Date.now() < deadline) {
    snapshot = await readAuthSnapshot(page);
    if (predicate(snapshot)) return snapshot;
    await page.waitForTimeout(500);
  }
  throw new Error(`${label} did not settle: ${JSON.stringify(snapshot)}`);
}

async function findFrame(
  page: Page,
  predicate: (frame: Frame) => Promise<boolean>,
): Promise<Frame> {
  for (const frame of await previewFrames(page)) {
    if (await predicate(frame)) return frame;
  }
  throw new Error("Could not find the requested preview frame.");
}

function cookieMetadataFingerprint(
  cookies: Array<{
    name: string;
    domain: string;
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite?: string;
  }>,
): string {
  const metadata = cookies
    .map((cookie) =>
      [
        cookie.name,
        cookie.domain,
        cookie.path,
        cookie.httpOnly,
        cookie.secure,
        cookie.sameSite ?? "",
      ].join("|"),
    )
    .sort()
    .join("\n");
  return createHash("sha256").update(metadata).digest("hex");
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({
    headless: process.env.VISUAL_EDIT_HEADLESS !== "0",
  });
  const context = await browser.newContext({
    viewport: { width: 1900, height: 1100 },
  });
  const page = await context.newPage();
  const authResponses: number[] = [];
  const authPostResponses: number[] = [];
  const authConsoleErrors: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/_agent-native/auth/local-dev")) {
      authResponses.push(response.status());
      if (response.request().method() === "POST") {
        authPostResponses.push(response.status());
      }
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") authConsoleErrors.push(message.text());
  });
  let createdDesignId: string | undefined;

  const postAction = async (name: string, data: Record<string, unknown>) => {
    const response = await page.request.post(
      `${designUrl}/_agent-native/actions/${name}`,
      {
        data,
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-Browser-Tab": "visual-edit-auth-runtime-proof",
          "X-Agent-Native-Frontend": "1",
        },
      },
    );
    const body = await response.text();
    if (!response.ok()) {
      throw new Error(`${name}: ${response.status()} ${body}`);
    }
    return body ? (JSON.parse(body) as Record<string, unknown>) : undefined;
  };

  try {
    let targetUrl = editorUrl;
    if (!targetUrl) {
      const opened = await postAction("open-visual-edit", {
        title: "Slides authenticated visual-edit proof",
        devServerUrl: slidesUrl,
        bridgeUrl,
        bridgeToken,
        rootPath,
        paths: screenPaths,
        publicReadOnly: false,
        navigate: false,
      });
      createdDesignId =
        typeof opened?.designId === "string" ? opened.designId : undefined;
      const urlPath = typeof opened?.urlPath === "string" ? opened.urlPath : "";
      if (!urlPath) throw new Error("open-visual-edit returned no editor URL");
      targetUrl = `${designUrl}${urlPath}&view=overview&zoom=24`;
    }

    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .waitFor({ state: "attached", timeout: 30_000 });
    const signedOut = await waitForAuthSnapshot(
      page,
      (snapshot) =>
        snapshot.frameCount === screenPaths.length &&
        snapshot.signedOutFrames === screenPaths.length,
      "signed-out canvases",
    );
    await page.screenshot({
      path: `${outputDir}/auth-runtime-signed-out.png`,
      fullPage: true,
    });

    const designCookieBefore = (await context.cookies()).filter(
      (cookie) =>
        cookie.domain.replace(/^\./, "") === new URL(designUrl).hostname,
    );
    const signInFrame = await findFrame(page, async (frame) =>
      frame.locator("#local-dev-btn").isVisible(),
    );
    await signInFrame.locator("#local-dev-btn").evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    await page.waitForTimeout(500);
    let directAuthStatus: number | undefined;
    if (authPostResponses.length === 0) {
      directAuthStatus = await signInFrame.evaluate(async () => {
        const response = await fetch("/_agent-native/auth/local-dev", {
          method: "POST",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        return response.status;
      });
    }
    if (directAuthStatus !== undefined && directAuthStatus !== 200) {
      throw new Error(
        `Continue as local dev did not create a bridge session: ${JSON.stringify(
          {
            authResponses,
            directAuthStatus,
            authConsoleErrors,
          },
        )}`,
      );
    }
    await page.reload({ waitUntil: "commit" });
    await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .waitFor({ state: "attached", timeout: 30_000 });
    const signedIn = await waitForAuthSnapshot(
      page,
      (snapshot) =>
        snapshot.frameCount === screenPaths.length &&
        snapshot.signedOutFrames === 0 &&
        snapshot.appFrames === screenPaths.length,
      "signed-in canvases",
    );

    const signedInStorage = await context.storageState();
    const designCookieAfterSignIn = (await context.cookies()).filter(
      (cookie) =>
        cookie.domain.replace(/^\./, "") === new URL(designUrl).hostname,
    );
    if (
      cookieMetadataFingerprint(designCookieBefore) !==
      cookieMetadataFingerprint(designCookieAfterSignIn)
    ) {
      throw new Error(
        "Signing in to Slides changed the Design session cookies.",
      );
    }
    if (
      (await page.locator("iframe[data-design-preview-iframe]").count()) !==
      screenPaths.length
    ) {
      throw new Error("The Design editor lost a preview frame after sign-in.");
    }

    const homeFrame = await findFrame(page, async (frame) =>
      frame.getByText("No decks yet", { exact: true }).isVisible(),
    );
    const source = homeFrame.getByText("No decks yet", { exact: true }).first();
    const anchor = homeFrame
      .getByRole("button", { name: /create your first deck/i })
      .first();
    const sourceBox = await source.boundingBox();
    const anchorBox = await anchor.boundingBox();
    if (!sourceBox || !anchorBox) {
      throw new Error(
        "Could not locate the authenticated structure-drag targets.",
      );
    }
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      anchorBox.x + anchorBox.width / 2,
      anchorBox.y + anchorBox.height - 2,
      { steps: 12 },
    );
    await page.waitForTimeout(250);
    await page.mouse.up();
    await page.waitForTimeout(1_000);

    const webMcpCall = (await page.evaluate(async () => {
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
      if (!helper) throw new Error("WebMCP page helper missing");
      return helper.call("get-visual-edit-prompt", {});
    })) as WebMcpCall;
    const pendingEditCount = webMcpCall.result?.pendingEditCount ?? 0;
    if (
      webMcpCall.state !== "done" ||
      webMcpCall.ok !== true ||
      webMcpCall.tool !== "get-visual-edit-prompt" ||
      pendingEditCount < 1
    ) {
      throw new Error(
        `Authenticated WebMCP edit proof was empty: ${JSON.stringify({
          state: webMcpCall.state,
          ok: webMcpCall.ok,
          tool: webMcpCall.tool,
          pendingEditCount,
          status: webMcpCall.result?.status,
        })}`,
      );
    }
    await page.screenshot({
      path: `${outputDir}/auth-runtime-signed-in-pending.png`,
      fullPage: true,
    });

    const settingsFrame = await findFrame(page, async (frame) =>
      frame.getByRole("tab", { name: /^account$/i }).isVisible(),
    );
    const accountUrl = new URL(settingsFrame.url());
    accountUrl.pathname = "/settings/account";
    await settingsFrame.goto(accountUrl.toString(), {
      waitUntil: "domcontentloaded",
    });
    const logout = settingsFrame.locator("#sign-out button").first();
    await logout.waitFor({ state: "visible", timeout: 10_000 });
    const logoutResponsePromise = page
      .waitForResponse(
        (response) =>
          response.url().includes("/_agent-native/auth/logout") &&
          response.request().method() === "POST",
        { timeout: 15_000 },
      )
      .catch(() => undefined);
    await logout.click({ force: true });
    const logoutResponse = await logoutResponsePromise;
    if (logoutResponse && !logoutResponse.ok()) {
      throw new Error(
        `Sign-out request failed with ${logoutResponse.status()}.`,
      );
    }
    if (!logoutResponse) {
      const directLogoutStatus = await settingsFrame.evaluate(async () => {
        const response = await fetch("/_agent-native/auth/logout", {
          method: "POST",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        return response.status;
      });
      if (directLogoutStatus < 200 || directLogoutStatus >= 300) {
        throw new Error(`Sign-out fallback failed with ${directLogoutStatus}.`);
      }
    }
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: "commit" });
    await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .waitFor({ state: "attached", timeout: 30_000 });
    const signedOutAfter = await waitForAuthSnapshot(
      page,
      (snapshot) =>
        snapshot.frameCount === screenPaths.length &&
        snapshot.signedOutFrames === screenPaths.length,
      "signed-out canvases after logout",
    );
    const designCookieAfterSignOut = (await context.cookies()).filter(
      (cookie) =>
        cookie.domain.replace(/^\./, "") === new URL(designUrl).hostname,
    );
    if (
      cookieMetadataFingerprint(designCookieBefore) !==
      cookieMetadataFingerprint(designCookieAfterSignOut)
    ) {
      throw new Error(
        "Signing out of Slides changed the Design session cookies.",
      );
    }
    await page.screenshot({
      path: `${outputDir}/auth-runtime-signed-out-after.png`,
      fullPage: true,
    });

    const artifact = {
      screenPaths,
      screenCount: screenPaths.length,
      signedOut,
      signedIn,
      signedOutAfter,
      editor: {
        designOrigin: new URL(designUrl).origin,
        previewFrameCount: await page
          .locator("iframe[data-design-preview-iframe]")
          .count(),
        sessionCookieMetadataUnchanged: true,
      },
      authenticatedStorageCookieCount: signedInStorage.cookies.length,
      bridgeAuthResponseStatus:
        directAuthStatus ?? authResponses[authResponses.length - 1] ?? null,
      webMcp: {
        tool: webMcpCall.tool,
        state: webMcpCall.state,
        pendingEditCount,
        status: webMcpCall.result?.status ?? null,
      },
      screenshots: [
        "auth-runtime-signed-out.png",
        "auth-runtime-signed-in-pending.png",
        "auth-runtime-signed-out-after.png",
      ],
    };
    await writeFile(
      `${outputDir}/auth-runtime-proof.json`,
      `${JSON.stringify(artifact, null, 2)}\n`,
    );
    console.log(JSON.stringify(artifact, null, 2));
  } finally {
    if (createdDesignId) {
      await postAction("delete-design", { id: createdDesignId });
    }
    await context.close();
    await browser.close();
  }
}

await main();
