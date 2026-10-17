import { mkdir } from "node:fs/promises";
import http, { type Server } from "node:http";
import path from "node:path";

import { decodeContinuation } from "@agent-native/core/shared";
import {
  prepareDesignConnectManifest,
  startDesignConnectBridge,
  type DesignConnectBridge,
} from "@agent-native/core/testing";
import {
  type Browser,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  appPath,
  bridgeMessages,
  designFrame,
  enterDirectMode,
  installBridge,
  readSeedDesignId,
  selectByText,
  waitForBridge,
} from "./helpers";
import { expect, test } from "./rails";

const AUTH_STATE_PATH = process.env.E2E_AUTH_DIR
  ? path.join(path.resolve(process.env.E2E_AUTH_DIR), "state.json")
  : path.join(import.meta.dirname, ".auth", "state.json");
const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
const SIGNED_OUT_BASE_URL = BASE_URL.replace("127.0.0.1", "localhost");
const SHORTCUT = process.platform === "darwin" ? "Meta+k" : "Control+k";
const UNDO_SHORTCUT = process.platform === "darwin" ? "Meta+z" : "Control+z";
const REDO_SHORTCUT =
  process.platform === "darwin" ? "Meta+Shift+z" : "Control+y";

let designId: string;
let linkedScreenId: string;
let collaborationDesignId: string;
let collaborationScreenId: string;
let collaborationSecondScreenId: string;
let visualEditTargetServer: Server | null = null;
let visualEditBridge: DesignConnectBridge | null = null;
let visualEditTargetUrl = "";
// Deleted in afterAll, once no page still polls them.
const throwawayDesignIds: string[] = [];
const VISUAL_EDIT_BRIDGE_TOKEN = "signed-out-visual-edit-e2e-bridge-token";

type PageRuntimeErrors = {
  consoleErrors: string[];
  pageErrors: string[];
};

type SignedOutPage = PageRuntimeErrors & {
  page: Page;
  close: () => Promise<void>;
  mutationRequests: string[];
};

const ACTION_BATCH_PATH_SUFFIX = "/_agent-native/actions/get-actions-batch";
const ACTION_ROUTE_PATH_PATTERN = /\/_agent-native\/actions\//;

type ActionBatchRequestEntry = {
  action: string;
  query: string;
};

type ActionRequest = Pick<Request, "url" | "method" | "postDataJSON">;
type VisualEditSnapshotRequestEntry = {
  fileId: string;
  batchIndex: number | null;
};
type VisualEditSnapshotResponseEntry = {
  fileId: string;
  status: number;
  body: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

function actionBatchRequests(
  request: ActionRequest,
): ActionBatchRequestEntry[] | null {
  const pathname = new URL(request.url()).pathname;
  if (
    request.method() !== "POST" ||
    !pathname.endsWith(ACTION_BATCH_PATH_SUFFIX)
  ) {
    return null;
  }

  let payload: unknown;
  try {
    payload = request.postDataJSON();
  } catch {
    return null;
  }
  if (!isRecord(payload) || !hasExactKeys(payload, ["requests"])) return null;
  if (!Array.isArray(payload.requests) || payload.requests.length === 0) {
    return null;
  }

  const entries: ActionBatchRequestEntry[] = [];
  for (const entry of payload.requests) {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ["action", "query"]) ||
      typeof entry.action !== "string" ||
      entry.action.trim().length === 0 ||
      typeof entry.query !== "string"
    ) {
      return null;
    }
    entries.push({ action: entry.action, query: entry.query });
  }
  return entries;
}

function visualEditSnapshotRequestEntries(
  request: ActionRequest,
): VisualEditSnapshotRequestEntry[] {
  const url = new URL(request.url());
  if (
    request.method() === "GET" &&
    url.pathname.endsWith("/get-visual-edit-snapshot")
  ) {
    const fileId = url.searchParams.get("fileId");
    return fileId ? [{ fileId, batchIndex: null }] : [];
  }

  const batchRequests = actionBatchRequests(request);
  if (!batchRequests) return [];
  return batchRequests.flatMap((entry, batchIndex) => {
    if (entry.action !== "get-visual-edit-snapshot") return [];
    const fileId = new URLSearchParams(entry.query).get("fileId");
    return fileId ? [{ fileId, batchIndex }] : [];
  });
}

function visualEditSnapshotResponseEntries(
  request: ActionRequest,
  status: number,
  payload: unknown,
): VisualEditSnapshotResponseEntry[] {
  const requests = visualEditSnapshotRequestEntries(request);
  if (requests.length === 0) return [];
  if (requests[0]?.batchIndex === null) {
    const directRequest = requests[0];
    return directRequest
      ? [{ fileId: directRequest.fileId, status, body: payload }]
      : [];
  }
  if (status < 200 || status >= 300 || !isRecord(payload)) return [];
  const results = payload.results;
  if (!Array.isArray(results)) return [];

  return requests.flatMap((requestEntry) => {
    if (requestEntry.batchIndex === null) return [];
    const result: unknown = results[requestEntry.batchIndex];
    if (!isRecord(result) || typeof result.status !== "number") return [];
    return [
      {
        fileId: requestEntry.fileId,
        status: result.status,
        body: result.body,
      },
    ];
  });
}

function fullVisualEditSnapshotHtml(
  response: VisualEditSnapshotResponseEntry,
): string | null {
  if (
    response.status < 200 ||
    response.status >= 300 ||
    !isRecord(response.body) ||
    response.body.fileId !== response.fileId ||
    typeof response.body.html !== "string"
  ) {
    return null;
  }
  return response.body.html;
}

function rememberFullVisualEditSnapshotHtml(
  snapshots: Map<string, string>,
  response: VisualEditSnapshotResponseEntry,
): void {
  const html = fullVisualEditSnapshotHtml(response);
  if (html !== null) snapshots.set(response.fileId, html);
}

function actionBatchIncludesAction(
  request: ActionRequest,
  actionName: string,
): boolean {
  const pathname = new URL(request.url()).pathname;
  if (
    request.method() !== "POST" ||
    !pathname.endsWith(ACTION_BATCH_PATH_SUFFIX)
  ) {
    return false;
  }

  let payload: unknown;
  try {
    payload = request.postDataJSON();
  } catch {
    return false;
  }
  if (!isRecord(payload) || !Array.isArray(payload.requests)) return false;
  return payload.requests.some(
    (entry) => isRecord(entry) && entry.action === actionName,
  );
}

function isActionMutationRequest(request: ActionRequest): boolean {
  const pathname = new URL(request.url()).pathname;
  return (
    request.method() === "POST" &&
    ACTION_ROUTE_PATH_PATTERN.test(pathname) &&
    actionBatchRequests(request) === null
  );
}

function fakeActionRequest({
  path,
  method,
  payload,
  parseError = false,
}: {
  path: string;
  method: string;
  payload?: unknown;
  parseError?: boolean;
}): ActionRequest {
  return {
    url: () => `http://localhost${path}`,
    method: () => method,
    postDataJSON: () => {
      if (parseError) throw new Error("invalid JSON");
      return payload;
    },
  };
}

test("public action request observer distinguishes read-only batches", () => {
  const batchPath = ACTION_BATCH_PATH_SUFFIX;

  expect(
    isActionMutationRequest(
      fakeActionRequest({
        path: batchPath,
        method: "POST",
        payload: {
          requests: [
            { action: "get-design", query: "id=design-1" },
            { action: "list-review-comments", query: "resourceId=design-1" },
          ],
        },
      }),
    ),
  ).toBe(false);

  for (const malformedBatch of [
    fakeActionRequest({ path: batchPath, method: "POST", parseError: true }),
    fakeActionRequest({
      path: batchPath,
      method: "POST",
      payload: { requests: [] },
    }),
    fakeActionRequest({
      path: batchPath,
      method: "POST",
      payload: { requests: [{ action: "get-design", query: "" }], extra: true },
    }),
    fakeActionRequest({
      path: batchPath,
      method: "POST",
      payload: {
        requests: [{ action: "get-design", query: "", extra: true }],
      },
    }),
  ]) {
    expect(isActionMutationRequest(malformedBatch)).toBe(true);
  }

  expect(
    isActionMutationRequest(
      fakeActionRequest({
        path: "/_agent-native/actions/update-file",
        method: "POST",
        payload: { id: "file-1" },
      }),
    ),
  ).toBe(true);
  expect(
    isActionMutationRequest(
      fakeActionRequest({
        path: "/_agent-native/actions/get-design",
        method: "GET",
      }),
    ),
  ).toBe(false);
  expect(
    actionBatchIncludesAction(
      fakeActionRequest({
        path: batchPath,
        method: "POST",
        payload: {
          requests: [
            { action: "refresh-localhost-preview-token", query: "" },
            { action: "get-design" },
          ],
          unexpected: true,
        },
      }),
      "refresh-localhost-preview-token",
    ),
  ).toBe(true);
});

test("visual-edit snapshot observer reads direct and batched responses", () => {
  const directRequest = fakeActionRequest({
    path: "/_agent-native/actions/get-visual-edit-snapshot?designId=design-1&fileId=file-1",
    method: "GET",
  });
  expect(visualEditSnapshotRequestEntries(directRequest)).toEqual([
    { fileId: "file-1", batchIndex: null },
  ]);
  const directResponse = visualEditSnapshotResponseEntries(directRequest, 200, {
    fileId: "file-1",
    html: "<h1>Local visual edit</h1>",
    unchanged: false,
  });
  expect(fullVisualEditSnapshotHtml(directResponse[0]!)).toBe(
    "<h1>Local visual edit</h1>",
  );

  const batchRequest = fakeActionRequest({
    path: ACTION_BATCH_PATH_SUFFIX,
    method: "POST",
    payload: {
      requests: [
        { action: "get-design", query: "designId=design-1" },
        {
          action: "get-visual-edit-snapshot",
          query: "designId=design-1&fileId=file-1",
        },
        {
          action: "get-visual-edit-snapshot",
          query: "designId=design-1&fileId=file-2",
        },
      ],
    },
  });
  const batchResponses = visualEditSnapshotResponseEntries(batchRequest, 200, {
    results: [
      { status: 200, body: { id: "design-1" } },
      {
        status: 200,
        body: {
          fileId: "file-1",
          html: "<h1>Local visual edit</h1>",
          unchanged: false,
        },
      },
      {
        status: 200,
        body: { fileId: "file-2", html: null, unchanged: true },
      },
    ],
  });
  expect(batchResponses.map(({ fileId }) => fileId)).toEqual([
    "file-1",
    "file-2",
  ]);
  expect(fullVisualEditSnapshotHtml(batchResponses[0]!)).toBe(
    "<h1>Local visual edit</h1>",
  );
  expect(fullVisualEditSnapshotHtml(batchResponses[1]!)).toBeNull();
  const snapshotHtmlByFile = new Map([
    ["file-2", "<h1>Previously hydrated</h1>"],
  ]);
  for (const response of batchResponses) {
    rememberFullVisualEditSnapshotHtml(snapshotHtmlByFile, response);
  }
  expect(snapshotHtmlByFile.get("file-2")).toBe("<h1>Previously hydrated</h1>");
});

function ownScreenFrame(page: Page) {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame();
}

// fixme: fails in CI on current main: beforeAll's open-visual-edit is rejected because browser requests can no longer include bridge credentials; re-author via a trusted bridge
test.describe.fixme("public visual edit", () => {
  test.beforeAll(async ({ browser }) => {
    visualEditTargetServer = http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const pathname = requestUrl.pathname;
      if (pathname === "/slow") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
        });
        response.end(
          `<!doctype html><html><body><main><h1>Delayed image frame</h1><img id="delayed-image" src="${visualEditTargetUrl}/slow-image.svg" /></main></body></html>`,
        );
        return;
      }
      if (pathname === "/slow-image.svg") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "image/svg+xml",
        });
        setTimeout(() => {
          response.end(
            '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="36" fill="#7c3aed"/></svg>',
          );
        }, 5_000);
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        `<!doctype html><html><body><main><h1>${requestUrl.searchParams.has("e2eRoute") ? "Owner updated canvas" : "Local visual edit"}</h1></main></body></html>`,
      );
    });
    const address = await listen(visualEditTargetServer);
    visualEditTargetUrl = `http://${address.host}:${address.port}`;
    const bridgePortServer = http.createServer();
    const bridgeAddress = await listen(bridgePortServer);
    await closeServer(bridgePortServer);
    const manifest = await prepareDesignConnectManifest({
      root: path.resolve(import.meta.dirname, "fixtures"),
      url: visualEditTargetUrl,
      port: bridgeAddress.port,
    });
    visualEditBridge = await startDesignConnectBridge(manifest, {
      bridgeToken: VISUAL_EDIT_BRIDGE_TOKEN,
      allowedOrigins: [
        ...new Set([
          new URL(BASE_URL).origin,
          new URL(SIGNED_OUT_BASE_URL).origin,
        ]),
      ],
    });
    designId = await readSeedDesignId();
    linkedScreenId = await createLinkedScreen(browser, designId);
    await setDesignVisibility(browser, designId, "public");
    const collaborationDesign = await createOwnedVisualEditDesign(browser);
    collaborationDesignId = collaborationDesign.designId;
    collaborationScreenId = collaborationDesign.screenIds[0]!;
    collaborationSecondScreenId = collaborationDesign.screenIds[1]!;
    await setDesignVisibility(browser, collaborationDesignId, "public");
  });

  test.afterAll(async ({ browser }) => {
    try {
      if (designId) {
        if (linkedScreenId) await deleteLinkedScreen(browser, linkedScreenId);
        await setDesignVisibility(browser, designId, "private");
      }
      if (collaborationDesignId) {
        await setLiveCollaboration(browser, collaborationDesignId, false);
        await setDesignVisibility(browser, collaborationDesignId, "private");
        await deleteDesign(browser, collaborationDesignId);
      }
      for (const id of throwawayDesignIds.splice(0))
        await deleteDesign(browser, id);
    } finally {
      await closeServer(visualEditBridge?.server ?? null);
      visualEditBridge = null;
      await closeServer(visualEditTargetServer);
      visualEditTargetServer = null;
    }
  });

  // fixme: fails on current main after the merge: Error: open-visual-edit failed: 400 {"error":"Browser visual-edit requests cannot include bridge credentials.
  test.fixme("loads the public /visual-edit route without a session and stays crash-free", async ({
    browser,
  }) => {
    const signedOut = await openSignedOutPage(
      browser,
      "/visual-edit",
      undefined,
      SIGNED_OUT_BASE_URL,
    );
    try {
      await expect(signedOut.page).toHaveURL(
        new RegExp(
          `${escapeRegExp(appUrl("/visual-edit", SIGNED_OUT_BASE_URL))}(?:[?#].*)?$`,
        ),
      );
      await expect(
        signedOut.page.getByRole("heading", { level: 1 }).first(),
      ).toBeVisible();
      await expect(
        signedOut.page.getByRole("heading", {
          name: /start with \/visual-edit/i,
        }),
      ).toBeVisible();
      await expect(
        signedOut.page.getByText(
          "npx @agent-native/core@latest skills add visual-edit",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        signedOut.page.getByRole("button", { name: /^copy$/i }),
      ).toBeVisible();
      await assertNoRuntimeErrors(signedOut);

      await signedOut.page.keyboard.press(SHORTCUT);
      await expect(
        signedOut.page.getByRole("dialog").filter({ visible: true }),
      ).toHaveCount(0);
      await assertNoRuntimeErrors(signedOut);
    } finally {
      await signedOut.close();
    }
  });

  // fixme: product bug: Both 'Preparing the live editor…' elements stay visible for 3s after editor-chrome-ready (bridge ready about 0.3s after mount); the frame
  test.fixme("reveals the local frame as soon as its editor bridge is ready", async ({
    browser,
    page,
  }) => {
    let createdDesignId: string | undefined;
    await page.addInitScript(() => {
      if (window.top !== window) return;
      const timing = {
        mountedAt: null as number | null,
        readyAt: null as number | null,
        loadAt: null as number | null,
      };
      const sourceWarningState = { visibleWhilePreparing: false };
      Object.defineProperty(window, "__visualEditFrameTiming", {
        configurable: false,
        value: timing,
      });
      Object.defineProperty(window, "__visualEditSourceWarningState", {
        configurable: false,
        value: sourceWarningState,
      });
      const mountTimes = new WeakMap<HTMLIFrameElement, number>();
      const watchedFrames = new WeakSet<HTMLIFrameElement>();
      const watchFrame = (element: Element) => {
        if (
          !(element instanceof HTMLIFrameElement) ||
          !element.matches("iframe[data-design-preview-iframe]") ||
          watchedFrames.has(element)
        ) {
          return;
        }
        watchedFrames.add(element);
        mountTimes.set(element, performance.now());
        element.addEventListener("load", () => {
          if (element.src.includes("slow")) timing.loadAt ??= performance.now();
        });
      };
      const scan = (node: Node) => {
        if (!(node instanceof Element)) return;
        watchFrame(node);
        node
          .querySelectorAll("iframe[data-design-preview-iframe]")
          .forEach(watchFrame);
      };
      const checkSourceWarning = () => {
        const frame = document.querySelector<HTMLIFrameElement>(
          'iframe[data-design-preview-iframe][src*="slow"]',
        );
        const wrapper = frame?.closest(".design-canvas-iframe-wrapper");
        const isPreparing = /preparing (?:the )?live editor/i.test(
          wrapper?.textContent ?? "",
        );
        const warningIsVisible = [
          ...document.querySelectorAll('[role="status"]'),
        ].some(
          (element) =>
            element.textContent?.trim() ===
              "No source locations available for this app." &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== "hidden",
        );
        if (isPreparing && warningIsVisible) {
          sourceWarningState.visibleWhilePreparing = true;
        }
      };
      new MutationObserver((records) => {
        for (const record of records) {
          record.addedNodes.forEach(scan);
          if (
            record.type === "attributes" &&
            record.target instanceof HTMLIFrameElement
          ) {
            watchFrame(record.target);
          }
        }
        checkSourceWarning();
      }).observe(document, {
        attributes: true,
        attributeFilter: ["src"],
        childList: true,
        subtree: true,
        characterData: true,
      });
      checkSourceWarning();
      window.addEventListener("message", (event) => {
        if (
          event.data?.type !== "agent-native:editor-chrome-ready" ||
          timing.readyAt !== null
        ) {
          return;
        }
        const frame = [
          ...document.querySelectorAll<HTMLIFrameElement>(
            'iframe[data-design-preview-iframe][src*="slow"]',
          ),
        ].find((candidate) => candidate.contentWindow === event.source);
        if (!frame) return;
        timing.mountedAt = mountTimes.get(frame) ?? performance.now();
        timing.readyAt = performance.now();
      });
    });

    const opened = await createOwnedVisualEditDesign(browser, {
      title: "Iframe load timing",
      paths: ["/slow"],
    });
    createdDesignId = opened.designId;

    try {
      if (!opened.urlPath) throw new Error("open-visual-edit returned no URL");

      await page.goto(
        `${BASE_URL}${opened.urlPath}&editorView=overview&zoom=50`,
        { waitUntil: "domcontentloaded" },
      );
      const slowScreenRow = page
        .locator("button[data-screen-row]")
        .filter({ hasText: "Localhost slow" });
      await expect(slowScreenRow).toBeVisible();
      await slowScreenRow.click();
      const editorFrame = page.locator(
        'iframe[data-design-preview-iframe][src*="live-edit"][src*="slow"]',
      );
      await expect(editorFrame).toBeAttached({ timeout: 30_000 });
      await page.waitForFunction(
        () => {
          const timing = (
            window as Window & {
              __visualEditFrameTiming?: { readyAt: number | null };
            }
          ).__visualEditFrameTiming;
          return typeof timing?.readyAt === "number";
        },
        undefined,
        { timeout: 30_000 },
      );

      const localScreen = editorFrame.contentFrame();
      await expect(
        page
          .locator(".design-canvas-iframe-wrapper")
          .filter({
            has: page.locator(
              'iframe[data-design-preview-iframe][src*="slow"]',
            ),
          })
          .getByText(/prepar.*live editor/i)
          .filter({ visible: true }),
        "the frame is revealed once its bridge is ready, not when its slow image finishes",
      ).toHaveCount(0, { timeout: 3_000 });
      await expect(
        localScreen.getByRole("heading", { name: "Delayed image frame" }),
      ).toBeVisible();
      expect(
        await localScreen
          .locator("#delayed-image")
          .evaluate((image) => !(image as HTMLImageElement).complete),
      ).toBe(true);
      const sourceWarningState = await page.evaluate(
        () =>
          (
            window as Window & {
              __visualEditSourceWarningState?: {
                visibleWhilePreparing: boolean;
              };
            }
          ).__visualEditSourceWarningState,
      );
      expect(sourceWarningState?.visibleWhilePreparing).toBe(false);

      await page.waitForFunction(
        () => {
          const timing = (
            window as Window & {
              __visualEditFrameTiming?: { loadAt: number | null };
            }
          ).__visualEditFrameTiming;
          return typeof timing?.loadAt === "number";
        },
        undefined,
        { timeout: 15_000 },
      );
      const timing = await page.evaluate(() => {
        const timing = (
          window as Window & {
            __visualEditFrameTiming?: {
              mountedAt: number | null;
              readyAt: number | null;
              loadAt: number | null;
            };
          }
        ).__visualEditFrameTiming;
        if (
          !timing ||
          timing.mountedAt === null ||
          timing.readyAt === null ||
          timing.loadAt === null
        ) {
          throw new Error("iframe timing events were not all observed");
        }
        return {
          bridgeReadyMs: Math.round(timing.readyAt - timing.mountedAt),
          fullLoadAfterReadyMs: Math.round(timing.loadAt - timing.readyAt),
        };
      });
      console.info(
        `[visual-edit-iframe-timing] bridge-ready=${timing.bridgeReadyMs}ms full-load-after-ready=${timing.fullLoadAfterReadyMs}ms`,
      );
    } finally {
      if (createdDesignId) throwawayDesignIds.push(createdDesignId);
    }
  });

  // fixme: fails in CI on current main: open-visual-edit failed: 400 {"error":"Browser visual-edit requests cannot include bridge credentials. Register the
  test.fixme("stops preparing when live bridge registration is rejected", async ({
    app,
    browser,
    page,
  }) => {
    app.allowFailure(
      /status of 401 \(Unauthorized\)/,
      "the routed bridge rejects every registration with 401",
    );
    await page.context().grantPermissions(["local-network-access"], {
      origin: new URL(BASE_URL).origin,
    });
    const created = await createOwnedVisualEditDesign(browser);
    let registrationAttempts = 0;
    await page.route("**/live-edit-bridge", async (route) => {
      const request = route.request();
      const requestHeaders = request.headers();
      const origin = requestHeaders.origin ?? "*";
      if (request.method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-origin": origin,
            "access-control-allow-methods":
              requestHeaders["access-control-request-method"] ?? "POST",
            "access-control-allow-headers":
              requestHeaders["access-control-request-headers"] ?? "",
          },
        });
        return;
      }
      if (request.method() !== "POST") {
        await route.continue();
        return;
      }
      registrationAttempts += 1;
      await route.fulfill({
        status: 401,
        headers: { "access-control-allow-origin": origin },
        body: "Invalid or missing preview token",
      });
    });

    try {
      await page.goto(
        appUrl(`/visual-edit/${created.designId}?editorView=overview`),
        { waitUntil: "domcontentloaded" },
      );
      const frame = page.locator("iframe[data-design-preview-iframe]").first();
      await expect(frame).toBeAttached();
      await expect(
        page
          .getByText(
            "The running app is shielded until Design connects to the local bridge.",
          )
          .first(),
      ).toBeVisible();

      const preparing = page.getByText(/prepar.*live editor/i);
      await expect(preparing).toBeHidden();
      const settledSource = await frame.getAttribute("src");
      await page.waitForTimeout(2_500); // e2e-harness-ignore: negative stability window catches the reported spinner loop reappearing.

      expect(registrationAttempts).toBeGreaterThan(0);
      await expect(preparing).toBeHidden();
      await expect(frame).toHaveAttribute("src", settledSource!);
      await expect(
        page.getByRole("dialog", { name: "Connect your local screens" }),
        "a rejected preview token is not a local-network permission problem",
      ).toHaveCount(0);
    } finally {
      await page.unroute("**/live-edit-bridge");
      throwawayDesignIds.push(created.designId);
    }
  });

  // fixme: fails in CI on current main: open-visual-edit failed: 400 {"error":"Browser visual-edit requests cannot include bridge credentials. Register the
  test.fixme("rejects forged bare-link editor access", async ({
    app,
    browser,
  }) => {
    const before = await app.savedRecord(designId);
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: {
        "X-Agent-Native-Frontend": "1",
        Origin: new URL(BASE_URL).origin,
        "Sec-Fetch-Site": "same-origin",
      },
    });
    try {
      const directResponse = await context.request.get(
        appUrl(`/visual-edit/${designId}`),
      );
      expect(directResponse.ok()).toBe(true);
      expect(directResponse.url()).toBe(appUrl(`/visual-edit/${designId}`));
      const directHtml = await directResponse.text();
      expect(directHtml).not.toContain("/_agent-native/embed/start");
      expect(directHtml).not.toMatch(/__an_embed_token=[^&"<]*/);

      const response = await context.request.post(
        appUrl("/_agent-native/actions/issue-visual-edit-access"),
        { data: { designId } },
      );
      expect(response.status()).toBe(401);
      expect(await response.text()).not.toContain("/_agent-native/embed/start");

      const forgedFileWrite = await context.request.post(
        appUrl("/_agent-native/actions/update-file"),
        {
          data: {
            id: linkedScreenId,
            content: "forged anonymous source write",
          },
        },
      );
      expect([401, 403]).toContain(forgedFileWrite.status());

      const forgedDesignWrite = await context.request.post(
        appUrl("/_agent-native/actions/update-design"),
        {
          data: {
            id: designId,
            data: JSON.stringify({ title: "forged anonymous design write" }),
          },
        },
      );
      expect([401, 403]).toContain(forgedDesignWrite.status());
      const after = await app.savedRecord(designId);
      expect(
        after.files.find((file) => file.id === linkedScreenId)?.content,
      ).toBe(before.files.find((file) => file.id === linkedScreenId)?.content);
      expect(after.data, "the forged design write left no trace").toEqual(
        before.data,
      );
    } finally {
      await context.close();
    }
  });

  // fixme: fails in CI on current main: open-visual-edit returns 400, browser requests can no longer include bridge credentials; re-author via a trusted bridge
  test.fixme("public /visual-edit viewers cannot get local bridge credentials", async ({
    browser,
  }) => {
    const signedOut = await openSignedOutPage(
      browser,
      "/visual-edit",
      undefined,
      SIGNED_OUT_BASE_URL,
    );
    const updateFileRequests: string[] = [];
    const bridgeResponses: string[] = [];
    const bridgeAttestationResponses: Array<{
      status: number;
      hasPreviewToken: boolean;
      hasAttestationChallenge: boolean;
    }> = [];
    signedOut.page.on("request", (request) => {
      const requestUrl = new URL(request.url());
      if (requestUrl.pathname.endsWith("/_agent-native/actions/update-file")) {
        updateFileRequests.push(`${request.method()} ${requestUrl.pathname}`);
      }
    });
    try {
      if (!visualEditBridge) {
        throw new Error("visual-edit bridge is not running");
      }
      const bridgeInput = {
        bridgeUrl: visualEditBridge.manifest.bridgeUrl,
        bridgeToken: VISUAL_EDIT_BRIDGE_TOKEN,
        rootPath: visualEditBridge.manifest.rootPath,
      };
      const blockedOrigins = new Set([
        new URL(visualEditBridge.manifest.bridgeUrl).origin,
        new URL(visualEditTargetUrl).origin,
      ]);
      const bridgeOrigin = new URL(visualEditBridge.manifest.bridgeUrl).origin;
      signedOut.page.on("response", (response) => {
        const responseUrl = new URL(response.url());
        // open-visual-edit reads this token-protected manifest to attest the local connector.
        if (
          responseUrl.origin === bridgeOrigin &&
          responseUrl.pathname === "/manifest.json"
        ) {
          bridgeAttestationResponses.push({
            status: response.status(),
            hasPreviewToken: responseUrl.searchParams.has("previewToken"),
            hasAttestationChallenge: responseUrl.searchParams.has(
              "attestationChallenge",
            ),
          });
          return;
        }
        if (blockedOrigins.has(responseUrl.origin)) {
          const request = response.request();
          bridgeResponses.push(
            `${request.method()} ${response.status()} ${responseUrl.origin}${responseUrl.pathname} (${request.resourceType()})`,
          );
        }
      });
      await expect
        .poll(
          () =>
            signedOut.page.evaluate(() => {
              const status = (
                window as Window & {
                  __agentNativeWebMcpStatus?: {
                    state?: string;
                    registered?: number;
                    total?: number;
                    error?: string;
                  };
                }
              ).__agentNativeWebMcpStatus;
              return status ?? null;
            }),
          { timeout: 15_000 },
        )
        .toMatchObject({ state: "ready" });

      const preflightPromise = signedOut.page.evaluate(
        ({ devServerUrl, bridgeInput }) => {
          const helper = (
            window as typeof window & {
              __agentNativeWebMcp?: {
                call(
                  name: string,
                  args?: Record<string, unknown>,
                ): Promise<unknown>;
              };
            }
          ).__agentNativeWebMcp;
          if (!helper) throw new Error("WebMCP page helper missing");
          return helper.call("open-visual-edit", {
            devServerUrl,
            paths: ["/"],
            navigate: false,
            ...bridgeInput,
          });
        },
        { devServerUrl: visualEditTargetUrl, bridgeInput },
      );
      const dialog = signedOut.page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: /open visual edit/i }).click();
      const preflight = await preflightPromise;
      expect(preflight).toMatchObject({
        state: "done",
        ok: true,
        tool: "open-visual-edit",
      });
      const preflightResult = (
        preflight as { result?: Record<string, unknown> }
      ).result;
      expect(preflightResult?.designId).toEqual(expect.any(String));
      expect(preflightResult?.connectionId).toEqual(expect.any(String));
      expect(preflightResult?.publicReadOnly).toBe(true);

      const publicDesignResponse = await signedOut.page
        .context()
        .request.get(
          appUrl("/_agent-native/actions/get-design", SIGNED_OUT_BASE_URL),
          { params: { id: String(preflightResult?.designId) } },
        );
      expect(
        publicDesignResponse.status(),
        await publicDesignResponse.text(),
      ).toBe(200);
      expect(await publicDesignResponse.json()).toMatchObject({
        id: preflightResult?.designId,
        visibility: "public",
        accessRole: "viewer",
      });

      const previewCredentialResponse = signedOut.page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith(
            "/actions/refresh-localhost-preview-token",
          ),
        { timeout: 30_000 },
      );
      await signedOut.page.evaluate(
        ({ designId, devServerUrl, bridgeInput }) => {
          const helper = (
            window as typeof window & {
              __agentNativeWebMcp?: {
                call(
                  name: string,
                  args?: Record<string, unknown>,
                ): Promise<unknown>;
              };
            }
          ).__agentNativeWebMcp;
          if (!helper) throw new Error("WebMCP page helper missing");
          void helper
            .call("open-visual-edit", {
              designId,
              devServerUrl,
              paths: ["/"],
              ...bridgeInput,
            })
            .catch(() => {
              // Navigation may abort this promise after the editor opens.
            });
        },
        {
          designId: preflightResult?.designId,
          devServerUrl: visualEditTargetUrl,
          bridgeInput,
        },
      );
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: /open visual edit/i }).click();
      await signedOut.page.waitForURL(
        /\/visual-edit\/[^?]+\?.*__an_embed_token=/,
        { timeout: 30_000, waitUntil: "domcontentloaded" },
      );
      await expect(signedOut.page.locator("[data-design-editor]")).toBeVisible({
        timeout: 30_000,
      });

      const credentialResponse = await previewCredentialResponse;
      expect(credentialResponse.status()).toBe(200);
      const credentialBody = await credentialResponse.json();
      const credentialPayload =
        credentialBody.result ?? credentialBody.data ?? credentialBody;
      const openedConnectionId = String(preflightResult?.connectionId);
      const previewCredentials =
        credentialPayload.connections?.[openedConnectionId] ??
        credentialPayload;
      expect(previewCredentials).toMatchObject({
        status: "unavailable",
        errorCode: "public_localhost_preview_unavailable",
      });
      expect(previewCredentials.previewToken).toBeUndefined();
      expect(previewCredentials.liveEditCapability).toBeUndefined();
      expect(previewCredentials.liveEditRegistrationCapability).toBeUndefined();

      const unavailableAlert = signedOut.page.getByRole("alert").filter({
        hasText: "Localhost previews are not shared with public viewers.",
      });
      await expect(unavailableAlert).toBeVisible();
      await expect(
        unavailableAlert.getByRole("button", { name: /retry/i }),
      ).toHaveCount(0);
      expect(bridgeAttestationResponses.length).toBeGreaterThan(0);
      expect(
        bridgeAttestationResponses.every(
          ({ status, hasPreviewToken, hasAttestationChallenge }) =>
            status === 200 && hasPreviewToken && hasAttestationChallenge,
        ),
      ).toBe(true);
      expect(updateFileRequests).toEqual([]);
      expect(bridgeResponses).toEqual([]);
      await assertNoRuntimeErrors(signedOut);
    } finally {
      await signedOut.close();
    }
  });

  test("authenticated public design links register WebMCP actions", async ({
    page,
  }) => {
    await page.goto(appUrl(`/design/${designId}`), {
      waitUntil: "domcontentloaded",
    });
    const cdp = await page.context().newCDPSession(page);
    const readWebMcpState = async () => {
      const { result } = await cdp.send("Runtime.evaluate", {
        expression: `(async () => {
          const modelContext = document.modelContext;
          const status = window.__agentNativeWebMcpStatus;
          const tools =
            modelContext && typeof modelContext.getTools === "function"
              ? await modelContext.getTools()
              : [];
          return {
            helper: Boolean(window.__agentNativeWebMcp),
            modelContext: Boolean(modelContext),
            status: status
              ? {
                  state: status.state,
                  registered: status.registered,
                  total: status.total,
                }
              : null,
            toolCount: tools.length,
            toolNames: tools.map((tool) => tool.name),
          };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      return result.value as {
        helper: boolean;
        modelContext: boolean;
        status: {
          state: string;
          registered: number;
          total: number;
        } | null;
        toolCount: number;
        toolNames: string[];
      };
    };

    await expect.poll(readWebMcpState, { timeout: 15_000 }).toMatchObject({
      helper: true,
      modelContext: true,
      status: { state: "ready" },
      toolNames: expect.arrayContaining(["get-visual-edit-prompt"]),
    });
    expect((await readWebMcpState()).toolCount).toBeGreaterThan(0);
    const promptCall = await page.evaluate(async () => {
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
    });
    expect(promptCall).toMatchObject({
      state: "done",
      ok: true,
      tool: "get-visual-edit-prompt",
      result: {
        designId,
        pendingEditCount: 0,
        status: "empty",
      },
    });
  });

  test("public /design/:id renders read-only and stays crash-free", async ({
    app,
    browser,
  }) => {
    const savedBefore = await app.savedHtml(designId);
    const signedOut = await openSignedOutPage(browser, `/design/${designId}`);
    try {
      await expect(
        ownScreenFrame(signedOut.page).getByText("E2E Hero Heading"),
      ).toBeVisible();
      const publicIframe = signedOut.page
        .locator("iframe[data-design-preview-iframe]")
        .last();
      await expect(publicIframe).toBeVisible();
      await publicIframe.evaluate((element) => {
        const frame = element as HTMLIFrameElement & {
          __publicReadOnlyLoadCount?: number;
        };
        frame.dataset.publicReadOnlyIdentity = "stable-public-preview";
        frame.__publicReadOnlyLoadCount = 0;
        frame.addEventListener("load", () => {
          frame.__publicReadOnlyLoadCount =
            (frame.__publicReadOnlyLoadCount ?? 0) + 1;
        });
      });
      await ownScreenFrame(signedOut.page)
        .locator("body")
        .evaluate(() => {
          (window as any).__publicReadOnlyDocumentMarker =
            "stable-public-document";
        });
      const expectStablePublicPreview = async () => {
        await expect
          .poll(async () => {
            const iframeState = await publicIframe.evaluate((element) => {
              const frame = element as HTMLIFrameElement & {
                __publicReadOnlyLoadCount?: number;
              };
              const style = getComputedStyle(frame);
              const rect = frame.getBoundingClientRect();
              return {
                identity: frame.dataset.publicReadOnlyIdentity ?? null,
                loads: frame.__publicReadOnlyLoadCount ?? -1,
                visible:
                  frame.isConnected &&
                  style.display !== "none" &&
                  style.visibility !== "hidden" &&
                  Number(style.opacity) !== 0 &&
                  rect.width > 0 &&
                  rect.height > 0,
              };
            });
            const documentMarker = await ownScreenFrame(signedOut.page)
              .locator("body")
              .evaluate(
                () => (window as any).__publicReadOnlyDocumentMarker ?? null,
              )
              .catch(() => null);
            return { ...iframeState, documentMarker };
          })
          .toEqual({
            identity: "stable-public-preview",
            documentMarker: "stable-public-document",
            loads: 0,
            visible: true,
          });
      };
      await expect(
        signedOut.page.getByRole("link", { name: /^sign up$/i }).first(),
      ).toBeVisible();
      await expect(
        signedOut.page.getByRole("link", { name: /^share$/i }),
      ).toHaveCount(1);

      signedOut.mutationRequests.length = 0;
      await installBridge(signedOut.page);
      await signedOut.page.evaluate(() => {
        (window as any).__bridge = [];
      });
      const heading = ownScreenFrame(signedOut.page)
        .getByText("E2E Hero Heading")
        .first();
      const headingBox = await heading.boundingBox();
      expect(headingBox).toBeTruthy();
      await signedOut.page.mouse.click(
        (headingBox?.x ?? 0) + (headingBox?.width ?? 0) / 2,
        (headingBox?.y ?? 0) + (headingBox?.height ?? 0) / 2,
      );
      await signedOut.page.keyboard.type("read-only check");
      await signedOut.page.keyboard.press("Backspace");
      await signedOut.page.keyboard.press("Delete");
      await signedOut.page.mouse.dblclick(
        (headingBox?.x ?? 0) + (headingBox?.width ?? 0) / 2,
        (headingBox?.y ?? 0) + (headingBox?.height ?? 0) / 2,
      );
      await signedOut.page.keyboard.type("double-click edit");
      await signedOut.page.keyboard.press("Escape");

      expect(signedOut.mutationRequests).toEqual([]);
      await expect
        .poll(async () =>
          (await bridgeMessages(signedOut.page)).some((message) =>
            /^(visual-style-change|visual-structure-change|visual-duplicate-change|text-content-change)$/.test(
              String(message?.type ?? ""),
            ),
          ),
        )
        .toBe(false);
      await expect(
        ownScreenFrame(signedOut.page).getByText("E2E Hero Heading"),
      ).toBeVisible();
      await expectStablePublicPreview();

      await signedOut.page.keyboard.press(SHORTCUT);
      await expect(
        signedOut.page.getByRole("dialog").filter({ visible: true }),
      ).toHaveCount(0);
      await expectStablePublicPreview();
      await assertNoRuntimeErrors(signedOut);
      // Outlasts the editor's 600ms save debounce, so a save the keys triggered would have been sent.
      await signedOut.page.waitForTimeout(800);
      expect(signedOut.mutationRequests).toEqual([]);
      expect(
        await app.savedHtml(designId),
        "nothing a viewer typed reached the saved screen",
      ).toBe(savedBefore);
    } finally {
      await signedOut.close();
    }
  });

  test("public /design/:id explains that connected localhost screens are unavailable", async ({
    browser,
  }) => {
    const previewCredentialRequests: string[] = [];
    const signedOut = await openSignedOutPage(
      browser,
      `/design/${collaborationDesignId}`,
      (page) => {
        page.on("request", (request) => {
          const pathname = new URL(request.url()).pathname;
          if (
            pathname.endsWith("/actions/refresh-localhost-preview-token") ||
            actionBatchIncludesAction(
              request,
              "refresh-localhost-preview-token",
            )
          ) {
            previewCredentialRequests.push(pathname);
          }
        });
      },
    );
    try {
      const unavailableAlert = signedOut.page.getByRole("alert").filter({
        hasText: "Localhost previews are not shared with public viewers.",
      });
      await expect(unavailableAlert).toHaveCount(2);
      await expect(unavailableAlert.first()).toBeVisible();
      await expect(unavailableAlert.nth(1)).toBeVisible();
      await expect(
        unavailableAlert.getByRole("button", { name: /retry/i }),
      ).toHaveCount(0);
      await expect(
        signedOut.page.locator(
          `iframe[data-design-preview-iframe][src*="${visualEditTargetUrl}"]`,
        ),
      ).toHaveCount(0);
      expect(previewCredentialRequests).toEqual([]);
      expect(signedOut.mutationRequests).toEqual([]);
      await assertNoRuntimeErrors(signedOut);
    } finally {
      await signedOut.close();
    }
  });

  test("public design links restore the requested overview screen", async ({
    browser,
  }) => {
    const pathname = `/design/${designId}?view=overview&screen=${linkedScreenId}&zoom=60`;
    const homeScreenId = await indexScreenId(browser, designId);
    const signedOut = await openSignedOutPage(browser, pathname);
    try {
      await expect(
        designFrame(signedOut.page, linkedScreenId).getByText(
          "Linked public screen",
        ),
      ).toBeVisible();
      await expect(signedOut.page).toHaveURL(
        new RegExp(`screen=${escapeRegExp(linkedScreenId)}`),
      );
      const view = signedOut.page.viewportSize()!;
      const screenBox = async (fileId: string) =>
        (await signedOut.page
          .locator(`iframe[data-screen-iframe-id="${fileId}"]`)
          .boundingBox())!;
      await expect
        .poll(
          async () => {
            const linked = await screenBox(linkedScreenId);
            const home = await screenBox(homeScreenId);
            return {
              linkedWidth: Math.round(linked.width),
              linkedInView:
                linked.x >= 0 &&
                linked.y >= 0 &&
                linked.x + linked.width <= view.width &&
                linked.y + linked.height <= view.height,
              homeInView: home.y >= 0 && home.y + home.height <= view.height,
            };
          },
          {
            message:
              "the camera frames the linked screen at the linked 60% zoom, not the first screen",
          },
        )
        .toEqual({ linkedWidth: 768, linkedInView: true, homeInView: false });
      expect(signedOut.mutationRequests).toEqual([]);
      await assertNoRuntimeErrors(signedOut);
    } finally {
      await signedOut.close();
    }
  });

  test("signed-out save and share buttons send visitors to the sign-in return URL", async ({
    browser,
  }) => {
    await expectReturnUrl(
      browser,
      `/design/${designId}`,
      (page) =>
        page
          .getByRole("link")
          .filter({ hasText: /^sign up$/i })
          .first(),
      appReturnPath(`/design/${designId}?intent=save`),
    );

    await expectReturnUrl(
      browser,
      `/design/${designId}`,
      (page) => page.getByRole("link", { name: /^share$/i }).first(),
      appReturnPath(`/design/${designId}?intent=share`),
    );
  });

  test("signed-out live canvas sharing requires sign-in and returns to the canvas", async ({
    browser,
  }) => {
    await expectSharePopoverReturnUrl(
      browser,
      `/visual-edit/${collaborationDesignId}?editorView=overview`,
      appReturnPath(`/visual-edit/${collaborationDesignId}?intent=share`),
    );
  });

  // fixme: product bug: The Switch track's background is rgba(0,0,0,0) both off and on (the toolkit's data-[state] bg classes don't take effect), so the on/off
  test.fixme("live collaboration can be enabled from Share by a signed-in editor", async ({
    browser,
    page,
  }) => {
    await setLiveCollaboration(browser, collaborationDesignId, false);
    await page.goto(
      appUrl(`/visual-edit/${collaborationDesignId}?editorView=overview`),
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.locator("[data-design-editor]")).toBeVisible();
    await expect(
      designFrame(page, collaborationScreenId).getByRole("heading", {
        name: "Local visual edit",
      }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByRole("tab", { name: "Live collaboration" }).click();
    const collaborationToggle = page.getByRole("switch", {
      name: "Live collaboration",
    });
    await expect(collaborationToggle).toHaveAttribute("aria-checked", "false");
    const trackColor = () =>
      collaborationToggle.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
    const offColor = await trackColor();
    const published = page.waitForResponse((response) =>
      response.url().includes("/publish-visual-edit-snapshot"),
    );

    await collaborationToggle.click();

    await expect(collaborationToggle).toHaveAttribute("aria-checked", "true");
    expect
      .soft(
        await trackColor(),
        "the switch track shows the on state, not the off colour",
      )
      .not.toBe(offColor);
    expect(
      (await published).status(),
      "enabling publishes the live snapshot guests will see",
    ).toBe(200);
    const saved = await page.request.get(
      appUrl(
        `/_agent-native/actions/get-visual-edit-collaboration?designId=${collaborationDesignId}`,
      ),
    );
    expect(await saved.json()).toEqual({
      designId: collaborationDesignId,
      enabled: true,
    });
  });

  test("keeps public snapshot edits with the guest until they share them", async ({
    browser,
    page,
  }) => {
    await setLiveCollaboration(browser, collaborationDesignId, true);
    const localNetworkCdp = await page.context().newCDPSession(page);
    await localNetworkCdp.send("Browser.grantPermissions", {
      origin: new URL(BASE_URL).origin,
      permissions: ["localNetworkAccess"],
    });
    const ownerSnapshotStatuses: number[] = [];
    const ownerSnapshotPublicationCounts = new Map<string, number>();
    page.on("response", (response) => {
      if (response.url().includes("/publish-visual-edit-snapshot")) {
        ownerSnapshotStatuses.push(response.status());
        void response
          .json()
          .then(
            (body: {
              designId?: string;
              fileId?: string;
              published?: boolean;
            }) => {
              if (
                body.designId === collaborationDesignId &&
                body.fileId &&
                body.published === true
              ) {
                ownerSnapshotPublicationCounts.set(
                  body.fileId,
                  (ownerSnapshotPublicationCounts.get(body.fileId) ?? 0) + 1,
                );
              }
            },
          )
          .catch(() => {});
      }
    });
    await page.goto(
      appUrl(
        `/visual-edit/${collaborationDesignId}?editorView=overview&screen=${encodeURIComponent(collaborationScreenId)}`,
      ),
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.locator("[data-design-editor]")).toBeVisible({
      timeout: 30_000,
    });
    const ownerFrame = designFrame(page, collaborationScreenId);
    await expect(
      ownerFrame.getByRole("heading", { name: "Local visual edit" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        () => ownerSnapshotPublicationCounts.get(collaborationScreenId) ?? 0,
      )
      .toBeGreaterThan(0);
    const ownerSecondFrame = designFrame(page, collaborationSecondScreenId);
    const secondOwnerScreenRow = page
      .locator("[data-screen-row]")
      .filter({ hasText: "Localhost settings" });
    await secondOwnerScreenRow.click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("screen"))
      .toBe(collaborationSecondScreenId);
    await expect(
      ownerSecondFrame.getByRole("heading", { name: "Local visual edit" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        () =>
          ownerSnapshotPublicationCounts.get(collaborationSecondScreenId) ?? 0,
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    const firstOwnerScreenRow = page
      .locator("[data-screen-row]")
      .filter({ hasText: "Localhost home" });
    await firstOwnerScreenRow.click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("screen"))
      .toBe(collaborationScreenId);
    await expect(
      ownerFrame.getByRole("heading", { name: "Local visual edit" }),
    ).toBeVisible({ timeout: 30_000 });
    const allScreensButton = page.getByRole("button", {
      name: "All screens",
    });
    await allScreensButton.click();
    await expect(allScreensButton).toHaveAttribute("aria-current", "page");

    await page.getByRole("button", { name: /^share$/i }).click();
    await expect(
      page.getByText("Live canvas link", { exact: true }),
    ).toBeVisible();
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: new URL(page.url()).origin,
      });
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain(`/visual-edit/${collaborationDesignId}?share=1`);
    await page.keyboard.press("Escape");

    await expectSharePopoverReturnUrl(
      browser,
      `/design/${collaborationDesignId}`,
      appReturnPath(`/design/${collaborationDesignId}?intent=share`),
    );

    const guestSnapshotHtmlByFile = new Map<string, string>();
    const guestSnapshotRequestCounts = new Map<string, number>();
    const guest = await openSignedOutPage(
      browser,
      `/visual-edit/${collaborationDesignId}?share=1&editorView=overview&screen=${encodeURIComponent(collaborationScreenId)}`,
      (guestPage) => {
        guestPage.on("request", (request) => {
          for (const { fileId } of visualEditSnapshotRequestEntries(request)) {
            guestSnapshotRequestCounts.set(
              fileId,
              (guestSnapshotRequestCounts.get(fileId) ?? 0) + 1,
            );
          }
        });
        guestPage.on("response", async (response) => {
          if (visualEditSnapshotRequestEntries(response.request()).length === 0)
            return;
          let payload: unknown;
          try {
            payload = await response.json();
          } catch {
            return;
          }
          for (const snapshotResponse of visualEditSnapshotResponseEntries(
            response.request(),
            response.status(),
            payload,
          )) {
            rememberFullVisualEditSnapshotHtml(
              guestSnapshotHtmlByFile,
              snapshotResponse,
            );
          }
        });
      },
    );
    try {
      const guestFrame = designFrame(guest.page, collaborationScreenId);
      await expect
        .poll(
          () =>
            [collaborationScreenId, collaborationSecondScreenId].map(
              (fileId) =>
                guestSnapshotHtmlByFile
                  .get(fileId)
                  ?.includes("Local visual edit") ?? false,
            ),
          { timeout: 15_000 },
        )
        .toEqual([true, true]);
      await expect(
        guestFrame.getByRole("heading", { name: "Local visual edit" }),
      ).toBeVisible({ timeout: 30_000 });
      const secondGuestFrame = designFrame(
        guest.page,
        collaborationSecondScreenId,
      );
      await expect(
        secondGuestFrame.getByRole("heading", { name: "Local visual edit" }),
      ).toBeVisible({ timeout: 30_000 });
      const guestIframe = guest.page.locator(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${collaborationScreenId}"]`,
      );
      await expect(guestIframe).not.toHaveAttribute(
        "src",
        new RegExp(escapeRegExp(visualEditTargetUrl)),
      );
      await expect(guestIframe).toHaveAttribute("srcdoc", /Local visual edit/);

      const firstScreenInitialReads =
        guestSnapshotRequestCounts.get(collaborationScreenId) ?? 0;
      await selectByText(guest.page, "Local visual edit", {
        screenId: collaborationScreenId,
      });
      await expect
        .poll(
          () => guestSnapshotRequestCounts.get(collaborationScreenId) ?? 0,
          { timeout: 5_000 },
        )
        .toBeGreaterThan(firstScreenInitialReads);
      const firstScreenReads =
        guestSnapshotRequestCounts.get(collaborationScreenId) ?? 0;
      const secondScreenReads =
        guestSnapshotRequestCounts.get(collaborationSecondScreenId) ?? 0;
      await expect
        .poll(
          () => guestSnapshotRequestCounts.get(collaborationScreenId) ?? 0,
          { timeout: 5_000 },
        )
        .toBeGreaterThan(firstScreenReads);
      expect(
        guestSnapshotRequestCounts.get(collaborationSecondScreenId) ?? 0,
      ).toBe(secondScreenReads);

      const secondScreenRow = guest.page
        .locator("[data-screen-row]")
        .filter({ hasText: "Localhost settings" });
      await expect(secondScreenRow).toHaveCount(1);
      await secondScreenRow.click();
      await expect
        .poll(() => new URL(guest.page.url()).searchParams.get("screen"))
        .toBe(collaborationSecondScreenId);
      await expect
        .poll(
          () =>
            guestSnapshotRequestCounts.get(collaborationSecondScreenId) ?? 0,
          { timeout: 15_000 },
        )
        .toBeGreaterThan(secondScreenReads);
      await expect(
        secondGuestFrame.getByRole("heading", { name: "Local visual edit" }),
      ).toBeVisible({ timeout: 30_000 });
      const firstScreenReadsAfterSwitch =
        guestSnapshotRequestCounts.get(collaborationScreenId) ?? 0;
      const secondScreenReadsAfterSwitch =
        guestSnapshotRequestCounts.get(collaborationSecondScreenId) ?? 0;
      await expect
        .poll(
          () =>
            guestSnapshotRequestCounts.get(collaborationSecondScreenId) ?? 0,
          { timeout: 5_000 },
        )
        .toBeGreaterThan(secondScreenReadsAfterSwitch);
      expect(guestSnapshotRequestCounts.get(collaborationScreenId) ?? 0).toBe(
        firstScreenReadsAfterSwitch,
      );

      const firstScreenReadsBeforeRefocus =
        guestSnapshotRequestCounts.get(collaborationScreenId) ?? 0;
      const firstScreenRow = guest.page
        .locator("[data-screen-row]")
        .filter({ hasText: "Localhost home" });
      await firstScreenRow.click();
      await expect
        .poll(() => new URL(guest.page.url()).searchParams.get("screen"))
        .toBe(collaborationScreenId);
      await selectByText(guest.page, "Local visual edit", {
        screenId: collaborationScreenId,
      });
      await expect
        .poll(
          () => guestSnapshotRequestCounts.get(collaborationScreenId) ?? 0,
          { timeout: 5_000 },
        )
        .toBeGreaterThan(firstScreenReadsBeforeRefocus);

      await firstOwnerScreenRow.click();
      await expect
        .poll(() => new URL(page.url()).searchParams.get("screen"))
        .toBe(collaborationScreenId);
      const ownerPublicationsBeforeEdit = ownerSnapshotStatuses.filter(
        (status) => status === 200,
      ).length;
      await page.evaluate(() => {
        const state = { messages: [] as string[] };
        Object.defineProperty(window, "__visualEditCollabMessages", {
          configurable: true,
          value: state,
        });
        window.addEventListener("message", (event) => {
          if (typeof event.data?.type === "string") {
            state.messages.push(event.data.type);
          }
        });
      });
      await ownerFrame.locator("h1").evaluate(() => {
        const route = new URL(window.location.href);
        route.searchParams.set("e2eRoute", "account");
        window.history.pushState({}, "", route);
        document.querySelector("h1")!.textContent = "Owner updated canvas";
      });
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as Window & {
                  __visualEditCollabMessages?: { messages: string[] };
                }
              ).__visualEditCollabMessages?.messages ?? [],
          ),
        )
        .toContain("agent-native:live-route-path");
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as Window & {
                  __visualEditCollabMessages?: { messages: string[] };
                }
              ).__visualEditCollabMessages?.messages ?? [],
          ),
        )
        .toContain("agent-native:runtime-layer-snapshot");
      await expect(
        ownerFrame.getByRole("heading", { name: "Owner updated canvas" }),
      ).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(
          () => ownerSnapshotStatuses.filter((status) => status === 200).length,
        )
        .toBeGreaterThan(ownerPublicationsBeforeEdit);
      await expect(
        guestFrame.getByRole("heading", { name: "Owner updated canvas" }),
      ).toBeVisible({ timeout: 20_000 });
      const ownerMain = ownerFrame.locator("main");
      const ownerMainBefore = (await ownerMain.boundingBox())!;

      const publicationRequests: string[] = [];
      const isPendingPublicationRequest = (request: {
        url(): string;
        method(): string;
      }) => {
        const pathname = new URL(request.url()).pathname;
        return (
          request.method() === "POST" &&
          (pathname.endsWith("/live-edit-pending") ||
            pathname.endsWith("/publish-visual-edit-pending"))
        );
      };
      const trackPendingPublication = (request: {
        url(): string;
        method(): string;
      }) => {
        if (isPendingPublicationRequest(request)) {
          const pathname = new URL(request.url()).pathname;
          publicationRequests.push(pathname);
        }
      };
      guest.page.on("request", trackPendingPublication);
      page.on("request", trackPendingPublication);
      await enterDirectMode(guest.page, { screenId: collaborationScreenId });
      await installBridge(guest.page);
      const heading = guestFrame.getByRole("heading", {
        name: "Owner updated canvas",
      });
      const headingBox = await heading.boundingBox();
      expect(headingBox).toBeTruthy();
      await guest.page.evaluate(() => ((window as any).__bridge = []));
      const modifier = process.platform === "darwin" ? "Meta" : "Control";
      await guest.page.keyboard.down(modifier);
      try {
        await guest.page.mouse.click(
          (headingBox?.x ?? 0) + (headingBox?.width ?? 0) / 2,
          (headingBox?.y ?? 0) + (headingBox?.height ?? 0) / 2,
        );
      } finally {
        await guest.page.keyboard.up(modifier);
      }
      const selection = await waitForBridge(guest.page, "element-select");
      const selected = selection?.payload ?? selection;
      expect(selected.textContent).toContain("Owner updated canvas");
      const resized = guestFrame.locator(
        `[data-agent-native-node-id="${selected.sourceId}"]`,
      );
      const before = await resized.boundingBox();
      expect(before).toBeTruthy();
      const handle = guestFrame.locator('[data-agent-native-edge-handle="s"]');
      await expect(handle).toBeVisible({ timeout: 15_000 });
      const handleBox = await handle.boundingBox();
      expect(handleBox).toBeTruthy();
      await guest.page.mouse.move(
        (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2,
        (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2,
      );
      await guest.page.mouse.down();
      await guest.page.mouse.move(
        (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2,
        (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2 + 16,
        { steps: 8 },
      );
      await guest.page.mouse.up();
      await waitForBridge(guest.page, "visual-style-change", 15_000, {
        phase: "commit",
      });
      const after = (await resized.boundingBox())!;
      expect(
        Math.abs(after.height - before!.height - 16),
        `the selected layer grew ${after.height - before!.height}px for a 16px handle drag`,
      ).toBeLessThanOrEqual(1);
      await expect(
        guest.page.locator("[data-design-pending-visual-style-toolbar]"),
      ).toBeVisible();
      await expect(
        guest.page.getByRole("button", {
          name: "Copy agent prompt",
          exact: true,
        }),
      ).toBeVisible();
      // A share-only viewer can stage edits locally. Durable handoff to the
      // owner requires the editor capability used by the signed-out editor flow.
      const unexpectedPublicationRequest = await guest.page
        .waitForRequest(isPendingPublicationRequest, { timeout: 1_000 })
        .then(
          (request) => request.url(),
          (error: unknown) => {
            if (error instanceof Error && error.name === "TimeoutError") {
              return null;
            }
            throw error;
          },
        );
      expect(unexpectedPublicationRequest).toBeNull();
      expect(publicationRequests).toEqual([]);
      expect(
        (await ownerMain.boundingBox())!.height,
        "the owner never receives the guest's edit",
      ).toBe(ownerMainBefore.height);
      await expect(
        guest.page.getByRole("button", { name: "Apply edits", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Apply edits", exact: true }),
      ).toHaveCount(0);

      await page.screenshot({
        path: test.info().outputPath("visual-edit-collaboration-owner.png"),
      });
      await guest.page.screenshot({
        path: test.info().outputPath("visual-edit-collaboration-guest.png"),
      });
      await assertNoRuntimeErrors(guest);
    } finally {
      await guest.close();
    }
  });
});

async function listen(server: Server): Promise<{ host: string; port: number }> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || !address) {
        reject(new Error("Visual-edit target server did not bind."));
        return;
      }
      resolve({ host: address.address, port: address.port });
    });
  });
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function setDesignVisibility(
  browser: Browser,
  id: string,
  visibility: "public" | "private",
): Promise<void> {
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  try {
    const response = await context.request.post(
      `${BASE_URL}/_agent-native/actions/set-resource-visibility`,
      {
        data: {
          resourceType: "design",
          resourceId: id,
          visibility,
        },
      },
    );
    if (!response.ok()) {
      throw new Error(
        `set-resource-visibility(${visibility}) failed: ${response.status()} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as {
      visibility?: string;
      ok?: boolean;
    };
    expect(body.visibility ?? visibility).toBe(visibility);
  } finally {
    await context.close();
  }
}

async function setLiveCollaboration(
  browser: Browser,
  designId: string,
  enabled: boolean,
): Promise<void> {
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  try {
    const response = await context.request.post(
      appUrl("/_agent-native/actions/update-visual-edit-collaboration"),
      { data: { designId, enabled } },
    );
    if (!response.ok()) {
      throw new Error(
        `update-visual-edit-collaboration(${enabled}) failed: ${response.status()} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as {
      designId?: string;
      enabled?: boolean;
    };
    expect(body).toMatchObject({ designId, enabled });
  } finally {
    await context.close();
  }
}

async function indexScreenId(browser: Browser, id: string): Promise<string> {
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  try {
    const response = await context.request.get(
      appUrl(`/_agent-native/actions/get-design?id=${id}`),
    );
    expect(response.ok(), `get-design ${response.status()}`).toBe(true);
    const { files } = (await response.json()) as {
      files: { id: string; filename: string }[];
    };
    return files.find((file) => file.filename === "index.html")!.id;
  } finally {
    await context.close();
  }
}

async function createLinkedScreen(browser: Browser, designId: string) {
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  try {
    const response = await context.request.post(
      `${BASE_URL}/_agent-native/actions/create-file`,
      {
        data: {
          designId,
          filename: "linked-public-screen.html",
          fileType: "html",
          content:
            "<!doctype html><html><body><h1>Linked public screen</h1></body></html>",
        },
      },
    );
    if (!response.ok()) {
      throw new Error(
        `create-file failed: ${response.status()} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as { id?: string };
    if (!body.id) throw new Error("create-file returned no file ID");
    return body.id;
  } finally {
    await context.close();
  }
}

async function createOwnedVisualEditDesign(
  browser: Browser,
  options: { title?: string; paths?: string[] } = {},
): Promise<{ designId: string; screenIds: string[]; urlPath: string }> {
  if (!visualEditBridge) throw new Error("visual-edit bridge is not running");
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  let createdDesignId: string | undefined;
  try {
    const createResponse = await context.request.post(
      appUrl("/_agent-native/actions/create-design"),
      {
        data: {
          title: options.title ?? "E2E live canvas collaboration",
          projectType: "prototype",
        },
      },
    );
    if (!createResponse.ok()) {
      throw new Error(
        `create-design failed: ${createResponse.status()} ${await createResponse.text()}`,
      );
    }
    const created = (await createResponse.json()) as {
      id?: string;
      data?: { id?: string };
      design?: { id?: string };
    };
    createdDesignId = created.id ?? created.data?.id ?? created.design?.id;
    if (!createdDesignId)
      throw new Error("create-design returned no design ID");

    const response = await context.request.post(
      appUrl("/_agent-native/actions/open-visual-edit"),
      {
        data: {
          designId: createdDesignId,
          devServerUrl: visualEditTargetUrl,
          bridgeUrl: visualEditBridge.manifest.bridgeUrl,
          rootPath: visualEditBridge.manifest.rootPath,
          routeManifest: visualEditBridge.manifest,
          bridgeToken: VISUAL_EDIT_BRIDGE_TOKEN,
          paths: options.paths ?? ["/", "/settings"],
          navigate: false,
          publicReadOnly: false,
        },
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-Frontend": "1",
        },
      },
    );
    if (!response.ok()) {
      throw new Error(
        `open-visual-edit failed: ${response.status()} ${await response.text()}`,
      );
    }
    const result = (await response.json()) as {
      designId?: string;
      urlPath?: string;
      screens?: Array<{ id?: string }>;
    };
    const openedDesignId = result.designId;
    const screenIds = result.screens?.flatMap((screen) =>
      screen.id ? [screen.id] : [],
    );
    if (
      openedDesignId !== createdDesignId ||
      !screenIds ||
      screenIds.length < (options.paths ?? ["/", "/settings"]).length ||
      !result.urlPath
    ) {
      throw new Error("open-visual-edit returned no design or screen");
    }
    return { designId: openedDesignId, screenIds, urlPath: result.urlPath };
  } catch (error) {
    if (createdDesignId) {
      const cleanup = await context.request.post(
        appUrl("/_agent-native/actions/delete-design"),
        { data: { id: createdDesignId } },
      );
      if (!cleanup.ok()) {
        throw new Error(
          `Visual-edit setup failed (${String(error)}) and delete-design cleanup failed: ${cleanup.status()}`,
        );
      }
    }
    throw error;
  } finally {
    await context.close();
  }
}

async function deleteDesign(browser: Browser, id: string): Promise<void> {
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  try {
    const response = await context.request.post(
      appUrl("/_agent-native/actions/delete-design"),
      { data: { id } },
    );
    if (!response.ok()) {
      throw new Error(
        `delete-design failed: ${response.status()} ${await response.text()}`,
      );
    }
  } finally {
    await context.close();
  }
}

async function deleteLinkedScreen(browser: Browser, fileId: string) {
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  try {
    const response = await context.request.post(
      `${BASE_URL}/_agent-native/actions/delete-file`,
      { data: { id: fileId } },
    );
    if (!response.ok()) {
      throw new Error(
        `delete-file failed: ${response.status()} ${await response.text()}`,
      );
    }
  } finally {
    await context.close();
  }
}

async function openSignedOutPage(
  browser: Browser,
  pathname: string,
  beforeLoad?: (page: Page) => void,
  baseUrl = BASE_URL,
): Promise<SignedOutPage> {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const mutationRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text();
      if (
        /^Failed to load resource: the server responded with a status of 401\b/.test(
          text,
        )
      ) {
        return;
      }
      const location = message.location();
      consoleErrors.push(`${text} (${location.url}:${location.lineNumber})`);
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("request", (request) => {
    if (isActionMutationRequest(request)) {
      mutationRequests.push(new URL(request.url()).pathname);
    }
  });
  beforeLoad?.(page);

  await page.goto(appUrl(pathname, baseUrl), {
    waitUntil: "domcontentloaded",
  });

  return {
    page,
    consoleErrors,
    pageErrors,
    mutationRequests,
    close: async () => {
      await context.close();
    },
  };
}

async function expectReturnUrl(
  browser: Browser,
  pathname: string,
  getButton: (page: Page) => Locator,
  expectedReturnPath: string,
): Promise<void> {
  const signedOut = await openSignedOutPage(browser, pathname);
  try {
    const button = getButton(signedOut.page);
    await expect(button).toBeVisible();
    await button.click();
    await expect(signedOut.page).toHaveURL(/\/sign-in\?c=/);

    const url = new URL(signedOut.page.url());
    const continuation = url.searchParams.get("c");
    expect(continuation).toBeTruthy();
    expect(decodeContinuation(continuation)).toBe(expectedReturnPath);
    await assertNoRuntimeErrors(signedOut);
  } finally {
    await signedOut.close();
  }
}

async function expectSharePopoverReturnUrl(
  browser: Browser,
  pathname: string,
  expectedReturnPath: string,
): Promise<void> {
  const signedOut = await openSignedOutPage(browser, pathname);
  try {
    const share = signedOut.page.getByRole("button", {
      name: "Share",
      exact: true,
    });
    await expect(share).toBeVisible();
    await share.click();

    const signUp = signedOut.page.getByRole("link", {
      name: "Sign up to share a live canvas",
      exact: true,
    });
    await expect(signUp).toBeVisible();
    await signUp.hover();
    await expect(signUp).toBeVisible();
    await signUp.click();
    await expect(signedOut.page).toHaveURL(/\/sign-in\?c=/);

    const url = new URL(signedOut.page.url());
    const continuation = url.searchParams.get("c");
    expect(continuation).toBeTruthy();
    expect(decodeContinuation(continuation)).toBe(expectedReturnPath);
    await assertNoRuntimeErrors(signedOut);
  } finally {
    await signedOut.close();
  }
}

async function assertNoRuntimeErrors({
  consoleErrors,
  pageErrors,
}: PageRuntimeErrors): Promise<void> {
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) =>
      !message.includes("401 (Unauthorized)") &&
      !message.includes("status of 401"),
  );
  expect(
    unexpectedConsoleErrors,
    `console errors: ${unexpectedConsoleErrors.join("\n")}`,
  ).toEqual([]);
  expect(pageErrors, `page errors: ${pageErrors.join("\n")}`).toEqual([]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appUrl(pathname: string, baseUrl = BASE_URL): string {
  return new URL(appPath(pathname), baseUrl).toString();
}

function appReturnPath(pathname: string): string {
  const url = new URL(appUrl(pathname));
  return `${url.pathname}${url.search}${url.hash}`;
}
