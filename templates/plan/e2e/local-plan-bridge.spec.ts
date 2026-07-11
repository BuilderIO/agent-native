import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { startLocalPlanBridge } from "@agent-native/core/testing";
import { test, expect, type Page } from "@playwright/test";

async function getAvailablePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a local bridge test port.");
  }
  return address.port;
}

function writeBridgeFixture(root: string) {
  const dir = path.join(root, "bridge-reload-fixture");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "plan.mdx"),
    [
      "---",
      'title: "Bridge Reload Fixture"',
      'brief: "Loads from the local bridge."',
      'kind: "plan"',
      "---",
      "",
      "# Bridge Reload Fixture",
      "",
      "This local bridge content survived startup retry and hard reload.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return dir;
}

async function expectLocalPlanContent(page: Page) {
  await expect(page.locator(".plans-workspace")).toBeVisible({
    timeout: 25_000,
  });
  await expect(
    page.getByRole("heading", { name: "Bridge Reload Fixture" }).first(),
  ).toBeVisible({ timeout: 25_000 });
  await expect(
    page.getByText(
      "This local bridge content survived startup retry and hard reload.",
    ),
  ).toBeVisible({ timeout: 25_000 });
}

test("local bridge retries startup and survives a hard reload", async ({
  page,
  baseURL,
}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-plan-bridge-e2e-"));
  const dir = writeBridgeFixture(root);
  const port = await getAvailablePort();
  const token = `bridge-${Date.now().toString(36)}`;
  const bridgeUrl = `http://127.0.0.1:${port}/local-plan.json?token=${encodeURIComponent(
    token,
  )}`;
  const appUrl =
    baseURL ?? process.env.PLAN_BASE_URL ?? "http://localhost:8081";
  const localPlanUrl = new URL(
    `/local-plans/bridge-reload-fixture?bridge=${encodeURIComponent(
      bridgeUrl,
    )}`,
    appUrl,
  ).toString();
  const failedBridgeRequests: string[] = [];
  page.on("requestfailed", (request) => {
    if (request.url() === bridgeUrl) {
      failedBridgeRequests.push(request.failure()?.errorText ?? "failed");
    }
  });

  let bridge: Awaited<ReturnType<typeof startLocalPlanBridge>> | undefined =
    undefined;
  try {
    await page.goto(localPlanUrl, { waitUntil: "domcontentloaded" });
    await expect
      .poll(() => failedBridgeRequests.length, { timeout: 10_000 })
      .toBeGreaterThan(0);

    bridge = await startLocalPlanBridge({
      dir,
      appUrl,
      host: "127.0.0.1",
      port,
      token,
      urlFile: false,
    });

    await expectLocalPlanContent(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectLocalPlanContent(page);
  } finally {
    if (bridge) {
      await new Promise<void>((resolve) =>
        bridge.server.close(() => resolve()),
      );
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
