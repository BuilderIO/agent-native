import { readFile } from "node:fs/promises";
import http, { type Server } from "node:http";
import path from "node:path";

import { decodeContinuation } from "@agent-native/core/shared";
import type { Browser, Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath, cdpScreenshot } from "./helpers";
import { expect, test } from "./rails";

const AUTH_STATE_PATH = process.env.E2E_AUTH_DIR
  ? path.join(path.resolve(process.env.E2E_AUTH_DIR), "state.json")
  : path.join(import.meta.dirname, ".auth", "state.json");

// A different host than the signed-in suite, so this context has no session.
const SIGNED_OUT_BASE_URL = (process.env.E2E_BASE_URL ?? e2eBaseURL()).replace(
  "127.0.0.1",
  "localhost",
);

type CallOutcome =
  | { state: "done"; ok: true; result: unknown }
  | { state: "done"; ok: false; error: string }
  | { state: "pending" | "unknown" };

let fixtureServer: Server | null = null;
let fixtureUrl = "";

function appUrl(pathname: string): string {
  const url = new URL(appPath(pathname));
  url.host = new URL(SIGNED_OUT_BASE_URL).host;
  return url.toString();
}

async function waitForTools(page: Page, names: string[]): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async (wanted) => {
          const helper = (
            window as Window & {
              __agentNativeWebMcp?: {
                tools(): Promise<Array<{ name: string }>>;
              };
            }
          ).__agentNativeWebMcp;
          if (!helper) return false;
          const listed = new Set((await helper.tools()).map((t) => t.name));
          return wanted.every((name) => listed.has(name));
        }, names),
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function callTool(
  page: Page,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const outcome = (await page.evaluate(
    ({ name, args }) =>
      (
        window as Window & {
          __agentNativeWebMcp?: {
            call(
              name: string,
              args: Record<string, unknown>,
              options: { waitMs: number },
            ): Promise<unknown>;
          };
        }
      ).__agentNativeWebMcp!.call(name, args, { waitMs: 30_000 }),
    { name, args },
  )) as CallOutcome;
  if (outcome.state !== "done" || !outcome.ok) {
    throw new Error(`${name} failed: ${JSON.stringify(outcome)}`);
  }
  return outcome.result;
}

function screenHtml(text: string): string {
  return `<!doctype html><html><body style="margin:0;font-family:sans-serif"><main><h1>${text}</h1></main></body></html>`;
}

async function openSignedOutDesign(browser: Browser) {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.goto(appUrl("/visual-edit"), { waitUntil: "domcontentloaded" });
  return { context, page };
}

test.describe("signed-out remix board", () => {
  test.beforeAll(async () => {
    fixtureServer = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(screenHtml("Fixture destination"));
    });
    await new Promise<void>(
      (resolve) => fixtureServer!.listen(0, "127.0.0.1", resolve), // e2e-harness-ignore: loopback fixture app on its own port, not the Design base URL
    );
    const address = fixtureServer.address();
    if (!address || typeof address === "string") {
      throw new Error("fixture server has no port");
    }
    fixtureUrl = `http://127.0.0.1:${address.port}`; // e2e-harness-ignore: the loopback fixture app, not the Design base URL
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) =>
      fixtureServer ? fixtureServer.close(() => resolve()) : resolve(),
    );
    fixtureServer = null;
  });

  test("builds a remix board signed out and asks for sign-in only to share", async ({
    browser,
  }, testInfo) => {
    const shot = async (page: Page, name: string) => {
      const filePath = testInfo.outputPath(`${name}.png`);
      await cdpScreenshot(page, filePath);
      await testInfo.attach(name, { path: filePath, contentType: "image/png" });
    };
    const { context, page } = await openSignedOutDesign(browser);
    try {
      await waitForTools(page, ["open-visual-edit"]);
      // Before a board exists the page offers no board tools.
      const preBoardTools = await page.evaluate(async () =>
        (
          await (
            window as Window & {
              __agentNativeWebMcp?: {
                tools(): Promise<Array<{ name: string }>>;
              };
            }
          ).__agentNativeWebMcp!.tools()
        ).map((tool) => tool.name),
      );
      expect(preBoardTools).not.toContain("create-file");

      const opening = page.evaluate(
        (devServerUrl) =>
          (
            window as Window & {
              __agentNativeWebMcp?: {
                call(
                  name: string,
                  args: Record<string, unknown>,
                ): Promise<unknown>;
              };
            }
          )
            .__agentNativeWebMcp!.call("open-visual-edit", {
              devServerUrl,
              withoutBridge: true,
              title: "Remix board",
            })
            .catch(() => {
              // The page navigates to the board, which can abort this call.
            }),
        fixtureUrl,
      );
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: /open visual edit/i }).click();
      await opening;
      await page.waitForURL(/\/visual-edit\/[^/?]+\?/, {
        timeout: 30_000,
        waitUntil: "domcontentloaded",
      });
      const designId = decodeURIComponent(
        /\/visual-edit\/([^/?]+)/.exec(new URL(page.url()).pathname)![1]!,
      );

      // Only the opening tab keeps the secret that moves the board later.
      const claimKey = `design-visual-edit-board-claim:${designId}`;
      expect(
        await page.evaluate(
          (key) => ({
            session: window.sessionStorage.getItem(key),
            local: window.localStorage.getItem(key),
          }),
          claimKey,
        ),
      ).toEqual({
        session: expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/),
        local: null,
      });
      const otherTab = await context.newPage();
      try {
        await otherTab.goto(appUrl("/visual-edit"), {
          waitUntil: "domcontentloaded",
        });
        expect(
          await otherTab.evaluate(
            (key) =>
              window.sessionStorage.getItem(key) ??
              window.localStorage.getItem(key),
            claimKey,
          ),
        ).toBeNull();
      } finally {
        await otherTab.close();
      }

      await waitForTools(page, [
        "create-file",
        "update-file",
        "update-design",
        "rename-screen",
        "list-files",
        "migrate-board-objects-to-file",
      ]);

      const screens: Array<{ id: string; name: string }> = [];
      for (const [filename, name] of [
        ["original.html", "Original · example.com"],
        ["remix.html", "Remix"],
        ["how-it-works.html", "How it works"],
      ] as const) {
        const created = (await callTool(page, "create-file", {
          designId,
          filename,
          content: screenHtml(name),
        })) as { id: string };
        await callTool(page, "rename-screen", { id: created.id, name });
        screens.push({ id: created.id, name });
      }
      await callTool(page, "migrate-board-objects-to-file", { designId });
      const files = (await callTool(page, "list-files", { designId })) as {
        files?: Array<{ id: string; filename: string }>;
      };
      const board = files.files?.find(
        (file) => file.filename === "__board__.html",
      );
      expect(board).toBeDefined();
      await callTool(page, "update-file", {
        id: board!.id,
        content:
          '<!doctype html><html><body><div data-agent-native-node-id="title" data-agent-native-layer-name="Title" data-an-primitive="text" style="position:absolute;left:0;top:-200px;font:600 84px Inter">Remix board</div></body></html>',
      });
      await callTool(page, "update-design", {
        id: designId,
        dataOperations: [
          { op: "set", path: ["canvasBackground"], value: "#e7e3dc" },
        ],
      });

      await page.reload({ waitUntil: "domcontentloaded" });
      for (const screen of screens) {
        await expect(
          page.locator("button[data-screen-row]").filter({
            hasText: screen.name,
          }),
        ).toHaveCount(1, { timeout: 30_000 });
      }
      await shot(page, "signed-out-board");

      // The board is private: its capability reads it, nobody else does.
      const getDesignUrl = appUrl(
        `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
      );
      // Keep the cookies and headers that carry the board's capability, to
      // replay them after the claim from outside this tab.
      const capabilityRequest = page.waitForRequest((request) =>
        request.url().includes("/_agent-native/actions/get-design?"),
      );
      expect(
        await page.evaluate(async (url) => {
          const response = await fetch(url, { credentials: "same-origin" });
          return {
            status: response.status,
            visibility: ((await response.json()) as { visibility?: string })
              .visibility,
          };
        }, getDesignUrl),
      ).toEqual({ status: 200, visibility: "private" });
      const capabilityHeaders = Object.fromEntries(
        Object.entries(await (await capabilityRequest).allHeaders()).filter(
          ([name]) => name === "authorization" || name.startsWith("x-"),
        ),
      );
      const capabilityCookies = await context.cookies();
      const replayCapability = async () => {
        const replay = await browser.newContext({
          storageState: { cookies: capabilityCookies, origins: [] },
        });
        try {
          const read = await replay.request.get(getDesignUrl, {
            headers: capabilityHeaders,
          });
          // Writes need same-origin browser evidence, so send this one from a
          // page on the app's origin in the replaying context.
          const replayPage = await replay.newPage();
          await replayPage.goto(getDesignUrl);
          const write = await replayPage.evaluate(
            async ({ url, headers, body }) =>
              (
                await fetch(url, {
                  method: "POST",
                  credentials: "same-origin",
                  headers: { ...headers, "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                })
              ).status,
            {
              url: appUrl("/_agent-native/webmcp/actions/update-design"),
              headers: capabilityHeaders,
              body: {
                id: designId,
                dataOperations: [
                  { op: "set", path: ["replayed"], value: true },
                ],
              },
            },
          );
          return { read: read.status(), write };
        } finally {
          await replay.close();
        }
      };
      const beforeClaim = await replayCapability();
      expect(beforeClaim).toEqual({ read: 200, write: 200 });
      const stranger = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      try {
        const response = await stranger.request.get(getDesignUrl);
        expect(response.status()).toBe(404);
      } finally {
        await stranger.close();
      }

      // The capability never reaches sharing, design creation or another board.
      for (const [name, body] of [
        [
          "share-resource",
          {
            resourceType: "design",
            resourceId: designId,
            principalType: "user",
            principalId: "someone@example.com",
            role: "editor",
          },
        ],
        [
          "set-resource-visibility",
          { resourceType: "design", resourceId: designId, visibility: "org" },
        ],
        ["create-design", { title: "Not allowed" }],
      ] as const) {
        const status = await page.evaluate(
          async ({ url, body }) =>
            (
              await fetch(url, {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              })
            ).status,
          { url: appUrl(`/_agent-native/webmcp/actions/${name}`), body },
        );
        expect(status, name).toBeGreaterThanOrEqual(400);
      }

      const share = page.getByRole("link", { name: "Share", exact: true });
      await expect(share).toBeVisible();
      await share.click();
      await expect(page).toHaveURL(/\/sign-in\?c=/);
      await shot(page, "share-asks-sign-in");
      const continuation = new URL(page.url()).searchParams.get("c");
      const returnPath = `${new URL(appUrl(`/visual-edit/${encodeURIComponent(designId)}`)).pathname}?intent=share`;
      expect(decodeContinuation(continuation)).toBe(returnPath);

      // Signing in returns to the board, which moves into the account.
      const signedIn = JSON.parse(await readFile(AUTH_STATE_PATH, "utf8")) as {
        cookies: Parameters<typeof context.addCookies>[0];
      };
      const host = new URL(SIGNED_OUT_BASE_URL).hostname;
      await context.addCookies(
        signedIn.cookies.map((cookie) => ({ ...cookie, domain: host })),
      );
      // The return page redirects as soon as the claim lands, so start the
      // navigation without waiting on the page it immediately replaces.
      await page.evaluate((url) => {
        window.location.assign(url);
      }, new URL(returnPath, appUrl("/")).toString());
      await page.waitForURL(new RegExp(`/design/${designId}\\?intent=share`), {
        timeout: 30_000,
        waitUntil: "domcontentloaded",
      });
      const claimed = await page.evaluate(
        async ({ id, url }) => {
          const response = await fetch(url, { credentials: "same-origin" });
          const body = (await response.json()) as {
            accessRole?: string;
            visibility?: string;
          };
          return {
            accessRole: body.accessRole,
            visibility: body.visibility,
            secret: window.sessionStorage.getItem(
              `design-visual-edit-board-claim:${id}`,
            ),
          };
        },
        {
          id: designId,
          url: appUrl(
            `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
          ),
        },
      );
      expect(claimed).toEqual({
        accessRole: "owner",
        visibility: "private",
        secret: null,
      });
      // The capability the board had while signed out no longer reaches it.
      const afterClaim = await replayCapability();
      expect(afterClaim.read).toBe(404);
      expect(afterClaim.write).toBeGreaterThanOrEqual(400);
      // The claim moves the design row only; the board's files come along.
      const claimedFiles = await page.evaluate(
        async (url) =>
          (
            (await (
              await fetch(url, { credentials: "same-origin" })
            ).json()) as {
              files?: Array<{ filename: string; content: string }>;
            }
          ).files?.map((file) => ({
            filename: file.filename,
            hasTitle: file.content.includes("Remix board"),
          })),
        appUrl(
          `/_agent-native/actions/list-files?designId=${encodeURIComponent(designId)}`,
        ),
      );
      expect(claimedFiles).toEqual(
        expect.arrayContaining([
          { filename: "__board__.html", hasTitle: true },
          expect.objectContaining({ filename: "Remix.html" }),
        ]),
      );
      await expect(page.locator("[data-design-editor]")).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.locator("button[data-screen-row]").filter({ hasText: "Remix" }),
      ).toHaveCount(1, { timeout: 30_000 });
      // The tab is now the signed-in owner, not the board's old capability.
      await expect(page.getByRole("link", { name: "Sign up" })).toHaveCount(0);
      await shot(page, "claimed-board");
    } finally {
      await context.close();
    }
  });
});
