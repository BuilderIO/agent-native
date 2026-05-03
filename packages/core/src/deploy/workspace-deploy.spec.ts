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
      fs.existsSync(
        path.join(
          tmpDir,
          "dist",
          "_workspace_static",
          "dispatch",
          "assets",
          "app.js",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          tmpDir,
          "dist",
          "_workspace_static",
          "starter",
          "assets",
          "app.js",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          tmpDir,
          "dist",
          "_workspace_static",
          "starter",
          "favicon.svg",
        ),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "dist", "dispatch"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "dist", "starter"))).toBe(false);
    expect(
      fs.existsSync(
        path.join(
          tmpDir,
          "dist",
          "_workspace_static",
          "dispatch",
          "dispatch",
          "assets",
          "app.js",
        ),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(tmpDir, "dist", "_workspace_static", "dispatch", "dispatch"),
      ),
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
    expect(dispatchServer).toContain(
      'path: ["/_agent-native/*","/dispatch/*"]',
    );
    expect(dispatchServer).toContain('"/dispatch/assets/*"');
    expect(dispatchServer).toContain('"/dispatch/*.svg"');
    expect(dispatchServer).toContain('"/.netlify/*"');
    expect(dispatchServer).toContain("preferStatic: false");
    expect(dispatchServer).not.toContain("normalizeBasePathArgs");

    const starterServer = fs.readFileSync(
      path.join(
        tmpDir,
        ".netlify",
        "functions-internal",
        "starter-server",
        "starter-server.mjs",
      ),
      "utf-8",
    );
    expect(starterServer).toContain('path: ["/starter","/starter/*"]');
    expect(starterServer).toContain("normalizeBasePathArgs");
    expect(starterServer).toContain('"/starter/assets/*"');
    expect(starterServer).toContain('"/starter/*.webmanifest"');
    expect(starterServer).toContain("preferStatic: false");

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

    const starterModule = await import(
      `${
        pathToFileURL(
          path.join(
            tmpDir,
            ".netlify",
            "functions-internal",
            "starter-server",
            "starter-server.mjs",
          ),
        ).href
      }?t=${Date.now()}-starter`
    );
    const starterResponse = await starterModule.default(
      new Request("https://example.test/starter"),
    );
    expect(await starterResponse.text()).toBe("https://example.test/starter//");

    const redirects = fs.readFileSync(
      path.join(tmpDir, "dist", "_redirects"),
      "utf-8",
    );
    expect(redirects).toContain(
      "/dispatch/assets/* /_workspace_static/dispatch/assets/:splat 200",
    );
    expect(redirects).toContain(
      "/dispatch/:file.svg /_workspace_static/dispatch/:file.svg 200",
    );
    expect(redirects).toContain(
      "/starter/:file.webmanifest /_workspace_static/starter/:file.webmanifest 200",
    );
    expect(redirects).toContain(
      "/_agent-native/* /.netlify/functions/dispatch-server 200",
    );
    expect(redirects).toContain("/ /dispatch/overview 302");
    expect(redirects).toContain("/dispatch /dispatch/overview 302");
    expect(redirects).toContain("/apps /dispatch/apps 302");
    expect(redirects).not.toMatch(/^\/dispatch\/\* .* 200$/m);
    expect(redirects).not.toMatch(/^\/starter .* 200$/m);
    expect(redirects).not.toMatch(/^\/starter\/\* .* 200$/m);
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

  it("routes root framework requests to Dispatch for Cloudflare workspaces", async () => {
    makeWorkspaceApp(tmpDir, "dispatch");
    makeWorkspaceApp(tmpDir, "starter");

    await runWorkspaceDeploy({
      workspaceRoot: tmpDir,
      preset: "cloudflare_pages",
      buildOnly: true,
      execFile: execFile as typeof execFileSync,
    });

    const routes = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "dist", "_routes.json"), "utf-8"),
    ) as { include: string[] };
    expect(routes.include).toContain("/_agent-native/*");
    expect(routes.include).toContain("/dispatch/*");
    expect(routes.include).toContain("/starter/*");

    const worker = fs.readFileSync(
      path.join(tmpDir, "dist", "_worker.js"),
      "utf-8",
    );
    expect(worker).toContain(
      'if (pathname === "/_agent-native" || pathname.startsWith("/_agent-native/")) return app_dispatch.fetch(request, env, ctx);',
    );
    expect(worker).toContain(
      'if (pathname === "/dispatch" || pathname.startsWith("/dispatch/")) return app_dispatch.fetch(request, env, ctx);',
    );
    expect(worker).not.toContain(
      'new Request(new URL("/dispatch/_agent-native',
    );
  });

  it("does not claim root framework requests without Dispatch", async () => {
    makeWorkspaceApp(tmpDir, "starter");

    await runWorkspaceDeploy({
      workspaceRoot: tmpDir,
      preset: "cloudflare_pages",
      buildOnly: true,
      execFile: execFile as typeof execFileSync,
    });

    const routes = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "dist", "_routes.json"), "utf-8"),
    ) as { include: string[] };
    expect(routes.include).not.toContain("/_agent-native/*");

    const worker = fs.readFileSync(
      path.join(tmpDir, "dist", "_worker.js"),
      "utf-8",
    );
    expect(worker).not.toContain('pathname === "/_agent-native"');
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
  fs.writeFileSync(
    path.join(appDir, "dist", app, "favicon.svg"),
    "<svg></svg>",
  );
  fs.writeFileSync(path.join(appDir, "dist", app, "site.webmanifest"), "{}");
  fs.mkdirSync(path.join(appDir, "dist", app, app, "assets"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(appDir, "dist", app, app, "assets", "duplicate.js"),
    "export {};",
  );
  fs.writeFileSync(
    path.join(appDir, ".netlify", "functions-internal", "server", "main.mjs"),
    "export default async function handler(request) { return new Response(request?.url ?? 'ok'); }\n",
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
