/**
 * `agent-native deploy` — build and deploy every app in a workspace to a
 * single origin. Each app is served from `/<app-name>/*`, so:
 *
 *   https://your-agents.com/mail/*       → apps/mail
 *   https://your-agents.com/calendar/*   → apps/calendar
 *
 * Benefits of same-origin deploy:
 *   - Shared auth cookie → log in once, every app is signed in
 *   - Cross-app A2A is a same-origin fetch (no CORS, no JWT for siblings)
 *   - One DNS record, one TLS cert, one CDN cache
 *
 * Per-app independent deploy is still supported — just cd into the app and
 * run `agent-native build` as before. This orchestrator is for teams that
 * want the whole workspace behind one domain.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { findWorkspaceRoot } from "../scripts/utils.js";

export type WorkspaceDeployPreset = "cloudflare_pages" | "netlify";

export interface WorkspaceDeployOptions {
  args?: string[];
  /** Override the workspace root (defaults to walking up from cwd). */
  workspaceRoot?: string;
  /** Only build — don't invoke the deploy platform CLI. */
  buildOnly?: boolean;
  /** Target preset. Defaults to `cloudflare_pages`. */
  preset?: WorkspaceDeployPreset;
  /** @internal Override process execution in tests. */
  execFile?: typeof execFileSync;
}

export async function runWorkspaceDeploy(
  opts: WorkspaceDeployOptions = {},
): Promise<void> {
  const workspaceRoot =
    opts.workspaceRoot ?? findWorkspaceRoot(process.cwd()) ?? process.cwd();
  const appsDir = path.join(workspaceRoot, "apps");
  if (!fs.existsSync(appsDir)) {
    throw new Error(
      `No apps/ directory found at ${workspaceRoot}. Run this inside an agent-native workspace.`,
    );
  }

  const rawArgs = opts.args ?? [];
  const args = new Set(rawArgs);
  const buildOnly = opts.buildOnly ?? args.has("--build-only");

  const apps = fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => fs.existsSync(path.join(appsDir, n, "package.json")));

  if (apps.length === 0) {
    throw new Error(
      `Workspace has no apps. Run \`agent-native add-app\` to add one.`,
    );
  }

  const preset = resolvePreset(opts.preset, rawArgs);
  const distDir = path.join(workspaceRoot, "dist");
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(distDir, { recursive: true });

  if (preset === "netlify") {
    const functionsDir = netlifyFunctionsDir(workspaceRoot);
    fs.rmSync(functionsDir, { recursive: true, force: true });
    fs.mkdirSync(functionsDir, { recursive: true });
  }

  console.log(
    `[workspace-deploy] Building ${apps.length} app(s) for preset=${preset}`,
  );

  const execFile = opts.execFile ?? execFileSync;
  for (const app of apps) {
    buildOneApp(workspaceRoot, app, preset, execFile);
    moveAppBuildIntoDist(workspaceRoot, app, distDir, preset);
  }

  if (preset === "netlify") {
    writeNetlifyRedirects(distDir, apps);
  } else {
    writeCloudflareRoutingManifest(distDir, apps);
  }

  if (buildOnly) {
    console.log(
      `\n[workspace-deploy] Build complete at ${distDir}. Skipping publish (--build-only).`,
    );
    return;
  }

  console.log(`\n[workspace-deploy] Build complete. Publish with:\n`);
  console.log(`  cd ${path.relative(process.cwd(), workspaceRoot) || "."}`);
  if (preset === "netlify") {
    console.log(
      `  netlify deploy --prod --dir=dist --functions=.netlify/functions-internal\n`,
    );
  } else {
    console.log(`  wrangler pages deploy dist\n`);
  }
  console.log(
    `All apps live at https://<origin>/<app-name>/*. Log in once on any app\nand the session is shared across the workspace.`,
  );
}

function buildOneApp(
  workspaceRoot: string,
  app: string,
  preset: WorkspaceDeployPreset,
  execFile: typeof execFileSync,
): void {
  const appDir = path.join(workspaceRoot, "apps", app);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NITRO_PRESET: preset,
    APP_BASE_PATH: `/${app}`,
    VITE_APP_BASE_PATH: `/${app}`,
  };

  if (preset === "netlify" && appUsesNetlifyUnpooledDatabaseUrl(appDir)) {
    env.DATABASE_URL =
      process.env.NETLIFY_DATABASE_URL_UNPOOLED ??
      process.env.DATABASE_URL ??
      env.DATABASE_URL;
  }

  console.log(
    `[workspace-deploy] Building ${app} (base=/${app}, preset=${preset})`,
  );

  cleanAppBuildOutputs(appDir);

  execFile("pnpm", ["--filter", app, "build"], {
    cwd: workspaceRoot,
    env,
    stdio: "inherit",
  });
}

function moveAppBuildIntoDist(
  workspaceRoot: string,
  app: string,
  distDir: string,
  preset: WorkspaceDeployPreset,
): void {
  const appDir = path.join(workspaceRoot, "apps", app);
  // Resolve the per-app build output: prefer dist/ (standard), fall back to
  // .output/ (Nitro's default). The Cloudflare preset emits into dist/
  // containing the worker + assets.
  const candidates = ["dist", ".output"];
  const src = candidates
    .map((c) => path.join(appDir, c))
    .find((p) => fs.existsSync(p));
  if (!src) {
    throw new Error(
      `Expected ${candidates.join(" or ")} under ${appDir} but none existed. Check the app's build script.`,
    );
  }
  if (preset === "netlify") {
    const mountedSrc = path.join(src, app);
    const staticSrc = fs.existsSync(mountedSrc) ? mountedSrc : src;
    const target = path.join(distDir, app);
    fs.mkdirSync(target, { recursive: true });
    copyDir(staticSrc, target);
    // Nitro/Vite mounted builds can contain a nested copy of public assets at
    // dist/<app>/<app>/...; the workspace root already supplies the outer
    // mount path, so keeping it would publish duplicate /<app>/<app> URLs.
    fs.rmSync(path.join(target, app), { recursive: true, force: true });
    copyNetlifyFunctionIntoWorkspace(workspaceRoot, app);
  } else {
    const target = path.join(distDir, app);
    fs.mkdirSync(target, { recursive: true });
    copyDir(src, target);
  }
}

/**
 * Write the Cloudflare Pages `_routes.json` and a dispatcher `_worker.js` at
 * the workspace dist root so each app is reachable under /<app>/*.
 */
function writeCloudflareRoutingManifest(distDir: string, apps: string[]): void {
  // _routes.json tells Cloudflare which paths are dynamic (Functions) vs
  // static. Mark /<app>/* as include so every app's worker handles its
  // subtree.
  const routes = {
    version: 1,
    include: apps.map((a) => `/${a}/*`).concat(["/"]),
    exclude: [],
  };
  fs.writeFileSync(
    path.join(distDir, "_routes.json"),
    JSON.stringify(routes, null, 2) + "\n",
  );

  // Dispatcher worker: inspects the path and forwards to the matching
  // per-app worker.
  const imports = apps
    .map((a) => `import ${moduleIdent(a)} from "./${a}/_worker.js";`)
    .join("\n");
  const dispatch = apps
    .map(
      (a) =>
        `  if (pathname === "/${a}" || pathname.startsWith("/${a}/")) return ${moduleIdent(a)}.fetch(request, env, ctx);`,
    )
    .join("\n");

  const worker = `${imports}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
${dispatch}
    if (pathname === "/") {
      return Response.redirect(new URL("/${apps[0]}/", request.url).toString(), 302);
    }
    return new Response("Not found", { status: 404 });
  },
};
`;
  fs.writeFileSync(path.join(distDir, "_worker.js"), worker);
}

function writeNetlifyRedirects(distDir: string, apps: string[]): void {
  const lines: string[] = [
    "# Generated by agent-native deploy --preset netlify",
    "# No forced rewrites: Netlify should serve static files from dist/ first.",
  ];

  if (apps.includes("dispatch")) {
    lines.push("/ /dispatch/overview 302");
    lines.push("/dispatch /dispatch/overview 302");
    for (const [from, to] of DISPATCH_WORKSPACE_ROOT_REDIRECTS) {
      lines.push(`/${from} /dispatch/${to} 302`);
    }
  } else {
    lines.push(`/ /${apps[0]}/ 302`);
  }

  for (const app of apps) {
    const functionPath = `/.netlify/functions/${app}-server`;
    if (app !== "dispatch") {
      lines.push(`/${app} ${functionPath} 200`);
    }
    lines.push(`/${app}/* ${functionPath} 200`);
  }

  fs.writeFileSync(path.join(distDir, "_redirects"), lines.join("\n") + "\n");
}

const DISPATCH_WORKSPACE_ROOT_REDIRECTS = [
  ["overview", "overview"],
  ["apps", "apps"],
  ["new-app", "new-app"],
  ["vault", "vault"],
  ["integrations", "integrations"],
  ["agents", "agents"],
  ["workspace", "workspace"],
  ["messaging", "messaging"],
  ["destinations", "destinations"],
  ["identities", "identities"],
  ["approvals", "approvals"],
  ["audit", "audit"],
  ["team", "team"],
];

function copyNetlifyFunctionIntoWorkspace(
  workspaceRoot: string,
  app: string,
): void {
  const appDir = path.join(workspaceRoot, "apps", app);
  const src = path.join(appDir, ".netlify", "functions-internal", "server");
  if (!fs.existsSync(src)) {
    throw new Error(
      `Expected Netlify function at ${src} after building ${app}. Check the app's build script and NITRO_PRESET.`,
    );
  }

  const dest = path.join(netlifyFunctionsDir(workspaceRoot), `${app}-server`);
  fs.rmSync(dest, { recursive: true, force: true });
  copyDir(src, dest);
  patchNetlifyFunctionEntry(dest, app);
}

function patchNetlifyFunctionEntry(functionDir: string, app: string): void {
  const serverPath = path.join(functionDir, "server.mjs");
  if (!fs.existsSync(serverPath)) return;

  const basePath = `/${app}`;
  const server = `const basePath = ${JSON.stringify(basePath)};

function setBasePathEnv() {
  const processRef = globalThis.process ??= { env: {} };
  processRef.env ??= {};
  Object.assign(processRef.env, {
    APP_BASE_PATH: basePath,
    VITE_APP_BASE_PATH: basePath,
  });
}

setBasePathEnv();

let cachedHandler;

export default async function handler(...args) {
  setBasePathEnv();
  cachedHandler ??= (await import("./main.mjs")).default;
  return cachedHandler(...args);
}

export const config = {
  name: ${JSON.stringify(`${app} server handler`)},
  generator: "agent-native workspace deploy",
  path: ${JSON.stringify(`${basePath}/*`)},
  nodeBundler: "none",
  includedFiles: ["**"],
  excludedPath: ["/.netlify/*"],
  preferStatic: true,
};
`;
  fs.rmSync(serverPath, { force: true });
  fs.writeFileSync(path.join(functionDir, `${app}-server.mjs`), server);
}

function netlifyFunctionsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".netlify", "functions-internal");
}

function cleanAppBuildOutputs(appDir: string): void {
  for (const name of ["dist", ".output", "build"]) {
    fs.rmSync(path.join(appDir, name), { recursive: true, force: true });
  }
  fs.rmSync(path.join(appDir, ".netlify", "functions-internal"), {
    recursive: true,
    force: true,
  });
}

function appUsesNetlifyUnpooledDatabaseUrl(appDir: string): boolean {
  const netlifyPath = path.join(appDir, "netlify.toml");
  if (!fs.existsSync(netlifyPath)) return false;
  try {
    return fs
      .readFileSync(netlifyPath, "utf-8")
      .includes("NETLIFY_DATABASE_URL_UNPOOLED");
  } catch {
    return false;
  }
}

function parsePresetArg(args: string[]): WorkspaceDeployPreset | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--preset" && args[i + 1]) {
      return normalizePreset(args[i + 1]);
    }
    if (arg.startsWith("--preset=")) {
      return normalizePreset(arg.slice("--preset=".length));
    }
  }
  return null;
}

function resolvePreset(
  optionPreset: WorkspaceDeployPreset | undefined,
  args: string[],
): WorkspaceDeployPreset {
  return (
    optionPreset ??
    parsePresetArg(args) ??
    normalizePreset(process.env.NITRO_PRESET) ??
    "cloudflare_pages"
  );
}

function normalizePreset(
  value: string | undefined,
): WorkspaceDeployPreset | null {
  if (!value) return null;
  if (value === "cloudflare_pages" || value === "cloudflare-pages") {
    return "cloudflare_pages";
  }
  if (value === "netlify") return "netlify";
  throw new Error(
    `Unsupported workspace deploy preset "${value}". Supported presets: cloudflare_pages, netlify.`,
  );
}

function moduleIdent(app: string): string {
  return "app_" + app.replace(/[^a-zA-Z0-9_]/g, "_");
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        const target = fs.readlinkSync(s);
        fs.symlinkSync(target, d);
      } catch {
        fs.copyFileSync(s, d);
      }
    } else if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
