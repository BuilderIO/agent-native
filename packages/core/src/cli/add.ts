/**
 * `agent-native add <kind> [name|url]` — the **blueprint installer**.
 *
 * Borrowed from Flue's `flue add`: instead of being a dumb scaffolder that
 * writes files for you, this command emits a curated Markdown *integration
 * blueprint* to stdout. You pipe that blueprint into your own coding agent,
 * which applies the changes against the live repo:
 *
 *   agent-native add provider stripe | claude
 *   agent-native add channel discord  | codex
 *
 * This fits the agent-applies-changes, filesystem-first house style: the
 * framework supplies the recipe (the canonical files to touch, the rules to
 * honor, the verification step), and the coding agent does the editing with
 * full repo context.
 *
 * A bare name resolves a curated blueprint from `blueprints/<kind>/<name>.md`.
 * A URL instead of a name emits a GENERIC "research-and-integrate" blueprint
 * for that kind with the URL embedded as the research starting point (mirrors
 * Flue: a URL is a research seed, not a known recipe).
 *
 * Blueprint `.md` files ship in the published package via the `blueprints`
 * entry in `package.json` `files`, so they live at
 * `node_modules/@agent-native/core/blueprints/**` at runtime. Resolution works
 * both from source (tsx: `src/cli` → `../../blueprints`) and from the compiled
 * package (`dist/cli` → `../../blueprints`), with an upward-walk fallback.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** A coarse classification of what `add` resolved for a given invocation. */
export type AddBlueprintSource =
  | { kind: "curated"; blueprintKind: string; name: string; path: string }
  | { kind: "generic-url"; blueprintKind: string; url: string };

export interface ResolvedBlueprint {
  /** The Markdown to print to stdout (piped into a coding agent). */
  markdown: string;
  source: AddBlueprintSource;
}

/**
 * Locate the directory that holds the blueprint `.md` recipes.
 *
 * Both `src/cli` (tsx/source) and `dist/cli` (published) sit two levels under
 * the package root, where `blueprints/` lives, so `../../blueprints` from this
 * module's directory is the primary path. We additionally walk upward looking
 * for a `blueprints` directory as a resilience fallback (e.g. unusual bundler
 * layouts). An explicit override is honored for tests.
 */
export function resolveBlueprintsRoot(overrideRoot?: string): string {
  if (overrideRoot) return overrideRoot;

  const here = path.dirname(fileURLToPath(import.meta.url));
  const primary = path.resolve(here, "../../blueprints");
  if (isDir(primary)) return primary;

  // Fallback: walk up from this module looking for a sibling `blueprints` dir.
  let dir = here;
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, "blueprints");
    if (isDir(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Return the primary path even if missing so error messages are concrete.
  return primary;
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** True for an argument that should be treated as a research URL, not a name. */
export function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/** List the blueprint kinds (subdirectories) available, sorted. */
export function listKinds(root: string): string[] {
  if (!isDir(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** List the blueprint names available under a kind, sorted (no `.md`). */
export function listBlueprintNames(root: string, kind: string): string[] {
  const dir = path.join(root, kind);
  if (!isDir(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name.slice(0, -".md".length))
    .sort();
}

/** A flat catalog of every kind and its blueprint names. */
export function listCatalog(root: string): Array<{
  kind: string;
  names: string[];
}> {
  return listKinds(root).map((kind) => ({
    kind,
    names: listBlueprintNames(root, kind),
  }));
}

/** Render the `--list` / no-args catalog text. */
export function formatCatalog(root: string): string {
  const catalog = listCatalog(root);
  const lines: string[] = [];
  lines.push("Available blueprints:");
  lines.push("");
  if (catalog.length === 0) {
    lines.push("  (none found)");
  } else {
    for (const { kind, names } of catalog) {
      const shown =
        names.length > 0 ? names.join(", ") : "(generic — pass a URL)";
      lines.push(`  ${kind.padEnd(10)} ${shown}`);
    }
  }
  lines.push("");
  lines.push("Usage:");
  lines.push(
    "  agent-native add <kind> <name>            Print a curated blueprint",
  );
  lines.push(
    "  agent-native add <kind> <https://docs…>   Research-and-integrate from a URL",
  );
  lines.push("  agent-native add --list                   Show this list");
  lines.push("");
  lines.push("Pipe a blueprint into your coding agent to apply it:");
  lines.push("  agent-native add provider stripe | claude");
  lines.push("  agent-native add channel discord | codex");
  return lines.join("\n");
}

/**
 * Build the generic "research-and-integrate" blueprint emitted when the user
 * passes a URL instead of a known blueprint name. Mirrors Flue: a URL is a
 * research seed. We keep this self-contained — the coding agent reading it has
 * no other context.
 */
export function buildGenericUrlBlueprint(kind: string, url: string): string {
  const kindGuidance = GENERIC_KIND_GUIDANCE[kind] ?? GENERIC_DEFAULT_GUIDANCE;
  return `# Blueprint: integrate a new ${kind} from a URL

You are a coding agent working inside an **agent-native** app (a repo built on
\`@agent-native/core\`). Apply this blueprint as real source changes on the
current branch. Do not just describe the work — research, implement, then verify.

## Research seed

Start from this URL and follow it for the API/protocol/contract you need:

  ${url}

Fetch it (and the pages it links to) to learn the real endpoints, auth model,
payload shapes, and any signature/verification requirements. Do not guess from
training data — the docs are the source of truth, and package/API versions
drift. Confirm the current version before writing code.

## What you're adding

A new **${kind}** integration. ${kindGuidance}

## How agent-native wants it built

- **Actions are the single source of truth.** Add app operations in \`actions/\`
  with \`defineAction\` (Zod schema). The agent calls them as tools; the frontend
  calls the same action through \`useActionQuery\` / \`useActionMutation\`. Do NOT
  add \`/api/*\` or Nitro pass-through routes that just wrap an action.
- **Prefer the provider-api substrate for external HTTP.** For ad-hoc reads
  against a third-party API, register the provider with
  \`@agent-native/core/provider-api\` and expose the
  \`provider-api-catalog\` / \`provider-api-docs\` / \`provider-api-request\` trio
  instead of one rigid action per endpoint. First-class actions are shortcuts,
  not capability limits.
- **Read the relevant skill before editing** — \`actions\`,
  \`integration-webhooks\`, \`secrets\`, \`onboarding\`, \`sharing\`, \`security\` —
  for the area you're touching.
- **Never hardcode secrets.** Read API keys / tokens / signing secrets from the
  secret store (\`readAppSecret\`, the provider credential adapter, OAuth token
  helpers) at call time. Use obviously-fake placeholders in any example
  (e.g. \`sk_test_PLACEHOLDER_xxx\`), never a real credential.
- **Scope ownable data.** Tables with \`ownableColumns()\` require
  \`accessFilter\` / \`resolveAccess\` / \`assertAccess\`; fail closed.
- **Changeset.** If you edit a publishable package's source
  (\`packages/core\`, \`packages/dispatch\`, \`packages/scheduling\`,
  \`packages/pinpoint\`), add a \`.changeset/*.md\`.

## Verify

1. \`agent-native typecheck\` (or \`tsc --noEmit\`) passes.
2. Add a focused \`*.spec.ts\` for the new surface and run it.
3. Exercise the real workflow end to end: invoke the new action from the agent
   chat (and the UI if applicable), and confirm the external call round-trips
   with credentials injected and secrets redacted.
`;
}

const GENERIC_DEFAULT_GUIDANCE =
  "Identify whether it is best modeled as an action, a provider-api integration, " +
  "an inbound channel adapter, or a sandbox backend, and follow that area's skill.";

const GENERIC_KIND_GUIDANCE: Record<string, string> = {
  provider:
    "Wire it into the provider-api substrate (`@agent-native/core/provider-api`): " +
    "register the base URL, auth style, credential key, and docs URLs, then expose " +
    "the `provider-api-catalog` / `provider-api-docs` / `provider-api-request` trio " +
    "so any endpoint is reachable without one action per endpoint.",
  channel:
    "Implement a `PlatformAdapter` (see " +
    "`packages/core/src/integrations/types.ts` and the adapters under " +
    "`packages/core/src/integrations/adapters/`) and register it in " +
    "`getDefaultAdapters()` in `packages/core/src/integrations/plugin.ts`. " +
    "Enqueue to SQL and return 200 fast; run the agent loop in the separate " +
    "`_process-task` execution. Read the `integration-webhooks` skill.",
  sandbox:
    "Implement the `SandboxAdapter` seam in " +
    "`packages/core/src/coding-tools/sandbox/` (mirror " +
    "`local-child-process-adapter.ts`) and select it via `AGENT_NATIVE_SANDBOX` " +
    "or `registerSandboxAdapter()`. The adapter only runs the already-prepared, " +
    "non-secret module source — it never sees app secrets.",
  action:
    "Add a single multi-surface `defineAction` in `actions/` with a Zod schema. " +
    "Keep the surface small and orthogonal (one CRUD-style `update` over N " +
    "per-field actions). Read the `actions` skill.",
};

/**
 * Resolve a blueprint for a `kind` + optional `name`/`url`.
 *
 * - A known name → the curated `blueprints/<kind>/<name>.md`.
 * - A URL → the generic research-and-integrate blueprint for the kind.
 * - Unknown name → throws `AddResolutionError` listing what's available.
 */
export function resolveBlueprint(opts: {
  kind: string;
  nameOrUrl?: string;
  root: string;
}): ResolvedBlueprint {
  const { kind, nameOrUrl, root } = opts;
  const kinds = listKinds(root);

  if (!kinds.includes(kind)) {
    throw new AddResolutionError(
      `Unknown blueprint kind: ${kind}\n\n${formatCatalog(root)}`,
    );
  }

  // A URL seed → generic blueprint for the kind.
  if (nameOrUrl && looksLikeUrl(nameOrUrl)) {
    return {
      markdown: buildGenericUrlBlueprint(kind, nameOrUrl.trim()),
      source: {
        kind: "generic-url",
        blueprintKind: kind,
        url: nameOrUrl.trim(),
      },
    };
  }

  const names = listBlueprintNames(root, kind);

  // No name given: if exactly one curated blueprint exists, use it; otherwise
  // ask the user to pick one (or pass a URL for the generic path).
  if (!nameOrUrl) {
    if (names.length === 1) {
      return loadCurated(root, kind, names[0]);
    }
    throw new AddResolutionError(
      `Specify a ${kind} blueprint name or a URL.\n` +
        `  Available ${kind} blueprints: ${
          names.length ? names.join(", ") : "(none — pass a URL)"
        }\n` +
        `  Or research from a URL: agent-native add ${kind} https://…`,
    );
  }

  if (!names.includes(nameOrUrl)) {
    throw new AddResolutionError(
      `Unknown ${kind} blueprint: ${nameOrUrl}\n` +
        `  Available ${kind} blueprints: ${
          names.length ? names.join(", ") : "(none)"
        }\n` +
        `  Or research from a URL: agent-native add ${kind} https://…`,
    );
  }

  return loadCurated(root, kind, nameOrUrl);
}

function loadCurated(
  root: string,
  kind: string,
  name: string,
): ResolvedBlueprint {
  const filePath = path.join(root, kind, `${name}.md`);
  const markdown = fs.readFileSync(filePath, "utf-8");
  return {
    markdown,
    source: { kind: "curated", blueprintKind: kind, name, path: filePath },
  };
}

/** Thrown for an unknown kind/name; the CLI prints the message and exits 1. */
export class AddResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AddResolutionError";
  }
}

interface ParsedAddArgs {
  list: boolean;
  help: boolean;
  /** Accepted as an explicit no-op alias for the default print behavior. */
  print: boolean;
  positionals: string[];
}

export function parseAddArgs(argv: string[]): ParsedAddArgs {
  const out: ParsedAddArgs = {
    list: false,
    help: false,
    print: false,
    positionals: [],
  };
  for (const arg of argv) {
    if (arg === "--") continue;
    if (arg === "--list" || arg === "-l") out.list = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--print" || arg === "-p") out.print = true;
    else if (arg.startsWith("-")) {
      // Ignore unknown flags rather than misparse them as a name.
      continue;
    } else out.positionals.push(arg);
  }
  return out;
}

const HELP = `agent-native add — emit an integration blueprint for your coding agent.

Instead of scaffolding files, \`add\` prints a curated Markdown recipe to stdout.
Pipe it into a coding agent (Claude Code, Codex, …) and it applies the changes
against your live repo, the agent-native way.

Usage:
  agent-native add <kind> <name>            Print a curated blueprint
  agent-native add <kind> <https://docs…>   Research-and-integrate from a URL
  agent-native add --list                   List available kinds and blueprints

Examples:
  agent-native add provider stripe | claude
  agent-native add channel discord | codex
  agent-native add sandbox docker
  agent-native add action crud
  agent-native add provider https://docs.example.com/api | claude

Options:
  -l, --list     List available blueprint kinds and names
  -p, --print    Print the blueprint to stdout (the default; explicit no-op)
  -h, --help     Show this help`;

/**
 * CLI entry point. Returns the process exit code so the dispatcher / tests can
 * assert on it. Writes the blueprint Markdown to stdout and diagnostics to
 * stderr so `... | claude` only receives the blueprint.
 */
export function runAdd(
  argv: string[],
  io: {
    out?: (s: string) => void;
    err?: (s: string) => void;
    root?: string;
  } = {},
): number {
  const out = io.out ?? ((s: string) => process.stdout.write(s));
  const err = io.err ?? ((s: string) => process.stderr.write(s));
  const root = resolveBlueprintsRoot(io.root);

  const parsed = parseAddArgs(argv);

  if (parsed.help) {
    out(HELP + "\n");
    return 0;
  }

  // `--list` or no positionals → show the catalog (to stdout; this is the
  // requested output, not an error).
  if (parsed.list || parsed.positionals.length === 0) {
    out(formatCatalog(root) + "\n");
    return 0;
  }

  const [kind, nameOrUrl] = parsed.positionals;

  try {
    const resolved = resolveBlueprint({ kind, nameOrUrl, root });
    out(
      resolved.markdown.endsWith("\n")
        ? resolved.markdown
        : resolved.markdown + "\n",
    );
    return 0;
  } catch (e) {
    if (e instanceof AddResolutionError) {
      err(e.message + "\n");
      return 1;
    }
    throw e;
  }
}
