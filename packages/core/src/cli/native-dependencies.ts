import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BETTER_SQLITE3 = "better-sqlite3";
const REBUILD_LOCK = ".agent-native-better-sqlite3-rebuild.lock";
const RUNTIME_MARKER = ".agent-native-node-runtime.json";
const LOCK_INITIALIZATION_TIMEOUT_MS = 5_000;
const REBUILD_WAIT_MS = 250;
const REBUILD_TIMEOUT_MS = 10 * 60 * 1000;

type NativeDependencyCheck =
  | {
      status: "absent";
      packageName: string;
    }
  | {
      status: "healthy";
      packageName: string;
      packageDir: string;
    }
  | {
      status: "broken";
      packageName: string;
      packageDir: string;
      error: unknown;
    };

export interface NativeDependencyOptions {
  fromDirectory?: string;
  label?: string;
  repair?: boolean;
}

interface NodeRuntimeMarker {
  nodeVersion: string;
  nodeAbi: string;
  platform: NodeJS.Platform;
  arch: string;
}

function corePackageDirectory(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function packageRootFromManifest(
  packageName: string,
  manifestPath: string,
): string | null {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    name?: unknown;
  };
  return manifest.name === packageName ? path.dirname(manifestPath) : null;
}

function resolvePackageDirectory(
  packageName: string,
  fromDirectory: string,
): string | null {
  const requireFromDirectory = createRequire(
    path.join(path.resolve(fromDirectory), "package.json"),
  );

  try {
    const manifestPath = requireFromDirectory.resolve(
      `${packageName}/package.json`,
    );
    return packageRootFromManifest(packageName, manifestPath);
  } catch {
    try {
      const entryPath = requireFromDirectory.resolve(packageName);
      let current = path.dirname(entryPath);
      while (true) {
        const manifestPath = path.join(current, "package.json");
        if (fs.existsSync(manifestPath)) {
          const packageDir = packageRootFromManifest(packageName, manifestPath);
          if (packageDir) return packageDir;
        }
        const parent = path.dirname(current);
        if (parent === current) return null;
        current = parent;
      }
    } catch {
      return null;
    }
  }
}

function probeBetterSqlite3(packageDir: string): unknown | null {
  try {
    const requireFromPackage = createRequire(
      path.join(packageDir, "package.json"),
    );
    const Database = requireFromPackage(BETTER_SQLITE3) as {
      new (filename: string): {
        close: () => void;
        prepare: (sql: string) => { get: () => unknown };
      };
    };
    const database = new Database(":memory:");
    database.prepare("select 1 as ok").get();
    database.close();
    return null;
  } catch (error) {
    return error;
  }
}

export function checkNativeDependencies(
  fromDirectory = corePackageDirectory(),
): NativeDependencyCheck {
  const packageDir = resolvePackageDirectory(BETTER_SQLITE3, fromDirectory);
  if (!packageDir) {
    return { status: "absent", packageName: BETTER_SQLITE3 };
  }

  const error = probeBetterSqlite3(packageDir);
  return error === null
    ? { status: "healthy", packageName: BETTER_SQLITE3, packageDir }
    : { status: "broken", packageName: BETTER_SQLITE3, packageDir, error };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function npmExecutable(): string {
  const sibling = path.join(
    path.dirname(process.execPath),
    process.platform === "win32" ? "npm.cmd" : "npm",
  );
  return fs.existsSync(sibling) ? sibling : "npm";
}

function sleepSync(milliseconds: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code !== "ESRCH";
  }
}

function acquireRebuildLock(packageDir: string, label: string): () => void {
  const lockPath = path.join(packageDir, REBUILD_LOCK);
  const startedWaiting = Date.now();

  while (true) {
    try {
      const lockFd = fs.openSync(lockPath, "wx");
      fs.writeSync(
        lockFd,
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
        }),
      );
      return () => {
        try {
          fs.closeSync(lockFd);
        } finally {
          try {
            fs.unlinkSync(lockPath);
          } catch (error) {
            if (
              !(
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
              )
            ) {
              throw error;
            }
          }
        }
      };
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      ) {
        throw error;
      }

      let ownerPid: number | null = null;
      let lockAge = 0;
      try {
        const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
          pid?: unknown;
        };
        ownerPid = typeof lock.pid === "number" ? lock.pid : null;
      } catch {
        // The owner may be between creating and writing the lock metadata.
      }
      try {
        lockAge = Date.now() - fs.statSync(lockPath).mtimeMs;
      } catch {
        continue;
      }

      if (
        (ownerPid !== null && !processIsRunning(ownerPid)) ||
        (ownerPid === null && lockAge > LOCK_INITIALIZATION_TIMEOUT_MS)
      ) {
        try {
          fs.unlinkSync(lockPath);
          continue;
        } catch (unlinkError) {
          if (
            !(
              unlinkError instanceof Error &&
              "code" in unlinkError &&
              unlinkError.code === "ENOENT"
            )
          ) {
            throw unlinkError;
          }
          continue;
        }
      }

      if (Date.now() - startedWaiting > REBUILD_TIMEOUT_MS) {
        throw new Error(
          `[${label}] Timed out waiting for another process to finish rebuilding ${BETTER_SQLITE3}.`,
        );
      }
      sleepSync(REBUILD_WAIT_MS);
    }
  }
}

function rebuildNativeDependency(packageDir: string): void {
  execFileSync(
    npmExecutable(),
    ["run", "build-release", "--prefix", packageDir],
    {
      cwd: packageDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
}

function brokenDependencyMessage(
  check: Extract<NativeDependencyCheck, { status: "broken" }>,
  label: string,
): string {
  return [
    `[${label}] ${check.packageName} cannot load its native binding.`,
    `Package: ${check.packageDir}`,
    `Node: ${process.version} (ABI ${process.versions.modules}, ${process.platform}-${process.arch})`,
    `Original error: ${errorMessage(check.error)}`,
    "The installed native binary was built for a different Node runtime or is otherwise stale.",
  ].join("\n");
}

export function ensureNativeDependencies(
  options: NativeDependencyOptions = {},
): NativeDependencyCheck {
  const label = options.label ?? "native preflight";
  const check = checkNativeDependencies(options.fromDirectory);
  if (check.status !== "broken") return check;

  if (!options.repair) {
    throw new Error(brokenDependencyMessage(check, label));
  }

  console.warn(
    `${brokenDependencyMessage(check, label)}\n[${label}] Rebuilding it with the current Node runtime...`,
  );
  const releaseLock = acquireRebuildLock(check.packageDir, label);
  try {
    const current = checkNativeDependencies(options.fromDirectory);
    if (current.status === "healthy") return current;
    if (current.status !== "broken") {
      throw new Error(
        `[${label}] ${BETTER_SQLITE3} disappeared before its native rebuild.`,
      );
    }

    rebuildNativeDependency(current.packageDir);

    const repaired = checkNativeDependencies(options.fromDirectory);
    if (repaired.status === "healthy") {
      console.log(
        `[${label}] ${repaired.packageName} is ready for Node ABI ${process.versions.modules}.`,
      );
      return repaired;
    }

    if (repaired.status === "broken") {
      throw new Error(brokenDependencyMessage(repaired, label));
    }

    throw new Error(
      `[${label}] ${BETTER_SQLITE3} disappeared after its native rebuild.`,
    );
  } finally {
    releaseLock();
  }
}

export function assertNativeDependencies(
  options: Omit<NativeDependencyOptions, "repair"> = {},
): NativeDependencyCheck {
  const check = checkNativeDependencies(options.fromDirectory);
  if (check.status === "broken") {
    throw new Error(brokenDependencyMessage(check, options.label ?? "runtime"));
  }
  return check;
}

export function writeNodeRuntimeMarker(serverDirectory: string): string | null {
  if (!fs.existsSync(serverDirectory)) return null;

  const markerPath = path.join(serverDirectory, RUNTIME_MARKER);
  const marker: NodeRuntimeMarker = {
    nodeVersion: process.version,
    nodeAbi: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
  };
  fs.writeFileSync(markerPath, `${JSON.stringify(marker)}\n`);
  return markerPath;
}

export function assertNodeRuntimeMarker(serverDirectory: string): void {
  const markerPath = path.join(serverDirectory, RUNTIME_MARKER);
  if (!fs.existsSync(markerPath)) return;

  let marker: NodeRuntimeMarker;
  try {
    marker = JSON.parse(
      fs.readFileSync(markerPath, "utf8"),
    ) as NodeRuntimeMarker;
  } catch (error) {
    throw new Error(
      `[runtime] Could not read ${RUNTIME_MARKER}: ${errorMessage(error)}`,
    );
  }

  const mismatches = [
    marker.nodeAbi !== process.versions.modules
      ? `Node ABI ${marker.nodeAbi} (build) vs ${process.versions.modules} (runtime)`
      : null,
    marker.platform !== process.platform
      ? `platform ${marker.platform} (build) vs ${process.platform} (runtime)`
      : null,
    marker.arch !== process.arch
      ? `architecture ${marker.arch} (build) vs ${process.arch} (runtime)`
      : null,
  ].filter((value): value is string => value !== null);

  if (mismatches.length > 0) {
    throw new Error(
      [
        `[runtime] Production output was built for a different Node runtime: ${mismatches.join(", ")}.`,
        `Build Node: ${marker.nodeVersion}; runtime Node: ${process.version}.`,
        "Run the build and start commands with the same Node installation.",
      ].join("\n"),
    );
  }
}

function isDirectExecution(): boolean {
  const entryPoint = process.argv[1];
  return (
    entryPoint !== undefined &&
    path.resolve(entryPoint) === path.resolve(fileURLToPath(import.meta.url))
  );
}

if (isDirectExecution() && process.argv.includes("--repair")) {
  ensureNativeDependencies({ repair: true, label: "native repair" });
}
