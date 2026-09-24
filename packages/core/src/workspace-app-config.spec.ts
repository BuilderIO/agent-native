import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const jitiMock = vi.hoisted(() => ({
  createJiti: vi.fn(),
}));

vi.mock("jiti", () => jitiMock);

import { resetAppConfigForTests, defineAppConfig } from "./app-config/index.js";
import {
  inferWorkspaceAppRootHomePath,
  readConfiguredWorkspaceAppHomePath,
} from "./workspace-app-config.js";

let tempRoot: string | undefined;

afterEach(() => {
  jitiMock.createJiti.mockReset();
  resetAppConfigForTests();
  if (tempRoot) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("workspace app configuration discovery", () => {
  it.each(["home._index.tsx", "_app.home._index.tsx"])(
    "recognizes %s as an existing home route",
    (homeRoute) => {
      tempRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "workspace-app-routes-"),
      );
      const routesDir = path.join(tempRoot, "app", "routes");
      fs.mkdirSync(routesDir, { recursive: true });
      fs.writeFileSync(path.join(routesDir, "_index.tsx"), "export {};");
      fs.writeFileSync(path.join(routesDir, homeRoute), "export {};");

      expect(inferWorkspaceAppRootHomePath(tempRoot)).toBeUndefined();
    },
  );

  it("serializes app config reads that share the process-global config store", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-app-config-"));
    const firstApp = makeConfigApp("first");
    const secondApp = makeConfigApp("second");

    jitiMock.createJiti.mockImplementation((entry: string) => ({
      import: vi.fn(async () => {
        defineAppConfig({
          app: { homePath: entry.includes("first") ? "/first" : "/second" },
        });
      }),
    }));

    await expect(
      Promise.all([
        readConfiguredWorkspaceAppHomePath(firstApp),
        readConfiguredWorkspaceAppHomePath(secondApp),
      ]),
    ).resolves.toEqual(["/first", "/second"]);
  });
});

function makeConfigApp(name: string): string {
  const appDir = path.join(tempRoot!, name);
  fs.mkdirSync(path.join(appDir, "server", "plugins"), { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "server", "plugins", "config.ts"),
    "export {};\n",
  );
  return appDir;
}
