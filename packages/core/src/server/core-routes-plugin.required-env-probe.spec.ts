/**
 * The required-env line of the `/_agent-native/ping?configuration=1` probe,
 * through the real `createCoreRoutesPlugin` request path. A deployed server has
 * no `agent-native.config.ts` to read, so the probe takes the app's declared
 * names from the build, never from the request.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../deploy/route-discovery.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../deploy/route-discovery.js")>()),
  getMissingDefaultPlugins: vi.fn(async () => []),
}));

import { closeDbExec } from "../db/client.js";
import type { RuntimeConfigIssue } from "../shared/runtime-config.js";
import { createCoreRoutesPlugin } from "./core-routes-plugin.js";

function createNitroApp() {
  return { h3: { "~middleware": [] as any[] } };
}

async function dispatch(nitroApp: any, url: string) {
  const request = new Request(url);
  const responseHeaders = new Headers();
  const event = {
    method: "GET",
    url: new URL(url),
    path: new URL(url).pathname,
    context: {},
    req: request,
    headers: request.headers,
    res: { status: 200, headers: responseHeaders },
    node: {
      req: { method: "GET", url: new URL(url).pathname, headers: {} },
      res: {
        statusCode: 200,
        setHeader(name: string, value: string) {
          responseHeaders.set(name, value);
        },
      },
    },
  };

  let index = 0;
  const next = async (): Promise<unknown> => {
    const middleware = nitroApp.h3["~middleware"][index++];
    if (!middleware) return { fellThrough: true };
    return middleware(event, next);
  };

  return next();
}

function missingRequiredEnv(body: unknown): string[][] {
  const { configuration } = body as {
    configuration: { issues: RuntimeConfigIssue[] };
  };
  return configuration.issues
    .filter((issue) => issue.code === "missing-required-env")
    .map((issue) => issue.envKeys);
}

describe("configuration probe required env vars", () => {
  let tempDir = "";

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-native-required-env-probe-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await closeDbExec();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("reports a name the build embedded and ignores names in the request", async () => {
    vi.stubEnv("DATABASE_URL", `pglite:${join(tempDir, "db")}`);
    vi.stubEnv("AGENT_NATIVE_BUILD_REQUIRED_ENV", '["NOTION_API_KEY"]');
    vi.stubEnv("NOTION_API_KEY", "");
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    const nitroApp = createNitroApp();
    await createCoreRoutesPlugin()(nitroApp);

    const body = await dispatch(
      nitroApp,
      "https://app.test/_agent-native/ping?configuration=1&requiredEnv=GOOGLE_CLIENT_ID",
    );

    expect(missingRequiredEnv(body)).toEqual([["NOTION_API_KEY"]]);
  });
});
