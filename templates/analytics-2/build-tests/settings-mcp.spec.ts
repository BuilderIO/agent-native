import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  chromium,
  expect as browserExpect,
  type Browser,
} from "@playwright/test";
import { createRequestHandler } from "react-router";
import { afterAll, beforeAll, expect, it } from "vitest";

// Run agent-native build first: this test loads the shipped chunks and SSR shell.
const appDir = fileURLToPath(new URL("..", import.meta.url));
const clientDir = resolve(appDir, "build/client");
let server: Server;
let browser: Browser;
let origin: string;

beforeAll(async () => {
  const build = await import(
    pathToFileURL(resolve(appDir, "build/server/index.js")).href
  );
  const handler = createRequestHandler(build, "production");
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", origin);
      const file = resolve(clientDir, `.${url.pathname}`);
      const types: Record<string, string> = {
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
        ".json": "application/json",
      };
      if (file.startsWith(`${clientDir}/`) && types[extname(file)]) {
        response.writeHead(200, {
          "content-type": types[extname(file)],
        });
        response.end(await readFile(file));
        return;
      }
      const result = await handler(
        new Request(url, {
          method: request.method,
          headers: new Headers(
            Object.entries(request.headers).flatMap(([key, value]) =>
              value === undefined ? [] : [[key, String(value)]],
            ),
          ),
        }),
      );
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  await new Promise<void>((resolveReady) =>
    server.listen(0, "127.0.0.1", resolveReady),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No preview port");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  if (!server) return;
  await new Promise<void>((resolveClosed, reject) =>
    server?.close((error) => (error ? reject(error) : resolveClosed())),
  );
});

it.each([null, "house"])(
  "reaches the MCP server API-key form from Settings with skin preference %s",
  async (skin) => {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.addInitScript((preference) => {
      if (preference) localStorage.setItem("agent-native.skin", preference);
    }, skin);
    const errors: string[] = [];
    const unknownRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400)
        errors.push(`${response.status()} ${response.url()}`);
    });
    await page.route("**/_agent-native/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown;
      if (path.endsWith("/auth/session"))
        body = {
          user: {
            id: "test-user",
            name: "Test User",
            email: "test@example.invalid",
          },
          session: { id: "test-session", expiresAt: "2099-01-01" },
        };
      else if (path.endsWith("/actions/get-workspace-bootstrap"))
        body = {
          workspace: { id: "test-workspace", name: "Test workspace" },
          user: {
            id: "test-user",
            name: "Test User",
            email: "test@example.invalid",
          },
          features: { isAdmin: true },
        };
      else if (path.endsWith("/mcp/servers"))
        body = { user: [], org: [], orgId: "test-workspace", role: "owner" };
      else if (path.endsWith("/actions/get-managed-mcp-oauth-readiness"))
        body = { hubspot: "configured" };
      else if (path.endsWith("/actions/list-role-requests")) body = [];
      else if (path.endsWith("/actions/get-localization-preference"))
        body = { preference: "system" };
      else if (path.endsWith("/actions/get-theme-family"))
        body = { family: "default" };
      else if (path.endsWith("/webmcp/manifest")) body = { tools: [] };
      else if (path.endsWith("/agent-engine/status"))
        body = { engines: [], current: { engine: "anthropic" } };
      else if (path.endsWith("/auth/consent-region")) body = { region: "US" };
      else if (
        path.endsWith("/auth/attribution") ||
        path.endsWith("/ping") ||
        path.includes("/application-state")
      )
        body = {};
      else {
        unknownRequests.push(path);
        await route.abort();
        return;
      }
      await route.fulfill({ json: body });
    });
    try {
      await page.goto(`${origin}/settings/profile`);
      const settings = page.getByRole("navigation", {
        name: "Settings",
        exact: true,
      });
      await browserExpect(settings).toBeVisible();
      await browserExpect(
        settings.getByRole("link", { name: "Integrations", exact: true }),
      ).toBeVisible();
      await settings
        .getByRole("link", { name: "Integrations", exact: true })
        .click();
      await browserExpect(page).toHaveURL(`${origin}/settings/integrations`);
      await page
        .getByRole("button", { name: "Add integration", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Add your own", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Use an API key instead", exact: true })
        .click();
      await browserExpect(
        page.getByLabel("URL", { exact: true }),
      ).toBeVisible();
      await browserExpect(
        page.getByLabel("Headers", { exact: true }),
      ).toBeVisible();
      await page
        .getByLabel("Integration name", { exact: true })
        .fill("HubSpot");
      await page
        .getByLabel("URL", { exact: true })
        .fill("https://example.com/mcp");
      await page
        .getByLabel("Headers", { exact: true })
        .fill("Authorization: Bearer <token>");
      await browserExpect(
        page.getByLabel("Headers", { exact: true }),
      ).toHaveValue("Authorization: Bearer <token>");
      expect(unknownRequests).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await page.screenshot({
        path: resolve(
          appDir,
          `../../.tmp/row791-settings-mcp-${skin ?? "default"}.png`,
        ),
      });
      await page.close();
    }
  },
);
