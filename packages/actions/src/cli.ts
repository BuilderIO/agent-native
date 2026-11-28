import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

import { isDefinedAction } from "./action.js";
import { createActionClient } from "./client.js";
import { generateActionArtifacts, scanActionsDirectory } from "./codegen.js";
import { isActionError, serializeActionErrorBody } from "./errors.js";
import { runStdioMcpServer } from "./mcp.js";
import { createActions, type ActionsRegistry } from "./registry.js";
import { schemaToJsonSchema } from "./schema.js";
import { AGENT_NATIVE_ACTIONS_SKILL_MD, installActionsSkill } from "./skill.js";
import type { ActionContextInput, ActionMap } from "./types.js";

type DetectedFramework = "next" | "vite" | "nuxt" | "sveltekit" | "node";

interface ParsedCliArgs {
  positionals: string[];
  flags: Record<string, string | boolean | string[]>;
}

export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const stripped = token.slice(2);
    const eqIndex = stripped.indexOf("=");
    if (eqIndex !== -1) {
      const key = stripped.slice(0, eqIndex);
      const val = stripped.slice(eqIndex + 1);
      appendFlag(flags, key, val);
      continue;
    }

    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      appendFlag(flags, stripped, next);
      i++;
    } else {
      flags[stripped] = true;
    }
  }

  return { positionals, flags };
}

function appendFlag(
  flags: Record<string, string | boolean | string[]>,
  key: string,
  value: string,
): void {
  const existing = flags[key];
  if (existing === undefined || typeof existing === "boolean") {
    flags[key] = value;
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    flags[key] = [existing, value];
  }
}

function loadEnvFiles(projectRoot: string): void {
  const candidates = [".env", ".env.local"];
  for (const filename of candidates) {
    const filePath = path.join(projectRoot, filename);
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

function readTsconfigAliases(projectRoot: string): Record<string, string> {
  const tsconfigPath = path.join(projectRoot, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) return {};
  try {
    const raw = fs
      .readFileSync(tsconfigPath, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const parsed = JSON.parse(raw) as {
      compilerOptions?: {
        baseUrl?: string;
        paths?: Record<string, string[]>;
      };
    };
    const paths = parsed.compilerOptions?.paths;
    if (!paths) return {};
    const baseDir = path.resolve(
      projectRoot,
      parsed.compilerOptions?.baseUrl ?? ".",
    );
    const aliases: Record<string, string> = {};
    for (const [pattern, targets] of Object.entries(paths)) {
      const target = targets[0];
      if (!target) continue;
      const cleanPattern = pattern.endsWith("/*")
        ? pattern.slice(0, -1)
        : pattern;
      const cleanTarget = target.endsWith("/*") ? target.slice(0, -1) : target;
      aliases[cleanPattern] = path.resolve(baseDir, cleanTarget);
    }
    return aliases;
  } catch {
    // coercion-ok: tsconfig.json may use JSONC syntax; jiti still resolves standard module paths without custom aliases
    return {};
  }
}

async function loadRegistry(
  projectRoot: string,
  options: { registryPath?: string; actionsDir?: string },
): Promise<ActionsRegistry<unknown, ActionMap<unknown>>> {
  const jiti = createJiti(path.join(projectRoot, "package.json"), {
    interopDefault: true,
    alias: readTsconfigAliases(projectRoot),
  });

  if (options.registryPath) {
    const absPath = path.resolve(projectRoot, options.registryPath);
    const mod = (await jiti.import(absPath)) as {
      actions?: ActionsRegistry<unknown, ActionMap<unknown>>;
      default?: ActionsRegistry<unknown, ActionMap<unknown>>;
    };
    const registry = mod.actions ?? mod.default;
    if (!registry || typeof registry.call !== "function") {
      throw new Error(
        `Registry file ${absPath} must export \`actions\` (or default export) created with createActions().`,
      );
    }
    return registry;
  }

  const scan = scanActionsDirectory(projectRoot, {
    ...(options.actionsDir ? { actionsDir: options.actionsDir } : {}),
  });

  const loadedActions: ActionMap<unknown> = {};
  for (const item of scan.actions) {
    const mod = (await jiti.import(item.filePath)) as { default?: unknown };
    const candidate = mod.default ?? mod;
    if (!isDefinedAction(candidate)) {
      throw new Error(
        `Action file ${item.filePath} must default-export a defineAction() definition.`,
      );
    }
    loadedActions[item.name] = candidate as ActionMap<unknown>[string];
  }

  let createContext:
    | ((input: ActionContextInput) => unknown | Promise<unknown>)
    | undefined;
  if (scan.contextFile) {
    const ctxMod = (await jiti.import(scan.contextFile)) as {
      createContext?: (input: ActionContextInput) => unknown | Promise<unknown>;
    };
    if (typeof ctxMod.createContext === "function") {
      createContext = ctxMod.createContext;
    }
  }

  if (createContext) {
    return createActions({
      actions: loadedActions,
      createContext,
    });
  }
  return createActions<unknown, ActionMap<unknown>>({
    actions: loadedActions,
    createContext: (input): unknown => input,
  });
}

function detectFramework(projectRoot: string): DetectedFramework {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return "node";
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if ("next" in deps) return "next";
    if ("nuxt" in deps) return "nuxt";
    if ("@sveltejs/kit" in deps) return "sveltekit";
    if ("vite" in deps) return "vite";
  } catch {
    return "node";
  }
  return "node";
}

function runInit(
  projectRoot: string,
  options: { dryRun: boolean; framework?: DetectedFramework },
): void {
  const framework = options.framework ?? detectFramework(projectRoot);
  const actionsDir = path.join(projectRoot, "actions");
  const sampleActionPath = path.join(actionsDir, "hello.ts");
  const plannedWrites: Array<{
    filePath: string;
    content: string;
    note: string;
  }> = [];

  if (!fs.existsSync(sampleActionPath)) {
    plannedWrites.push({
      filePath: sampleActionPath,
      note: "Sample action (callable via UI, HTTP, CLI, and MCP)",
      content: [
        'import { defineAction } from "@agent-native/actions";',
        'import { z } from "zod";',
        "",
        "export default defineAction({",
        '  description: "Say hello from @agent-native/actions",',
        "  schema: z.object({",
        '    name: z.string().default("world").describe("Name to greet"),',
        "  }),",
        '  http: { method: "GET" },',
        "  readOnly: true,",
        "  run: async ({ name }) => ({ message: `Hello, ${name}!` }),",
        "});",
        "",
      ].join("\n"),
    });
  }

  if (framework === "next") {
    const hasSrcApp = fs.existsSync(path.join(projectRoot, "src", "app"));
    const routePath = path.join(
      projectRoot,
      hasSrcApp ? "src/app" : "app",
      "api/agent-native/[...path]/route.ts",
    );
    const manifestRel = hasSrcApp
      ? "../../../../../.generated/actions"
      : "../../../../.generated/actions";
    if (!fs.existsSync(routePath)) {
      plannedWrites.push({
        filePath: routePath,
        note: "Single Next.js App Router catch-all serving /actions/* and /mcp",
        content: [
          'import { createNextHandler } from "@agent-native/actions/next";',
          `import { actions } from "${manifestRel}";`,
          "",
          "export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } =",
          "  createNextHandler(actions);",
          "",
        ].join("\n"),
      });
    }
  } else if (framework === "sveltekit") {
    const routePath = path.join(
      projectRoot,
      "src/routes/api/agent-native/[...path]/+server.ts",
    );
    if (!fs.existsSync(routePath)) {
      plannedWrites.push({
        filePath: routePath,
        note: "Single SvelteKit catch-all serving /actions/* and /mcp",
        content: [
          'import { createSvelteKitHandler } from "@agent-native/actions/svelte/server";',
          'import { actions } from "../../../../../.generated/actions";',
          "",
          "export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } =",
          "  createSvelteKitHandler(actions);",
          "",
        ].join("\n"),
      });
    }
  } else if (framework === "nuxt") {
    const routePath = path.join(
      projectRoot,
      "server/api/agent-native/[...path].ts",
    );
    if (!fs.existsSync(routePath)) {
      plannedWrites.push({
        filePath: routePath,
        note: "Single Nuxt/Nitro catch-all serving /actions/* and /mcp",
        content: [
          'import { createNitroHandler } from "@agent-native/actions/vue/server";',
          'import { actions } from "../../../.generated/actions";',
          "",
          "export default createNitroHandler(actions);",
          "",
        ].join("\n"),
      });
    }
  }

  console.error(
    `[@agent-native/actions] Detected framework: ${framework}${options.dryRun ? " (dry-run)" : ""}`,
  );

  for (const write of plannedWrites) {
    const rel = path.relative(projectRoot, write.filePath);
    if (options.dryRun) {
      console.error(`  [would create] ${rel} — ${write.note}`);
    } else {
      fs.mkdirSync(path.dirname(write.filePath), { recursive: true });
      fs.writeFileSync(write.filePath, write.content, "utf8");
      console.error(`  [created] ${rel} — ${write.note}`);
    }
  }

  let missingDeps: string[] = [];
  const pkgPath = path.join(projectRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (!("@agent-native/actions" in allDeps)) {
      missingDeps.push("@agent-native/actions");
    }
    if (!("zod" in allDeps)) {
      missingDeps.push("zod");
    }
    pkg.scripts ??= {};
    if (!pkg.scripts["action"]) {
      if (options.dryRun) {
        console.error(
          '  [would update] package.json — add `"action": "actions"` script',
        );
      } else {
        pkg.scripts["action"] = "actions";
        fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
        console.error(
          '  [updated] package.json — added `"action": "actions"` script',
        );
      }
    }
  }

  if (!options.dryRun) {
    const generated = generateActionArtifacts({ projectRoot });
    console.error(
      `  [generated] ${path.relative(projectRoot, generated.manifestPath)} & ${path.relative(projectRoot, generated.typesPath)} (${generated.actionCount} action(s))`,
    );
  }

  const skillResult = installActionsSkill({
    projectRoot,
    dryRun: options.dryRun === true,
  });
  if (skillResult.status === "created") {
    console.error(
      `  [created] ${skillResult.relativePath} — agent skill teaching coding agents to build new features as actions`,
    );
  } else if (skillResult.status === "would-create") {
    console.error(
      `  [would create] ${skillResult.relativePath} — agent skill teaching coding agents to build new features as actions`,
    );
  }

  const nextSteps: string[] = [];
  if (missingDeps.length > 0) {
    nextSteps.push(`install dependencies: pnpm add ${missingDeps.join(" ")}`);
  }
  if (framework === "next") {
    nextSteps.push(
      "wrap next.config.ts with `withAgentNativeActions()` from `@agent-native/actions/next/config`.",
    );
  } else if (framework === "vite") {
    nextSteps.push(
      "add `agentNativeActionsPlugin()` from `@agent-native/actions/vite` to vite.config.ts.",
    );
  } else if (framework === "sveltekit") {
    nextSteps.push(
      "add `agentNativeActionsPlugin({ devMiddleware: false })` from `@agent-native/actions/vite` to vite.config.ts.",
    );
  } else if (framework === "nuxt") {
    nextSteps.push(
      'add `"@agent-native/actions/nuxt"` to `modules` in nuxt.config.ts.',
    );
  }
  for (const step of nextSteps) {
    console.error(`\nNext step: ${step}`);
  }
}

function coerceCliInput(
  flags: Record<string, string | boolean | string[]>,
  jsonArg: string | undefined,
): Record<string, unknown> {
  if (jsonArg !== undefined) {
    const parsed: unknown = JSON.parse(jsonArg);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        'JSON argument must be an object, e.g. \'{"title":"Ship"}\'.',
      );
    }
    return parsed as Record<string, unknown>;
  }

  const input: Record<string, unknown> = {};
  const reserved = new Set([
    "registry",
    "dir",
    "cwd",
    "help",
    "list",
    "approved",
    "remote",
    "token",
    "dry-run",
    "framework",
  ]);

  for (const [key, value] of Object.entries(flags)) {
    if (reserved.has(key)) continue;
    if (value === "true") {
      input[key] = true;
    } else if (value === "false") {
      input[key] = false;
    } else if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) {
      input[key] = Number(value);
    } else {
      input[key] = value;
    }
  }
  return input;
}

async function promptInteractiveApproval(
  actionName: string,
  input: unknown,
): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return new Promise((resolve) => {
    rl.question(
      `Action "${actionName}" requires approval.\nInput: ${JSON.stringify(input)}\nApprove and run? [y/N] `,
      (answer) => {
        rl.close();
        const normalized = answer.trim().toLowerCase();
        resolve(normalized === "y" || normalized === "yes");
      },
    );
  });
}

export async function runActionCli(argv: readonly string[]): Promise<number> {
  const { positionals, flags } = parseCliArgs(argv);
  const projectRoot =
    typeof flags["cwd"] === "string"
      ? path.resolve(flags["cwd"])
      : process.cwd();
  const registryPath =
    typeof flags["registry"] === "string" ? flags["registry"] : undefined;
  const actionsDir =
    typeof flags["dir"] === "string" ? flags["dir"] : undefined;

  const command = positionals[0];

  if (command === "init") {
    const fw =
      typeof flags["framework"] === "string"
        ? (flags["framework"] as DetectedFramework)
        : undefined;
    runInit(projectRoot, {
      dryRun: flags["dry-run"] === true,
      ...(fw ? { framework: fw } : {}),
    });
    return 0;
  }

  if (command === "skill") {
    if (flags["print"] === true) {
      process.stdout.write(AGENT_NATIVE_ACTIONS_SKILL_MD);
      return 0;
    }
    const result = installActionsSkill({
      projectRoot,
      dryRun: flags["dry-run"] === true,
      overwrite: flags["force"] === true,
    });
    console.error(`  [${result.status}] ${result.relativePath}`);
    return 0;
  }

  if (command === "generate") {
    const res = generateActionArtifacts({
      projectRoot,
      ...(actionsDir ? { actionsDir } : {}),
    });
    console.log(
      JSON.stringify(
        {
          manifestPath: path.relative(projectRoot, res.manifestPath),
          typesPath: path.relative(projectRoot, res.typesPath),
          actionCount: res.actionCount,
          hasContextFile: res.hasContextFile,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  loadEnvFiles(projectRoot);

  if (command === "mcp") {
    const registry = await loadRegistry(projectRoot, {
      ...(registryPath ? { registryPath } : {}),
      ...(actionsDir ? { actionsDir } : {}),
    });
    await runStdioMcpServer(registry);
    return 0;
  }

  if (typeof flags["remote"] === "string" && command) {
    const input = coerceCliInput(flags, positionals[1]);
    const token =
      typeof flags["token"] === "string" ? flags["token"] : undefined;
    const client = createActionClient({
      baseUrl: flags["remote"],
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    });
    const result = await client.call(command, input);
    console.log(JSON.stringify(result ?? null, null, 2));
    return 0;
  }

  const registry = await loadRegistry(projectRoot, {
    ...(registryPath ? { registryPath } : {}),
    ...(actionsDir ? { actionsDir } : {}),
  });

  if (command === "inspect") {
    console.log(
      JSON.stringify(
        {
          projectRoot,
          actions: registry.describe(),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (!command || flags["list"] === true || command === "list") {
    const list = registry.describe();
    if (list.length === 0) {
      console.log(
        "No actions found. Run `npx @agent-native/actions init` to create one.",
      );
      return 0;
    }
    for (const item of list) {
      const verb = item.httpMethod ?? "NO-HTTP";
      console.log(`${item.name.padEnd(28)} [${verb}] ${item.description}`);
    }
    return 0;
  }

  const action = registry.actions[command];
  if (!action) {
    console.error(
      `Action "${command}" not found. Available: ${registry.list().join(", ") || "(none)"}`,
    );
    return 1;
  }

  if (flags["help"] === true) {
    console.log(`${command} — ${action.description}`);
    const jsonSchema = schemaToJsonSchema(
      action.schema,
      "input",
      action.toolSchema,
    );
    if (jsonSchema) {
      console.log("\nInput JSON Schema:");
      console.log(JSON.stringify(jsonSchema, null, 2));
    }
    return 0;
  }

  const input = coerceCliInput(flags, positionals[1]);
  const approvalFlag = flags["approved"] === true;

  try {
    const result = await registry.invokeFromCliOrStdio(command, input, {
      caller: "cli",
      approved: approvalFlag,
    });
    console.log(JSON.stringify(result ?? null, null, 2));
    return 0;
  } catch (error) {
    if (isActionError(error) && error.errorCode === "approval_required") {
      const confirmed = await promptInteractiveApproval(command, input);
      if (confirmed) {
        const result = await registry.invokeFromCliOrStdio(command, input, {
          caller: "cli",
          approved: true,
        });
        console.log(JSON.stringify(result ?? null, null, 2));
        return 0;
      }
      console.error(
        `Approval required for "${command}". Confirm with a human and re-run with --approved.`,
      );
      return 2;
    }

    const { body } = serializeActionErrorBody(error);
    console.error(JSON.stringify(body, null, 2));
    return 1;
  }
}

const isDirectExecution =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  runActionCli(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) process.exit(code);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
