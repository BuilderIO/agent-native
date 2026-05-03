import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWorkspaceDeploy } from "./workspace-deploy.js";

let tmpDir: string;
let previousAppBasePath: string | undefined;
let previousDatabaseUrl: string | undefined;
let previousUnpooledDatabaseUrl: string | undefined;
let previousNitroPreset: string | undefined;
let previousViteAppBasePath: string | undefined;
let execFile: ReturnType<typeof vi.fn>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-workspace-deploy-"));
  execFile = vi.fn(((_cmd, args) => {
    if (Array.isArray(args) && args[0] === "--filter") {
      writeAppBuildOutput(tmpDir, String(args[1]));
    }
    return Buffer.from("");
  }) as typeof execFileSync);
  previousAppBasePath = process.env.APP_BASE_PATH;
  previousDatabaseUrl = process.env.DATABASE_URL;
  previousUnpooledDatabaseUrl = process.env.NETLIFY_DATABASE_URL_UNPOOLED;
  previousNitroPreset = process.env.NITRO_PRESET;
  previousViteAppBasePath = process.env.VITE_APP_BASE_PATH;
  delete process.env.APP_BASE_PATH;
  delete process.env.DATABASE_URL;
  delete process.env.NETLIFY_DATABASE_URL_UNPOOLED;
  delete process.env.NITRO_PRESET;
  delete process.env.VITE_APP_BASE_PATH;
});

afterEach(() => {
  restoreEnv("APP_BASE_PATH", previousAppBasePath);
  restoreEnv("DATABASE_URL", previousDatabaseUrl);
  restoreEnv("NETLIFY_DATABASE_URL_UNPOOLED", previousUnpooledDatabaseUrl);
  restoreEnv("NITRO_PRESET", previousNitroPreset);
  restoreEnv("VITE_APP_BASE_PATH", previousViteAppBasePath);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("workspace deploy", () => {
  it("collects Netlify static assets, functions, and redirects for a workspace", async () => {
    makeWorkspaceApp(tmpDir, "dispatch");
    makeWorkspaceApp(tmpDir, "starter");

    await runWorkspaceDeploy({
      workspaceRoot: tmpDir,
      args: ["--preset=netlify", "--build-only"],
      execFile: execFile as typeof execFileSync,
    });

    const calls = execFile.mock.calls;
    expect(calls).toHaveLength(2);

    const dispatchCall = buildCallForApp("dispatch");
    expect(dispatchCall?.env).toMatchObject({
      NITRO_PRESET: "netlify",
      APP_BASE_PATH: "/dispatch",
      VITE_APP_BASE_PATH: "/dispatch",
    });

    const starterCall = buildCallForApp("starter");
    expect(starterCall?.env).toMatchObject({
      NITRO_PRESET: "netlify",
      APP_BASE_PATH: "/starter",
      VITE_APP_BASE_PATH: "/starter",
    });

    expect(
      fs.existsSync(path.join(tmpDir, "dist", "dispatch", "assets", "app.js")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(tmpDir, "dist", "starter", "assets", "app.js")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(tmpDir, "dist", "dispatch", "dispatch", "assets", "app.js"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(tmpDir, "dist", "dispatch", "dispatch")),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(
          tmpDir,
          ".netlify",
          "functions-internal",
          "dispatch-server",
          "dispatch-server.mjs",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          tmpDir,
          ".netlify",
          "functions-internal",
          "starter-server",
          "starter-server.mjs",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          tmpDir,
          ".netlify",
          "functions-internal",
          "dispatch-server",
          "main.mjs",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          tmpDir,
          ".netlify",
          "functions-internal",
          "dispatch-server",
          "server.mjs",
        ),
      ),
    ).toBe(false);

    const dispatchServer = fs.readFileSync(
      path.join(
        tmpDir,
        ".netlify",
        "functions-internal",
        "dispatch-server",
        "dispatch-server.mjs",
      ),
      "utf-8",
    );
    expect(dispatchServer).toContain('const basePath = "/dispatch";');
    expect(dispatchServer).toContain("Object.assign(processRef.env");
    expect(dispatchServer).toContain("APP_BASE_PATH: basePath");
    expect(dispatchServer).toContain('await import("./main.mjs")');
    expect(dispatchServer).toContain('path: "/dispatch/*"');

    const dispatchModule = await import(
      `${
        pathToFileURL(
          path.join(
            tmpDir,
            ".netlify",
            "functions-internal",
            "dispatch-server",
            "dispatch-server.mjs",
          ),
        ).href
      }?t=${Date.now()}`
    );
    process.env.APP_BASE_PATH = "/wrong";
    process.env.VITE_APP_BASE_PATH = "/wrong";
    await dispatchModule.default();
    expect(process.env.APP_BASE_PATH).toBe("/dispatch");
    expect(process.env.VITE_APP_BASE_PATH).toBe("/dispatch");

    const redirects = fs.readFileSync(
      path.join(tmpDir, "dist", "_redirects"),
      "utf-8",
    );
    expect(redirects).toContain("/ /dispatch/overview 302");
    expect(redirects).toContain("/dispatch /dispatch/overview 302");
    expect(redirects).toContain("/apps /dispatch/apps 302");
    expect(redirects).not.toContain("/.netlify/functions/");
    expect(redirects).not.toContain("/dispatch/*");
    expect(redirects).not.toContain("/starter/*");
    expect(redirects).not.toContain("!");
    expect(redirects).not.toMatch(
      /^\/\* \/.netlify\/functions\/dispatch-server 200$/m,
    );
    expect(redirects).not.toContain(
      "/unknown /.netlify/functions/dispatch-server",
    );
    expect(fs.existsSync(path.join(tmpDir, "dist", "_routes.json"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(tmpDir, "dist", "_worker.js"))).toBe(false);
  });

  it("uses Netlify unpooled database URLs for apps that request them", async () => {
    process.env.DATABASE_URL = "postgres://pooled";
    process.env.NETLIFY_DATABASE_URL_UNPOOLED = "postgres://unpooled";
    makeWorkspaceApp(tmpDir, "mail", { usesUnpooledDatabaseUrl: true });

    await runWorkspaceDeploy({
      workspaceRoot: tmpDir,
      preset: "netlify",
      buildOnly: true,
      execFile: execFile as typeof execFileSync,
    });

    expect(buildCallForApp("mail")?.env).toMatchObject({
      DATABASE_URL: "postgres://unpooled",
      NITRO_PRESET: "netlify",
      APP_BASE_PATH: "/mail",
      VITE_APP_BASE_PATH: "/mail",
    });
  });
});

function makeWorkspaceApp(
  workspaceRoot: string,
  app: string,
  opts: { usesUnpooledDatabaseUrl?: boolean } = {},
): void {
  const appDir = path.join(workspaceRoot, "apps", app);
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "package.json"),
    JSON.stringify({ name: app, scripts: { build: "agent-native build" } }),
  );

  if (opts.usesUnpooledDatabaseUrl) {
    fs.writeFileSync(
      path.join(appDir, "netlify.toml"),
      [
        "[build]",
        '  command = "DATABASE_URL=${NETLIFY_DATABASE_URL_UNPOOLED:-$DATABASE_URL} NITRO_PRESET=netlify pnpm build"',
        "",
      ].join("\n"),
    );
  }
}

function writeAppBuildOutput(workspaceRoot: string, app: string): void {
  const appDir = path.join(workspaceRoot, "apps", app);
  fs.mkdirSync(path.join(appDir, "dist", app, "assets"), { recursive: true });
  fs.mkdirSync(path.join(appDir, ".netlify", "functions-internal", "server"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(appDir, "dist", app, "assets", "app.js"),
    "export {};",
  );
  fs.mkdirSync(path.join(appDir, "dist", app, app, "assets"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(appDir, "dist", app, app, "assets", "duplicate.js"),
    "export {};",
  );
  fs.writeFileSync(
    path.join(appDir, ".netlify", "functions-internal", "server", "main.mjs"),
    "export default async function handler() { return new Response('ok'); }\n",
  );
  fs.writeFileSync(
    path.join(appDir, ".netlify", "functions-internal", "server", "server.mjs"),
    [
      'export { default } from "./main.mjs";',
      "export const config = {",
      '  name: "server handler",',
      '  path: "/*",',
      "  preferStatic: true,",
      "};",
      "",
    ].join("\n"),
  );
}

function buildCallForApp(app: string): { env?: NodeJS.ProcessEnv } | undefined {
  const call = vi
    .mocked(execFile)
    .mock.calls.find(([, args]) => Array.isArray(args) && args[1] === app);
  return call?.[2] as { env?: NodeJS.ProcessEnv } | undefined;
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
