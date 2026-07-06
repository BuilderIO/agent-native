import fs from "node:fs";
import path from "node:path";

import {
  assertLocalPlanFilesValid,
  readLocalPlanFiles,
  startLocalPlanBridge,
  verifyLocalPlanBridge,
} from "./plan-local.js";

const APP_ID = "visualize-repo";
const MANIFEST_FILE = "agent-native.json";
const DEFAULT_VISUAL_DOCS_ROOT = ".agent-native/visual-docs";
const DEFAULT_VISUAL_DOCS_DIR = ".agent-native/visual-docs/repo-overview";
const DEFAULT_TITLE = "Repo Visual Docs";
const DEFAULT_BRIEF =
  "A local, repo-backed visual documentation workspace for code review and agent handoff.";

const DEFAULT_HIDE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.agent-native/**",
];

const COMMANDS = new Set(["init", "serve", "open", "check", "verify", "help"]);

export type VisualizeRepoCommand =
  | "init"
  | "serve"
  | "open"
  | "check"
  | "verify"
  | "help";

export interface VisualizeRepoArgs {
  command: VisualizeRepoCommand;
  dir?: string;
  root?: string;
  targets: string[];
  title?: string;
  brief?: string;
  open: boolean;
  dryRun: boolean;
  json: boolean;
  force: boolean;
  appUrl?: string;
  host?: string;
  port?: number;
  help: boolean;
}

export interface VisualizeRepoTarget {
  id: string;
  name: string;
  kind: "api" | "model" | "component" | "flow" | "area" | "docs";
  include: string[];
  blocks: string[];
  policy: "seed" | "update-when-touched" | "required-on-pr";
}

export interface VisualizeRepoWorkspace {
  workspaceRoot: string;
  manifestPath: string;
  docsRoot: string;
  planDir: string;
  planPath: string;
  statePath: string;
  manifest: Record<string, unknown>;
  targets: VisualizeRepoTarget[];
  created: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeSlash(value: string) {
  return value.replace(/\\/g, "/");
}

function stringFlagValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePort(value: string) {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("--port must be an integer between 0 and 65535.");
  }
  return port;
}

export function parseVisualizeRepoArgs(argv: string[]): VisualizeRepoArgs {
  const [first, ...rest] = argv;
  const command = COMMANDS.has(first ?? "")
    ? (first as VisualizeRepoCommand)
    : "serve";
  const args =
    command === "serve" && first && !COMMANDS.has(first) ? argv : rest;
  const parsed: VisualizeRepoArgs = {
    command,
    targets: [],
    open: true,
    dryRun: false,
    json: false,
    force: false,
    help: command === "help",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "help" || arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--dir") {
      parsed.dir = stringFlagValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--dir=")) {
      parsed.dir = arg.slice("--dir=".length);
    } else if (arg === "--root") {
      parsed.root = stringFlagValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--root=")) {
      parsed.root = arg.slice("--root=".length);
    } else if (arg === "--target") {
      parsed.targets.push(stringFlagValue(args, index, arg));
      index += 1;
    } else if (arg.startsWith("--target=")) {
      parsed.targets.push(arg.slice("--target=".length));
    } else if (arg === "--title") {
      parsed.title = stringFlagValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--title=")) {
      parsed.title = arg.slice("--title=".length);
    } else if (arg === "--brief") {
      parsed.brief = stringFlagValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--brief=")) {
      parsed.brief = arg.slice("--brief=".length);
    } else if (arg === "--app-url") {
      parsed.appUrl = stringFlagValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--app-url=")) {
      parsed.appUrl = arg.slice("--app-url=".length);
    } else if (arg === "--host") {
      parsed.host = stringFlagValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--host=")) {
      parsed.host = arg.slice("--host=".length);
    } else if (arg === "--port") {
      parsed.port = parsePort(stringFlagValue(args, index, arg));
      index += 1;
    } else if (arg.startsWith("--port=")) {
      parsed.port = parsePort(arg.slice("--port=".length));
    } else if (arg === "--open") {
      parsed.open = true;
    } else if (arg === "--no-open") {
      parsed.open = false;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      parsed.targets.push(arg);
    }
  }

  return parsed;
}

function findWorkspaceRoot(cwd: string) {
  let current = path.resolve(cwd);
  for (;;) {
    if (
      fs.existsSync(path.join(current, MANIFEST_FILE)) ||
      fs.existsSync(path.join(current, "package.json")) ||
      fs.existsSync(path.join(current, ".git"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd);
    current = parent;
  }
}

async function readManifest(
  manifestPath: string,
): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
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

function slugify(value: string) {
  const slug = normalizeSlash(value)
    .toLowerCase()
    .replace(/[^a-z0-9/._-]+/g, "-")
    .replace(/[/.]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "target";
}

function titleFromPath(value: string) {
  const clean = value
    .replace(/\/\*\*.*$/, "")
    .replace(/\.(tsx?|jsx?|mdx?)$/, "");
  return (
    path
      .basename(clean)
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase()) || "Repo target"
  );
}

function inferKind(include: string): VisualizeRepoTarget["kind"] {
  const normalized = normalizeSlash(include);
  if (normalized.includes("actions/") || normalized.endsWith("actions")) {
    return "api";
  }
  if (normalized.includes("schema") || normalized.includes("db/")) {
    return "model";
  }
  if (
    normalized.includes("components/") ||
    normalized.endsWith("/components") ||
    normalized === "components"
  ) {
    return "component";
  }
  if (normalized.includes("pages/") || normalized.includes("routes/")) {
    return "flow";
  }
  if (normalized.includes("docs/") || normalized.endsWith(".mdx")) {
    return "docs";
  }
  return "area";
}

function blocksForKind(kind: VisualizeRepoTarget["kind"]) {
  switch (kind) {
    case "api":
      return ["api-endpoint", "diagram", "annotated-code"];
    case "model":
      return ["data-model", "diagram", "annotated-code"];
    case "component":
      return ["wireframe", "states", "annotated-code"];
    case "flow":
      return ["wireframe", "diagram", "annotated-code"];
    case "docs":
      return ["rich-text", "diagram"];
    case "area":
      return ["file-tree", "diagram", "annotated-code"];
  }
}

function targetFromInclude(include: string): VisualizeRepoTarget {
  const normalized = normalizeSlash(include).replace(/^\.\/+/, "");
  const kind = inferKind(normalized);
  return {
    id: slugify(normalized),
    name: titleFromPath(normalized),
    kind,
    include: [normalized],
    blocks: blocksForKind(kind),
    policy: kind === "api" || kind === "model" ? "required-on-pr" : "seed",
  };
}

function fileExists(root: string, rel: string) {
  return fs.existsSync(path.join(root, rel));
}

function recommendedTargets(workspaceRoot: string): VisualizeRepoTarget[] {
  const candidates: string[] = [];
  const add = (rel: string) => {
    if (fileExists(workspaceRoot, rel)) candidates.push(rel);
  };

  add("actions");
  add("app/components");
  add("app/pages");
  add("app/routes");
  add("server/db/schema.ts");
  add("server/db/schema.tsx");
  add("src");
  add("packages");
  add("templates");
  add("docs");
  add("content");

  return candidates.slice(0, 12).map(targetFromInclude);
}

function normalizeTargets(value: unknown): VisualizeRepoTarget[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => {
    const include = Array.isArray(entry.include)
      ? entry.include.filter((item): item is string => typeof item === "string")
      : typeof entry.path === "string"
        ? [entry.path]
        : [];
    const first = include[0] ?? "target";
    const kind =
      typeof entry.kind === "string"
        ? (entry.kind as VisualizeRepoTarget["kind"])
        : inferKind(first);
    return {
      id: typeof entry.id === "string" ? entry.id : slugify(first),
      name: typeof entry.name === "string" ? entry.name : titleFromPath(first),
      kind,
      include,
      blocks: Array.isArray(entry.blocks)
        ? entry.blocks.filter(
            (item): item is string => typeof item === "string",
          )
        : blocksForKind(kind),
      policy:
        entry.policy === "required-on-pr" ||
        entry.policy === "update-when-touched" ||
        entry.policy === "seed"
          ? entry.policy
          : "seed",
    };
  });
}

function mergeTargets(
  existing: VisualizeRepoTarget[],
  incoming: VisualizeRepoTarget[],
) {
  const byId = new Map<string, VisualizeRepoTarget>();
  for (const target of existing) byId.set(target.id, target);
  for (const target of incoming) byId.set(target.id, target);
  return Array.from(byId.values());
}

function upsertVisualizeManifest(
  manifest: Record<string, unknown>,
  input: {
    docsRoot: string;
    planDir: string;
    targets: VisualizeRepoTarget[];
  },
) {
  const next: Record<string, unknown> = {
    ...manifest,
    version: manifest.version ?? 1,
  };
  const apps = isRecord(next.apps) ? { ...next.apps } : {};
  const existing = isRecord(apps[APP_ID]) ? { ...apps[APP_ID] } : {};
  apps[APP_ID] = {
    ...existing,
    mode: "local-files",
    root: normalizeSlash(input.docsRoot),
    entry: normalizeSlash(input.planDir),
    targets: input.targets,
    hide: Array.isArray(existing.hide) ? existing.hide : DEFAULT_HIDE,
  };
  next.apps = apps;
  return next;
}

function escapeYamlString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function targetAnchorList(target: VisualizeRepoTarget) {
  return target.include.map((item) => `\`${item}\``).join(", ");
}

function fileTreeEntries(targets: VisualizeRepoTarget[]) {
  return JSON.stringify(
    targets.flatMap((target) =>
      target.include.map((include) => ({
        path: include,
        note: `${target.kind}; ${target.blocks.join(", ")}`,
      })),
    ),
  );
}

function buildPlanMdx(input: {
  title: string;
  brief: string;
  targets: VisualizeRepoTarget[];
  manifestRel: string;
}) {
  const targetSections = input.targets.flatMap((target, index) => [
    `## ${index + 1}. ${target.name}`,
    "",
    `Source anchors: ${targetAnchorList(target)}`,
    "",
    `Recommended blocks: ${target.blocks.map((block) => `\`${block}\``).join(", ")}`,
    "",
    `Freshness policy: \`${target.policy}\``,
    "",
    "Use this section as the durable visual contract for the code above. Keep it sparse until the target earns more detail, then add API specs, data models, wireframes, diagrams, or annotated code blocks beside the prose.",
    "",
  ]);

  return [
    "---",
    `title: "${escapeYamlString(input.title)}"`,
    `brief: "${escapeYamlString(input.brief)}"`,
    'kind: "plan"',
    "localOnly: true",
    "---",
    "",
    `# ${input.title}`,
    "",
    input.brief,
    "",
    "This workspace is repo-native: the MDX files are local source files, comments stay beside them in `comments.json`, and the Plan UI reads them through the localhost bridge instead of writing the plan to hosted storage.",
    "",
    `Manifest: \`${input.manifestRel}\``,
    "",
    "## Visualized Targets",
    "",
    `<FileTree id="visualized-targets" title="Visualized targets" entries={${fileTreeEntries(
      input.targets,
    )}} />`,
    "",
    ...targetSections,
    "## Review And Agent Handoff",
    "",
    "Comment on sections, diagrams, specs, or wireframes in the local Plan UI. Agent-targeted comments are the queue for a coding agent to update the repo and then patch these MDX files so the visual docs stay current with code.",
    "",
  ].join("\n");
}

function buildStateJson(input: {
  manifestRel: string;
  targets: VisualizeRepoTarget[];
}) {
  return `${JSON.stringify(
    {
      localOnly: true,
      kind: "plan",
      visualDocs: {
        manifest: input.manifestRel,
        targets: input.targets.map((target) => target.id),
      },
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`;
}

export async function prepareVisualizeRepoWorkspace(options: {
  cwd?: string;
  dir?: string;
  root?: string;
  targets?: string[];
  title?: string;
  brief?: string;
  dryRun?: boolean;
  force?: boolean;
}): Promise<VisualizeRepoWorkspace> {
  const workspaceRoot = findWorkspaceRoot(options.cwd ?? process.cwd());
  const manifestPath = path.join(workspaceRoot, MANIFEST_FILE);
  const manifest = await readManifest(manifestPath);
  const existingApp = isRecord(
    isRecord(manifest.apps) ? manifest.apps[APP_ID] : undefined,
  )
    ? (manifest.apps as Record<string, unknown>)[APP_ID]
    : undefined;
  const existingRoot =
    isRecord(existingApp) && typeof existingApp.root === "string"
      ? existingApp.root
      : undefined;
  const existingEntry =
    isRecord(existingApp) && typeof existingApp.entry === "string"
      ? existingApp.entry
      : undefined;
  const docsRoot = normalizeSlash(
    options.root ?? existingRoot ?? DEFAULT_VISUAL_DOCS_ROOT,
  );
  const planDir = normalizeSlash(
    options.dir ?? existingEntry ?? DEFAULT_VISUAL_DOCS_DIR,
  );
  const existingTargets = normalizeTargets(
    isRecord(existingApp) ? existingApp.targets : undefined,
  );
  const requestedTargets = (options.targets ?? []).map(targetFromInclude);
  const seedTargets =
    requestedTargets.length > 0
      ? mergeTargets(existingTargets, requestedTargets)
      : existingTargets.length > 0
        ? existingTargets
        : recommendedTargets(workspaceRoot);
  const targets =
    seedTargets.length > 0 ? seedTargets : [targetFromInclude("src")];
  const nextManifest = upsertVisualizeManifest(manifest, {
    docsRoot,
    planDir,
    targets,
  });
  const absolutePlanDir = path.join(workspaceRoot, planDir);
  const planPath = path.join(absolutePlanDir, "plan.mdx");
  const statePath = path.join(absolutePlanDir, ".plan-state.json");
  const manifestRel = normalizeSlash(
    path.relative(absolutePlanDir, manifestPath),
  );
  const shouldWritePlan = options.force || !fs.existsSync(planPath);

  if (!options.dryRun) {
    await fs.promises.writeFile(
      manifestPath,
      `${JSON.stringify(nextManifest, null, 2)}\n`,
    );
    await fs.promises.mkdir(absolutePlanDir, { recursive: true });
    if (shouldWritePlan) {
      await fs.promises.writeFile(
        planPath,
        buildPlanMdx({
          title: options.title ?? DEFAULT_TITLE,
          brief: options.brief ?? DEFAULT_BRIEF,
          targets,
          manifestRel,
        }),
      );
      await fs.promises.writeFile(
        statePath,
        buildStateJson({ manifestRel, targets }),
      );
    } else if (!fs.existsSync(statePath)) {
      await fs.promises.writeFile(
        statePath,
        buildStateJson({ manifestRel, targets }),
      );
    }
  }

  return {
    workspaceRoot,
    manifestPath,
    docsRoot: path.join(workspaceRoot, docsRoot),
    planDir: absolutePlanDir,
    planPath,
    statePath,
    manifest: nextManifest,
    targets,
    created: shouldWritePlan && !options.dryRun,
  };
}

function printHelp() {
  process.stdout
    .write(`agent-native visualize-repo — local visual docs workspace

Usage:
  agent-native visualize-repo [serve] [--target <path-or-glob>] [--open]
  agent-native visualize-repo init [--target <path-or-glob>] [--force]
  agent-native visualize-repo check [--dir <folder>]
  agent-native visualize-repo verify [--dir <folder>] [--app-url <url>]

Options:
  --target <path-or-glob>  Add a visualized source target. Repeatable.
  --root <folder>          Visual docs root in agent-native.json (default ${DEFAULT_VISUAL_DOCS_ROOT})
  --dir <folder>           Local Plan MDX folder (default ${DEFAULT_VISUAL_DOCS_DIR})
  --title <text>           Starter document title
  --brief <text>           Starter document brief
  --app-url <url>          Plan app URL for local bridge preview/verify
  --host <host>            Local bridge host
  --port <number>          Local bridge port; 0 means random
  --open / --no-open       Open the Plan UI after starting the bridge (default open)
  --force                  Regenerate plan.mdx if it already exists
  --dry-run                Print the setup plan without writing files
  --json                   Print machine-readable output

When ${MANIFEST_FILE} is missing, init/serve creates one with an apps.visualize-repo
local-files section and a small recommended target set from the repo structure.
The generated MDX stays local and is served through the Plan local bridge.
`);
}

function summarizeWorkspace(workspace: VisualizeRepoWorkspace) {
  return {
    ok: true,
    workspaceRoot: workspace.workspaceRoot,
    manifestPath: workspace.manifestPath,
    docsRoot: workspace.docsRoot,
    planDir: workspace.planDir,
    planPath: workspace.planPath,
    targets: workspace.targets,
    created: workspace.created,
  };
}

export async function runVisualizeRepo(argv: string[]) {
  const parsed = parseVisualizeRepoArgs(argv);
  if (parsed.help) {
    printHelp();
    return 0;
  }

  const readOnlyCommand =
    parsed.command === "check" || parsed.command === "verify";
  const workspace = await prepareVisualizeRepoWorkspace({
    dir: parsed.dir,
    root: parsed.root,
    targets: parsed.targets,
    title: parsed.title,
    brief: parsed.brief,
    dryRun: parsed.dryRun || readOnlyCommand,
    force: parsed.force,
  });

  if (parsed.dryRun || parsed.command === "init") {
    process.stdout.write(
      `${JSON.stringify(summarizeWorkspace(workspace), null, 2)}\n`,
    );
    return 0;
  }

  if (parsed.command === "check") {
    const files = readLocalPlanFiles(workspace.planDir);
    assertLocalPlanFilesValid(files);
    process.stdout.write(
      `${JSON.stringify({ ...summarizeWorkspace(workspace), validation: "lint-passed" }, null, 2)}\n`,
    );
    return 0;
  }

  if (parsed.command === "verify") {
    const result = await verifyLocalPlanBridge({
      dir: workspace.planDir,
      kind: "plan",
      title: parsed.title ?? DEFAULT_TITLE,
      brief: parsed.brief ?? DEFAULT_BRIEF,
      appUrl: parsed.appUrl,
      host: parsed.host,
      port: parsed.port,
      urlFile: false,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  }

  const bridge = await startLocalPlanBridge({
    dir: workspace.planDir,
    kind: "plan",
    title: parsed.title ?? DEFAULT_TITLE,
    brief: parsed.brief ?? DEFAULT_BRIEF,
    appUrl: parsed.appUrl,
    host: parsed.host,
    port: parsed.port,
    open: parsed.open,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ...summarizeWorkspace(workspace),
        url: bridge.result.url,
        bridgeUrl: bridge.result.bridgeUrl,
        urlFile: bridge.result.urlFile,
      },
      null,
      2,
    )}\n`,
  );
  process.stderr.write(
    [
      `Repo visual docs: ${workspace.planDir}`,
      `Local Plan bridge running at ${bridge.result.bridgeUrl}`,
      bridge.result.urlFile
        ? `Open URL written to ${bridge.result.urlFile}`
        : "",
      "Press Ctrl+C to stop.",
    ]
      .filter(Boolean)
      .join("\n") + "\n",
  );

  await new Promise<void>((resolve) => {
    let stopped = false;
    const cleanup = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      cleanup();
      bridge.server.close(() => resolve());
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  return 0;
}
