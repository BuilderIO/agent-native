import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function inferWorkspaceAppRootHomePath(appDir: string): "/" | undefined {
  const routesDir = path.join(appDir, "app", "routes");
  if (!fs.existsSync(routesDir)) return undefined;

  const routeFiles = fs.readdirSync(routesDir);
  const hasRootRoute = routeFiles.some((filename) =>
    /^_index\.(?:[cm]?[jt]sx?)$/.test(filename),
  );
  const hasHomeRoute = routeFiles.some((filename) =>
    /^(?:_app\.)?home(?:\._index)?\.(?:[cm]?[jt]sx?)$/.test(filename),
  );
  return hasRootRoute && !hasHomeRoute ? "/" : undefined;
}

// ponytail: one process-global queue is the smallest safe isolation; replace
const workspaceAppConfigGlobals = globalThis as typeof globalThis & {
  __agentNativeWorkspaceAppConfigReadQueue?: Promise<void>;
};

export function readConfiguredWorkspaceAppHomePath(
  appDir: string,
): Promise<string | undefined> {
  const previous =
    workspaceAppConfigGlobals.__agentNativeWorkspaceAppConfigReadQueue ??
    Promise.resolve();
  const result = previous.then(() =>
    readConfiguredWorkspaceAppHomePathUnserialized(appDir),
  );
  workspaceAppConfigGlobals.__agentNativeWorkspaceAppConfigReadQueue =
    result.then(
      () => undefined,
      () => undefined,
    );
  return result;
}

async function readConfiguredWorkspaceAppHomePathUnserialized(
  appDir: string,
): Promise<string | undefined> {
  const pluginsDir = path.join(appDir, "server", "plugins");
  if (!fs.existsSync(pluginsDir)) return undefined;

  const pluginPaths = fs
    .readdirSync(pluginsDir)
    .filter((filename) => /\.(?:m?js|m?ts)$/.test(filename))
    .filter((filename) => !/\.(?:spec|test)\./.test(filename))
    .map((filename) => path.join(pluginsDir, filename))
    .filter((pluginPath) => {
      const source = fs.readFileSync(pluginPath, "utf8");
      return (
        path.basename(pluginPath).startsWith("config.") ||
        /\bdefineAppConfig\s*\(/.test(source)
      );
    })
    .sort();
  if (pluginPaths.length === 0) return undefined;

  const { createJiti } = await import("jiti");
  const { getAppConfig, resetAppConfigForTests } =
    await import("./app-config/index.js");
  const globals = globalThis as typeof globalThis & {
    __agentNativeAppConfig?: {
      layers: Record<string, unknown>;
      resolved?: unknown;
      envSignature?: string;
    };
  };
  const previousState = globals.__agentNativeAppConfig;
  const previousLayers = previousState
    ? { ...previousState.layers }
    : undefined;
  const previousResolved = previousState?.resolved;
  const previousEnvSignature = previousState?.envSignature;
  resetAppConfigForTests();
  try {
    const jiti = createJiti(pathToFileURL(pluginPaths[0]).href, {
      interopDefault: true,
      moduleCache: false,
    });
    for (const pluginPath of pluginPaths) {
      await jiti.import(pluginPath);
    }
    return getAppConfig().app.homePath;
  } catch (error) {
    throw new Error(
      `Could not load workspace app configuration from ${appDir}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    resetAppConfigForTests();
    if (previousState) {
      previousState.layers = previousLayers ?? {};
      previousState.resolved = previousResolved;
      previousState.envSignature = previousEnvSignature;
      globals.__agentNativeAppConfig = previousState;
    }
  }
}
