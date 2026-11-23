import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { test as baseTest, expect } from "@playwright/test";

import { connectToQaBrowser } from "../../qa-browser.js";
import { safeRequest } from "../../safe-request.js";

const target = "https://labs.agent-native.com/analytics-2";

export const test = baseTest.extend<{ base: string; observations: void }>({
  base: async ({}, provide) => {
    await provide(target);
  },
  browser: [
    async ({}, provide) => {
      const browser = await connectToQaBrowser();
      try {
        await provide(browser);
      } finally {
        await browser.close();
      }
    },
    { scope: "worker" },
  ],
  observations: [
    async ({ page, base }, provide) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "assert")
          errors.push(`console: ${message.text()}`);
      });
      page.on("response", (response) => {
        if (response.url().startsWith(`${base}/`) && response.status() >= 400)
          errors.push(
            `HTTP ${response.status()}: ${new URL(response.url()).pathname}`,
          );
      });
      await provide();
      expect(errors, "Unexpected page, console or HTTP errors").toEqual([]);
    },
    { auto: true },
  ],
  context: async ({ browser, base }, provide) => {
    const profile = JSON.parse(
      await readFile(
        resolve(homedir(), ".config/agent-native-qa/analytics-2-profile.json"),
        "utf8",
      ),
    );
    if (
      profile.email !== "qa-fleet@builder.io" ||
      typeof profile.workspaceId !== "string" ||
      !profile.workspaceId
    )
      throw new Error("Invalid QA profile fixture");
    const guardPath = resolve(
      homedir(),
      "Projects/re/kit-local/clone/lead/labs-ws/qa/qa-browser-guard.mjs",
    );
    const { readQaCookies } = await import(pathToFileURL(guardPath).href);
    const cookies = await readQaCookies(`${base}/`);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: "block",
      extraHTTPHeaders: { "x-agent-native-frontend": "1" },
    });
    try {
      await context.addCookies(cookies);
      const response = await safeRequest(
        "GET /_agent-native/actions/get-workspace-shell",
        () =>
          context.request.get(
            `${base}/_agent-native/actions/get-workspace-shell`,
            { headers: { "x-agent-native-frontend": "1" } },
          ),
      );
      if (!response.ok())
        throw new Error(`QA identity read HTTP ${response.status()}`);
      const identity = await response.json();
      if (
        identity.user?.email !== profile.email ||
        identity.workspace?.id !== profile.workspaceId ||
        identity.features?.isAdmin !== true
      )
        throw new Error("QA identity or workspace did not match");
      console.log(
        `VERIFIED QA ${identity.user.email}, workspace ${identity.workspace.id}`,
      );
      await provide(context);
    } finally {
      await context.close();
    }
  },
});
export { expect };
