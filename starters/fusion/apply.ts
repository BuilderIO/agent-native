/**
 * Apply the Fusion starter overlay onto a materialized chat template tree.
 *
 * Lives in agent-native `starters/fusion/` and is mirrored to the starter's
 * `template` branch as `.github/starter-patch/`. The starter's sync workflow
 * copies that directory aside before dropping `.github/`, then runs it against
 * the merged `main` tree. Search/replace steps fail loudly if upstream copy
 * drifted; agent-native CI runs them against the materialized Chat template.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PATCH_DIR = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY_DIR = path.join(PATCH_DIR, "overlay");

function parseArgs(argv: string[]): {
  root: string;
  sourceRoot: string | undefined;
  restoreOwnedOnly: boolean;
} {
  let root = process.cwd();
  let sourceRoot: string | undefined;
  let restoreOwnedOnly = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root" && argv[i + 1]) {
      root = path.resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--source-root" && argv[i + 1]) {
      sourceRoot = path.resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--restore-owned-only") {
      restoreOwnedOnly = true;
    }
  }
  return { root, sourceRoot, restoreOwnedOnly };
}

function readLines(file: string): string[] {
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function listOverlayFiles(): string[] {
  const files: string[] = [];
  function walk(rel: string): void {
    const abs = path.join(OVERLAY_DIR, rel);
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const next = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(next);
      else files.push(next.split(path.sep).join("/"));
    }
  }
  walk(".");
  return files;
}

function uniqueReplace(file: string, from: string, to: string): void {
  if (!existsSync(file)) {
    throw new Error(`replacement target missing: ${relTo(file)}`);
  }
  const src = readFileSync(file, "utf8");
  const toCount = src.split(to).length - 1;
  if (toCount === 1) {
    // Some replacements keep `from` inside `to`, so look for it outside `to`.
    if (src.split(to).join("").includes(from)) {
      throw new Error(
        `starter patch failed: both the original and patched snippet are in ${relTo(file)}`,
      );
    }
    return;
  }
  if (toCount > 1) {
    throw new Error(
      `starter patch failed: patched snippet not unique (${toCount}x) in ${relTo(file)}`,
    );
  }
  const fromCount = src.split(from).length - 1;
  if (fromCount === 0) {
    throw new Error(
      `starter patch failed: expected snippet not found in ${relTo(file)}\n---\n${from}\n---`,
    );
  }
  if (fromCount !== 1) {
    throw new Error(
      `starter patch failed: snippet not unique (${fromCount}x) in ${relTo(file)}`,
    );
  }
  writeFileSync(file, src.replace(from, to));
}

function optionalReplace(file: string, from: string, to: string): void {
  if (!existsSync(file)) return;
  uniqueReplace(file, from, to);
}

function relTo(file: string): string {
  return path.relative(process.cwd(), file) || file;
}

function restoreOwnedPaths(root: string, sourceRoot: string): void {
  if (path.resolve(root) === path.resolve(sourceRoot)) {
    throw new Error("--source-root must be different from --root");
  }
  for (const rel of readLines(path.join(PATCH_DIR, "owned.txt"))) {
    const source = path.join(sourceRoot, rel);
    const target = path.join(root, rel);
    rmSync(target, { recursive: true, force: true });
    if (!existsSync(source)) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true });
  }
}

function copyOverlay(root: string): string[] {
  if (!existsSync(OVERLAY_DIR)) {
    throw new Error(`missing overlay directory: ${OVERLAY_DIR}`);
  }
  const files = listOverlayFiles();
  if (files.length === 0) {
    throw new Error("starter patch overlay is empty");
  }
  for (const rel of files) {
    const to = path.join(root, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(path.join(OVERLAY_DIR, rel), to);
  }
  return files;
}

function deleteListed(root: string): void {
  for (const rel of readLines(path.join(PATCH_DIR, "delete.txt"))) {
    const target = path.join(root, rel);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
}

// CLAUDE.md ships as a symlink to AGENTS.md; agents that read both then load
// the same guide twice and muddy context. Replace it with a one-line pointer so
// AGENTS.md stays the single source of truth. Must run before copyOverlay so we
// never write through the symlink into AGENTS.md.
function dedupeClaudeGuide(root: string): void {
  const claude = path.join(root, "CLAUDE.md");
  let isLink = false;
  try {
    isLink = lstatSync(claude).isSymbolicLink();
  } catch {
    return;
  }
  if (!isLink) return;
  rmSync(claude);
  writeFileSync(
    claude,
    `# App — Agent Guide

The agent guide for this app lives in [AGENTS.md](AGENTS.md) — the single source
of truth for the framework contract, skills, application state, data, and
verification rules. This file is only a pointer; read AGENTS.md.
`,
  );
}

function assertGone(root: string, rel: string, label: string): void {
  if (existsSync(path.join(root, rel))) {
    throw new Error(`${label} still present at ${rel}`);
  }
}

function assertContains(root: string, rel: string, snippet: string): void {
  const file = path.join(root, rel);
  if (!existsSync(file)) throw new Error(`expected ${rel} after patch`);
  const src = readFileSync(file, "utf8");
  if (!src.includes(snippet)) {
    throw new Error(`expected ${rel} to contain:\n${snippet}`);
  }
}

function assertHomepageShape(root: string): void {
  const src = readFileSync(path.join(root, "app/routes/_index.tsx"), "utf8");
  if (!/return \(\r?\n\s*<div[\s>]/.test(src)) {
    throw new Error(
      "app/routes/_index.tsx must use `return (\\n    <div` so Fusion can inject its generating placeholder",
    );
  }
  if (!src.includes("Your app here")) {
    throw new Error("homepage is missing the replaceable Your app here canvas");
  }
}

function applyReplacements(root: string): void {
  // AGENTS.md is injected into the runtime chat agent's system prompt on every
  // request; DEVELOPING.md is not (see COMPACT_PROMPT_RESOURCE_MAX_CHARS in
  // agent-native's prompt-resources.ts). Anything here about how to build or
  // edit this app's source — not how to operate the running app — belongs in
  // DEVELOPING.md instead, reached through this one pointer.
  uniqueReplace(
    path.join(root, "AGENTS.md"),
    `Chat is the minimal chat-first agent-native app. \`/\` redirects to shared sign-in; authenticated chat starts at \`/home\`. Actions carry capabilities; screens exist only for durable workflows.`,
    `This starter ships as a blank Agent-Native app canvas — that describes its
initial state, not necessarily its current one. See \`DEVELOPING.md\` before
making any source code change.`,
  );

  uniqueReplace(
    path.join(root, "AGENTS.md"),
    `# Chat — Agent Guide`,
    `# App — Agent Guide`,
  );

  // Opt-in default plugins are refused via the overlay `server/plugins/config.ts`
  // (defineAppConfig → the `app` layer getAppConfig() reads). `plugins.disabled`
  // in agent-native.json is NOT read by the plugin-mount decision, so it must
  // live in the app config layer, not the client manifest.

  uniqueReplace(
    path.join(root, "package.json"),
    `  "name": "chat",
  "displayName": "Chat",
  "private": true,
  "description": "Minimal chat-first agent-native app template.",`,
    `  "name": "app",
  "displayName": "App",
  "private": true,
  "description": "Minimal agent-native app starter template.",`,
  );

  // The chat template ships a Chat-branded PWA manifest whose start_url also
  // deep-links to the chat home route (`/home`). The blank starter has no
  // `/home` route and defines its own brand later, so neutralize the identity
  // and point start_url at the app canvas root.
  uniqueReplace(
    path.join(root, "public/manifest.json"),
    `  "name": "Chat",
  "short_name": "Chat",
  "description": "Chat-first agent-native app ready to customize",
  "start_url": "./home",`,
    `  "name": "App",
  "short_name": "App",
  "description": "Agent-Native app starter ready to customize",
  "start_url": "./",`,
  );

  // Drop `--open` from the dev script. Fusion cloud environments are headless
  // Linux where the CLI's browser-open spawns `xdg-open`, which isn't installed
  // there and throws `spawn xdg-open ENOENT` on boot. Auto-opening a browser is
  // meaningless in those containers anyway.
  uniqueReplace(
    path.join(root, "package.json"),
    `    "dev": "agent-native dev --open",`,
    `    "dev": "agent-native dev",`,
  );

  uniqueReplace(
    path.join(root, "package.json"),
    `  "packageManager": "pnpm@10.29.1",`,
    `  "packageManager": "pnpm@10.14.0+sha512.ad27a79641b49c3e481a16a805baa71817a04bbe06a38d17e60e2eaee83f6a146c6a688125f5792e48dd5ba30e7da52a5cda4c3992b9ccf333f9ce223af84748",`,
  );

  uniqueReplace(
    path.join(root, "package.json"),
    `    "test": "vitest --run --passWithNoTests",`,
    `    "test": "vitest --run --passWithNoTests",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",`,
  );

  uniqueReplace(
    path.join(root, "package.json"),
    `    "postgres": "^3.4.9",
    "@react-router/dev": "8.1.0",`,
    `    "postgres": "^3.4.9",
    "@neondatabase/serverless": "^1.0.2",
    "dotenv": "^17.2.1",
    "drizzle-orm": "0.45.2",
    "@react-router/dev": "8.1.0",`,
  );

  uniqueReplace(
    path.join(root, "package.json"),
    `    "cmdk": "^1.1.1",
    "embla-carousel-react": "^8.6.0",`,
    `    "cmdk": "^1.1.1",
    "drizzle-kit": "0.31.9",
    "embla-carousel-react": "^8.6.0",`,
  );

  uniqueReplace(
    path.join(root, "netlify.toml"),
    `then pnpm migrate:production; fi`,
    `then pnpm migrate:production && pnpm db:migrate; fi`,
  );

  // Upstream storing-data tells Chat apps to hand-write `runMigrations([...])`
  // and says Chat ships no Drizzle Kit setup. This starter ships one, so its
  // generated migrations must stay the only app migration owner.
  uniqueReplace(
    path.join(root, ".agents/skills/storing-data/SKILL.md"),
    `If the scaffold already has \`drizzle.config.ts\`, \`drizzle/schema.ts\`, and a
\`db:generate\` script, generate reviewed SQL with Drizzle Kit and load it through
\`runDrizzleMigrations\`. Do not assume every starter has that setup or add a
second migration owner beside it. The Chat and default starters do not ship that
Drizzle Kit setup; follow their local instructions and the Database docs for
the migration path. In Chat, add \`server/db/schema.ts\`, \`server/db/index.ts\`
with \`createGetDb(schema)\`, and \`server/plugins/db.ts\` with
\`runMigrations([...], { table })\`. \`scripts/migrate-production.ts\` is framework-only;
do not create a parallel \`runMigrations([...])\` list beside a generated Drizzle
migration owner. Give each handwritten migration a unique, stable \`name\`
alongside its \`version\`; append changes instead of renumbering, reusing, or
editing an applied entry.`,
    `When the project contains \`drizzle.config.ts\` and \`drizzle/START_HERE.md\`, that managed Drizzle scaffold is the only app migration path. Define app tables in \`drizzle/schema.ts\`, run \`pnpm db:generate\`, and apply them with \`pnpm db:migrate\`. \`scripts/migrate-production.ts\` is framework-only: do not create a parallel \`runMigrations([...])\` list in \`server/plugins/db.ts\` or import an app migration runner into the release script.

In projects without that managed scaffold, every entry added to a framework \`runMigrations([...])\` list (\`@agent-native/core/db\`) needs a unique, stable \`name\` alongside its \`version\`; append changes instead of renumbering, reusing, or editing an applied entry.`,
  );

  uniqueReplace(
    path.join(root, ".agents/skills/storing-data/SKILL.md"),
    `For Chat and templates using the framework migration plugin, define the
PostgreSQL schema in \`server/db/schema.ts\`; \`getDb()\` comes from the local
\`server/db/index.ts\`. Some templates have their own Drizzle Kit layout and
local instructions. All queries are async.`,
    `In a managed Drizzle scaffold, define the PostgreSQL schema in
\`drizzle/schema.ts\` and get \`getDb()\` and \`schema\` from \`server/db.ts\` (see
\`drizzle/START_HERE.md\`). Otherwise, define it in \`server/db/schema.ts\`;
\`getDb()\` comes from the local \`server/db/index.ts\`. All queries are async.`,
  );

  // The release script closes the shared DB pool in its `finally`. Action
  // auto-discovery also mounts it as a live route, so if it is imported and run
  // in-process it tears down the pool for the whole server ("Cannot use a pool
  // after calling end on the pool"). Guard it to run only as a direct process
  // entrypoint (`pnpm migrate:production`) and throw otherwise.
  // Anchor on the `core/server` import alone rather than a contiguous
  // core/db + core/server pair. Upstream adds imports between those two lines
  // as the release script grows (it inserted `loadEnv` from
  // `@agent-native/core/scripts`), and a multi-line anchor fails the whole sync
  // every time that happens. Matching one line tolerates new neighbors.
  uniqueReplace(
    path.join(root, "scripts/migrate-production.ts"),
    `import { runFrameworkReleaseMigrations } from "@agent-native/core/server";`,
    `import { runFrameworkReleaseMigrations } from "@agent-native/core/server";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";`,
  );

  uniqueReplace(
    path.join(root, "scripts/migrate-production.ts"),
    `try {
  await main();
} finally {
  await closeDbExec();
}`,
    `// Guard: closeDbExec() below tears down the shared database pool, so this
// script must run only as its own process (\`pnpm migrate:production\`). The
// framework's action auto-discovery would otherwise mount it as a live route
// and running the teardown in-process breaks every other request with "Cannot
// use a pool after calling end on the pool." Throw instead of tearing down a
// pool this process does not own.
function isProcessEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return (
      pathToFileURL(realpathSync(entry)).href ===
      pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href
    );
  } catch {
    // coercion-ok: an unresolvable entry path is not this script, so the guard below throws.
    return false;
  }
}

if (!isProcessEntrypoint()) {
  throw new Error(
    "scripts/migrate-production.ts must run as its own process " +
      "(pnpm migrate:production); it closes the shared database pool when it " +
      "finishes, so importing or invoking it in-process — e.g. via an " +
      "auto-discovered action route — would break every other request.",
  );
}

try {
  await main();
} finally {
  await closeDbExec();
}`,
  );

  uniqueReplace(
    path.join(root, "pnpm-workspace.yaml"),
    `minimumReleaseAgeExclude:
  - typescript-7
  - typescript`,
    `minimumReleaseAgeExclude:
  - "@agent-native/*"
  - typescript-7
  - typescript`,
  );

  // Fusion already provisions connections for generated projects, so the
  // framework's first-run connect/integrations setup is redundant noise for
  // Fusion users. Non-Fusion agent-native apps built from templates/chat
  // still get the framework default.
  uniqueReplace(
    path.join(root, "agent-native.config.ts"),
    `export default defineAgentNativeConfig({
  changelog: { enabled: false },
  harness: true,
});`,
    `export default defineAgentNativeConfig({
  changelog: { enabled: false },
  harness: true,
  onboarding: { firstRun: "off" },
});`,
  );

  // The blank starter ships as a single standalone app. The multi-app-workspace
  // skill (added via the overlay) documents the workspace/Dispatch shape; point
  // agents at it before they restructure the repo into a workspace.
  uniqueReplace(
    path.join(root, "AGENTS.md"),
    `## Core rules`,
    `This repo is a single standalone app (\`agent-native.scaffold.shape:
"standalone"\`), not a workspace root. If the user asks for a workspace, a
platform or suite of apps, a second app, an app shell or launcher, or Dispatch,
read the \`multi-app-workspace\` skill before touching the repo layout.

## Core rules`,
  );

  uniqueReplace(
    path.join(root, "AGENTS.md"),
    `- \`navigation\` describes the view and selected ids. Chat is \`chat\` at \`/home\`; \`/\` opens shared sign-in/signup.`,
    `- \`navigation\` describes the view and selected ids. The default home view is
  \`home\` at \`/\` (blank app canvas). No agent rail or chat is mounted by
  default; add one only when the user asks.`,
  );

  // Upstream's domain-app recipe extends the Chat shell (Sidebar.tsx, Header.tsx,
  // \`/home\` as Chat) that deleteListed() removes, and forbids the README rewrite
  // DEVELOPING.md asks for.
  uniqueReplace(
    path.join(root, "AGENTS.md"),
    `Choose the primary workflow and route before editing. Add a domain route under \`app/routes/\` and set \`app.homePath\` in \`server/plugins/agent-native-email-branding.ts\` with \`defineAppConfig\`. Keep \`/home\` as Chat. Add a static link in \`app/components/layout/Sidebar.tsx\` before \`ChatThreadsSection\`; \`Header.tsx\` maps \`/home\` to Chat and uses \`APP_TITLE\` elsewhere. Shared sidebar and AgentInspector remain.`,
    `Choose the primary workflow and route before editing. Build on the blank canvas in \`app/routes/_index.tsx\` or add domain routes under \`app/routes/\`. This starter has no Chat route, sidebar, header, or agent rail; add only the navigation the product needs. Set \`app.homePath\` in the existing \`defineAppConfig\` in \`server/plugins/config.ts\` as \`DEVELOPING.md\` describes.`,
  );

  uniqueReplace(
    path.join(root, "AGENTS.md"),
    `Keep feature guidance here; do not rewrite \`README.md\` or \`DESIGN.md\`. After all edits, run one typecheck, one doctor check, and one browser smoke of the primary workflow, including overlap rejection, cancellation freeing the slot, and authenticated landing.`,
    `Keep feature guidance here and update \`README.md\` as \`DEVELOPING.md\` describes. After all edits, run one typecheck, one doctor check, and one browser smoke of the primary workflow and its authenticated landing.`,
  );

  // AGENTS.md's one DEVELOPING.md pointer lives in the intro paragraph above;
  // everything else this overlay used to add inline to AGENTS.md — the
  // blank-canvas build guidance, the DECISIONS.md check, and the
  // i18n/changelog opt-in note — moves into DEVELOPING.md below instead. None
  // of it helps the runtime agent operate the deployed app; all of it is
  // about editing this app's source, which is exactly DEVELOPING.md's job
  // (and the one thing AGENTS.md's pointer sends the agent there for).
  uniqueReplace(
    path.join(root, "DEVELOPING.md"),
    `See the \`extensions\` skill in \`.agents/skills/extensions/SKILL.md\` for full implementation details.`,
    `See the \`extensions\` skill in \`.agents/skills/extensions/SKILL.md\` for full implementation details.

## Preserve existing work

This starter ships as a blank Agent-Native app canvas — that describes its
initial state, not necessarily its current one. Before assuming no UI or
brand exists, check \`app/routes/_index.tsx\` and \`app/global.css\`: if they
already contain real content, that content is the current product and its
established brand. Build additively, preserve existing tokens/routes/palette,
and do not re-derive a new visual direction or overwrite shipped UI unless
the user explicitly asks for a redesign. Only treat the canvas as blank when
the files actually show the starter's placeholder content.

If \`DECISIONS.md\` exists at the repo root, read it before starting work — it
holds pre-build choices as current requirements. If the user changes one
later in chat, update \`DECISIONS.md\` to match.

\`README.md\` starts as a generic "My App" placeholder. Once the app has real
features, rewrite its title and opening paragraph to name the app and say what
it does, and keep the run instructions accurate when you change scripts or
required env vars.

**Do not add internationalization or changelog support unless the user
explicitly asks for them.** This starter ships English-only UI copy inline —
no \`app/i18n/\`, LanguagePicker, \`CHANGELOG.md\`, or What's New surfaces. If the
user requests i18n or changelogs, load the matching skill and add only what
they asked for.

## Data & actions (read these first)

Add persistence or auth **only when data must survive reload or be shared
between users**. A pure UI, copy, or layout change needs no schema, action, or
auth — build it directly and do **not** read the \`security\` or \`storing-data\`
skills for UI-only work. Only when you actually add an action, route, or schema
that handles user input or persistence, read \`security\` and \`storing-data\`
first.

### Choose the post-auth landing route from the app

Before enabling authentication, inspect \`app/routes\`, the app's navigation,
and any existing \`app.homePath\` in \`server/plugins/config.ts\`. Preserve an
existing \`homePath\` when it still points to a valid route. Otherwise choose
the actual primary authenticated landing page from the product already built,
such as \`/\`, \`/dashboard\`, or \`/tasks\`. Never assume \`/home\` unless that
route really exists.

The starter ships \`homePath: "/"\` only so sign-in lands on the blank canvas.
Once \`/\` is a public page and the signed-in app lives elsewhere, replace it
with that route.

Do not choose an auth route, API route, public-only marketing page, wildcard
route, or parameterized route that cannot open without an id. If multiple
authenticated landing routes are equally plausible and the product intent is
unclear, ask the user instead of inventing one.

Write the selected route to the existing \`defineAppConfig\` object in
\`server/plugins/config.ts\` while preserving its \`plugins.disabled\` settings:

\`\`\`ts
export default defineAppConfig({
  app: { homePath: "/dashboard" },
  plugins: {
    disabled: ["integrations", "observational-memory", "sentry", "terminal"],
  },
});
\`\`\`

After enabling or changing auth, verify both signup and login land on an
existing page rather than a 404.

When adding SQL-backed features, do **not** start with \`find\` / \`cat\` over
\`node_modules\`. Read these two files first:

1. \`drizzle/START_HERE.md\` — table map, migrate commands, path map
2. \`drizzle/crud-action-example.ts\` — copy-paste list/create/update/delete

Then use \`getDb\` / \`schema\` from \`server/db.ts\`. After a batch of related
schema/action edits: one smoke test, one \`pnpm typecheck\` (see Verification).

- Guarded verification: run \`pnpm agent-native:doctor\`; fix findings before done.

## Verification

Run checks **once at the end of a batch of related edits**, not after every
file, action, or small UI tweak. Dev already runs route/action typegen while
\`pnpm dev\` is up — do not treat that as a reason to also run full typecheck
after each write.

| Change shape | Verify with |
| ------------- | ----------- |
| UI / copy / layout only | Formatter if the app has one; preview if something looks wrong. Skip full typecheck unless the edit touched types or imports. |
| New/changed actions, schema, server, or shared types | One \`pnpm typecheck\` (and lint if the app has it) after the batch. |
| New DB-backed CRUD | One smoke path only (e.g. create + list via \`pnpm action …\` or a single HTTP call). Do **not** CLI-test every action method. |

Do not re-run typecheck to "confirm" after a clean pass. If typecheck fails on
unrelated pre-existing errors, fix or note them — do not thrash with repeated
full runs and greps.

## Configuration is code, not env vars

Configure framework behavior in \`agent-native.config.ts\` via
\`defineAgentNativeConfig({ ... })\`. App metadata consumed by \`getAppConfig()\`,
including \`app.homePath\`, belongs in the existing \`defineAppConfig\` object in
\`server/plugins/config.ts\`. Do **not** reach for \`process.env\` to drive app
behavior, feature flags, or framework options. Environment variables are only
for deploy-level secrets and host settings (see \`secrets\`); never add a
\`process.env\` fallback to configure a feature.`,
  );

  uniqueReplace(
    path.join(root, ".agents/skills/adding-a-feature/SKILL.md"),
    `If the feature changes visible copy, update its source and the app's configured
locale catalogs. Use \`agent-native-docs\` to find the localization guidance when
the app's translation setup is unclear.`,
    `If the feature adds or changes visible UI copy, prompts, toasts, labels, empty
states, or formatting, edit the English strings inline in components. Do **not**
add i18n catalogs unless the user explicitly asks for localization; only then
read the \`internationalization\` skill.`,
  );

  uniqueReplace(
    path.join(root, ".agents/skills/actions/SKILL.md"),
    `The default template dispatches through core's \`runScript()\` in \`actions/run.ts\`. Action names are lowercase-with-hyphens (\`pnpm action my-action\` → \`actions/my-action.ts\`).

## Custom \`/api/\` Routes`,
    `The default template dispatches through core's \`runScript()\` in \`actions/run.ts\`. Action names are lowercase-with-hyphens (\`pnpm action my-action\` → \`actions/my-action.ts\`).

After adding or changing several related actions, smoke-test **once** (one
happy-path call that proves the wire-up), then typecheck once. Do not run
\`pnpm action …\` for every method unless a smoke test failed and you need to
isolate which action broke.

## CRUD + Drizzle in this starter

Before hunting through \`node_modules\` for DB helpers, read:

1. \`drizzle/START_HERE.md\` — where tables live + migrate commands
2. \`drizzle/crud-action-example.ts\` — copy-paste list/create/update/delete pattern

DB client: \`getDb\` / \`schema\` from \`server/db.ts\`.

## Custom \`/api/\` Routes`,
  );

  // package.json keeps \`scaffold.template: "chat"\`, so build-an-app would send
  // agents to the Chat shell edit points that deleteListed() removes.
  uniqueReplace(
    path.join(root, ".agents/skills/build-an-app/SKILL.md"),
    `- \`chat\`: \`references/edit-points-chat.md\``,
    `- \`chat\` in this Fusion starter: the Chat shell was removed, so do not use
  \`references/edit-points-chat.md\`. Use \`AGENTS.md\`, \`DEVELOPING.md\`, and
  \`drizzle/START_HERE.md\` for edit points.`,
  );

  uniqueReplace(
    path.join(root, ".agents/skills/frontend-design/SKILL.md"),
    `Preserve the existing brand and theme. Prefer semantic color tokens and the
app's type system over raw palette colors or a newly invented visual system.
Choose an accent and type treatment for a reason; avoid generic gradients,
glass effects, decorative blobs, and hero sections without a product purpose.`,
    `This starter ships **no brand system** — the neutral, 0%-saturation tokens in
\`app/global.css\` are a placeholder, not a design to preserve. Every app must
look impressive on first load even when the build prompt gives no design
direction: commit to one deliberate visual world, set a product-fitting accent
family in the light and dark tokens, and establish a clear type hierarchy,
spacing rhythm, and one signature detail. Do not ship the gray placeholder and
do not average toward generic SaaS. If an app already has a real brand, preserve
it. Keep shared behavior and semantic token names consistent; palette, density,
composition, type contrast, and shape language are yours to define. Prefer
semantic color tokens over raw palette colors, and avoid generic gradients,
glass effects, decorative blobs, and hero sections without a product purpose.`,
  );

  optionalReplace(
    path.join(root, ".agents/skills/app-branding/SKILL.md"),
    `- \`pnpm typecheck\` passes.`,
    `- \`pnpm typecheck\` passes once at the end of the branding batch (skip if only
  CSS/copy tokens changed with no type/import edits).`,
  );

  optionalReplace(
    path.join(root, ".agents/skills/app-permissions/SKILL.md"),
    `4. **Typecheck.** Editing server source is a Tier 2 change — run \`pnpm typecheck\`
   afterward (see \`self-modifying-code\`).`,
    `4. **Typecheck.** Editing server source is a Tier 2 change — run \`pnpm typecheck\`
   once after the batch of related edits (see \`self-modifying-code\`).`,
  );
}

function assertPatched(root: string): void {
  assertGone(root, "CHANGELOG.md", "changelog");
  assertGone(root, "changelog", "changelog directory");
  assertGone(root, "app/i18n", "i18n catalogs");
  assertGone(root, "app/i18n-data.ts", "i18n data");
  assertGone(root, "app/components/layout/Header.tsx", "header chrome");
  assertGone(root, "app/components/layout/Sidebar.tsx", "left sidebar");
  assertGone(
    root,
    "app/components/layout/AgentInspector.tsx",
    "agent inspector sidebar",
  );
  assertGone(
    root,
    "app/components/chat/ChatRouteContent.tsx",
    "chat route content",
  );
  assertGone(root, "app/routes/agent.tsx", "agent settings route");
  assertGone(root, "app/routes/database.tsx", "database admin route");
  assertGone(root, "app/routes/observability.tsx", "observability route");
  assertGone(root, "app/routes/settings.tsx", "settings route");
  assertGone(root, "app/routes/settings.$.tsx", "settings splat route");
  assertGone(root, "public/auth-marketing", "chat auth marketing screenshot");
  assertGone(root, ".agents/skills/turn-into-app", "turn-into-app skill");
  assertGone(root, ".agents/skills/turn-into-skill", "turn-into-skill skill");
  assertGone(
    root,
    ".agents/skills/workspace-conventions",
    "workspace-conventions skill",
  );
  assertGone(
    root,
    ".claude/skills/turn-into-app",
    "turn-into-app claude skill",
  );
  assertGone(
    root,
    ".claude/skills/turn-into-skill",
    "turn-into-skill claude skill",
  );
  assertGone(
    root,
    ".claude/skills/workspace-conventions",
    "workspace-conventions claude skill",
  );
  assertHomepageShape(root);
  assertContains(
    root,
    "app/components/layout/Layout.tsx",
    "agent-native-app-main",
  );
  assertContains(root, "drizzle.config.ts", 'out: "./drizzle/migrations"');
  assertContains(root, "drizzle.config.ts", 'dialect: "postgresql"');
  assertContains(
    root,
    "drizzle.config.ts",
    "url: process.env.DATABASE_URL_UNPOOLED",
  );
  assertContains(root, "drizzle/START_HERE.md", "drizzle/schema.ts");
  assertContains(
    root,
    "drizzle/crud-action-example.ts",
    "COPY-PASTE REFERENCE",
  );
  assertContains(
    root,
    ".agents/skills/storing-data/SKILL.md",
    "that managed Drizzle scaffold is the only app migration path",
  );
  assertContains(
    root,
    "scripts/migrate-production.ts",
    "must run as its own process",
  );
  const layout = readFileSync(
    path.join(root, "app/components/layout/Layout.tsx"),
    "utf8",
  );
  if (
    layout.includes('from "./Sidebar"') ||
    layout.includes('from "./Header"') ||
    layout.includes("<AgentSidebar")
  ) {
    throw new Error(
      "Layout still imports Header/Sidebar or default-mounts the agent rail",
    );
  }
  const rootSrc = readFileSync(path.join(root, "app/root.tsx"), "utf8");
  if (rootSrc.includes("i18nCatalog") || rootSrc.includes("changelog")) {
    throw new Error("root.tsx still wires i18n or changelog");
  }
  if (rootSrc.includes("CommandMenu")) {
    throw new Error("root.tsx still mounts the command menu");
  }
  const agentChat = readFileSync(
    path.join(root, "server/plugins/agent-chat.ts"),
    "utf8",
  );
  if (
    agentChat.includes('appId: "chat"') ||
    agentChat.includes("right-hand rail")
  ) {
    throw new Error("agent-chat plugin still carries chat identity");
  }
  if (agentChat.includes("initialToolNames")) {
    throw new Error(
      "agent-chat plugin must derive first-turn tools from generated app actions",
    );
  }
  if (
    !agentChat.includes(
      "If an expected action is not loaded, use tool-search before considering a source-code handoff.",
    )
  ) {
    throw new Error(
      "agent-chat plugin is missing the app-operation classification guard",
    );
  }
  if (!agentChat.includes("nativeActionsInDev: true")) {
    throw new Error(
      "agent-chat plugin must expose app actions as native tools in dev",
    );
  }
  if (
    !agentChat.includes("finalResponseGuard: appOperationFinalResponseGuard")
  ) {
    throw new Error(
      "agent-chat plugin must enforce app-operation discovery before source handoffs",
    );
  }
  // Nitro auto-registers every file under server/plugins and requires a default
  // export there, so the guard module lives outside that directory.
  if (existsSync(path.join(root, "server/plugins/app-operation-guard.ts"))) {
    throw new Error(
      "app-operation guard must not live in server/plugins (Nitro plugin dir)",
    );
  }
  const appOperationGuard = readFileSync(
    path.join(root, "server/agent/app-operation-guard.ts"),
    "utf8",
  );
  if (!appOperationGuard.includes("expandToolSurface: true")) {
    throw new Error(
      "app-operation guard must expand the tool surface on corrective retry",
    );
  }
  const auth = readFileSync(path.join(root, "server/plugins/auth.ts"), "utf8");
  if (auth.includes("marketing:") || auth.includes("tagline:")) {
    throw new Error("auth plugin still carries chat marketing copy");
  }
  if (lstatSync(path.join(root, "CLAUDE.md")).isSymbolicLink()) {
    throw new Error("CLAUDE.md is still a symlink duplicate of AGENTS.md");
  }
  assertContains(root, "CLAUDE.md", "read AGENTS.md");
  const claudeSrc = readFileSync(path.join(root, "CLAUDE.md"), "utf8");
  if (claudeSrc.includes("## Core rules")) {
    throw new Error("CLAUDE.md still duplicates the full AGENTS.md guide");
  }
  const pkgSrc = readFileSync(path.join(root, "package.json"), "utf8");
  if (
    pkgSrc.includes("chat-first") ||
    pkgSrc.includes('"displayName": "Chat"')
  ) {
    throw new Error("package.json still identifies the app as chat");
  }
  if (pkgSrc.includes("agent-native dev --open")) {
    throw new Error("package.json dev script still passes --open");
  }
  assertContains(root, "package.json", '"dev": "agent-native dev"');
  assertContains(
    root,
    "package.json",
    '"packageManager": "pnpm@10.14.0+sha512.',
  );
  assertContains(root, "package.json", '"db:generate": "drizzle-kit generate"');
  assertContains(root, "package.json", '"db:migrate": "drizzle-kit migrate"');
  assertContains(root, "package.json", '"drizzle-orm": "0.45.2"');
  assertContains(root, "package.json", '"drizzle-kit": "0.31.9"');
  assertContains(root, "package.json", '"@neondatabase/serverless"');
  assertContains(root, "package.json", '"dotenv":');
  assertContains(
    root,
    "netlify.toml",
    "pnpm migrate:production && pnpm db:migrate",
  );
  assertContains(root, "pnpm-workspace.yaml", '"@agent-native/*"');
  assertContains(
    root,
    "agent-native.config.ts",
    `onboarding: { firstRun: "off" }`,
  );
  assertContains(
    root,
    "DEVELOPING.md",
    "Before enabling authentication, inspect `app/routes`, the app's navigation",
  );
  assertContains(root, "DEVELOPING.md", "Never assume `/home` unless that");
  assertContains(root, "DEVELOPING.md", 'app: { homePath: "/dashboard" },');
  assertContains(
    root,
    "DEVELOPING.md",
    "Build additively, preserve existing tokens/routes/palette",
  );
  assertContains(
    root,
    "DEVELOPING.md",
    "If `DECISIONS.md` exists at the repo root",
  );
  assertContains(root, "DEVELOPING.md", "`README.md` starts as a generic");
  const readmeSrc = readFileSync(path.join(root, "README.md"), "utf8");
  if (
    readmeSrc.includes("# Chat") ||
    readmeSrc.includes("chat.agent-native.com")
  ) {
    throw new Error("README.md still describes the chat template");
  }
  assertContains(
    root,
    "DEVELOPING.md",
    "Do not add internationalization or changelog support unless the user",
  );
  assertContains(root, "AGENTS.md", "See `DEVELOPING.md` before");
  assertContains(
    root,
    "AGENTS.md",
    "read the `multi-app-workspace` skill before touching the repo layout",
  );
  assertContains(
    root,
    ".agents/skills/multi-app-workspace/SKILL.md",
    "multi-app-workspace",
  );
  const pluginConfigSrc = readFileSync(
    path.join(root, "server/plugins/config.ts"),
    "utf8",
  );
  if (
    !pluginConfigSrc.includes("defineAppConfig") ||
    !pluginConfigSrc.includes("disabled") ||
    !pluginConfigSrc.includes("integrations")
  ) {
    throw new Error(
      "server/plugins/config.ts is missing the disabled default plugins",
    );
  }
  const manifestSrc = readFileSync(
    path.join(root, "public/manifest.json"),
    "utf8",
  );
  if (
    manifestSrc.includes('"Chat"') ||
    manifestSrc.includes("Chat-first") ||
    manifestSrc.includes('"./home"')
  ) {
    throw new Error(
      "public/manifest.json still carries chat identity or the /home start_url",
    );
  }
}

function main(): void {
  const { root, sourceRoot, restoreOwnedOnly } = parseArgs(
    process.argv.slice(2),
  );
  if (!existsSync(path.join(root, "app/routes/_index.tsx"))) {
    throw new Error(`does not look like the chat starter tree: ${root}`);
  }
  if (restoreOwnedOnly) {
    if (!sourceRoot) {
      throw new Error("--source-root is required with --restore-owned-only");
    }
    restoreOwnedPaths(root, sourceRoot);
    console.log(`Restored owned paths from pristine template into ${root}`);
    return;
  }
  if (sourceRoot) restoreOwnedPaths(root, sourceRoot);
  applyReplacements(root);
  dedupeClaudeGuide(root);
  copyOverlay(root);
  deleteListed(root);
  assertPatched(root);
  console.log(`Applied Fusion starter patch to ${root}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
