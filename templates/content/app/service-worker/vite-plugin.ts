import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build, type Plugin, type Rolldown } from "vite";

import {
  IMMUTABLE_ASSET_PATH,
  SHELL_WORKER_ENV,
  SHELL_WORKER_OFF,
  SHELL_WORKER_URL,
  shellBuildFilePath,
  type ShellBuildFile,
} from "./shell-contract";
import {
  shellBootAssets,
  shellRoutesFromManifest,
  type ReactRouterManifest,
} from "./shell-manifest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_ENTRY = path.join(HERE, "shell-worker.ts");
const CLEANUP_ENTRY = path.join(HERE, "cleanup-worker.ts");
const MANIFEST_FILE = /^manifest-[A-Za-z0-9_-]{8}\.js$/;
const MANIFEST_ASSIGNMENT = "window.__reactRouterManifest=";

function listFiles(root: string, relative = ""): string[] {
  const directory = path.join(root, relative);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = path.posix.join(relative, entry.name);
    return entry.isDirectory() ? listFiles(root, child) : [child];
  });
}

export function readReactRouterManifest(
  clientDir: string,
): ReactRouterManifest {
  const assetsDir = path.join(clientDir, "assets");
  const names = fs
    .readdirSync(assetsDir)
    .filter((name) => MANIFEST_FILE.test(name));
  const [name, ...others] = names;
  if (!name || others.length > 0) {
    throw new Error(
      `Expected one React Router manifest in ${assetsDir}, found ${names.length}`,
    );
  }
  const source = fs.readFileSync(path.join(assetsDir, name), "utf8").trim();
  if (!source.startsWith(MANIFEST_ASSIGNMENT)) {
    throw new Error(`Unrecognized React Router manifest ${name}`);
  }
  return JSON.parse(
    source.slice(MANIFEST_ASSIGNMENT.length).replace(/;$/, ""),
  ) as ReactRouterManifest;
}

export function createShellBuildFile(
  manifest: ReactRouterManifest,
  assetPaths: readonly string[],
): ShellBuildFile {
  const assets = assetPaths
    .filter((assetPath) => IMMUTABLE_ASSET_PATH.test(assetPath))
    .filter((assetPath) => !assetPath.startsWith("/assets/sw-build-"))
    .sort();
  const available = new Set(assets);
  const boot = shellBootAssets(manifest);
  const missing = boot.filter((assetPath) => !available.has(assetPath));
  if (missing.length) {
    throw new Error(
      `React Router manifest names files the build lacks: ${missing.slice(0, 5).join(", ")}`,
    );
  }
  return {
    version: manifest.version,
    boot: boot.sort(),
    assets,
    routes: shellRoutesFromManifest(manifest),
  };
}

/** Bundle a worker entry into one classic script, which every browser can run. */
export async function bundleShellWorker(entry: string): Promise<string> {
  const result = await build({
    configFile: false,
    envDir: false,
    logLevel: "warn",
    publicDir: false,
    root: HERE,
    build: {
      write: false,
      emptyOutDir: false,
      copyPublicDir: false,
      minify: true,
      reportCompressedSize: false,
      sourcemap: false,
      target: "es2020",
      lib: {
        entry,
        formats: ["iife"],
        name: "contentShellWorker",
        fileName: () => "sw.js",
      },
    },
  });
  const outputs = (
    Array.isArray(result) ? result : [result]
  ) as Rolldown.RolldownOutput[];
  const chunk = outputs
    .flatMap((output) => output.output)
    .find((item): item is Rolldown.OutputChunk => item.type === "chunk");
  if (!chunk) throw new Error(`Bundling ${entry} produced no script`);
  return chunk.code;
}

export async function writeShellWorker(
  clientDir: string,
  mode: string | undefined,
): Promise<void> {
  const off = mode === SHELL_WORKER_OFF;
  const code = await bundleShellWorker(off ? CLEANUP_ENTRY : WORKER_ENTRY);
  fs.writeFileSync(path.join(clientDir, SHELL_WORKER_URL.slice(1)), code);
  if (off) return;
  const manifest = readReactRouterManifest(clientDir);
  const assetPaths = listFiles(path.join(clientDir, "assets")).map(
    (relative) => `/assets/${relative}`,
  );
  const file = createShellBuildFile(manifest, assetPaths);
  fs.writeFileSync(
    path.join(clientDir, shellBuildFilePath(file.version).slice(1)),
    JSON.stringify(file),
  );
}

/**
 * Writes `/sw.js` and `/assets/sw-build-<version>.json` into the client build
 * once React Router has written its manifest, so a prebuilt client artifact
 * carries them too. Dev servers never serve the worker.
 */
export function contentShellWorkerPlugin(): Plugin {
  let root = process.cwd();
  let mode = process.env[SHELL_WORKER_ENV];
  return {
    name: "content-shell-worker",
    apply: "build",
    configResolved(config) {
      root = config.root;
      // The page reads the switch from `import.meta.env`, which includes
      // `.env` files; Vite's resolved env is the same source.
      const value: unknown = config.env[SHELL_WORKER_ENV];
      if (typeof value === "string") mode = value;
    },
    buildApp: {
      order: "post",
      async handler(builder) {
        // An app that builds no client has no client environment.
        const client = Object.values(builder.environments).find(
          (environment) => environment.name === "client",
        );
        if (!client?.isBuilt) return;
        await writeShellWorker(
          path.resolve(root, client.config.build.outDir),
          mode,
        );
      },
    },
  };
}
