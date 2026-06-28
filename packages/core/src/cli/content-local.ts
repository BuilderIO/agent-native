import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTENT_APP_ID = "content";
const MANIFEST_FILE = "agent-native.json";
const DEFAULT_PORT = 8083;
const DEFAULT_PROFILE = "docs/no-bookkeeping";
const LOCAL_FILE_ID_PREFIX = "local-file:";

export interface ContentLocalArgs {
  target?: string;
  open: boolean;
  port: number;
  profile?: string;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

export interface ContentLocalLaunchPlan {
  workspaceRoot: string;
  manifestPath: string;
  rootPath: string;
  filePath?: string;
  url: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  manifest: Record<string, unknown>;
}

function normalizeSlash(value: string) {
  return value.replace(/\\/g, "/");
}

function titleFromPath(value: string) {
  return (
    path
      .basename(value)
      .replace(/\.(mdx?|markdown)$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase()) || "Content"
  );
}

function encodeLocalFileId(filePath: string) {
  return `${LOCAL_FILE_ID_PREFIX}${Buffer.from(filePath, "utf8").toString(
    "base64url",
  )}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringFlagValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseContentLocalArgs(argv: string[]): ContentLocalArgs {
  const args = argv[0] === "local-files" ? argv.slice(1) : argv;
  const parsed: ContentLocalArgs = {
    open: true,
    port: DEFAULT_PORT,
    dryRun: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "help" || arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--open") {
      parsed.open = true;
    } else if (arg === "--no-open") {
      parsed.open = false;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--port") {
      parsed.port = Number.parseInt(stringFlagValue(args, index, arg), 10);
      index += 1;
    } else if (arg.startsWith("--port=")) {
      parsed.port = Number.parseInt(arg.slice("--port=".length), 10);
    } else if (arg === "--profile") {
      parsed.profile = stringFlagValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--profile=")) {
      parsed.profile = arg.slice("--profile=".length);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!parsed.target) {
      parsed.target = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!Number.isInteger(parsed.port) || parsed.port <= 0) {
    throw new Error("--port must be a positive integer");
  }

  return parsed;
}

function resolveTarget(target: string, cwd: string) {
  const absoluteTarget = path.resolve(cwd, target);
  const stat = fsSync.statSync(absoluteTarget);
  const targetDirectory = stat.isDirectory()
    ? absoluteTarget
    : path.dirname(absoluteTarget);
  let workspaceRoot = path.resolve(cwd);
  let rootPath = normalizeSlash(path.relative(workspaceRoot, targetDirectory));

  if (!rootPath || rootPath === "." || rootPath.startsWith("../")) {
    workspaceRoot = path.dirname(targetDirectory);
    rootPath = path.basename(targetDirectory);
  }

  const filePath = stat.isFile()
    ? normalizeSlash(path.posix.join(rootPath, path.basename(absoluteTarget)))
    : undefined;

  return {
    absoluteTarget,
    isFile: stat.isFile(),
    workspaceRoot,
    rootPath: normalizeSlash(rootPath),
    filePath,
  };
}

async function readManifest(
  manifestPath: string,
): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      throw new Error(`${MANIFEST_FILE} must contain a JSON object`);
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1 };
    }
    throw error;
  }
}

function upsertContentManifest(
  manifest: Record<string, unknown>,
  rootPath: string,
  options: { filePath?: string; profile?: string },
) {
  const next: Record<string, unknown> = {
    ...manifest,
    version: manifest.version ?? 1,
  };
  const apps = isRecord(next.apps) ? { ...next.apps } : {};
  const existingContent = isRecord(apps[CONTENT_APP_ID])
    ? { ...apps[CONTENT_APP_ID] }
    : {};
  const existingRoots = Array.isArray(existingContent.roots)
    ? existingContent.roots.filter(isRecord).map((root) => ({ ...root }))
    : [];
  const include = options.filePath ? [options.filePath] : undefined;
  const rootIndex = existingRoots.findIndex((entry) => entry.path === rootPath);
  const existingRoot = rootIndex === -1 ? undefined : existingRoots[rootIndex];
  const profile =
    options.profile && !existingRoot?.profile ? options.profile : undefined;
  const root = {
    ...existingRoot,
    name:
      typeof existingRoot?.name === "string"
        ? existingRoot.name
        : titleFromPath(rootPath),
    path: rootPath,
    kind: typeof existingRoot?.kind === "string" ? existingRoot.kind : "docs",
    extensions: Array.isArray(existingRoot?.extensions)
      ? existingRoot.extensions
      : [".md", ".mdx"],
    ...(profile ? { profile } : {}),
    ...(include && rootIndex === -1 ? { include } : {}),
  };
  const roots =
    rootIndex === -1
      ? [...existingRoots, root]
      : existingRoots.map((entry, index) =>
          index === rootIndex ? { ...entry, ...root } : entry,
        );

  apps[CONTENT_APP_ID] = {
    ...existingContent,
    mode: "local-files",
    roots,
    hide: Array.isArray(existingContent.hide)
      ? existingContent.hide
      : ["**/_*.md", "**/_*.mdx"],
  };
  next.apps = apps;
  return next;
}

export function findContentTemplateDir(cwd = process.cwd()) {
  const cliDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates: string[] = [];
  let current = path.resolve(cwd);
  for (;;) {
    candidates.push(
      path.join(current, "templates", "content"),
      path.join(current, "apps", "content"),
    );
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  candidates.push(path.resolve(cliDir, "../../../..", "templates/content"));
  return (
    candidates.find((candidate) =>
      fsSync.existsSync(path.join(candidate, "package.json")),
    ) ?? null
  );
}

function launchUrl(port: number, filePath?: string) {
  const base = `http://127.0.0.1:${port}`;
  return filePath ? `${base}/page/${encodeLocalFileId(filePath)}` : base;
}

export async function prepareContentLocalLaunch(options: {
  target: string;
  cwd?: string;
  port?: number;
  profile?: string;
  dryRun?: boolean;
}): Promise<ContentLocalLaunchPlan> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const target = resolveTarget(options.target, cwd);
  const manifestPath = path.join(target.workspaceRoot, MANIFEST_FILE);
  const manifest = upsertContentManifest(
    await readManifest(manifestPath),
    target.rootPath,
    {
      filePath: target.filePath,
      profile: options.profile,
    },
  );
  const templateDir = findContentTemplateDir(cwd);
  if (!templateDir) {
    throw new Error(
      "Could not find the Content app template. Run this from the framework checkout or a workspace that includes templates/content.",
    );
  }

  if (!options.dryRun) {
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  return {
    workspaceRoot: target.workspaceRoot,
    manifestPath,
    rootPath: target.rootPath,
    filePath: target.filePath,
    url: launchUrl(options.port ?? DEFAULT_PORT, target.filePath),
    command: "corepack",
    args: [
      "pnpm",
      "--dir",
      templateDir,
      "dev",
      "--host",
      "127.0.0.1",
      "--port",
      String(options.port ?? DEFAULT_PORT),
      "--strictPort",
    ],
    env: {
      AGENT_NATIVE_MODE: "local-files",
      AGENT_NATIVE_MANIFEST_PATH: manifestPath,
    },
    manifest,
  };
}

function openBrowser(url: string) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  child.unref();
}

function printHelp() {
  console.log(`Usage:
  agent-native content local-files <file-or-folder> [options]
  agent-native content <file-or-folder> [options]

Options:
  --profile <name>   Local file profile, for example docs/no-bookkeeping
  --port <number>    Dev server port (default ${DEFAULT_PORT})
  --open             Open the target in the browser (default)
  --no-open          Start the server without opening the browser
  --dry-run          Print the launch plan without writing ${MANIFEST_FILE}
  --json             Print the launch plan as JSON`);
}

export async function runContentLocal(argv: string[]) {
  const parsed = parseContentLocalArgs(argv);
  if (parsed.help || !parsed.target) {
    printHelp();
    return parsed.target ? 0 : 1;
  }

  const plan = await prepareContentLocalLaunch({
    target: parsed.target,
    port: parsed.port,
    profile: parsed.profile ?? DEFAULT_PROFILE,
    dryRun: parsed.dryRun,
  });

  if (parsed.dryRun || parsed.json) {
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }

  console.log(`Content local files: ${plan.rootPath}`);
  console.log(`Manifest: ${plan.manifestPath}`);
  console.log(`Opening: ${plan.url}`);

  if (parsed.open) {
    setTimeout(() => openBrowser(plan.url), 1000).unref();
  }

  const child = spawn(plan.command, plan.args, {
    cwd: plan.workspaceRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...plan.env },
  });

  return await new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      process.on(signal, () => {
        child.kill(signal);
        resolve(1);
      });
    }
  });
}
