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

import {
  AGENT_BACKGROUND_PROCESSOR_A2A,
  AGENT_BACKGROUND_PROCESSOR_FIELD,
  AGENT_BACKGROUND_PROCESSOR_INTEGRATION,
  AGENT_BACKGROUND_PROCESSOR_ROUTE,
  AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD,
  AGENT_CHAT_PROCESS_RUN_PATH,
  isDurableBackgroundFlagExplicitlyDisabled,
} from "../agent/durable-background.js";
import type { AgentNativeWorkspaceRootPage } from "../config.js";
import {
  INTEGRATION_RECOVERY_RUNTIME_MARKER,
  INTEGRATION_RETRY_SWEEP_PATH,
  INTEGRATION_RETRY_SWEEP_TOKEN_SUBJECT,
  isIntegrationDurableDispatchConfigured,
} from "../integrations/integration-durable-dispatch-config.js";
import {
  RECURRING_JOBS_SWEEP_PATH,
  RECURRING_JOBS_SWEEP_TOKEN_SUBJECT,
} from "../jobs/scheduler-dispatch.js";
import { findWorkspaceRoot } from "../scripts/utils.js";
import { normalizeFrameworkRoutePrefix } from "../shared/framework-route-prefix.js";
import {
  DEFAULT_WORKSPACE_APP_AUDIENCE,
  normalizeWorkspaceAppHomePath,
  normalizeWorkspaceAppAudience,
  normalizeWorkspaceAppPathList,
  workspaceAppAudienceFromPackageJson,
  workspaceAppRouteAccessFromPackageJson,
  type WorkspaceAppRouteAccess,
  type WorkspaceAppAudience,
} from "../shared/workspace-app-audience.js";
import {
  DISPATCH_WORKSPACE_ROOT_REDIRECTS,
  isValidWorkspaceAppIdFormat,
} from "../shared/workspace-app-id.js";
import {
  createAgentNativeConfigContext,
  loadResolvedAgentNativeConfig,
} from "../vite/agent-native-config-loader.js";
import {
  inferWorkspaceAppRootHomePath,
  readConfiguredWorkspaceAppHomePath,
} from "../workspace-app-config.js";
import {
  assertEmittedBackgroundFunctionOnDisk,
  isRecurringJobsDeployEnabled,
} from "./build.js";
import {
  cloneServerBundleForFunction,
  pruneSsrIslandFromRewritingClone,
} from "./function-bundle.js";
import {
  collectImmutableAssetPaths,
  IMMUTABLE_ASSET_CACHE_HEADERS,
} from "./immutable-assets.js";

/**
 * The public framework route prefix the workspace gateway routes on. A
 * workspace deploy has no single `agent-native.config.ts`, so the value comes
 * from the deployment alias every app build in this process also reads; the
 * gateway and each app therefore agree by construction.
 */
function workspaceFrameworkRoutePrefixEnv(): string {
  return (
    process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX?.trim() || ""
  );
}

function workspaceFrameworkRoutePrefix(): string {
  return normalizeFrameworkRoutePrefix(
    workspaceFrameworkRoutePrefixEnv() || undefined,
    "AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX",
  );
}

export type WorkspaceDeployPreset = "cloudflare_pages" | "netlify" | "vercel";

const NETLIFY_WORKSPACE_STATIC_DIR = "_workspace_static";
const DEFAULT_HOSTED_FEEDBACK_URL =
  "https://forms.agent-native.com/f/agent-native-feedback/_16ewV";
const NETLIFY_PUBLIC_ASSET_EXTENSIONS = new Set([
  "avif",
  "css",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "js",
  "json",
  "map",
  "mp4",
  "pdf",
  "png",
  "svg",
  "txt",
  "wasm",
  "webm",
  "webmanifest",
  "webp",
  "xml",
]);
const WORKSPACE_APPS_ENV_KEY = "AGENT_NATIVE_WORKSPACE_APPS_JSON";
const WORKSPACE_APPS_MANIFEST_DIR = ".agent-native";
const WORKSPACE_APPS_MANIFEST_FILE = "workspace-apps.json";
const VERCEL_OUTPUT_DIR = ".vercel/output";

const WORKSPACE_DIRECTORY_ENV_SNIPPET = `
  const directoryOrigin =
    processRef.env.AGENT_NATIVE_ORG_DIRECTORY_URL ||
    processRef.env.WORKSPACE_GATEWAY_URL ||
    processRef.env.APP_URL ||
    processRef.env.URL ||
    processRef.env.DEPLOY_URL ||
    processRef.env.BETTER_AUTH_URL;
  if (directoryOrigin) {
    processRef.env.AGENT_NATIVE_ORG_DIRECTORY_URL = directoryOrigin;
  }
`;

interface WorkspaceAppManifestEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  homePath: string;
  url?: string;
  isDispatch: boolean;
  audience: WorkspaceAppAudience;
  publicPaths: string[];
  protectedPaths: string[];
}

interface WorkspaceAppManifestOverride {
  id: string;
  url?: string;
  homePath?: string;
  audience?: WorkspaceAppAudience;
  publicPaths?: string[];
  protectedPaths?: string[];
}

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
  const config = await loadResolvedAgentNativeConfig(
    workspaceRoot,
    createAgentNativeConfigContext(
      "build",
      process.env.CONTEXT ?? "production",
    ),
  );
  const appsDirectory = config.deployment?.workspace?.appsDirectory ?? "apps";
  const workspaceAuthMode = config.deployment?.workspace?.authMode ?? "shared";
  const workspaceRootPage =
    config.deployment?.workspace?.rootPage ?? "redirect";
  const appsDir = path.resolve(workspaceRoot, appsDirectory);
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
    .filter((n) => fs.existsSync(path.join(appsDir, n, "package.json")))
    .sort(compareWorkspaceAppIds);

  if (apps.length === 0) {
    throw new Error(
      `Workspace has no apps. Run \`agent-native add-app\` to add one.`,
    );
  }
  assertValidWorkspaceAppIds(apps);
  const workspaceApps = await readWorkspaceAppManifest(
    workspaceRoot,
    apps,
    appsDir,
  );

  const preset = resolvePreset(opts.preset, rawArgs);
  assertWorkspaceDeployProductionEnv({ buildOnly, preset });
  const distDir = path.join(workspaceRoot, "dist");
  const vercelOutputDir = path.join(workspaceRoot, VERCEL_OUTPUT_DIR);
  if (preset === "vercel") {
    fs.rmSync(vercelOutputDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(vercelOutputDir, "static"), { recursive: true });
    fs.mkdirSync(path.join(vercelOutputDir, "functions"), {
      recursive: true,
    });
  } else {
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.mkdirSync(distDir, { recursive: true });
  }

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
    buildOneApp(
      workspaceRoot,
      appsDir,
      app,
      preset,
      execFile,
      workspaceApps,
      workspaceAuthMode,
    );
    moveAppBuildIntoWorkspaceOutput(
      workspaceRoot,
      appsDir,
      app,
      preset,
      distDir,
      vercelOutputDir,
      workspaceApps,
      workspaceAuthMode,
    );
  }
  writeWorkspaceAppManifests(
    workspaceRoot,
    distDir,
    apps,
    workspaceApps,
    preset,
  );
  if (workspaceRootPage === "directory") {
    writeWorkspaceDirectoryPage(
      preset === "vercel" ? path.join(vercelOutputDir, "static") : distDir,
      workspaceApps,
    );
  }

  if (preset === "netlify") {
    writeNetlifyRedirects(distDir, apps, workspaceRootPage);
    writeNetlifyHeaders(distDir, apps);
  } else if (preset === "vercel") {
    writeVercelBuildConfig(vercelOutputDir, apps, workspaceRootPage);
  } else {
    writeCloudflareRoutingManifest(distDir, apps, workspaceRootPage);
  }

  if (buildOnly) {
    const outputDir = preset === "vercel" ? vercelOutputDir : distDir;
    console.log(
      `\n[workspace-deploy] Build complete at ${outputDir}. Skipping publish (--build-only).`,
    );
    return;
  }

  console.log(`\n[workspace-deploy] Build complete. Publish with:\n`);
  console.log(`  cd ${path.relative(process.cwd(), workspaceRoot) || "."}`);
  if (preset === "netlify") {
    console.log(
      `  netlify deploy --prod --dir=dist --functions=.netlify/functions-internal\n`,
    );
  } else if (preset === "vercel") {
    console.log(`  vercel deploy --prebuilt\n`);
  } else {
    console.log(`  wrangler pages deploy dist\n`);
  }
  console.log(
    `All apps live at https://<origin>/<app-name>/*. Log in once on any app\nand the session is shared across the workspace.`,
  );
}

function buildOneApp(
  workspaceRoot: string,
  appsDir: string,
  app: string,
  preset: WorkspaceDeployPreset,
  execFile: typeof execFileSync,
  workspaceApps: WorkspaceAppManifestEntry[],
  workspaceAuthMode: "shared" | "isolated",
): void {
  const appDir = path.join(appsDir, app);
  const workspaceAppAudience = workspaceAppAudienceForApp(workspaceApps, app);
  const workspaceAppRouteAccess = workspaceAppRouteAccessForApp(
    workspaceApps,
    app,
  );
  const workspaceGatewayUrl =
    process.env.VITE_WORKSPACE_GATEWAY_URL || workspaceBaseUrl();
  const workspaceOAuthUrl = workspaceOAuthOrigin(workspaceGatewayUrl);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NITRO_PRESET: preset,
    AGENT_NATIVE_WORKSPACE: "1",
    AGENT_NATIVE_WORKSPACE_AUTH_MODE: workspaceAuthMode,
    AGENT_NATIVE_WORKSPACE_APP_ID: app,
    VITE_AGENT_NATIVE_WORKSPACE: "1",
    VITE_AGENT_NATIVE_WORKSPACE_AUTH_MODE: workspaceAuthMode,
    VITE_AGENT_NATIVE_WORKSPACE_APP_ID: app,
    ...(preset === "netlify"
      ? {
          VITE_AGENT_NATIVE_FEEDBACK_URL:
            process.env.VITE_AGENT_NATIVE_FEEDBACK_URL ??
            DEFAULT_HOSTED_FEEDBACK_URL,
        }
      : {}),
    APP_BASE_PATH: `/${app}`,
    VITE_APP_BASE_PATH: `/${app}`,
    AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX:
      workspaceFrameworkRoutePrefixEnv(),
    AGENT_NATIVE_WORKSPACE_APP_AUDIENCE: workspaceAppAudience,
    AGENT_NATIVE_WORKSPACE_APP_PUBLIC_PATHS: JSON.stringify(
      workspaceAppRouteAccess.publicPaths,
    ),
    AGENT_NATIVE_WORKSPACE_APP_PROTECTED_PATHS: JSON.stringify(
      workspaceAppRouteAccess.protectedPaths,
    ),
    VITE_AGENT_NATIVE_WORKSPACE_APP_AUDIENCE: workspaceAppAudience,
    VITE_AGENT_NATIVE_WORKSPACE_APP_PUBLIC_PATHS: JSON.stringify(
      workspaceAppRouteAccess.publicPaths,
    ),
    VITE_AGENT_NATIVE_WORKSPACE_APP_PROTECTED_PATHS: JSON.stringify(
      workspaceAppRouteAccess.protectedPaths,
    ),
    VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON: JSON.stringify(workspaceApps),
    ...(workspaceGatewayUrl
      ? {
          AGENT_NATIVE_ORG_DIRECTORY_URL:
            process.env.AGENT_NATIVE_ORG_DIRECTORY_URL || workspaceGatewayUrl,
        }
      : {}),
    ...(workspaceGatewayUrl
      ? {
          WORKSPACE_GATEWAY_URL:
            process.env.WORKSPACE_GATEWAY_URL || workspaceGatewayUrl,
          VITE_WORKSPACE_GATEWAY_URL: workspaceGatewayUrl,
          ...(workspaceOAuthUrl
            ? { VITE_WORKSPACE_OAUTH_ORIGIN: workspaceOAuthUrl }
            : {}),
        }
      : {}),
    [WORKSPACE_APPS_ENV_KEY]: JSON.stringify(workspaceApps),
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

function moveAppBuildIntoWorkspaceOutput(
  workspaceRoot: string,
  appsDir: string,
  app: string,
  preset: WorkspaceDeployPreset,
  distDir: string,
  vercelOutputDir: string,
  workspaceApps: WorkspaceAppManifestEntry[],
  workspaceAuthMode: "shared" | "isolated",
): void {
  const appDir = path.join(appsDir, app);
  if (preset === "vercel") {
    copyVercelAppBuildIntoWorkspace(
      appsDir,
      app,
      vercelOutputDir,
      workspaceApps,
      workspaceAuthMode,
    );
    return;
  }

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
    const target = path.join(distDir, NETLIFY_WORKSPACE_STATIC_DIR, app);
    fs.mkdirSync(target, { recursive: true });
    copyDir(staticSrc, target);
    // Nitro/Vite mounted builds can contain a nested copy of public assets at
    // dist/<app>/<app>/...; the workspace root already supplies the outer
    // mount path, so keeping it would publish duplicate /<app>/<app> URLs.
    fs.rmSync(path.join(target, app), { recursive: true, force: true });
    copyNetlifyFunctionIntoWorkspace(
      workspaceRoot,
      appsDir,
      app,
      workspaceApps,
      target,
      workspaceAuthMode,
    );
  } else {
    const target = path.join(distDir, app);
    fs.mkdirSync(target, { recursive: true });
    copyDir(src, target);
  }
}

function copyVercelAppBuildIntoWorkspace(
  appsDir: string,
  app: string,
  vercelOutputDir: string,
  workspaceApps: WorkspaceAppManifestEntry[],
  workspaceAuthMode: "shared" | "isolated",
): void {
  const appDir = path.join(appsDir, app);
  const src = path.join(appDir, VERCEL_OUTPUT_DIR);
  if (!fs.existsSync(src)) {
    throw new Error(
      `Expected Vercel output at ${src} after building ${app}. Check the app's build script and NITRO_PRESET.`,
    );
  }

  const staticSrc = path.join(src, "static");
  const staticDest = path.join(vercelOutputDir, "static");
  if (fs.existsSync(staticSrc)) {
    copyDir(staticSrc, staticDest);
    // Nitro's Vercel preset already nests assets under baseURL. The shared
    // deploy build also mirrors client assets under baseURL for other Nitro
    // presets, so mounted apps can contain a duplicate /<app>/<app> copy.
    // An app named "assets" collides with Vite's real default assets
    // directory, so that path cannot be distinguished from the duplicate.
    if (app !== "assets") {
      fs.rmSync(path.join(staticDest, app, app), {
        recursive: true,
        force: true,
      });
    }
  }

  const functionSrc = path.join(src, "functions", "__server.func");
  if (!fs.existsSync(functionSrc)) {
    throw new Error(
      `Expected Vercel function at ${functionSrc} after building ${app}. Check the app's build script and NITRO_PRESET.`,
    );
  }

  const functionDest = path.join(
    vercelOutputDir,
    "functions",
    `${app}-server.func`,
  );
  fs.rmSync(functionDest, { recursive: true, force: true });
  cloneServerBundleForFunction(functionSrc, functionDest);
  patchVercelFunctionEntry(functionDest, app, workspaceApps, workspaceAuthMode);
}

/**
 * Write the Cloudflare Pages `_routes.json` and a dispatcher `_worker.js` at
 * the workspace dist root so each app is reachable under /<app>/*.
 */
function writeCloudflareRoutingManifest(
  distDir: string,
  apps: string[],
  rootPage: AgentNativeWorkspaceRootPage,
): void {
  const dispatchFaviconAsset = apps.includes("dispatch")
    ? dispatchRootFaviconAsset(distDir)
    : null;
  // _routes.json tells Cloudflare which paths are dynamic (Functions) vs
  // static. Mark both /<app> and /<app>/* as include so every app's worker
  // handles its root and subtree.
  const include = [
    ...apps.flatMap((a) => [`/${a}`, `/${a}/*`]),
    ...apps.flatMap((app) =>
      workspaceOAuthDiscoveryRoutes(app).flatMap(({ path, descendants }) => [
        path,
        ...(descendants ? [`${path}/*`] : []),
      ]),
    ),
  ];
  if (rootPage !== "directory") include.push("/");
  if (apps.includes("dispatch")) {
    include.push(`${workspaceFrameworkRoutePrefix()}/*`);
    include.push("/.well-known/*");
    include.push(
      ...DISPATCH_WORKSPACE_ROOT_REDIRECTS.map(([from]) => `/${from}`),
    );
    include.push("/apps/*");
    if (dispatchFaviconAsset) include.push("/favicon.ico");
  }
  const routes = {
    version: 1,
    include,
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
        `  if (pathname === "/${a}" || pathname === "/${a}.data" || pathname.startsWith("/${a}/")) return ${moduleIdent(a)}.fetch(requestForMountedApp(request, "/${a}"), env, ctx);`,
    )
    .join("\n");
  const workspaceOAuthRoutes = apps
    .flatMap((app) =>
      workspaceOAuthDiscoveryRoutes(app).map(({ path, descendants }) => {
        const matches = descendants
          ? `pathname === ${JSON.stringify(path)} || pathname.startsWith(${JSON.stringify(`${path}/`)})`
          : `pathname === ${JSON.stringify(path)}`;
        return `    if (${matches}) return ${moduleIdent(app)}.fetch(request, env, ctx);`;
      }),
    )
    .join("\n");
  const dispatchRootFrameworkRoutes = apps.includes("dispatch")
    ? `    if (pathname === ${JSON.stringify(workspaceFrameworkRoutePrefix())} || pathname.startsWith(${JSON.stringify(`${workspaceFrameworkRoutePrefix()}/`)}) || pathname === "/.well-known" || pathname.startsWith("/.well-known/")) return ${moduleIdent("dispatch")}.fetch(request, env, ctx);
`
    : "";
  const dispatchRootFaviconRoute = dispatchFaviconAsset
    ? `    if (pathname === "/favicon.ico") return Response.redirect(new URL("/dispatch/${dispatchFaviconAsset}", request.url).toString(), 302);
`
    : "";
  const dispatchRootAliasRoutes = apps.includes("dispatch")
    ? DISPATCH_WORKSPACE_ROOT_REDIRECTS.map(
        ([from, to]) =>
          `    if (pathname === "/${from}") return Response.redirect(new URL("/dispatch/${to}" + search, request.url).toString(), 302);`,
      ).join("\n") + "\n"
    : "";
  const dispatchRootDynamicAliasRoutes = apps.includes("dispatch")
    ? `    if (pathname.startsWith("/apps/")) return Response.redirect(new URL("/dispatch" + pathname + search, request.url).toString(), 302);
`
    : "";
  const dispatchMountedRootRedirect = apps.includes("dispatch")
    ? `    if (pathname === "/dispatch" || pathname === "/dispatch/") return Response.redirect(new URL("/dispatch/overview" + search, request.url).toString(), 302);
`
    : "";

  const rootRedirect =
    rootPage === "directory"
      ? ""
      : `    if (pathname === "/") {
      return Response.redirect(new URL("${cloudflareRootRedirectPath(apps)}", request.url).toString(), 302);
    }
`;
  const worker = `${imports}

function requestForMountedApp(request, basePath) {
  const url = new URL(request.url);
  if (url.pathname !== basePath && url.pathname !== \`\${basePath}/\`) {
    return request;
  }
  url.pathname = \`\${basePath}//\`;
  return new Request(url, request);
}

export default {
  async fetch(request, env, ctx) {
    const { pathname, search } = new URL(request.url);
${workspaceOAuthRoutes}
${dispatchRootFrameworkRoutes}${dispatchRootFaviconRoute}${dispatchRootAliasRoutes}${dispatchRootDynamicAliasRoutes}${dispatchMountedRootRedirect}${dispatch}
${rootRedirect}
    return new Response("Not found", { status: 404 });
  },
};
`;
  fs.writeFileSync(path.join(distDir, "_worker.js"), worker);
}

function cloudflareRootRedirectPath(apps: string[]): string {
  return apps.includes("dispatch") ? "/dispatch/overview" : `/${apps[0]}/`;
}

function workspaceOAuthDiscoveryRoutes(
  app: string,
): Array<{ path: string; descendants: boolean }> {
  return [
    {
      path: `/.well-known/oauth-authorization-server/${app}`,
      descendants: false,
    },
    {
      path: `/.well-known/openid-configuration/${app}`,
      descendants: false,
    },
    {
      path: `/.well-known/oauth-protected-resource/${app}`,
      descendants: true,
    },
  ];
}

function writeNetlifyRedirects(
  distDir: string,
  apps: string[],
  rootPage: AgentNativeWorkspaceRootPage,
): void {
  const lines: string[] = [
    "# Generated by agent-native deploy --preset netlify",
    "# Static app assets are stored under a safe namespace; dynamic app routes are handled by function route config.",
  ];

  for (const app of apps) {
    for (const { path, descendants } of workspaceOAuthDiscoveryRoutes(app)) {
      const target = `/.netlify/functions/${app}-server 200`;
      lines.push(`${path} ${target}`);
      if (descendants) lines.push(`${path}/* ${target}`);
    }
  }

  if (apps.includes("dispatch")) {
    lines.push(
      `${workspaceFrameworkRoutePrefix()}/* /.netlify/functions/dispatch-server 200`,
    );
    lines.push("/.well-known/* /.netlify/functions/dispatch-server 200");
    const faviconAsset = dispatchRootFaviconAsset(distDir);
    if (faviconAsset) {
      lines.push(`/favicon.ico /dispatch/${faviconAsset} 302`);
    }
  }

  for (const app of apps) {
    lines.push(...netlifyAssetRedirectsFor(app, distDir));
  }

  if (apps.includes("dispatch")) {
    if (rootPage !== "directory") {
      lines.push("/ /dispatch/overview 302");
    }
    lines.push("/dispatch /dispatch/overview 302");
    lines.push("/dispatch/ /dispatch/overview 302");
    for (const [from, to] of DISPATCH_WORKSPACE_ROOT_REDIRECTS) {
      lines.push(`/${from} /dispatch/${to} 302`);
    }
    lines.push("/apps/* /dispatch/apps/:splat 302");
  } else if (rootPage !== "directory") {
    lines.push(`/ /${apps[0]}/ 302`);
  }

  fs.writeFileSync(path.join(distDir, "_redirects"), lines.join("\n") + "\n");
}

function writeNetlifyHeaders(distDir: string, apps: string[]): void {
  const blocks = apps.flatMap((app) => {
    const staticDir = path.join(distDir, NETLIFY_WORKSPACE_STATIC_DIR, app);
    return collectImmutableAssetPaths(staticDir).flatMap((assetPath) => [
      netlifyHeaderBlock(`/${app}${assetPath}`),
      netlifyHeaderBlock(`/${NETLIFY_WORKSPACE_STATIC_DIR}/${app}${assetPath}`),
    ]);
  });

  if (blocks.length === 0) return;
  fs.writeFileSync(path.join(distDir, "_headers"), blocks.join("\n\n") + "\n");
}

function netlifyHeaderBlock(pathname: string): string {
  return [
    pathname,
    ...Object.entries(IMMUTABLE_ASSET_CACHE_HEADERS).map(
      ([name, value]) => `  ${name}: ${value}`,
    ),
  ].join("\n");
}

function writeVercelBuildConfig(
  outputDir: string,
  apps: string[],
  rootPage: AgentNativeWorkspaceRootPage,
): void {
  const routes: Array<Record<string, any>> = [
    ...vercelImmutableAssetHeaderRoutes(outputDir, apps),
    { handle: "filesystem" },
  ];

  routes.push(
    ...apps.flatMap((app) =>
      workspaceOAuthDiscoveryRoutes(app).flatMap(({ path, descendants }) => [
        { src: vercelRouteSrc(path), dest: `/${app}-server` },
        ...(descendants
          ? [{ src: `${vercelRouteSrc(path)}/(.*)`, dest: `/${app}-server` }]
          : []),
      ]),
    ),
  );

  if (apps.includes("dispatch")) {
    routes.push(
      { src: workspaceFrameworkRoutePrefix(), dest: "/dispatch-server" },
      {
        src: `${workspaceFrameworkRoutePrefix()}/(.*)`,
        dest: "/dispatch-server",
      },
      { src: "/\\.well-known", dest: "/dispatch-server" },
      { src: "/\\.well-known/(.*)", dest: "/dispatch-server" },
    );

    const faviconAsset = dispatchRootFaviconAsset(
      path.join(outputDir, "static"),
    );
    if (faviconAsset) {
      routes.push(vercelRedirect("/favicon.ico", `/dispatch/${faviconAsset}`));
    }

    if (rootPage !== "directory") {
      routes.push(vercelRedirect("/", "/dispatch/overview"));
    }
    routes.push(
      vercelRedirect("/dispatch", "/dispatch/overview"),
      vercelRedirect("/dispatch/", "/dispatch/overview"),
    );
    for (const [from, to] of DISPATCH_WORKSPACE_ROOT_REDIRECTS) {
      routes.push(vercelRedirect(`/${from}`, `/dispatch/${to}`));
    }
    routes.push(vercelRedirect("/apps/(.*)", "/dispatch/apps/$1"));
  } else if (rootPage !== "directory") {
    routes.push(vercelRedirect("/", `/${apps[0]}/`));
  }

  for (const app of apps) {
    if (app !== "dispatch") {
      routes.push({ src: `/${app}`, dest: `/${app}-server` });
      routes.push({
        src: vercelRouteSrc(`/${app}.data`),
        dest: `/${app}-server`,
      });
    }
    routes.push({ src: `/${app}/(.*)`, dest: `/${app}-server` });
  }

  const config = {
    version: 3,
    routes,
  };
  fs.writeFileSync(
    path.join(outputDir, "config.json"),
    JSON.stringify(config, null, 2) + "\n",
  );
}

function vercelImmutableAssetHeaderRoutes(
  outputDir: string,
  apps: string[],
): Array<Record<string, any>> {
  return apps.flatMap((app) => {
    const staticDir = path.join(outputDir, "static", app);
    return collectImmutableAssetPaths(staticDir).map((assetPath) => ({
      src: vercelRouteSrc(`/${app}${assetPath}`),
      headers: IMMUTABLE_ASSET_CACHE_HEADERS,
      continue: true,
    }));
  });
}

function vercelRouteSrc(pathname: string): string {
  return pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function vercelRedirect(src: string, location: string): Record<string, any> {
  return {
    src,
    status: 302,
    headers: { Location: location },
  };
}

function netlifyAssetRedirectsFor(app: string, distDir: string): string[] {
  const from = `/${app}`;
  const to = `/${NETLIFY_WORKSPACE_STATIC_DIR}/${app}`;
  return [
    `${from}/assets/* ${to}/assets/:splat 200`,
    ...netlifyPublicAssetPaths(
      app,
      path.join(distDir, NETLIFY_WORKSPACE_STATIC_DIR, app),
    ).map((assetPath) => {
      const assetName = assetPath.slice(from.length + 1);
      return `${assetPath} ${to}/${assetName} 200`;
    }),
  ];
}

function dispatchRootFaviconAsset(distDir: string): string | null {
  for (const asset of ["favicon.ico", "favicon.svg", "favicon.png"]) {
    if (workspaceAppAssetExists(distDir, "dispatch", asset)) return asset;
  }
  return null;
}

function workspaceAppAssetExists(
  distDir: string,
  app: string,
  asset: string,
): boolean {
  return [
    path.join(distDir, NETLIFY_WORKSPACE_STATIC_DIR, app, asset),
    path.join(distDir, app, app, asset),
    path.join(distDir, app, asset),
  ].some((candidate) => fs.existsSync(candidate));
}

const RESERVED_WORKSPACE_APP_IDS = new Set([
  "_agent-native",
  "_workspace_static",
  "netlify",
  ...DISPATCH_WORKSPACE_ROOT_REDIRECTS.map(([from]) => from),
]);

function assertValidWorkspaceAppIds(apps: string[]): void {
  const invalidIds = apps.filter((app) => !isValidWorkspaceAppIdFormat(app));
  if (invalidIds.length > 0) {
    throw new Error(
      `Workspace app id ${invalidIds.map((id) => `"${id}"`).join(", ")} must use lowercase letters, numbers, and hyphens.`,
    );
  }

  const conflicts = apps.filter(
    (app) => app !== "dispatch" && RESERVED_WORKSPACE_APP_IDS.has(app),
  );
  if (conflicts.length === 0) return;
  throw new Error(
    `Workspace app id ${conflicts.map((id) => `"${id}"`).join(", ")} conflicts with reserved workspace routes. Choose a different app id.`,
  );
}

function copyNetlifyFunctionIntoWorkspace(
  workspaceRoot: string,
  appsDir: string,
  app: string,
  workspaceApps: WorkspaceAppManifestEntry[],
  staticDir: string,
  workspaceAuthMode: "shared" | "isolated",
): void {
  const appDir = path.join(appsDir, app);
  const src = path.join(appDir, ".netlify", "functions-internal", "server");
  if (!fs.existsSync(src)) {
    throw new Error(
      `Expected Netlify function at ${src} after building ${app}. Check the app's build script and NITRO_PRESET.`,
    );
  }

  const dest = path.join(netlifyFunctionsDir(workspaceRoot), `${app}-server`);
  fs.rmSync(dest, { recursive: true, force: true });
  cloneServerBundleForFunction(src, dest);
  patchNetlifyFunctionEntry(
    dest,
    app,
    workspaceApps,
    staticDir,
    workspaceAuthMode,
  );

  // Durable background agent runs. Additive ONLY: when explicitly opted out
  // this emits nothing and the single-function deploy is unchanged.
  const integrationDurableDispatch =
    app === "dispatch" && isIntegrationDurableDispatchConfigured();
  const durableChat = isDurableBackgroundWorkspaceDeployEnabled();
  const recurringJobs = isRecurringJobsDeployEnabled();
  if (durableChat || integrationDurableDispatch || recurringJobs) {
    emitNetlifyBackgroundFunction(
      workspaceRoot,
      app,
      src,
      workspaceApps,
      workspaceAuthMode,
    );
  }
  if (recurringJobs || durableChat) {
    emitNetlifyRecurringJobsFunction(workspaceRoot, app);
  }
  if (integrationDurableDispatch) {
    emitNetlifyIntegrationRecoveryFunction(
      workspaceRoot,
      app,
      src,
      workspaceApps,
      workspaceAuthMode,
    );
  }
}

/**
 * Emit the per-app Netlify Scheduled Function that hands one recurring-job
 * sweep to that app's durable background worker. The worker owns the actual
 * scan so scheduled-function timeouts cannot strand the automation runner.
 *
 * The entry imports `node:crypto`, so `includedFiles: ["**"]` must stay: the
 * deploy packager only accepts an omitted `includedFiles` for scheduled
 * functions whose entry file has no import/require edge at all.
 */
function emitNetlifyRecurringJobsFunction(
  workspaceRoot: string,
  app: string,
): void {
  const functionName = `${app}-agent-recurring-jobs`;
  const dest = path.join(netlifyFunctionsDir(workspaceRoot), functionName);
  const backgroundName = `${app}-agent-background`;
  const backgroundPath = `/.netlify/functions/${backgroundName}`;
  const sweepPath = `/${app}${RECURRING_JOBS_SWEEP_PATH}`;
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  const entry = `import { createHmac } from "node:crypto";

const BACKGROUND_PATH = ${JSON.stringify(backgroundPath)};
const SWEEP_PATH = ${JSON.stringify(sweepPath)};
const TOKEN_SUBJECT = ${JSON.stringify(RECURRING_JOBS_SWEEP_TOKEN_SUBJECT)};
const PROCESSOR_FIELD = ${JSON.stringify(AGENT_BACKGROUND_PROCESSOR_FIELD)};
const PROCESSOR_ROUTE = ${JSON.stringify(AGENT_BACKGROUND_PROCESSOR_ROUTE)};
const PROCESSOR_ROUTE_FIELD = ${JSON.stringify(AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD)};

function siteOrigin(request) {
  return new URL(request.url).origin;
}

function token(secret) {
  const timestamp = Date.now();
  const signature = createHmac("sha256", secret)
    .update(\`${RECURRING_JOBS_SWEEP_TOKEN_SUBJECT}:\${timestamp}\`)
    .digest("hex");
  return \`\${timestamp}.\${signature}\`;
}

export default async function handler(request) {
  const secret = process.env.A2A_SECRET;
  if (!secret) {
    throw new Error("[recurring-jobs] A2A_SECRET is required for the scheduled sweep");
  }
  const url = new URL(BACKGROUND_PATH, siteOrigin(request));
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${token(secret)}\`,
      "Content-Type": "application/json",
      "user-agent": "agent-native-recurring-jobs",
    },
    body: JSON.stringify({
      [PROCESSOR_FIELD]: PROCESSOR_ROUTE,
      [PROCESSOR_ROUTE_FIELD]: SWEEP_PATH,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      \`[recurring-jobs] Durable sweep handoff failed (\${response.status}): \${body.slice(0, 500)}\`,
    );
  }
  console.log("[recurring-jobs] Durable sweep handed off", url.toString());
  return new Response(null, { status: 204 });
}

export const config = {
  name: ${JSON.stringify(`${app} agent-native recurring jobs`)},
  generator: "agent-native workspace deploy",
  schedule: "* * * * *",
  nodeBundler: "none",
  includedFiles: ["**"],
};
`;
  fs.writeFileSync(path.join(dest, `${functionName}.mjs`), entry);
  console.log(
    `[workspace-deploy] Emitted Netlify scheduled recurring-job function "${functionName}" for app "${app}".`,
  );
}

/**
 * Deploy-time gate for emitting the per-app `-background` Netlify function.
 *
 * DELIBERATELY WIDER THAN THE SINGLE-TEMPLATE GATE, and it must stay exactly as
 * wide as the WORKSPACE half of the runtime gate: a workspace app opts in
 * through its agent-chat plugin (`durableBackgroundRuns`), which
 * `isAgentChatDurableBackgroundEnabled({ appOptIn: true })` honors unless the
 * env flag is EXPLICITLY falsy. So the emit condition is "not explicitly
 * disabled" — narrowing it to the env-only opt-in would leave plugin-opted-in
 * apps dispatching at a function that was never deployed. The predicates come
 * from durable-background.ts so the deploy and runtime parses cannot drift
 * (they had: this file's former local copy claimed to match a default-off gate
 * while implementing a default-on one).
 */
export function isDurableBackgroundWorkspaceDeployEnabled(): boolean {
  return !isDurableBackgroundFlagExplicitlyDisabled();
}

/**
 * Emit a SECOND Netlify function for `app` whose name ends in `-background`,
 * re-exporting the SAME `main.mjs` handler bundle. Netlify invokes any function
 * with `config.background: true` asynchronously (202 immediately, up to 15-min
 * budget), which is exactly what the durable-background chat dispatch
 * (`fireInternalDispatch` → the function's default url) needs.
 *
 * DOC-CORRECT DEFAULT-URL APPROACH (mirrors the single-template emit in
 * deploy/build.ts): the function declares NO custom `config.path`, so it keeps
 * its DEFAULT url `/.netlify/functions/<app>-agent-background`. The `<app>-server`
 * function's catch-all already excludes `/.netlify/*`, so that default-url
 * namespace is NEVER shadowed by the synchronous function — no overlapping
 * `config.path` and no catch-all patch are needed. The foreground dispatches to
 * that default url (`resolveAgentChatProcessRunDispatchPath` resolves the per-app
 * name from `AGENT_NATIVE_WORKSPACE_APP_ID`); `fireInternalDispatch` strips the
 * app base path for `/.netlify/*` targets so the request reaches the host-root
 * function url. The entry then REWRITES the incoming pathname to the
 * base-path-prefixed `_process-run` route before delegating to the Nitro router.
 *
 * It shares the same bundle (`includedFiles: ["**"]`) so `A2A_SECRET`, the DB
 * URL, and the rest of the env/bundle are present. A prior attempt gave the
 * function a custom `config.path` (the framework route) that overlapped the
 * synchronous `<app>-server` catch-all; that path was not honored as a route in
 * prod (probe → 404). The default url is the doc-correct fix.
 *
 * Safety net: if the dispatch fast-fails the foreground degrades to an inline
 * 40s synchronous run (see production-agent.ts).
 */
function emitNetlifyBackgroundFunction(
  workspaceRoot: string,
  app: string,
  srcServerDir: string,
  workspaceApps: WorkspaceAppManifestEntry[],
  workspaceAuthMode: "shared" | "isolated",
): void {
  // Name MUST end in `-background` (Netlify async convention + the runtime guard
  // reads the -background Lambda-name suffix as a fallback). It is reached at its
  // DEFAULT url /.netlify/functions/<app>-agent-background.
  const backgroundName = `${app}-agent-background`;
  const dest = path.join(netlifyFunctionsDir(workspaceRoot), backgroundName);
  fs.rmSync(dest, { recursive: true, force: true });
  cloneServerBundleForFunction(srcServerDir, dest);

  const basePath = `/${app}`;
  const workspaceAppAudience = workspaceAppAudienceForApp(workspaceApps, app);
  const workspaceAppRouteAccess = workspaceAppRouteAccessForApp(
    workspaceApps,
    app,
  );
  // The Nitro router for this app expects the base-path-prefixed framework route.
  // The function is reached at its default url, so the entry rewrites the
  // incoming pathname to `/<app>/_agent-native/agent-chat/_process-run`.
  const processRunPath = `${basePath}${AGENT_CHAT_PROCESS_RUN_PATH}`;
  const a2aProcessTaskPath = `${basePath}/_agent-native/a2a/_process-task`;
  const integrationProcessTaskPath = `${basePath}/_agent-native/integrations/process-task`;
  const recurringJobsSweepPath = `${basePath}${RECURRING_JOBS_SWEEP_PATH}`;
  const server = `// Mark this isolate as the durable background runtime BEFORE the handler bundle
// is imported, so isInBackgroundFunctionRuntime() reliably returns true in this
// function (the deployed Lambda name is not guaranteed to end in -background). A
// globalThis flag (NOT process.env) avoids the no-env-mutation guard and carries
// no cross-request state.
globalThis.__AGENT_NATIVE_BACKGROUND_RUNTIME__ = true;

const basePath = ${JSON.stringify(basePath)};
// The base-path-prefixed framework route the Nitro router dispatches to.
const PROCESS_RUN_PATH = ${JSON.stringify(processRunPath)};
const A2A_PROCESS_TASK_PATH = ${JSON.stringify(a2aProcessTaskPath)};
const INTEGRATION_PROCESS_TASK_PATH = ${JSON.stringify(integrationProcessTaskPath)};
const RECURRING_JOBS_SWEEP_PATH = ${JSON.stringify(recurringJobsSweepPath)};
const BACKGROUND_PROCESSOR_FIELD = ${JSON.stringify(AGENT_BACKGROUND_PROCESSOR_FIELD)};
const BACKGROUND_PROCESSOR_A2A = ${JSON.stringify(AGENT_BACKGROUND_PROCESSOR_A2A)};
const BACKGROUND_PROCESSOR_INTEGRATION = ${JSON.stringify(AGENT_BACKGROUND_PROCESSOR_INTEGRATION)};
const BACKGROUND_PROCESSOR_ROUTE = ${JSON.stringify(AGENT_BACKGROUND_PROCESSOR_ROUTE)};
const BACKGROUND_PROCESSOR_ROUTE_FIELD = ${JSON.stringify(AGENT_BACKGROUND_PROCESSOR_ROUTE_FIELD)};

function processorPathFromBody(body) {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.[BACKGROUND_PROCESSOR_FIELD] === BACKGROUND_PROCESSOR_A2A) {
      return A2A_PROCESS_TASK_PATH;
    }
    if (
      parsed?.[BACKGROUND_PROCESSOR_FIELD] ===
      BACKGROUND_PROCESSOR_INTEGRATION
    ) {
      return INTEGRATION_PROCESS_TASK_PATH;
    }
    const route = parsed?.[BACKGROUND_PROCESSOR_ROUTE_FIELD];
    if (
      parsed?.[BACKGROUND_PROCESSOR_FIELD] === BACKGROUND_PROCESSOR_ROUTE &&
      typeof route === "string" &&
      (route === RECURRING_JOBS_SWEEP_PATH ||
        route.startsWith(basePath + "/api/_agent-native-background/")) &&
      !route.includes("?") &&
      !route.includes("#")
    ) {
      return route;
    }
    return null;
  } catch {
    return null;
  }
}

function setBasePathEnv() {
  const processRef = globalThis.process ??= { env: {} };
  processRef.env ??= {};
${WORKSPACE_DIRECTORY_ENV_SNIPPET}
  Object.assign(processRef.env, {
    AGENT_NATIVE_WORKSPACE: "1",
    AGENT_NATIVE_WORKSPACE_AUTH_MODE: ${JSON.stringify(workspaceAuthMode)},
    AGENT_NATIVE_WORKSPACE_APP_ID: ${JSON.stringify(app)},
    APP_BASE_PATH: basePath,
    AGENT_NATIVE_WORKSPACE_APP_AUDIENCE: ${JSON.stringify(workspaceAppAudience)},
    AGENT_NATIVE_WORKSPACE_APP_PUBLIC_PATHS: ${JSON.stringify(JSON.stringify(workspaceAppRouteAccess.publicPaths))},
    AGENT_NATIVE_WORKSPACE_APP_PROTECTED_PATHS: ${JSON.stringify(JSON.stringify(workspaceAppRouteAccess.protectedPaths))},
    VITE_AGENT_NATIVE_WORKSPACE: "1",
    VITE_AGENT_NATIVE_WORKSPACE_AUTH_MODE: ${JSON.stringify(workspaceAuthMode)},
    VITE_AGENT_NATIVE_WORKSPACE_APP_ID: ${JSON.stringify(app)},
    VITE_APP_BASE_PATH: basePath,
    AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX: ${JSON.stringify(workspaceFrameworkRoutePrefixEnv())},
    VITE_AGENT_NATIVE_WORKSPACE_APP_AUDIENCE: ${JSON.stringify(workspaceAppAudience)},
    VITE_AGENT_NATIVE_WORKSPACE_APP_PUBLIC_PATHS: ${JSON.stringify(JSON.stringify(workspaceAppRouteAccess.publicPaths))},
    VITE_AGENT_NATIVE_WORKSPACE_APP_PROTECTED_PATHS: ${JSON.stringify(JSON.stringify(workspaceAppRouteAccess.protectedPaths))},
    VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON: ${JSON.stringify(JSON.stringify(workspaceApps))},
    ${JSON.stringify(WORKSPACE_APPS_ENV_KEY)}: ${JSON.stringify(JSON.stringify(workspaceApps))},
  });
}

setBasePathEnv();

let cachedHandler;

// Reached at the DEFAULT url /.netlify/functions/${backgroundName}; REWRITE the
// incoming pathname to the base-path-prefixed _process-run route so the Nitro
// router runs the plugin. Method, ALL headers (the HMAC Authorization: Bearer
// MUST survive) and the body are preserved.
export default async function handler(request) {
  setBasePathEnv();
  cachedHandler ??= (await import("./main.mjs")).default;
  const url = new URL(request.url);
  const method = request.method || "POST";
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await request.text() : undefined;
  url.pathname = processorPathFromBody(body) || PROCESS_RUN_PATH;
  const rewritten = new Request(url.toString(), {
    method,
    headers: request.headers,
    body,
  });
  return cachedHandler(rewritten);
}

export const config = {
  name: ${JSON.stringify(`${app} agent background handler`)},
  generator: "agent-native workspace deploy",
  // background: true → async invoke (202, 15-min budget). NO custom path: the
  // function keeps its default url /.netlify/functions/${backgroundName}, which
  // the <app>-server catch-all never shadows (it excludes /.netlify/*).
  background: true,
  nodeBundler: "none",
  includedFiles: ["**"],
  preferStatic: false,
};
`;
  // Remove the original Nitro entry (server.mjs) so only our background entry
  // is the function entrypoint, mirroring patchNetlifyFunctionEntry.
  fs.rmSync(path.join(dest, "server.mjs"), { force: true });
  fs.writeFileSync(path.join(dest, `${backgroundName}.mjs`), server);
  {
    // The clone rewrites url.pathname unconditionally, so it can never
    // route to the SSR page/asset handlers it inherited. Netlify zips and
    // uploads every function separately, so that island is paid for twice.
    const freed = pruneSsrIslandFromRewritingClone(dest, server);
    if (freed > 0) {
      console.log(
        `[deploy] Pruned ${(freed / 1024 / 1024).toFixed(1)}MB of unroutable SSR modules from ${path.basename(dest)}.`,
      );
    }
  }
  assertEmittedBackgroundFunctionOnDisk(dest, backgroundName);
  console.log(
    `[workspace-deploy] Emitted durable-background function "${backgroundName}" ` +
      `for app "${app}" with config { background:true } and NO custom path — ` +
      `reachable at its default url /.netlify/functions/${backgroundName} ` +
      `(rewrites to ${processRunPath}). REQUIRES real-deploy verification of ` +
      `Netlify async (202) invocation — see docs/design/durable-agent-runs.md.`,
  );
}

function emitNetlifyIntegrationRecoveryFunction(
  workspaceRoot: string,
  app: string,
  srcServerDir: string,
  workspaceApps: WorkspaceAppManifestEntry[],
  workspaceAuthMode: "shared" | "isolated",
): void {
  const functionName = `${app}-integration-recovery`;
  const dest = path.join(netlifyFunctionsDir(workspaceRoot), functionName);
  fs.rmSync(dest, { recursive: true, force: true });
  cloneServerBundleForFunction(srcServerDir, dest);
  fs.rmSync(path.join(dest, "server.mjs"), { force: true });

  const basePath = `/${app}`;
  const workspaceAppAudience = workspaceAppAudienceForApp(workspaceApps, app);
  const workspaceAppRouteAccess = workspaceAppRouteAccessForApp(
    workspaceApps,
    app,
  );
  const sweepPath = `${basePath}${INTEGRATION_RETRY_SWEEP_PATH}`;
  const entry = `import { createHmac } from "node:crypto";

const basePath = ${JSON.stringify(basePath)};
const SWEEP_PATH = ${JSON.stringify(sweepPath)};
const SWEEP_SUBJECT = ${JSON.stringify(INTEGRATION_RETRY_SWEEP_TOKEN_SUBJECT)};
globalThis.${INTEGRATION_RECOVERY_RUNTIME_MARKER} = true;

function setBasePathEnv() {
  const processRef = globalThis.process ??= { env: {} };
  processRef.env ??= {};
${WORKSPACE_DIRECTORY_ENV_SNIPPET}
  Object.assign(processRef.env, {
    AGENT_NATIVE_WORKSPACE: "1",
    AGENT_NATIVE_WORKSPACE_AUTH_MODE: ${JSON.stringify(workspaceAuthMode)},
    AGENT_NATIVE_WORKSPACE_APP_ID: ${JSON.stringify(app)},
    APP_BASE_PATH: basePath,
    AGENT_NATIVE_WORKSPACE_APP_AUDIENCE: ${JSON.stringify(workspaceAppAudience)},
    AGENT_NATIVE_WORKSPACE_APP_PUBLIC_PATHS: ${JSON.stringify(JSON.stringify(workspaceAppRouteAccess.publicPaths))},
    AGENT_NATIVE_WORKSPACE_APP_PROTECTED_PATHS: ${JSON.stringify(JSON.stringify(workspaceAppRouteAccess.protectedPaths))},
    VITE_AGENT_NATIVE_WORKSPACE: "1",
    VITE_AGENT_NATIVE_WORKSPACE_AUTH_MODE: ${JSON.stringify(workspaceAuthMode)},
    VITE_AGENT_NATIVE_WORKSPACE_APP_ID: ${JSON.stringify(app)},
    VITE_APP_BASE_PATH: basePath,
    AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX: ${JSON.stringify(workspaceFrameworkRoutePrefixEnv())},
    VITE_AGENT_NATIVE_WORKSPACE_APP_AUDIENCE: ${JSON.stringify(workspaceAppAudience)},
    VITE_AGENT_NATIVE_WORKSPACE_APP_PUBLIC_PATHS: ${JSON.stringify(JSON.stringify(workspaceAppRouteAccess.publicPaths))},
    VITE_AGENT_NATIVE_WORKSPACE_APP_PROTECTED_PATHS: ${JSON.stringify(JSON.stringify(workspaceAppRouteAccess.protectedPaths))},
    VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON: ${JSON.stringify(JSON.stringify(workspaceApps))},
    ${JSON.stringify(WORKSPACE_APPS_ENV_KEY)}: ${JSON.stringify(JSON.stringify(workspaceApps))},
  });
}

function enabled() {
  const raw = process.env.AGENT_INTEGRATION_DURABLE_DISPATCH;
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function token(secret) {
  const timestamp = Date.now();
  const signature = createHmac("sha256", secret)
    .update(\`${INTEGRATION_RETRY_SWEEP_TOKEN_SUBJECT}:\${timestamp}\`)
    .digest("hex");
  return \`\${timestamp}.\${signature}\`;
}

setBasePathEnv();
let cachedHandler;

export default async function handler(request, context) {
  setBasePathEnv();
  if (!enabled()) return new Response(null, { status: 204 });
  const secret = process.env.A2A_SECRET;
  if (!secret) {
    console.error("[integration-recovery] A2A_SECRET is required; sweep skipped");
    return new Response(null, { status: 204 });
  }
  cachedHandler ??= (await import("./main.mjs")).default;
  const url = new URL(request.url);
  url.pathname = SWEEP_PATH;
  const rewritten = new Request(url.toString(), {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${token(secret)}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ taskId: SWEEP_SUBJECT }),
  });
  return cachedHandler(rewritten, context);
}

export const config = {
  name: ${JSON.stringify(`${app} integration pending-task recovery`)},
  generator: "agent-native workspace deploy",
  schedule: "* * * * *",
  nodeBundler: "none",
  includedFiles: ["**"],
  preferStatic: false,
};
`;
  fs.writeFileSync(path.join(dest, `${functionName}.mjs`), entry);
  {
    // The clone rewrites url.pathname unconditionally, so it can never route to
    // the SSR page/asset handlers it inherited. Netlify zips and uploads every
    // function separately, so that island is paid for on every deploy.
    const freed = pruneSsrIslandFromRewritingClone(dest, entry);
    if (freed > 0) {
      console.log(
        `[deploy] Pruned ${(freed / 1024 / 1024).toFixed(1)}MB of unroutable SSR modules from ${path.basename(dest)}.`,
      );
    }
  }
}

function patchNetlifyFunctionEntry(
  functionDir: string,
  app: string,
  workspaceApps: WorkspaceAppManifestEntry[],
  staticDir: string,
  workspaceAuthMode: "shared" | "isolated",
): void {
  const serverPath = path.join(functionDir, "server.mjs");
  if (!fs.existsSync(serverPath)) return;

  const basePath = `/${app}`;
  const workspaceAppAudience = workspaceAppAudienceForApp(workspaceApps, app);
  const workspaceAppRouteAccess = workspaceAppRouteAccessForApp(
    workspaceApps,
    app,
  );
  const pathConfig =
    app === "dispatch"
      ? [
          `${workspaceFrameworkRoutePrefix()}/*`,
          "/.well-known/*",
          `${basePath}/*`,
        ]
      : [
          basePath,
          `${basePath}.data`,
          `${basePath}/*`,
          ...workspaceOAuthDiscoveryRoutes(app).flatMap(
            ({ path, descendants }) => [
              path,
              ...(descendants ? [`${path}/*`] : []),
            ],
          ),
        ];
  const normalizeBasePathHelper =
    app === "dispatch"
      ? ""
      : `
function normalizeBasePathArgs(args) {
  const request = args[0];
  if (!request || typeof request.url !== "string" || typeof Request !== "function") {
    return args;
  }
  const url = new URL(request.url);
  if (url.pathname === basePath + ".data") {
    url.pathname = basePath + "/.data";
    return [new Request(url, request), ...args.slice(1)];
  }
  if (url.pathname === basePath || url.pathname === \`\${basePath}/\`) {
    url.pathname = \`\${basePath}//\`;
    return [new Request(url, request), ...args.slice(1)];
  }
  return args;
}
`;
  const handlerArgs =
    app === "dispatch" ? "...args" : "...normalizeBasePathArgs(args)";
  const server = `const basePath = ${JSON.stringify(basePath)};

function setBasePathEnv() {
  const processRef = globalThis.process ??= { env: {} };
  processRef.env ??= {};
${WORKSPACE_DIRECTORY_ENV_SNIPPET}
  Object.assign(processRef.env, {
    AGENT_NATIVE_WORKSPACE: "1",
    AGENT_NATIVE_WORKSPACE_AUTH_MODE: ${JSON.stringify(workspaceAuthMode)},
    AGENT_NATIVE_WORKSPACE_APP_ID: ${JSON.stringify(app)},
    APP_BASE_PATH: basePath,
    AGENT_NATIVE_WORKSPACE_APP_AUDIENCE: ${JSON.stringify(workspaceAppAudience)},
    AGENT_NATIVE_WORKSPACE_APP_PUBLIC_PATHS: ${JSON.stringify(JSON.stringify(workspaceAppRouteAccess.publicPaths))},
    AGENT_NATIVE_WORKSPACE_APP_PROTECTED_PATHS: ${JSON.stringify(JSON.stringify(workspaceAppRouteAccess.protectedPaths))},
    VITE_AGENT_NATIVE_WORKSPACE: "1",
    VITE_AGENT_NATIVE_WORKSPACE_AUTH_MODE: ${JSON.stringify(workspaceAuthMode)},
    VITE_AGENT_NATIVE_WORKSPACE_APP_ID: ${JSON.stringify(app)},
    VITE_APP_BASE_PATH: basePath,
    AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX: ${JSON.stringify(workspaceFrameworkRoutePrefixEnv())},
    VITE_AGENT_NATIVE_WORKSPACE_APP_AUDIENCE: ${JSON.stringify(workspaceAppAudience)},
    VITE_AGENT_NATIVE_WORKSPACE_APP_PUBLIC_PATHS: ${JSON.stringify(JSON.stringify(workspaceAppRouteAccess.publicPaths))},
    VITE_AGENT_NATIVE_WORKSPACE_APP_PROTECTED_PATHS: ${JSON.stringify(JSON.stringify(workspaceAppRouteAccess.protectedPaths))},
    VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON: ${JSON.stringify(JSON.stringify(workspaceApps))},
    ${JSON.stringify(WORKSPACE_APPS_ENV_KEY)}: ${JSON.stringify(JSON.stringify(workspaceApps))},
  });
}

setBasePathEnv();
${normalizeBasePathHelper}

let cachedHandler;

export default async function handler(...args) {
  setBasePathEnv();
  cachedHandler ??= (await import("./main.mjs")).default;
  return cachedHandler(${handlerArgs});
}

export const config = {
  name: ${JSON.stringify(`${app} server handler`)},
  generator: "agent-native workspace deploy",
  path: ${JSON.stringify(pathConfig)},
  nodeBundler: "none",
  includedFiles: ["**"],
  excludedPath: ${JSON.stringify(
    netlifyFunctionExcludedPaths(app, staticDir),
    null,
    2,
  )
    .split("\n")
    .join("\n  ")},
  preferStatic: false,
};
`;
  fs.rmSync(serverPath, { force: true });
  fs.writeFileSync(path.join(functionDir, `${app}-server.mjs`), server);
}

function patchVercelFunctionEntry(
  functionDir: string,
  app: string,
  workspaceApps: WorkspaceAppManifestEntry[],
  workspaceAuthMode: "shared" | "isolated",
): void {
  const entryPath = path.join(functionDir, "index.mjs");
  if (!fs.existsSync(entryPath)) return;

  const mainPath = path.join(functionDir, "main.mjs");
  fs.rmSync(mainPath, { force: true });
  fs.renameSync(entryPath, mainPath);

  const basePath = `/${app}`;
  const workspaceAppAudience = workspaceAppAudienceForApp(workspaceApps, app);
  const workspaceAppRouteAccess = workspaceAppRouteAccessForApp(
    workspaceApps,
    app,
  );
  const entry = `const basePath = ${JSON.stringify(basePath)};

function setBasePathEnv() {
  const processRef = globalThis.process ??= { env: {} };
  processRef.env ??= {};
${WORKSPACE_DIRECTORY_ENV_SNIPPET}
  Object.assign(processRef.env, {
    AGENT_NATIVE_WORKSPACE: "1",
    AGENT_NATIVE_WORKSPACE_AUTH_MODE: ${JSON.stringify(workspaceAuthMode)},
    AGENT_NATIVE_WORKSPACE_APP_ID: ${JSON.stringify(app)},
    APP_BASE_PATH: basePath,
    AGENT_NATIVE_WORKSPACE_APP_AUDIENCE: ${JSON.stringify(workspaceAppAudience)},
    AGENT_NATIVE_WORKSPACE_APP_PUBLIC_PATHS: ${JSON.stringify(JSON.stringify(workspaceAppRouteAccess.publicPaths))},
    AGENT_NATIVE_WORKSPACE_APP_PROTECTED_PATHS: ${JSON.stringify(JSON.stringify(workspaceAppRouteAccess.protectedPaths))},
    VITE_AGENT_NATIVE_WORKSPACE: "1",
    VITE_AGENT_NATIVE_WORKSPACE_AUTH_MODE: ${JSON.stringify(workspaceAuthMode)},
    VITE_AGENT_NATIVE_WORKSPACE_APP_ID: ${JSON.stringify(app)},
    VITE_APP_BASE_PATH: basePath,
    AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX: ${JSON.stringify(workspaceFrameworkRoutePrefixEnv())},
    VITE_AGENT_NATIVE_WORKSPACE_APP_AUDIENCE: ${JSON.stringify(workspaceAppAudience)},
    VITE_AGENT_NATIVE_WORKSPACE_APP_PUBLIC_PATHS: ${JSON.stringify(JSON.stringify(workspaceAppRouteAccess.publicPaths))},
    VITE_AGENT_NATIVE_WORKSPACE_APP_PROTECTED_PATHS: ${JSON.stringify(JSON.stringify(workspaceAppRouteAccess.protectedPaths))},
    VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON: ${JSON.stringify(JSON.stringify(workspaceApps))},
    ${JSON.stringify(WORKSPACE_APPS_ENV_KEY)}: ${JSON.stringify(JSON.stringify(workspaceApps))},
  });
}

function normalizeBasePathArgs(args) {
  const request = args[0];
  if (!request) return args;

  if (typeof Request === "function" && request instanceof Request) {
    const url = new URL(request.url);
    if (url.pathname === basePath + ".data") {
      url.pathname = basePath + "/.data";
      return [new Request(url, request), ...args.slice(1)];
    }
    if (url.pathname === basePath || url.pathname === \`\${basePath}/\`) {
      url.pathname = \`\${basePath}//\`;
      return [new Request(url, request), ...args.slice(1)];
    }
    return args;
  }

  if (typeof request.url !== "string") return args;
  const url = new URL(request.url, "http://agent-native.local");
  if (url.pathname === basePath + ".data") {
    request.url = basePath + "/.data" + url.search;
    return args;
  }
  if (url.pathname === basePath || url.pathname === \`\${basePath}/\`) {
    request.url = \`\${basePath}//\${url.search}\`;
  }
  return args;
}

setBasePathEnv();

let cachedHandler;

export default {
  async fetch(...args) {
    setBasePathEnv();
    cachedHandler ??= (await import("./main.mjs")).default;
    // Vercel invokes this { fetch } export web-style with a Web Request, and
    // Nitro's Vercel entry is itself a web fetch handler ({ fetch }). Require that
    // shape rather than forwarding a Web Request to a Node-style (req, res) handler.
    if (typeof cachedHandler?.fetch !== "function") {
      throw new Error(
        "agent-native: Vercel workspace function expected a Web fetch handler ({ fetch }) from ./main.mjs",
      );
    }
    return cachedHandler.fetch(...normalizeBasePathArgs(args));
  },
}
`;
  fs.writeFileSync(entryPath, entry);
}

function netlifyFunctionExcludedPaths(
  app: string,
  staticDir: string,
): string[] {
  return [
    "/.netlify/*",
    `/${app}/assets/*`,
    ...netlifyPublicAssetPaths(app, staticDir),
  ];
}

function netlifyPublicAssetPaths(app: string, staticDir: string): string[] {
  if (!fs.existsSync(staticDir)) return [];
  const assetPaths: string[] = [];
  const visit = (directory: string, relativeDirectory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!relativeDirectory && entry.name === "assets") continue;
        visit(path.join(directory, entry.name), relativePath);
        continue;
      }
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      if (NETLIFY_PUBLIC_ASSET_EXTENSIONS.has(ext)) {
        assetPaths.push(relativePath);
      }
    }
  };
  visit(staticDir, "");
  return assetPaths
    .sort()
    .map(
      (assetPath) =>
        `/${app}/${encodeURI(assetPath.split(path.sep).join("/"))}`,
    );
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
  fs.rmSync(path.join(appDir, ".vercel", "output"), {
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

function writeWorkspaceAppManifests(
  workspaceRoot: string,
  distDir: string,
  apps: string[],
  workspaceApps: WorkspaceAppManifestEntry[],
  preset: WorkspaceDeployPreset,
): void {
  const manifest = JSON.stringify(
    {
      version: 1,
      apps: workspaceApps,
    },
    null,
    2,
  );

  const targets =
    preset === "netlify"
      ? apps.map((app) =>
          path.join(
            netlifyFunctionsDir(workspaceRoot),
            `${app}-server`,
            WORKSPACE_APPS_MANIFEST_DIR,
            WORKSPACE_APPS_MANIFEST_FILE,
          ),
        )
      : preset === "vercel"
        ? apps.map((app) =>
            path.join(
              workspaceRoot,
              VERCEL_OUTPUT_DIR,
              "functions",
              `${app}-server.func`,
              WORKSPACE_APPS_MANIFEST_DIR,
              WORKSPACE_APPS_MANIFEST_FILE,
            ),
          )
        : apps.map((app) =>
            path.join(
              distDir,
              app,
              WORKSPACE_APPS_MANIFEST_DIR,
              WORKSPACE_APPS_MANIFEST_FILE,
            ),
          );

  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${manifest}\n`);
  }
}

function writeWorkspaceDirectoryPage(
  outputDir: string,
  apps: WorkspaceAppManifestEntry[],
): void {
  const accents = [
    "AccentColor",
    "LinkText",
    "Mark",
    "Highlight",
    "ButtonText",
  ];
  const cards = apps
    .map((app, index) => {
      const name = escapeWorkspaceDirectoryHtml(app.name);
      const description = escapeWorkspaceDirectoryHtml(
        app.description || "A focused workspace app for your team.",
      );
      const href = escapeWorkspaceDirectoryHtml(`${app.path}/`);
      const initial = escapeWorkspaceDirectoryHtml(app.name.charAt(0));
      const accent = accents[index % accents.length];
      return `<a class="app-card" href="${href}">
  <span class="app-card__mark" style="--accent:${accent}" aria-hidden="true"><span>${initial}</span></span>
  <span class="app-card__body"><strong>${name}</strong><span>${description}</span></span>
  <span class="app-card__arrow" aria-hidden="true">↗</span>
</a>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Focused Agent-Native apps for the work ahead." />
    <title>Agent-Native apps</title>
    <style>
      :root { color-scheme: light dark; --bg: Canvas; --ink: CanvasText; --muted: GrayText; --line: color-mix(in srgb, CanvasText 16%, Canvas); --card: Canvas; --soft: color-mix(in srgb, CanvasText 7%, Canvas); }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      a { color: inherit; }
      .page { width: min(1180px, calc(100% - 48px)); margin: 0 auto; padding: 28px 0 72px; }
      .topbar { display: flex; align-items: center; justify-content: space-between; padding: 4px 0 84px; }
      .brand { display: inline-flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 650; letter-spacing: -.01em; text-decoration: none; }
      .brand__mark { display: grid; width: 28px; height: 28px; place-items: center; border: 1px solid var(--ink); border-radius: 8px; }
      .brand__mark::after { width: 10px; height: 10px; border-radius: 3px; background: var(--ink); content: ""; }
      .topbar__label { color: var(--muted); font-size: 13px; }
      .hero { max-width: 700px; padding-bottom: 52px; }
      .eyebrow { margin: 0 0 14px; color: var(--muted); font-size: 12px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
      h1 { max-width: 680px; margin: 0; font-size: clamp(42px, 7vw, 76px); font-weight: 580; letter-spacing: -.065em; line-height: .98; }
      .hero__copy { max-width: 520px; margin: 24px 0 0; color: var(--muted); font-size: 17px; letter-spacing: -.01em; }
      .app-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
      .app-card { position: relative; display: flex; min-height: 254px; flex-direction: column; gap: 22px; padding: 25px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); background: var(--card); text-decoration: none; transition: background .18s ease, color .18s ease; }
      .app-card:hover { background: var(--soft); }
      .app-card:focus-visible { outline: 3px solid AccentColor; outline-offset: -3px; }
      .app-card__mark { display: grid; width: 46px; height: 46px; place-items: center; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line)); border-radius: 13px; background: color-mix(in srgb, var(--accent) 12%, var(--card)); color: var(--accent); font-size: 18px; font-weight: 700; letter-spacing: -.04em; }
      .app-card__body { display: grid; gap: 8px; }
      .app-card__body strong { font-size: 19px; font-weight: 620; letter-spacing: -.03em; }
      .app-card__body span { max-width: 255px; color: var(--muted); line-height: 1.45; }
      .app-card__arrow { margin-top: auto; color: var(--muted); font-size: 21px; line-height: 1; transition: color .18s ease, transform .18s ease; }
      .app-card:hover .app-card__arrow { color: var(--ink); transform: translate(2px, -2px); }
      @media (max-width: 900px) { .app-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 600px) { .page { width: min(100% - 32px, 520px); padding-top: 20px; } .topbar { padding-bottom: 58px; } .hero { padding-bottom: 38px; } .app-grid { grid-template-columns: 1fr; } .app-card { min-height: 220px; } }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="topbar">
        <a class="brand" href="/" aria-label="Agent-Native apps"><span class="brand__mark" aria-hidden="true"></span><span>Agent-Native</span></a>
        <span class="topbar__label">Apps</span>
      </header>
      <section class="hero" aria-labelledby="page-title">
        <p class="eyebrow">Agent-Native apps</p>
        <h1 id="page-title">Pick the right app for the work ahead.</h1>
        <p class="hero__copy">Focused tools that turn real signals into useful next steps - choose one to get started.</p>
      </section>
      <nav class="app-grid" aria-label="Apps">
        ${cards}
      </nav>
    </main>
  </body>
</html>
`;
  fs.writeFileSync(path.join(outputDir, "index.html"), html);
}

function escapeWorkspaceDirectoryHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

async function readWorkspaceAppManifest(
  workspaceRoot: string,
  apps: string[],
  appsDir: string,
): Promise<WorkspaceAppManifestEntry[]> {
  const explicitApps = readExistingWorkspaceAppManifest(workspaceRoot);
  const entries: WorkspaceAppManifestEntry[] = [];

  for (const app of apps) {
    const appDir = path.join(appsDir, app);
    const pkg = readPackageJson(path.join(appDir, "package.json"));
    const appPath = `/${app}`;
    const explicit = explicitApps.get(app);
    const configuredHomePath = await readConfiguredWorkspaceAppHomePath(appDir);
    const url =
      normalizeWorkspaceAppUrl(explicit?.url) ?? workspaceAppUrl(appPath);
    const audience =
      workspaceAppAudienceFromPackageJson(pkg) ??
      explicit?.audience ??
      DEFAULT_WORKSPACE_APP_AUDIENCE;
    const packageRouteAccess = workspaceAppRouteAccessFromPackageJson(pkg);
    // Prefer the package.json value whenever the field was set — including
    // an explicit empty array, which is how a per-app package.json signals
    // "clear any previously-published manifest override." Falling back on
    // length > 0 would silently keep the explicit override even after the
    // app owner blanked their list.
    const publicPaths =
      packageRouteAccess.publicPaths ?? explicit?.publicPaths ?? [];
    const protectedPaths =
      packageRouteAccess.protectedPaths ?? explicit?.protectedPaths ?? [];
    entries.push({
      id: app,
      name: pkg?.displayName || titleCase(app),
      description: pkg?.description || "",
      path: appPath,
      homePath: normalizeWorkspaceAppHomePath(
        explicit?.homePath ??
          configuredHomePath ??
          inferWorkspaceAppRootHomePath(appDir),
      ),
      ...(url ? { url } : {}),
      isDispatch: app === "dispatch",
      audience,
      publicPaths,
      protectedPaths,
    });
  }

  return entries.sort((a, b) => {
    if (a.id === "dispatch") return -1;
    if (b.id === "dispatch") return 1;
    return a.name.localeCompare(b.name);
  });
}

function readExistingWorkspaceAppManifest(
  workspaceRoot: string,
): Map<string, WorkspaceAppManifestOverride> {
  const fromEnv = parseWorkspaceAppsJson(process.env[WORKSPACE_APPS_ENV_KEY]);
  const fromFile =
    readWorkspaceAppsFromFile(
      path.join(
        workspaceRoot,
        WORKSPACE_APPS_MANIFEST_DIR,
        WORKSPACE_APPS_MANIFEST_FILE,
      ),
    ) ??
    readWorkspaceAppsFromFile(
      path.join(workspaceRoot, WORKSPACE_APPS_MANIFEST_FILE),
    );
  const apps = fromEnv ?? fromFile ?? [];
  return new Map(apps.map((app) => [app.id, app]));
}

function parseWorkspaceAppsJson(
  raw: string | undefined,
): WorkspaceAppManifestOverride[] | null {
  if (!raw) return null;
  try {
    return parseWorkspaceAppsManifest(JSON.parse(raw));
  } catch {
    return null;
  }
}

function readWorkspaceAppsFromFile(
  file: string,
): WorkspaceAppManifestOverride[] | null {
  if (!fs.existsSync(file)) return null;
  return parseWorkspaceAppsManifest(readPackageJson(file));
}

function parseWorkspaceAppsManifest(
  parsed: any,
): WorkspaceAppManifestOverride[] | null {
  const rawApps = Array.isArray(parsed?.apps)
    ? parsed.apps
    : Array.isArray(parsed)
      ? parsed
      : null;
  if (!rawApps) return null;

  const apps = (rawApps as unknown[])
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Record<string, unknown>;
      const id = typeof e.id === "string" ? e.id.trim() : "";
      if (!id) return null;
      const url = normalizeWorkspaceAppUrl(e.url);
      const hasHomePath = Object.prototype.hasOwnProperty.call(e, "homePath");
      const homePath = hasHomePath
        ? normalizeWorkspaceAppHomePath(e.homePath)
        : undefined;
      const audience =
        e.audience === undefined
          ? undefined
          : normalizeWorkspaceAppAudience(e.audience);
      const publicPaths = normalizeWorkspaceAppPathList(e.publicPaths);
      const protectedPaths = normalizeWorkspaceAppPathList(e.protectedPaths);
      return {
        id,
        ...(url ? { url } : {}),
        ...(homePath ? { homePath } : {}),
        ...(audience ? { audience } : {}),
        ...(publicPaths.length > 0 ? { publicPaths } : {}),
        ...(protectedPaths.length > 0 ? { protectedPaths } : {}),
      };
    })
    .filter((app): app is NonNullable<typeof app> => !!app);

  return apps.length ? apps : null;
}

function workspaceBaseUrl(): string | null {
  const gatewayOrigin =
    process.env.WORKSPACE_GATEWAY_URL || process.env.VITE_WORKSPACE_GATEWAY_URL;
  const publicGatewayOrigin = normalizeOrigin(gatewayOrigin);
  const gatewayFallback =
    publicGatewayOrigin && !isLoopbackOrigin(publicGatewayOrigin)
      ? gatewayOrigin
      : null;
  return (
    process.env.APP_URL ||
    process.env.WORKSPACE_OAUTH_ORIGIN ||
    process.env.VITE_WORKSPACE_OAUTH_ORIGIN ||
    process.env.URL ||
    process.env.DEPLOY_URL ||
    process.env.BETTER_AUTH_URL ||
    gatewayFallback ||
    gatewayOrigin ||
    null
  );
}

function normalizeOrigin(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host === "::1"
    );
  } catch {
    return false;
  }
}

function workspaceOAuthOrigin(
  workspaceGatewayUrl: string | null,
): string | undefined {
  // Explicit overrides (env vars set by the operator) win even if they happen
  // to be loopback — that's a deliberate dev-against-prod choice.
  // The gateway-URL fallback, however, is auto-resolved and would silently
  // send users to localhost if the configured gateway is loopback in a
  // production deploy. Strip loopback there so OAuth fails loudly instead.
  const gatewayFallback = normalizeOrigin(workspaceGatewayUrl);
  return (
    normalizeOrigin(process.env.VITE_WORKSPACE_OAUTH_ORIGIN) ||
    normalizeOrigin(process.env.WORKSPACE_OAUTH_ORIGIN) ||
    normalizeOrigin(process.env.APP_URL) ||
    normalizeOrigin(process.env.BETTER_AUTH_URL) ||
    normalizeOrigin(process.env.URL) ||
    normalizeOrigin(process.env.DEPLOY_URL) ||
    (isLoopbackOrigin(gatewayFallback) ? undefined : gatewayFallback)
  );
}

function workspaceAppUrl(appPath: string): string | undefined {
  const base = workspaceBaseUrl();
  if (!base) return undefined;
  try {
    return new URL(appPath, `${base.replace(/\/$/, "")}/`).toString();
  } catch {
    return undefined;
  }
}

function normalizeWorkspaceAppUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return new URL(value.trim()).toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function readPackageJson(file: string): Record<string, any> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function assertWorkspaceDeployProductionEnv(opts: {
  buildOnly: boolean;
  preset: WorkspaceDeployPreset;
}): void {
  if (!isProductionWorkspaceDeploy(opts)) return;
  if (process.env.A2A_SECRET?.trim()) return;
  const providerHint =
    opts.preset === "netlify"
      ? ' For Netlify, one option is: netlify env:set A2A_SECRET "$(openssl rand -hex 32)".'
      : "";
  throw new Error(
    [
      "A2A_SECRET is required for production workspace deploys.",
      "Workspace Slack, webhook, and cross-app A2A work resumes through signed background processors; without A2A_SECRET those production routes return 503.",
      `Set A2A_SECRET in your deploy provider and redeploy.${providerHint}`,
      "For local artifact checks, run agent-native deploy --build-only outside the deploy provider environment.",
    ].join(" "),
  );
}

function isProductionWorkspaceDeploy(opts: {
  buildOnly: boolean;
  preset: WorkspaceDeployPreset;
}): boolean {
  if (!opts.buildOnly) return true;
  if (
    opts.preset === "netlify" &&
    process.env.NETLIFY === "true" &&
    process.env.NETLIFY_LOCAL !== "true"
  ) {
    return true;
  }
  if (opts.preset === "cloudflare_pages" && process.env.CF_PAGES === "1") {
    return true;
  }
  if (opts.preset === "vercel" && process.env.VERCEL === "1") {
    return true;
  }
  return false;
}

function normalizePreset(
  value: string | undefined,
): WorkspaceDeployPreset | null {
  if (!value) return null;
  if (value === "cloudflare_pages" || value === "cloudflare-pages") {
    return "cloudflare_pages";
  }
  if (value === "netlify") return "netlify";
  if (value === "vercel") return "vercel";
  throw new Error(
    `Unsupported workspace deploy preset "${value}". Supported presets: cloudflare_pages, netlify, vercel.`,
  );
}

function moduleIdent(app: string): string {
  return "app_" + app.replace(/[^a-zA-Z0-9_]/g, "_");
}

function workspaceAppAudienceForApp(
  workspaceApps: WorkspaceAppManifestEntry[],
  app: string,
): WorkspaceAppAudience {
  return (
    workspaceApps.find((entry) => entry.id === app)?.audience ??
    DEFAULT_WORKSPACE_APP_AUDIENCE
  );
}

function workspaceAppRouteAccessForApp(
  workspaceApps: WorkspaceAppManifestEntry[],
  app: string,
): WorkspaceAppRouteAccess {
  const entry = workspaceApps.find((candidate) => candidate.id === app);
  return {
    publicPaths: entry?.publicPaths ?? [],
    protectedPaths: entry?.protectedPaths ?? [],
  };
}

function compareWorkspaceAppIds(a: string, b: string): number {
  if (a === "dispatch") return -1;
  if (b === "dispatch") return 1;
  return a.localeCompare(b);
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
