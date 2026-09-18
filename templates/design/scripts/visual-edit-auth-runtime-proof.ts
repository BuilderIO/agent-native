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
const slidesHost = new URL(slidesUrl).host;

type AuthSnapshot = {
  frameCount: number;
  routes: string[];
  signedOutFrames: number;
  appFrames: number;
  frameStates: Array<"signed-out" | "app" | "unknown">;
  routeStates: Array<{
    route: string;
    state: "signed-out" | "app" | "unknown";
  }>;
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

type PreviewIframe = {
  screenId: string;
  route: string;
  bridgeKey: string | null;
  src: string;
  sandbox: string;
  hasSrcdoc: boolean;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

function routeFromBridgeFrameUrl(rawUrl: string): string {
  const bridgeFrameUrl = new URL(rawUrl);
  const target = bridgeFrameUrl.searchParams.get("url");
  if (!target) return bridgeFrameUrl.pathname;
  const targetUrl = new URL(target);
  return `${targetUrl.pathname}${targetUrl.search}`;
}

function redactPreviewSrc(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.searchParams.delete("previewToken");
  url.searchParams.delete("bridgeKey");
  return url.toString();
}

async function previewFrames(
  page: Page,
  frameHost = bridgeHost,
): Promise<Frame[]> {
  const deadline = Date.now() + 30_000;
  let frames: Frame[] = [];
  while (Date.now() < deadline) {
    frames = page
      .frames()
      .filter(
        (frame) =>
          frame !== page.mainFrame() && frame.url().includes(frameHost),
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

async function previewFrameHost(page: Page): Promise<string> {
  const src = await page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .getAttribute("src");
  return new URL(requireValue(src, "Preview iframe has no source."), page.url())
    .host;
}

async function readAuthSnapshot(
  page: Page,
  frameHost = bridgeHost,
): Promise<AuthSnapshot> {
  const frames = await previewFrames(page, frameHost);
  const entries = await Promise.all(
    frames.map(async (frame) => {
      const route = routeFromBridgeFrameUrl(frame.url());
      const routePath = route.split("?", 1)[0];
      return {
        route,
        state: await (async () => {
          if (await frame.locator("#local-dev-btn").isVisible()) {
            return "signed-out" as const;
          }
          if (
            routePath === "/home" &&
            (await frame.getByText("No decks yet", { exact: true }).isVisible())
          ) {
            return "app" as const;
          }
          if (
            routePath === "/settings" &&
            (await frame.getByText("Account", { exact: true }).isVisible())
          ) {
            return "app" as const;
          }
          return "unknown" as const;
        })(),
        text: await frame.locator("body").innerText({ timeout: 10_000 }),
      };
    }),
  );
  const frameStates = entries.map((entry) => entry.state);
  const routes = entries.map((entry) => entry.route).sort();
  if (
    (await page.locator("iframe[data-design-preview-iframe]").count()) !==
    screenPaths.length
  ) {
    throw new Error(
      "The editor rendered a duplicate or missing preview frame.",
    );
  }
  return {
    frameCount: entries.length,
    routes,
    signedOutFrames: frameStates.filter((state) => state === "signed-out")
      .length,
    appFrames: frameStates.filter((state) => state === "app").length,
    frameStates,
    routeStates: entries
      .map(({ route, state }) => ({ route, state }))
      .sort((a, b) => a.route.localeCompare(b.route)),
    textLengths: entries
      .map((entry) => entry.text.length)
      .sort((a, b) => a - b),
  };
}

async function waitForAuthSnapshot(
  page: Page,
  predicate: (snapshot: AuthSnapshot) => boolean,
  label: string,
  frameHost = bridgeHost,
): Promise<AuthSnapshot> {
  const deadline = Date.now() + 30_000;
  let snapshot: AuthSnapshot | undefined;
  while (Date.now() < deadline) {
    snapshot = await readAuthSnapshot(page, frameHost);
    if (predicate(snapshot)) return snapshot;
    await page.waitForTimeout(500);
  }
  throw new Error(`${label} did not settle: ${JSON.stringify(snapshot)}`);
}

async function findFrame(
  page: Page,
  predicate: (frame: Frame) => Promise<boolean>,
  frameHost = bridgeHost,
): Promise<Frame> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const frame of await previewFrames(page, frameHost)) {
      if (await predicate(frame)) return frame;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("Could not find the requested preview frame.");
}

async function readPreviewIframes(
  page: Page,
  options: {
    frameHost?: string;
    requireBridge?: boolean;
    requireUniqueRoutes?: boolean;
  } = {},
): Promise<PreviewIframe[]> {
  const frameHost = options.frameHost ?? bridgeHost;
  const requireBridge = options.requireBridge ?? frameHost === bridgeHost;
  const iframes = await page
    .locator("iframe[data-design-preview-iframe]")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        screenId: element.getAttribute("data-screen-iframe-id") ?? "",
        src: element.getAttribute("src") ?? "",
        sandbox: element.getAttribute("sandbox") ?? "",
        hasSrcdoc: element.hasAttribute("srcdoc"),
      })),
    );
  if (iframes.length !== screenPaths.length) {
    throw new Error(
      `Expected ${screenPaths.length} preview iframes, found ${iframes.length}.`,
    );
  }
  const screenIds = iframes.map((iframe) => iframe.screenId);
  if (
    screenIds.some((screenId) => !screenId) ||
    new Set(screenIds).size !== screenIds.length
  ) {
    throw new Error("Preview iframes have missing or duplicate screen ids.");
  }
  const routes: string[] = [];
  for (const iframe of iframes) {
    const url = new URL(iframe.src, page.url());
    if (url.host !== frameHost) {
      throw new Error(
        `Preview is backed by the wrong host: ${JSON.stringify(iframe)}`,
      );
    }
    if (requireBridge && url.pathname !== "/live-edit") {
      throw new Error(
        `Preview is not URL-backed by the live-edit bridge: ${JSON.stringify(iframe)}`,
      );
    }
    const route = routeFromBridgeFrameUrl(iframe.src);
    const bridgeKey = url.searchParams.get("bridgeKey")?.trim() ?? "";
    if (requireBridge && !bridgeKey) {
      throw new Error(
        `Preview iframe has no keyed bridge route: ${iframe.src}`,
      );
    }
    routes.push(route);
    if (!iframe.sandbox.split(/\s+/).includes("allow-scripts")) {
      throw new Error(
        `URL-backed preview is missing allow-scripts: ${JSON.stringify(iframe)}`,
      );
    }
    if (
      requireBridge &&
      !iframe.sandbox.split(/\s+/).includes("allow-same-origin")
    ) {
      throw new Error(
        `URL-backed preview is missing allow-same-origin: ${JSON.stringify(iframe)}`,
      );
    }
    if (iframe.hasSrcdoc) {
      throw new Error("URL-backed preview unexpectedly has a srcdoc payload.");
    }
  }
  const bridgeKeys = iframes.map((iframe) => {
    const value = new URL(iframe.src, page.url()).searchParams.get("bridgeKey");
    return value?.trim() || null;
  });
  if (
    requireBridge &&
    (bridgeKeys.some((bridgeKey) => !bridgeKey) ||
      new Set(bridgeKeys).size !== bridgeKeys.length)
  ) {
    throw new Error("Preview iframes have missing or duplicate bridge keys.");
  }
  if (options.requireUniqueRoutes && new Set(routes).size !== routes.length) {
    throw new Error(`Preview iframes have duplicate target routes: ${routes}`);
  }
  if ((await page.locator("iframe[data-screen-snapshot]").count()) !== 0) {
    throw new Error("URL-backed visual-edit boot rendered a snapshot iframe.");
  }
  return iframes.map((iframe, index) => ({
    ...iframe,
    src: redactPreviewSrc(iframe.src),
    route: routes[index]!,
    bridgeKey: bridgeKeys[index] ? "<present>" : null,
  }));
}

function cookieMetadataFingerprint(
  cookies: Array<{
    name: string;
    value: string;
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
        createHash("sha256").update(cookie.value).digest("hex"),
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

function cookiesForHost<T extends { domain: string }>(
  cookies: T[],
  hostname: string,
): T[] {
  const host = hostname.toLowerCase();
  return cookies.filter((cookie) => {
    const domain = cookie.domain.replace(/^\./, "").toLowerCase();
    return domain === host || host.endsWith(`.${domain}`);
  });
}

async function cdpScreenshot(page: Page, filePath: string): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
  });
  await writeFile(filePath, Buffer.from(data, "base64"));
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
  let expectedScreenRoutes: Map<string, string> | undefined;

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

  const signInDesign = async () => {
    const response = await page.request.post(
      `${designUrl}/_agent-native/auth/local-dev`,
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok()) {
      throw new Error(
        `Design local-dev sign-in failed: ${response.status()} ${await response.text()}`,
      );
    }
  };

  const signOutDesign = async () => {
    const response = await page.request.post(
      `${designUrl}/_agent-native/auth/logout`,
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok()) {
      throw new Error(
        `Design local-dev sign-out failed: ${response.status()} ${await response.text()}`,
      );
    }
  };

  try {
    let targetUrl = editorUrl;
    if (!targetUrl) {
      await signInDesign();
      const opened = await postAction("open-visual-edit", {
        title: "Slides authenticated visual-edit proof",
        devServerUrl: slidesUrl,
        bridgeUrl,
        bridgeToken,
        rootPath,
        paths: screenPaths,
        publicReadOnly: true,
        navigate: false,
      });
      createdDesignId =
        typeof opened?.designId === "string" ? opened.designId : undefined;
      const urlPath = typeof opened?.urlPath === "string" ? opened.urlPath : "";
      if (!urlPath) throw new Error("open-visual-edit returned no editor URL");
      if (Array.isArray(opened?.screens)) {
        expectedScreenRoutes = new Map(
          opened.screens
            .filter(
              (screen): screen is Record<string, unknown> =>
                typeof screen === "object" &&
                screen !== null &&
                typeof screen.id === "string" &&
                typeof screen.path === "string",
            )
            .map((screen) => [screen.id as string, screen.path as string]),
        );
      }
      targetUrl = `${designUrl}${urlPath}&zoom=24`;
    }

    const assertPreviewRouteMapping = (
      iframes: PreviewIframe[],
      label: string,
    ) => {
      if (!expectedScreenRoutes) return;
      assert(
        expectedScreenRoutes.size === screenPaths.length,
        "open-visual-edit returned an incomplete screen route map.",
      );
      for (const iframe of iframes) {
        assert(
          expectedScreenRoutes.get(iframe.screenId) === iframe.route,
          `${label} mapped a screen iframe to the wrong route: ${JSON.stringify(
            { screenId: iframe.screenId, route: iframe.route },
          )}`,
        );
      }
    };

    await signOutDesign();
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .waitFor({ state: "attached", timeout: 30_000 });
    const signedOut = await waitForAuthSnapshot(
      page,
      (snapshot) =>
        snapshot.frameCount === screenPaths.length &&
        snapshot.signedOutFrames === screenPaths.length &&
        JSON.stringify(snapshot.routes) ===
          JSON.stringify(["/sign-in", "/sign-in", "/sign-in"]),
      "signed-out canvases",
      slidesHost,
    );
    const previewIframes = await readPreviewIframes(page, {
      frameHost: slidesHost,
      requireBridge: false,
      requireUniqueRoutes: true,
    });
    assertPreviewRouteMapping(previewIframes, "Logged-out preview");
    assert(
      JSON.stringify(previewIframes.map((iframe) => iframe.route).sort()) ===
        JSON.stringify([...screenPaths].sort()),
      "Logged-out preview iframes lost their requested route mapping.",
    );
    const loggedOutPathname = new URL(page.url()).pathname;
    if (!loggedOutPathname.includes("/visual-edit/")) {
      throw new Error(
        `Logged-out boot did not stay on the visual-edit route: ${page.url()}`,
      );
    }
    await cdpScreenshot(page, `${outputDir}/auth-runtime-signed-out.png`);

    const designHostname = new URL(designUrl).hostname;
    const bridgeHostname = new URL(bridgeUrl).hostname;
    const designCookiesAtLoggedOutBoot = cookiesForHost(
      await context.cookies(),
      designHostname,
    );
    await signInDesign();
    await page.reload({ waitUntil: "commit" });
    await page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .waitFor({ state: "attached", timeout: 30_000 });
    const designCookiesBeforeChildAuth = cookiesForHost(
      await context.cookies(),
      designHostname,
    );
    let authenticatedFrameHost = await previewFrameHost(page);
    let directAuthStatus: number | undefined;
    let childAuthTransport = "preview-token";
    let signedIn = await waitForAuthSnapshot(
      page,
      (snapshot) =>
        snapshot.frameCount === screenPaths.length &&
        ((snapshot.signedOutFrames === screenPaths.length &&
          JSON.stringify(snapshot.routes) ===
            JSON.stringify(["/sign-in", "/sign-in", "/sign-in"])) ||
          (snapshot.appFrames === screenPaths.length &&
            JSON.stringify(snapshot.routes) ===
              JSON.stringify(["/home", "/home", "/settings"].sort()))),
      "bridge auth state after Design sign-in",
      authenticatedFrameHost,
    );
    let bridgeCookiesBeforeChildAuth:
      | Awaited<ReturnType<typeof context.cookies>>
      | undefined;
    if (signedIn.signedOutFrames === screenPaths.length) {
      bridgeCookiesBeforeChildAuth = cookiesForHost(
        await context.cookies(),
        bridgeHostname,
      );
      childAuthTransport = "button";
      const signInFrame = await findFrame(
        page,
        async (frame) => frame.locator("#local-dev-btn").isVisible(),
        authenticatedFrameHost,
      );
      const signInChildWithFetch = async () => {
        const authFrame = requireValue(
          (await previewFrames(page, authenticatedFrameHost))[0],
          "No bridge preview frame was available for child sign-in.",
        );
        return authFrame.evaluate(async () => {
          const response = await fetch("/_agent-native/auth/local-dev", {
            method: "POST",
            credentials: "include",
            headers: { Accept: "application/json" },
          });
          return response.status;
        });
      };
      try {
        await signInFrame
          .locator("#local-dev-btn")
          .click({ timeout: 5_000, noWaitAfter: true });
      } catch {
        childAuthTransport = "frame-fetch-fallback";
        directAuthStatus = await signInChildWithFetch();
      }
      await page.waitForTimeout(500);
      if (directAuthStatus === undefined && authPostResponses.length === 0) {
        directAuthStatus = await signInChildWithFetch();
        childAuthTransport = "frame-fetch-fallback";
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
      authenticatedFrameHost = await previewFrameHost(page);
      signedIn = await waitForAuthSnapshot(
        page,
        (snapshot) =>
          snapshot.frameCount === screenPaths.length &&
          snapshot.signedOutFrames === 0 &&
          snapshot.appFrames === screenPaths.length &&
          JSON.stringify(snapshot.routes) ===
            JSON.stringify(["/home", "/home", "/settings"].sort()),
        "signed-in canvases",
        authenticatedFrameHost,
      );
    }
    assert(
      authenticatedFrameHost === bridgeHost,
      `Authenticated preview did not use the visual-edit bridge: ${authenticatedFrameHost}`,
    );
    const signedInPreviewIframes = await readPreviewIframes(page, {
      frameHost: authenticatedFrameHost,
    });
    assertPreviewRouteMapping(signedInPreviewIframes, "Signed-in preview");
    assert(
      JSON.stringify(
        signedInPreviewIframes.map((iframe) => iframe.route).sort(),
      ) === JSON.stringify([...screenPaths].sort()),
      "Signed-in preview iframes lost their requested route mapping.",
    );
    await cdpScreenshot(page, `${outputDir}/auth-runtime-signed-in.png`);
    const bridgeCookiesAfterChildSignIn = cookiesForHost(
      await context.cookies(),
      bridgeHostname,
    );
    const bridgeCookieMetadataChangedOnChildSignIn =
      bridgeCookiesBeforeChildAuth !== undefined &&
      cookieMetadataFingerprint(bridgeCookiesBeforeChildAuth) !==
        cookieMetadataFingerprint(bridgeCookiesAfterChildSignIn);
    const designCookiesAfterChildSignIn = cookiesForHost(
      await context.cookies(),
      designHostname,
    );
    if (
      cookieMetadataFingerprint(designCookiesBeforeChildAuth) !==
      cookieMetadataFingerprint(designCookiesAfterChildSignIn)
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

    const homeFrame = await findFrame(
      page,
      async (frame) =>
        frame.getByText("No decks yet", { exact: true }).isVisible(),
      authenticatedFrameHost,
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
    await cdpScreenshot(
      page,
      `${outputDir}/auth-runtime-signed-in-pending.png`,
    );

    const settingsFrame = await findFrame(
      page,
      async (frame) =>
        routeFromBridgeFrameUrl(frame.url()).split("?", 1)[0] === "/settings",
      authenticatedFrameHost,
    );
    const accountUrl = new URL(settingsFrame.url());
    accountUrl.pathname = "/settings/account";
    await settingsFrame.goto(accountUrl.toString(), {
      waitUntil: "domcontentloaded",
    });
    const logout = settingsFrame.locator("#sign-out button").first();
    await logout.waitFor({ state: "visible", timeout: 30_000 });
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
    authenticatedFrameHost = await previewFrameHost(page);
    const signedOutAfter = await waitForAuthSnapshot(
      page,
      (snapshot) =>
        snapshot.frameCount === screenPaths.length &&
        snapshot.signedOutFrames === screenPaths.length &&
        JSON.stringify(snapshot.routes) ===
          JSON.stringify(["/sign-in", "/sign-in", "/sign-in"].sort()),
      "signed-out canvases after logout",
      authenticatedFrameHost,
    );
    const bridgeCookiesAfterChildSignOut = cookiesForHost(
      await context.cookies(),
      bridgeHostname,
    );
    const bridgeCookieMetadataChangedOnChildSignOut =
      cookieMetadataFingerprint(bridgeCookiesAfterChildSignIn) !==
      cookieMetadataFingerprint(bridgeCookiesAfterChildSignOut);
    const designCookiesAfterChildSignOut = cookiesForHost(
      await context.cookies(),
      designHostname,
    );
    if (
      cookieMetadataFingerprint(designCookiesBeforeChildAuth) !==
      cookieMetadataFingerprint(designCookiesAfterChildSignOut)
    ) {
      throw new Error(
        "Signing out of Slides changed the Design session cookies.",
      );
    }
    const signedOutAfterPreviewIframes = await readPreviewIframes(page, {
      frameHost: authenticatedFrameHost,
    });
    assertPreviewRouteMapping(
      signedOutAfterPreviewIframes,
      "Signed-out-after preview",
    );
    await cdpScreenshot(page, `${outputDir}/auth-runtime-signed-out-after.png`);

    const artifact = {
      screenPaths,
      screenCount: screenPaths.length,
      signedOut,
      signedIn,
      signedOutAfter,
      editor: {
        designOrigin: new URL(designUrl).origin,
        loggedOutPathname,
        previewFrameCount: await page
          .locator("iframe[data-design-preview-iframe]")
          .count(),
        previewIframes,
        signedInPreviewIframes,
        signedOutAfterPreviewIframes,
        snapshotIframeCount: await page
          .locator("iframe[data-screen-snapshot]")
          .count(),
      },
      cookieScope: {
        designHost: designHostname,
        bridgeHost: bridgeHostname,
        designCookiesAtLoggedOutBoot: designCookiesAtLoggedOutBoot.length,
        designCookiesBeforeChildAuth: designCookiesBeforeChildAuth.length,
        designCookiesAfterChildSignIn: designCookiesAfterChildSignIn.length,
        designCookiesAfterChildSignOut: designCookiesAfterChildSignOut.length,
        bridgeCookiesBeforeChildAuth:
          bridgeCookiesBeforeChildAuth?.length ?? null,
        bridgeCookiesAfterChildSignIn: bridgeCookiesAfterChildSignIn.length,
        bridgeCookiesAfterChildSignOut: bridgeCookiesAfterChildSignOut.length,
        designSessionUnchangedDuringChildAuth: true,
        bridgeCookieMetadataChangedOnChildSignIn,
        bridgeSessionReusedAcrossFrames:
          signedIn.signedOutFrames === 0 &&
          signedIn.appFrames === screenPaths.length,
        childSessionAuthTransport: childAuthTransport,
        bridgeCookieMetadataChangedOnChildSignOut,
      },
      authenticatedStorageCookieCount: (await context.storageState()).cookies
        .length,
      bridgeAuthResponseStatus:
        directAuthStatus ?? authResponses[authResponses.length - 1] ?? null,
      webMcp: {
        tool: webMcpCall.tool,
        state: webMcpCall.state,
        pendingEditCount,
        status: webMcpCall.result?.status ?? null,
      },
      childAuthTransport,
      screenshots: [
        "auth-runtime-signed-out.png",
        "auth-runtime-signed-in.png",
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
    let cleanupError: unknown;
    if (createdDesignId) {
      try {
        await signInDesign();
        await postAction("delete-design", { id: createdDesignId });
      } catch (error) {
        cleanupError = error;
      }
      try {
        await signOutDesign();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    try {
      await context.close();
    } catch (error) {
      cleanupError ??= error;
    }
    try {
      await browser.close();
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError) throw cleanupError;
  }
}

await main();
