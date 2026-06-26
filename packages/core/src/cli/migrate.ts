import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  appendCodeAgentTranscriptEvent,
  codeAgentRunArtifactsDir,
  createCodeAgentRunRecord,
  getLastCodeAgentRunRecord,
  listCodeAgentRunRecords,
  writeCodeAgentRunRecord,
  type CodeAgentRunRecord,
} from "./code-agent-runs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_APP_NAME = "migration";
const DEFAULT_OUTPUT = "../migrated-app";
const DEFAULT_TARGET = "agent-native";
const DEFAULT_DOSSIER_DIR = "agent-native-migration-dossier";
const MIGRATION_DEV_PORT = 8101;
const MIGRATE_SUBCOMMANDS = new Set(["resume", "status", "stop", "ui"]);
const MIGRATION_SESSION_COMMAND = "agent-native code /migrate";
const MODEL_CREDENTIAL_ENV_NAMES = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "COHERE_API_KEY",
  "BUILDER_PRIVATE_KEY",
];

type MigrateSubcommand = "resume" | "status" | "stop" | "ui";
type SourceKind = "path" | "url" | "description";

export interface MigrateCliOptions {
  subcommand?: MigrateSubcommand;
  source?: string;
  sourcePath?: string;
  sourceUrl?: string;
  sourceDescription?: string;
  workbench?: string;
  output?: string;
  appName?: string;
  target?: string;
  planOnly?: boolean;
  planFile?: string;
  emit?: boolean;
  emitDir?: string;
  appSurface?: boolean;
  last?: boolean;
  help?: boolean;
}

export interface SourceSpec {
  kind: SourceKind;
  value: string;
  sourceRoot?: string;
  description?: string;
}

export interface EmitDossierResult {
  dossierRoot: string;
  files: string[];
  source: SourceSpec;
  usedMigrateHelpers: boolean;
}

interface ProjectIRLike {
  site: {
    framework: "nextjs" | "react" | "aem" | "unknown";
    sourceRoot: string;
    routes: Array<{
      id: string;
      path: string;
      filePath: string;
      router: "next-pages" | "next-app" | "unknown";
      kind: "marketing" | "docs" | "landing" | "app" | "api" | "unknown";
      dynamic: boolean;
      public: boolean;
      notes?: string[];
    }>;
    redirects: Array<Record<string, unknown>>;
    metadata: Record<string, unknown>;
  };
  components: {
    components: Array<{
      id: string;
      name: string;
      filePath: string;
      usedByRoutes: string[];
      notes?: string[];
    }>;
    designTokens: Record<string, unknown>;
  };
  content: {
    models: Array<Record<string, unknown>>;
    assets: Array<{
      id: string;
      path: string;
      type: string;
      metadata?: Record<string, unknown>;
    }>;
  };
  behavior: {
    apiEndpoints: Array<{
      id: string;
      path: string;
      method: string;
      filePath: string;
      recommendedRecipe: string;
    }>;
    dataStores: Array<{
      id: string;
      name: string;
      filePath: string;
      kind: "database" | "api" | "local-state" | "unknown";
    }>;
    llmCalls: Array<{ id: string; filePath: string; provider: string }>;
    clientState: Array<{ id: string; filePath: string; reason: string }>;
    auth: Array<{ id: string; filePath: string; provider: string }>;
    jobs: Array<{ id: string; filePath: string; kind: string }>;
  };
}

export function parseMigrateArgs(argv: string[]): MigrateCliOptions {
  const opts: MigrateCliOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (i === 0 && MIGRATE_SUBCOMMANDS.has(arg)) {
      opts.subcommand = arg as MigrateSubcommand;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--out" && argv[i + 1]) {
      opts.output = argv[++i];
    } else if (arg.startsWith("--out=")) {
      opts.output = arg.slice("--out=".length);
    } else if (arg === "--name" && argv[i + 1]) {
      opts.appName = argv[++i];
    } else if (arg.startsWith("--name=")) {
      opts.appName = arg.slice("--name=".length);
    } else if (arg === "--target" && argv[i + 1]) {
      opts.target = argv[++i];
    } else if (arg.startsWith("--target=")) {
      opts.target = arg.slice("--target=".length);
    } else if (arg === "--source" && argv[i + 1]) {
      setSourceOption(opts, argv[++i]);
    } else if (arg.startsWith("--source=")) {
      setSourceOption(opts, arg.slice("--source=".length));
    } else if (arg === "--path" && argv[i + 1]) {
      opts.sourcePath = argv[++i];
    } else if (arg.startsWith("--path=")) {
      opts.sourcePath = arg.slice("--path=".length);
    } else if (arg === "--url" && argv[i + 1]) {
      opts.sourceUrl = argv[++i];
    } else if (arg.startsWith("--url=")) {
      opts.sourceUrl = arg.slice("--url=".length);
    } else if (
      (arg === "--description" || arg === "--describe") &&
      argv[i + 1]
    ) {
      opts.sourceDescription = argv[++i];
    } else if (arg.startsWith("--description=")) {
      opts.sourceDescription = arg.slice("--description=".length);
    } else if (arg.startsWith("--describe=")) {
      opts.sourceDescription = arg.slice("--describe=".length);
    } else if (arg === "--emit") {
      opts.emit = true;
      if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
        opts.emitDir = argv[++i];
      }
    } else if (arg.startsWith("--emit=")) {
      opts.emit = true;
      opts.emitDir = arg.slice("--emit=".length);
    } else if (arg === "--emit-dir" && argv[i + 1]) {
      opts.emit = true;
      opts.emitDir = argv[++i];
    } else if (arg.startsWith("--emit-dir=")) {
      opts.emit = true;
      opts.emitDir = arg.slice("--emit-dir=".length);
    } else if (arg === "--app-surface" || arg === "--workbench") {
      opts.appSurface = true;
    } else if (arg === "--plan-only") {
      opts.planOnly = true;
    } else if (arg === "--plan-file" && argv[i + 1]) {
      opts.planFile = argv[++i];
    } else if (arg.startsWith("--plan-file=")) {
      opts.planFile = arg.slice("--plan-file=".length);
    } else if (arg === "--last") {
      opts.last = true;
    } else if (!arg.startsWith("-")) {
      if (
        opts.subcommand &&
        ["status", "stop", "ui"].includes(opts.subcommand) &&
        !opts.workbench
      ) {
        opts.workbench = arg;
      } else if (!opts.source) {
        opts.source = arg;
      } else if (!opts.workbench) {
        opts.workbench = arg;
      }
    }
  }
  return opts;
}

export async function runMigrate(argv: string[]): Promise<void> {
  const opts = parseMigrateArgs(argv);
  if (opts.help) {
    console.log(migrateUsage());
    return;
  }

  if (opts.subcommand === "status") {
    printMigrationStatus(opts);
    return;
  }
  if (opts.subcommand === "stop") {
    printMigrationStop(opts);
    return;
  }
  if (opts.subcommand === "ui") {
    printMigrationUi(opts);
    return;
  }
  if (opts.emit) {
    try {
      const result = await emitOwnAgentDossier(opts);
      console.log(renderEmitResult(result));
    } catch (error) {
      if (isExpectedMigrationCliError(error)) {
        console.error(`\n${migrationCliErrorMessage(error)}\n`);
        process.exit(1);
      }
      throw error;
    }
    return;
  }
  if (opts.subcommand === "resume" && !hasAnySource(opts)) {
    printMigrationResume(opts);
    return;
  }

  if (opts.appSurface) {
    await scaffoldOrResumeWorkbench();
    return;
  }

  try {
    await createMigrationCodeAgentSession(opts);
  } catch (error) {
    if (isExpectedMigrationCliError(error)) {
      console.error(`\n${migrationCliErrorMessage(error)}\n`);
      process.exit(1);
    }
    throw error;
  }
}

export async function emitOwnAgentDossier(
  opts: MigrateCliOptions,
  cwd = process.cwd(),
): Promise<EmitDossierResult> {
  const source = resolveSourceSpec(opts, cwd);
  if (!source) {
    throw new Error(
      "Usage: agent-native migrate <source-path-or-url> --emit [dossier-dir]",
    );
  }

  let dossierRoot = resolveDossierRoot(opts, source, cwd);
  const explicitEmitDir = Boolean(opts.emitDir);
  if (source.sourceRoot && isInsideOrSame(source.sourceRoot, dossierRoot)) {
    if (explicitEmitDir) {
      throw new Error(
        `Refusing to emit dossier inside sourceRoot (${source.sourceRoot}). Choose an --emit path outside the source project.`,
      );
    }
    dossierRoot = defaultDossierRoot(source, cwd);
  }
  if (source.sourceRoot) {
    assertOutsideSourceRoot(source.sourceRoot, dossierRoot, "dossier");
  }

  fs.mkdirSync(dossierRoot, { recursive: true });
  const planInputs = await readMigrationPlanInputs(opts, cwd);
  const written = new Set<string>();
  const write = (relativePath: string, content: string) => {
    const filePath = path.join(dossierRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      content.endsWith("\n") ? content : `${content}\n`,
    );
    written.add(relativePath);
  };

  const templateDir = findMigrationTemplateDir();
  const templateAgents = readTextIfExists(
    templateDir ? path.join(templateDir, "AGENTS.md") : undefined,
  );
  write("AGENTS.md", renderDossierAgentsMd(source, templateAgents, planInputs));

  for (const copied of copyMigrationSkills(templateDir, dossierRoot)) {
    written.add(copied);
  }

  const helperResult = await writeAssessmentWithMigrateHelpers({
    source,
    dossierRoot,
    target: opts.target ?? DEFAULT_TARGET,
    write,
  });
  const usedMigrateHelpers = helperResult;
  if (!helperResult) {
    const fallback = buildFallbackAssessment(source);
    write("01-assessment.md", fallback.assessment);
    if (fallback.ir) {
      write("ir.json", `${JSON.stringify(fallback.ir, null, 2)}\n`);
    }
  }

  if (planInputs) {
    write("02-plan-inputs.json", `${JSON.stringify(planInputs, null, 2)}\n`);
  }

  write("MIGRATION_PLAYBOOK.md", renderMigrationPlaybook(source, planInputs));
  write(
    "source.json",
    `${JSON.stringify(
      {
        source,
        target: opts.target ?? DEFAULT_TARGET,
        planInputs,
        createdAt: new Date().toISOString(),
        usedMigrateHelpers,
      },
      null,
      2,
    )}\n`,
  );

  return {
    dossierRoot,
    files: [...written].sort(),
    source,
    usedMigrateHelpers,
  };
}

export function isExpectedMigrationCliError(error: unknown): boolean {
  const message = migrationCliErrorMessage(error);
  return (
    message.startsWith("Usage: agent-native migrate") ||
    message.startsWith("Refusing to emit dossier inside sourceRoot") ||
    message.startsWith("Refusing to write ") ||
    message.startsWith("Could not read migration plan file ")
  );
}

function migrationCliErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function scaffoldOrResumeWorkbench(): Promise<void> {
  console.error(
    [
      "",
      "The legacy migration app surface has been removed.",
      "Use `agent-native code /migrate <source>` for the supported migration workflow.",
      "Use `--emit [dir]` when you want a portable dossier for another coding agent.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

async function createMigrationCodeAgentSession(
  opts: MigrateCliOptions,
): Promise<void> {
  const cwd = process.cwd();
  const source = resolveSourceSpec(opts, cwd);
  if (!source) {
    console.error(migrateUsage());
    process.exit(1);
  }

  const outputRoot = path.resolve(cwd, opts.output ?? DEFAULT_OUTPUT);
  const planInputs = await readMigrationPlanInputs(opts, cwd);
  if (source.sourceRoot) {
    assertOutsideSourceRoot(source.sourceRoot, outputRoot, "outputRoot");
  }

  const run = createCodeAgentRunRecord({
    goalId: "migrate",
    title: defaultRunName(source),
    subtitle: formatSourceForDisplay(source),
    status: "needs-approval",
    phase: "intake",
    needsApproval: true,
    progress: {
      label: "Intake",
      completed: 0,
      total: 1,
      percent: 0,
    },
    cwd,
    metadata: {
      source,
      sourceRoot: source.sourceRoot,
      outputRoot,
      target: opts.target ?? DEFAULT_TARGET,
      planInputs,
    },
  });
  appendCodeAgentTranscriptEvent({
    runId: run.id,
    kind: "user",
    message: `Migrate ${formatSourceForDisplay(source)} to ${opts.target ?? DEFAULT_TARGET}.`,
    metadata: {
      source,
      outputRoot,
      target: opts.target ?? DEFAULT_TARGET,
      planInputs,
    },
  });
  appendCodeAgentTranscriptEvent({
    runId: run.id,
    kind: "status",
    message: "Preparing migration dossier.",
    metadata: { status: "needs-approval", phase: "intake" },
  });
  const artifactRoot = codeAgentRunArtifactsDir(run.id);
  const dossierRoot = path.join(artifactRoot, "migration-dossier");
  const dossier = await emitOwnAgentDossier(
    {
      ...opts,
      emit: true,
      emitDir: dossierRoot,
      target: opts.target ?? DEFAULT_TARGET,
    },
    cwd,
  );

  const updated: CodeAgentRunRecord = {
    ...run,
    progress: {
      label: "Dossier ready; waiting for approval",
      completed: 1,
      total: 2,
      percent: 50,
    },
    artifactRoot,
    details: [
      { label: "Source", value: formatSourceForDisplay(source) },
      { label: "Output", value: outputRoot },
      { label: "Dossier", value: dossierRoot },
      { label: "Resume", value: "agent-native code resume --last" },
      { label: "Attach", value: "agent-native code attach --last" },
    ],
    metadata: {
      ...(run.metadata ?? {}),
      dossierRoot,
      dossierFiles: dossier.files,
      artifactFiles: dossier.files.map((file) => path.join(dossierRoot, file)),
      planInputs,
      usedMigrateHelpers: dossier.usedMigrateHelpers,
      resumeCommand: "agent-native code resume --last",
      attachCommand: "agent-native code attach --last",
      statusCommand: "agent-native code status --last",
      preferredCommand: MIGRATION_SESSION_COMMAND,
    },
    updatedAt: new Date().toISOString(),
  };
  writeCodeAgentRunRecord(updated);
  appendCodeAgentTranscriptEvent({
    runId: run.id,
    kind: "artifact",
    message: "Migration dossier created.",
    metadata: {
      path: dossierRoot,
      files: dossier.files,
      usedMigrateHelpers: dossier.usedMigrateHelpers,
    },
  });
  appendCodeAgentTranscriptEvent({
    runId: run.id,
    kind: "note",
    message:
      "Use the dossier with Codex, Claude Code, Cursor, or another coding agent; no migration agent process has been started by the CLI.",
    metadata: { source: "migration-dossier" },
  });
  appendCodeAgentTranscriptEvent({
    runId: run.id,
    kind: "status",
    message:
      "Migration dossier is ready. Resume the /migrate session from Agent-Native Code when you are ready to approve or continue.",
    metadata: { status: "needs-approval", phase: "intake" },
  });

  console.log(renderCodeAgentMigrationSession(updated, dossier));
}

function printMigrationStatus(opts: MigrateCliOptions): void {
  const last = getLastCodeAgentRunRecord("migrate");
  const runs = listCodeAgentRunRecords("migrate");
  if (last || !opts.appSurface) {
    console.log(renderCodeAgentMigrationStatus(runs));
    return;
  }

  const appDir = resolveWorkbenchDir(opts);
  const seedPath = path.join(appDir, "data", "migration-source.json");
  const seed = readJsonIfExists(seedPath) as {
    sourceKind?: string;
    sourceRoot?: string;
    sourceUrl?: string;
    sourceDescription?: string;
    outputRoot?: string;
    target?: string;
  } | null;
  const artifactRuns = readArtifactRuns(appDir);

  if (!fs.existsSync(appDir)) {
    console.error(`No Migration Workbench found at ${appDir}.`);
    console.error(
      `Create one with: npx @agent-native/core@latest code /migrate <source>`,
    );
    console.error(
      `The direct migrate command is a shortcut into that same Agent-Native Code slash command.`,
    );
    process.exit(1);
  }

  console.log(
    [
      "",
      "Migration Workbench status",
      "",
      `  App:        ${appDir}`,
      `  Seed:       ${fs.existsSync(seedPath) ? seedPath : "not found"}`,
      `  Source:     ${formatSeedSource(seed)}`,
      `  Output:     ${seed?.outputRoot ?? "not set"}`,
      `  Target:     ${seed?.target ?? DEFAULT_TARGET}`,
      `  Artifacts:  ${artifactRuns.length} run${artifactRuns.length === 1 ? "" : "s"}`,
      ...artifactRuns
        .slice(0, 5)
        .map((run) => `    - ${run.id} (${run.phase})`),
      artifactRuns.length > 5 ? `    - ${artifactRuns.length - 5} more...` : "",
      "",
      ...credentialStatusLines(),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function printMigrationStop(_opts: MigrateCliOptions): void {
  console.log(
    [
      "",
      "Agent-Native Code /migrate stop",
      "",
      "The migrate CLI creates resumable session records and artifacts; it does not daemonize a background process yet.",
      "Stop the terminal, Desktop run, or external coding agent that is actively working on the session.",
    ].join("\n"),
  );
}

function printMigrationUi(opts: MigrateCliOptions): void {
  const last = getLastCodeAgentRunRecord("migrate");
  if (last && !opts.appSurface) {
    console.log(renderCodeAgentMigrationUi(last));
    return;
  }

  const appDir = resolveWorkbenchDir(opts);
  console.log(
    [
      "",
      "Migration Workbench UI",
      "",
      `  App: ${appDir}`,
      `  URL: http://localhost:${MIGRATION_DEV_PORT}/`,
      "",
      "Start it with:",
      `  cd ${shellQuote(path.relative(process.cwd(), appDir) || ".")}`,
      "  pnpm install",
      "  pnpm dev",
      "",
      "Deep-link shape:",
      `  http://localhost:${MIGRATION_DEV_PORT}/`,
      "  Pick a run in the Workbench, or ask the app agent to navigate by run ID.",
    ].join("\n"),
  );
}

function printMigrationResume(opts: MigrateCliOptions): void {
  const last = getLastCodeAgentRunRecord("migrate");
  if (last && !opts.appSurface) {
    console.log(renderCodeAgentMigrationResume(last));
    return;
  }

  const appDir = resolveWorkbenchDir(opts);
  const seedPath = path.join(appDir, "data", "migration-source.json");
  const seed = readJsonIfExists(seedPath);
  if (!fs.existsSync(appDir) || !seed) {
    console.error(
      "No resumable Migration Workbench seed found. Run `npx @agent-native/core@latest code /migrate <source>` first.",
    );
    process.exit(1);
  }
  console.log(
    [
      "",
      "Migration Workbench resume",
      "",
      `  App:  ${appDir}`,
      `  Seed: ${seedPath}`,
      "",
      "Continue with:",
      `  cd ${shellQuote(path.relative(process.cwd(), appDir) || ".")}`,
      "  pnpm dev",
      "",
      `Workbench URL: http://localhost:${MIGRATION_DEV_PORT}/`,
    ].join("\n"),
  );
}

function renderWorkbenchReady(args: {
  appDir: string;
  existing: boolean;
  outputRoot: string;
  source: SourceSpec;
}): string {
  const rel = path.relative(process.cwd(), args.appDir) || ".";
  const sourceCommand = formatSourceForCommand(args.source);
  return [
    "",
    args.existing
      ? "Migration Workbench is ready (reused existing app)."
      : "Migration Workbench is ready.",
    "",
    `  Source: ${formatSourceForDisplay(args.source)}`,
    `  Output: ${args.outputRoot}`,
    `  App:    ${args.appDir}`,
    "",
    "Run it:",
    `  cd ${shellQuote(rel)}`,
    "  pnpm install",
    "  pnpm dev",
    "",
    "npx-friendly commands:",
    `  npx @agent-native/core@latest code /migrate ${sourceCommand} --out ${shellQuote(path.relative(process.cwd(), args.outputRoot) || ".")}`,
    `  npx @agent-native/core@latest code /migrate ${sourceCommand} --emit ${shellQuote(defaultDossierDirForDisplay(args.source))}`,
    "",
    "Workbench URL:",
    `  http://localhost:${MIGRATION_DEV_PORT}/`,
    "  If Vite chooses another port, use the URL printed by `pnpm dev`.",
    "",
    "Deep-link shape:",
    `  http://localhost:${MIGRATION_DEV_PORT}/`,
    "  Select the run inside the Workbench, or ask the app agent to open a run by ID.",
    "",
    ...credentialStatusLines(),
    "",
    "The Workbench seed is written to data/migration-source.json. It stores paths and source metadata only, never secret values.",
  ].join("\n");
}

function renderCodeAgentMigrationSession(
  run: CodeAgentRunRecord,
  dossier: EmitDossierResult,
): string {
  return [
    "",
    "Agent-Native Code /migrate session created.",
    "",
    `  Run:     ${run.id}`,
    "  Goal:    /migrate",
    `  Source:  ${run.subtitle ?? "not set"}`,
    `  Output:  ${stringMetadata(run, "outputRoot") ?? "not set"}`,
    `  Dossier: ${stringMetadata(run, "dossierRoot") ?? dossier.dossierRoot}`,
    `  Engine:  ${dossier.usedMigrateHelpers ? "@agent-native/migrate helpers" : "safe local fallback"}`,
    "",
    "Artifacts:",
    ...dossier.files
      .filter((file) =>
        [
          "AGENTS.md",
          "MIGRATION_PLAYBOOK.md",
          "01-assessment.md",
          "ir.json",
          "source.json",
        ].includes(file),
      )
      .map((file) => `  - ${path.join(dossier.dossierRoot, file)}`),
    "",
    "Continue:",
    "  agent-native code attach --last",
    "  agent-native code resume --last",
    "  agent-native code logs --last",
    "  agent-native code status --last",
    "",
    "Desktop:",
    "  Open Agent-Native Code in the left sidebar. This run appears as a /migrate session.",
    "",
    "Use another agent:",
    `  Point Codex, Claude Code, Cursor, or another coding agent at ${shellQuote(dossier.dossierRoot)} and ask it to follow AGENTS.md plus MIGRATION_PLAYBOOK.md.`,
    "",
    "Default surface:",
    "  Migration stays in Agent-Native Code. No hidden app/template was scaffolded.",
    "  The legacy --app-surface detail app has been removed.",
  ].join("\n");
}

function renderCodeAgentMigrationStatus(runs: CodeAgentRunRecord[]): string {
  return [
    "",
    "Agent-Native Code /migrate status",
    "",
    runs.length === 0
      ? "  No /migrate sessions found. Start one with `agent-native code /migrate <source>`."
      : `  ${runs.length} session${runs.length === 1 ? "" : "s"} found.`,
    ...runs.slice(0, 8).map((run) => {
      const output = stringMetadata(run, "outputRoot");
      const dossier = stringMetadata(run, "dossierRoot");
      const progress = run.progress?.label
        ? `    Progress: ${run.progress.label} (${run.progress.completed}/${run.progress.total})`
        : "";
      return [
        `  - ${run.id}`,
        `    Status:  ${run.status}${run.phase ? ` (${run.phase})` : ""}`,
        progress,
        `    Source:  ${run.subtitle ?? "not set"}`,
        output ? `    Output:  ${output}` : "",
        dossier ? `    Dossier: ${dossier}` : "",
        `    Resume:  agent-native code resume ${run.id}`,
      ]
        .filter(Boolean)
        .join("\n");
    }),
    runs.length > 8 ? `  - ${runs.length - 8} more...` : "",
    "",
    "Shortcuts:",
    "  agent-native migrate status --last shows the same Agent-Native Code sessions.",
    "  The legacy --app-surface detail app has been removed.",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderCodeAgentMigrationResume(run: CodeAgentRunRecord): string {
  const dossier = stringMetadata(run, "dossierRoot");
  return [
    "",
    "Agent-Native Code /migrate resume",
    "",
    `  Run:     ${run.id}`,
    `  Status:  ${run.status}${run.phase ? ` (${run.phase})` : ""}`,
    `  Source:  ${run.subtitle ?? "not set"}`,
    dossier ? `  Dossier: ${dossier}` : "",
    "",
    "Continue in the interactive shell:",
    "  agent-native code",
    "",
    "Resume this run directly:",
    `  agent-native code resume ${run.id}`,
    "  agent-native code attach --last",
    "",
    dossier
      ? `Or hand off to another agent by pointing it at ${shellQuote(dossier)}.`
      : "No dossier path is recorded on this run.",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderCodeAgentMigrationUi(run: CodeAgentRunRecord): string {
  return [
    "",
    "Agent-Native Code /migrate UI",
    "",
    `  Run: ${run.id}`,
    "",
    "Open Agent-Native Desktop and choose Agent-Native Code from the left sidebar.",
    "The legacy migration detail app is no longer scaffolded.",
  ].join("\n");
}

function renderEmitResult(result: EmitDossierResult): string {
  return [
    "",
    "Migration agent dossier emitted.",
    "",
    `  Source:  ${formatSourceForDisplay(result.source)}`,
    `  Dossier: ${result.dossierRoot}`,
    `  IR:      ${result.files.includes("ir.json") ? "included" : "not available from this input"}`,
    `  Engine:  ${result.usedMigrateHelpers ? "@agent-native/migrate helpers" : "safe local fallback"}`,
    "",
    "Files:",
    ...result.files.map((file) => `  - ${file}`),
    "",
    "Use with Agent-Native Code/Desktop:",
    `  Point the agent at ${shellQuote(result.dossierRoot)} and ask it to follow AGENTS.md plus MIGRATION_PLAYBOOK.md.`,
    "",
    "Safety:",
    "  The dossier was written outside sourceRoot and contains no secret values.",
  ].join("\n");
}

function migrateUsage(): string {
  return [
    "Usage:",
    "  agent-native code /migrate <source-path-or-url> [--out ../migrated-app]   (preferred)",
    "  agent-native migrate <source-path-or-url> [--out ../migrated-app]         (shortcut)",
    "  agent-native migrate <source> --emit [dossier-dir]",
    '  agent-native migrate --describe "legacy app described in prose" --emit',
    "  agent-native migrate resume --last",
    "  agent-native migrate status --last",
    "  agent-native migrate ui --last",
    "  agent-native migrate stop --last",
    "",
    "Examples:",
    "  npx @agent-native/core@latest code /migrate ./my-next-app --out ../migrated-app",
    "  npx @agent-native/core@latest migrate ./my-next-app --out ../migrated-app",
    '  npx @agent-native/core@latest code /migrate https://example.com --describe "marketing site" --emit ../migration-dossier',
    '  npx @agent-native/core@latest code /migrate --describe "A Rails admin app with reporting dashboards" --emit',
    "",
    "Default:",
    "  Migration is an Agent-Native Code slash command. The legacy hidden migration app has been removed.",
    "",
    "Options:",
    "  --source, --path <path>       Local source path",
    "  --url <url>                  Source URL",
    "  --description, --describe    Source description for any-input migrations",
    "  --emit [dir]                 Emit an own-agent dossier without recording a session",
    "  --out <path>                 Generated output path for the migration session",
    "  --plan-file <path>           Custom migration profile JSON or notes",
    "  --app-surface, --workbench   Removed legacy detail-app flag; prints migration guidance",
    "  --name <name>                Legacy app-surface name (ignored for supported flows)",
    "  --target <name>              Migration target (default: agent-native)",
    "  --plan-only                  Legacy app-surface plan-only seed (ignored for supported flows)",
  ].join("\n");
}

function setSourceOption(opts: MigrateCliOptions, value: string): void {
  opts.source = value;
  if (isProbablyUrl(value)) {
    opts.sourceUrl = value;
  } else {
    opts.sourcePath = value;
  }
}

function hasAnySource(opts: MigrateCliOptions): boolean {
  return Boolean(
    opts.source || opts.sourcePath || opts.sourceUrl || opts.sourceDescription,
  );
}

function resolveSourceSpec(
  opts: MigrateCliOptions,
  cwd = process.cwd(),
): SourceSpec | null {
  if (opts.sourceUrl) {
    return {
      kind: "url",
      value: opts.sourceUrl,
      description: opts.sourceDescription,
    };
  }
  if (opts.sourcePath) {
    return {
      kind: "path",
      value: opts.sourcePath,
      sourceRoot: path.resolve(cwd, opts.sourcePath),
      description: opts.sourceDescription,
    };
  }
  if (opts.source) {
    if (isProbablyUrl(opts.source)) {
      return {
        kind: "url",
        value: opts.source,
        description: opts.sourceDescription,
      };
    }
    return {
      kind: "path",
      value: opts.source,
      sourceRoot: path.resolve(cwd, opts.source),
      description: opts.sourceDescription,
    };
  }
  if (opts.sourceDescription) {
    return {
      kind: "description",
      value: opts.sourceDescription,
      description: opts.sourceDescription,
    };
  }
  return null;
}

function resolveDossierRoot(
  opts: MigrateCliOptions,
  source: SourceSpec,
  cwd: string,
): string {
  if (opts.emitDir) return path.resolve(cwd, opts.emitDir);
  return defaultDossierRoot(source, cwd);
}

async function readMigrationPlanInputs(
  opts: MigrateCliOptions,
  cwd: string,
): Promise<unknown | null> {
  if (!opts.planFile) return null;
  const filePath = path.resolve(cwd, opts.planFile);
  let text = "";
  try {
    text = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    throw new Error(
      `Could not read migration plan file ${filePath}: ${migrationCliErrorMessage(error)}`,
    );
  }

  try {
    const migratePackage = "@agent-native/migrate";
    const migrate = (await import(migratePackage)) as {
      parseMigrationPlanInputsText?: (
        text: string,
        sourceLabel?: string,
      ) => unknown;
    };
    const parsed = migrate.parseMigrationPlanInputsText?.(
      text,
      path.basename(filePath),
    );
    if (migrate.parseMigrationPlanInputsText) return parsed ?? null;
  } catch {
    // The dossier writer can run without the migrate package being bundled.
  }

  try {
    const parsed = JSON.parse(text);
    return isRecognizedPlanInputJson(parsed) ? parsed : null;
  } catch {
    return inferMigrationPlanInputsFromText(text, path.basename(filePath));
  }
}

function isRecognizedPlanInputJson(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return [
    "summary",
    "notes",
    "aem",
    "builder",
    "headless",
    "jquery",
    "verification",
  ].some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function inferMigrationPlanInputsFromText(
  text: string,
  sourceLabel: string,
): Record<string, unknown> {
  const lower = text.toLowerCase();
  const planInputs: Record<string, unknown> = {
    summary: firstMeaningfulLine(text) ?? sourceLabel,
    notes: text.trim(),
  };
  const mentionsAem =
    /\baem\b|adobe experience manager|content fragment|experience fragment|sling|htl|jcr|vault|dam/.test(
      lower,
    );
  const mentionsBuilder = /\bbuilder\b|fusion|publish|visual editor/.test(
    lower,
  );
  const mentionsHeadless = /akeneo|akineo|headless|dynamic pages?/.test(lower);
  const mentionsJQuery = /\bjquery\b|\$\(|clientlib/.test(lower);

  if (mentionsAem) {
    planInputs.aem = {
      modes: ["enterprise"],
      contentFragmentPolicy: mentionsHeadless ? "headless" : "manual",
      experienceFragmentPolicy: mentionsBuilder
        ? "builder-section"
        : "react-component",
      componentPolicy: mentionsBuilder
        ? "builder-registered-component"
        : "react-component",
    };
  }
  if (mentionsBuilder) {
    planInputs.builder = {
      enabled: true,
      componentRegistration: "register",
      routeOwnership: [
        {
          pattern: "static/low-change pages",
          owner: "builder-page",
          notes:
            "Use Builder for static or low-change public pages that benefit from visual management.",
        },
      ],
    };
  }
  if (mentionsHeadless) {
    planInputs.headless = {
      provider:
        lower.includes("akeneo") || lower.includes("akineo")
          ? "Akeneo"
          : "headless",
      routePatterns: ["dynamic pages"],
    };
    const builder = planInputs.builder as
      | { routeOwnership?: Array<Record<string, string>> }
      | undefined;
    if (builder) {
      builder.routeOwnership = [
        ...(builder.routeOwnership ?? []),
        {
          pattern: "dynamic pages",
          owner: "headless",
          notes:
            "Route dynamic pages through the approved headless source instead of treating Builder as a content dump.",
        },
      ];
    }
  }
  if (mentionsJQuery) {
    planInputs.jquery = { policy: "rewrite" };
  }
  return planInputs;
}

function firstMeaningfulLine(text: string): string | undefined {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean)
    ?.slice(0, 140);
}

function defaultDossierRoot(source: SourceSpec, cwd: string): string {
  if (source.sourceRoot) {
    return path.resolve(
      path.dirname(source.sourceRoot),
      `${path.basename(source.sourceRoot)}-migration-dossier`,
    );
  }
  return path.resolve(cwd, DEFAULT_DOSSIER_DIR);
}

function defaultDossierDirForDisplay(source: SourceSpec): string {
  if (source.sourceRoot) {
    return `../${path.basename(source.sourceRoot)}-migration-dossier`;
  }
  return DEFAULT_DOSSIER_DIR;
}

function assertOutsideSourceRoot(
  sourceRoot: string,
  targetPath: string,
  label: string,
): void {
  if (isInsideOrSame(sourceRoot, targetPath)) {
    throw new Error(
      `Refusing to write ${label} inside sourceRoot (${sourceRoot}). Choose a path outside the source project.`,
    );
  }
}

function isInsideOrSame(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function writeAssessmentWithMigrateHelpers(args: {
  source: SourceSpec;
  dossierRoot: string;
  target: string;
  write(relativePath: string, content: string): void;
}): Promise<boolean> {
  try {
    const migratePackage = "@agent-native/migrate";
    const migrate = (await import(migratePackage)) as any;
    const adapter = migrate.nextjsSourceAdapter;

    if (
      args.source.sourceRoot &&
      fs.existsSync(args.source.sourceRoot) &&
      adapter?.introspect &&
      migrate.createMigrationRun &&
      migrate.discoverMigration &&
      migrate.artifactPaths
    ) {
      if (adapter.detect) {
        const detected = await adapter.detect(args.source.sourceRoot);
        if (!detected) return false;
      }

      const artifactRoot = path.join(args.dossierRoot, ".migrate-artifacts");
      const outputRoot = path.join(args.dossierRoot, "generated-output");
      assertOutsideSourceRoot(
        args.source.sourceRoot,
        artifactRoot,
        "artifacts",
      );
      assertOutsideSourceRoot(args.source.sourceRoot, outputRoot, "outputRoot");

      const run = await migrate.createMigrationRun({
        sourceRoot: args.source.sourceRoot,
        outputRoot,
        artifactRoot,
        target: args.target,
        id: "dossier",
      });
      const result = await migrate.discoverMigration(run, adapter);
      const artifacts = migrate.artifactPaths(result.run);
      args.write(
        "01-assessment.md",
        fs.readFileSync(result.assessmentPath, "utf-8"),
      );
      if (fs.existsSync(artifacts.irPath)) {
        args.write("ir.json", fs.readFileSync(artifacts.irPath, "utf-8"));
      }
      return true;
    }

    if (!args.source.sourceRoot && migrate.createSkeletonProjectIR) {
      const ir = migrate.createSkeletonProjectIR({
        sourceRoot: args.source.value,
        inputKind: args.source.kind,
        inputDescription: args.source.description ?? args.source.value,
      }) as ProjectIRLike;
      args.write("01-assessment.md", renderLocalAssessment(args.source, ir));
      args.write("ir.json", `${JSON.stringify(ir, null, 2)}\n`);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function buildFallbackAssessment(source: SourceSpec): {
  assessment: string;
  ir?: ProjectIRLike;
} {
  if (source.sourceRoot && fs.existsSync(source.sourceRoot)) {
    const ir = createLocalProjectIr(source.sourceRoot);
    return { assessment: renderLocalAssessment(source, ir), ir };
  }
  return { assessment: renderNonPathAssessment(source) };
}

function createLocalProjectIr(sourceRoot: string): ProjectIRLike {
  const files = walkSourceFiles(sourceRoot);
  const packageJson = readJsonIfExists(
    path.join(sourceRoot, "package.json"),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null;
  const deps = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };
  const framework =
    deps.next ||
    hasAnyFile(sourceRoot, [
      "next.config.js",
      "next.config.mjs",
      "next.config.ts",
    ])
      ? "nextjs"
      : deps.react
        ? "react"
        : "unknown";
  const routes = files
    .map((file) => routeFromFile(file))
    .filter((route): route is ProjectIRLike["site"]["routes"][number] =>
      Boolean(route),
    )
    .sort((a, b) => a.path.localeCompare(b.path));
  const codeFiles = files.filter((file) => /\.(ts|tsx|js|jsx)$/.test(file));
  const behavior: ProjectIRLike["behavior"] = {
    apiEndpoints: [],
    dataStores: [],
    llmCalls: [],
    clientState: [],
    auth: [],
    jobs: [],
  };

  for (const file of codeFiles) {
    const text = readSmallText(path.join(sourceRoot, file));
    if (!text) continue;
    if (
      file.startsWith("pages/api/") ||
      /(^|\/)api\/.*\/route\.[tj]sx?$/.test(file)
    ) {
      behavior.apiEndpoints.push({
        id: stableId(file),
        path: apiPathFromFile(file),
        method: inferHttpMethod(text),
        filePath: file,
        recommendedRecipe: "api-routes-to-actions",
      });
    }
    if (/\b(useState|useReducer|localStorage|sessionStorage)\b/.test(text)) {
      behavior.clientState.push({
        id: stableId(`${file}:state`),
        filePath: file,
        reason:
          "Review for important UI state that should move into application_state.",
      });
    }
    if (
      /\b(openai|anthropic|generateText|streamText|chat\.completions|messages\.create)\b/i.test(
        text,
      )
    ) {
      behavior.llmCalls.push({
        id: stableId(`${file}:llm`),
        filePath: file,
        provider: inferLlmProvider(text),
      });
    }
    if (
      /\b(drizzle|prisma|postgres|supabase|mysql|sqlite|mongoose)\b/i.test(text)
    ) {
      behavior.dataStores.push({
        id: stableId(`${file}:data`),
        name: path.basename(file),
        filePath: file,
        kind: "database",
      });
    }
    if (/\b(next-auth|better-auth|auth0|clerk|supabase\.auth)\b/i.test(text)) {
      behavior.auth.push({
        id: stableId(`${file}:auth`),
        filePath: file,
        provider: inferAuthProvider(text),
      });
    }
    if (
      /\b(cron|schedule|queue|inngest|trigger\.dev|setInterval)\b/i.test(text)
    ) {
      behavior.jobs.push({
        id: stableId(`${file}:job`),
        filePath: file,
        kind: "scheduled-or-queued",
      });
    }
  }

  return {
    site: {
      framework,
      sourceRoot,
      routes,
      redirects: [],
      metadata: {
        routeCount: routes.length,
        fileCount: files.length,
        packageManager: detectPackageManager(sourceRoot),
      },
    },
    components: {
      components: files
        .filter(
          (file) =>
            /(^|\/)(components|ui)\//.test(file) &&
            /\.(ts|tsx|js|jsx)$/.test(file),
        )
        .sort()
        .map((file) => ({
          id: stableId(file),
          name: componentName(file),
          filePath: file,
          usedByRoutes: [],
        })),
      designTokens: {},
    },
    content: {
      models: [],
      assets: files
        .filter((file) =>
          /\.(png|jpe?g|webp|gif|svg|avif|pdf|mp4|webm)$/i.test(file),
        )
        .sort()
        .map((file) => ({
          id: stableId(file),
          path: file,
          type: path.extname(file).slice(1).toLowerCase() || "unknown",
        })),
    },
    behavior,
  };
}

function renderLocalAssessment(source: SourceSpec, ir: ProjectIRLike): string {
  return `# Migration Assessment

Source type: \`${source.kind}\`
Source: \`${formatSourceForDisplay(source)}\`
${source.description ? `Description: ${source.description}\n` : ""}
Target: \`${DEFAULT_TARGET}\`

## Inventory

- Framework: ${ir.site.framework}
- Routes: ${ir.site.routes.length}
- Components: ${ir.components.components.length}
- API endpoints: ${ir.behavior.apiEndpoints.length}
- Data stores: ${ir.behavior.dataStores.length}
- LLM calls: ${ir.behavior.llmCalls.length}
- Client state hotspots: ${ir.behavior.clientState.length}
- Auth hotspots: ${ir.behavior.auth.length}
- Jobs: ${ir.behavior.jobs.length}
- Assets: ${ir.content.assets.length}

## Routes

${ir.site.routes.map((route) => `- \`${route.path}\` (${route.kind}) from \`${route.filePath}\``).join("\n") || "- No routes detected."}

## Agent-Native Focus Areas

- Convert API routes and server mutations into actions unless they are uploads, webhooks, OAuth callbacks, or streams.
- Move app-owned state into SQL with Drizzle and expose reads/writes through actions.
- Delegate all AI work to the agent chat instead of calling model APIs directly from UI code.
- Expose important navigation and selection state through application_state.
- Keep public pages server-rendered and logged-in workflows inside the persistent app shell.
`;
}

function renderNonPathAssessment(source: SourceSpec): string {
  return `# Migration Assessment

Source type: \`${source.kind}\`
Source: ${source.kind === "url" ? source.value : "provided description"}
${source.description && source.kind !== "description" ? `Description: ${source.description}\n` : ""}
${source.kind === "description" ? `Description: ${source.value}\n` : ""}
Target: \`${DEFAULT_TARGET}\`

## Inventory

No local source path was provided, so this dossier does not include file-level IR. Use the URL or description as the intake brief, then let an Agent-Native Code or Desktop session inspect the real source before writing output.

## Agent-Native Focus Areas

- Identify public pages, logged-in workflows, API endpoints, data ownership, auth, jobs, and direct LLM calls.
- Convert operations into actions and keep application data in SQL.
- Generate output outside the original source tree.
- Verify claims with deterministic checks or explicit human review notes.
`;
}

function renderDossierAgentsMd(
  source: SourceSpec,
  templateAgents: string | null,
  planInputs: unknown | null,
): string {
  return `# Migration Dossier Agent Instructions

You are migrating an existing application to agent-native.

## Source

- Type: ${source.kind}
- Value: ${formatSourceForDisplay(source)}
${source.description ? `- Description: ${source.description}\n` : ""}
## Hard Rules

- Never write generated files inside the sourceRoot.
- Treat source as read-only unless the user explicitly asks for source edits.
- Put generated output in a separate directory.
- Keep app-owned data in SQL, expose operations as actions, and route AI work through the agent chat.
- Use 01-assessment.md and ir.json when present. If they are incomplete, update the assessment before implementation.
- Record manual gaps and verification evidence. Do not present a migration as complete without checks.
${planInputs ? "- Treat `02-plan-inputs.json` as binding planning input. Do not approve output writes until the generated task list covers it.\n" : ""}

## Files In This Dossier

- \`MIGRATION_PLAYBOOK.md\` - ordered workflow for Agent-Native Code/Desktop.
- \`01-assessment.md\` - initial source assessment.
- \`02-plan-inputs.json\` - custom route ownership, AEM, Builder, jQuery, or verification profile when present.
- \`ir.json\` - source inventory when available.
- \`.agents/skills/migration*/SKILL.md\` - extra instruction packs when available from the migration goal surface.

${templateAgents ? `## Migration Goal Surface Instructions\n\n${templateAgents.trim()}\n` : ""}
`;
}

function renderMigrationPlaybook(
  source: SourceSpec,
  planInputs: unknown | null,
): string {
  return `# Migration Playbook

## 1. Intake Any Input

Start from the available input: a local source path, a URL, or a prose description. If this dossier has \`ir.json\`, use it as a first inventory. If not, inspect the real source before planning implementation.

Source: ${formatSourceForDisplay(source)}

## 2. Build The Migration Map

Classify routes, public pages, logged-in app surfaces, API endpoints, data stores, auth, jobs, client state, assets, and direct LLM calls. Update \`01-assessment.md\` when you learn more.

${planInputs ? "Use `02-plan-inputs.json` as the customer-specific migration profile. Apply its route ownership, AEM evidence, Builder registration, headless, jQuery, and verification constraints before approving output writes.\n" : ""}

## 3. Apply Agent-Native Rules

- Actions are the single source of truth for operations.
- Data lives in SQL through Drizzle.
- AI work goes through the agent chat.
- Important UI state is mirrored through \`application_state\`.
- Public/SEO pages server-render; logged-in workflows use the persistent app shell.
- Ownable resources use sharing and access helpers.

## 4. Work In Samples

Migrate one representative route or workflow first. Verify it, tune the pattern, then sweep similar surfaces. Keep generated output outside the original source tree.

## 5. Verify

Run typecheck/build plus route, action, and data checks that fit the migrated app. Capture unresolved gaps in a report before handing off.

## 6. Use With Agent-Native Code Or Desktop

Point Codex, Claude Code, another code agent, or Agent-Native Desktop at this dossier directory. Ask it to follow \`AGENTS.md\`, then implement the plan in a separate output project.
`;
}

function copyMigrationSkills(
  templateDir: string | undefined,
  dossierRoot: string,
): string[] {
  if (!templateDir) return [];
  const skillsRoot = path.join(templateDir, ".agents", "skills");
  if (!fs.existsSync(skillsRoot)) return [];
  const copied: string[] = [];
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("migration")) continue;
    const src = path.join(skillsRoot, entry.name, "SKILL.md");
    if (!fs.existsSync(src)) continue;
    const relative = path.join(".agents", "skills", entry.name, "SKILL.md");
    const dest = path.join(dossierRoot, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied.push(relative);
  }
  return copied;
}

function findMigrationTemplateDir(): string | undefined {
  const starts = [__dirname, process.cwd()];
  for (const start of starts) {
    let dir = path.resolve(start);
    for (let i = 0; i < 12; i++) {
      for (const candidate of [
        path.join(dir, "templates", "migration"),
        path.join(dir, "src", "templates", "migration"),
      ]) {
        if (fs.existsSync(path.join(candidate, "AGENTS.md"))) {
          return candidate;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return undefined;
}

function resolveWorkbenchDir(opts: MigrateCliOptions): string {
  if (opts.workbench) return path.resolve(process.cwd(), opts.workbench);
  return resolveScaffoldedAppDir(
    process.cwd(),
    opts.appName ?? DEFAULT_APP_NAME,
  );
}

function resolveScaffoldedAppDir(cwd: string, appName: string): string {
  const workspaceAppDir = path.join(cwd, "apps", appName);
  if (fs.existsSync(workspaceAppDir)) return workspaceAppDir;
  return path.join(cwd, appName);
}

function sourceSeedPayload(source: SourceSpec): Record<string, string> {
  return {
    kind: source.kind,
    value: source.value,
    ...(source.sourceRoot ? { sourceRoot: source.sourceRoot } : {}),
    ...(source.description ? { description: source.description } : {}),
  };
}

function defaultRunName(source: SourceSpec): string {
  if (source.sourceRoot) {
    return `Migration from ${path.basename(source.sourceRoot)}`;
  }
  if (source.kind === "url") {
    return `Migration from ${source.value}`;
  }
  return "Migration from described source";
}

function stringMetadata(
  run: CodeAgentRunRecord,
  key: string,
): string | undefined {
  const value = run.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function formatSeedSource(
  seed: {
    sourceKind?: string;
    sourceRoot?: string;
    sourceUrl?: string;
    sourceDescription?: string;
  } | null,
): string {
  if (!seed) return "not set";
  if (seed.sourceRoot) return seed.sourceRoot;
  if (seed.sourceUrl) return seed.sourceUrl;
  if (seed.sourceDescription) return seed.sourceDescription;
  return seed.sourceKind ?? "not set";
}

function readArtifactRuns(
  appDir: string,
): Array<{ id: string; phase: string }> {
  const runsRoot = path.join(appDir, "data", "migration-runs");
  if (!fs.existsSync(runsRoot)) return [];
  return fs
    .readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const run = readJsonIfExists(
        path.join(runsRoot, entry.name, "run.json"),
      ) as { id?: string; phase?: string; updatedAt?: string } | null;
      return {
        id: run?.id ?? entry.name,
        phase: run?.phase ?? "unknown",
        updatedAt: run?.updatedAt ?? "",
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function credentialStatusLines(): string[] {
  const configured = MODEL_CREDENTIAL_ENV_NAMES.filter((key) =>
    Boolean(process.env[key]),
  );
  if (configured.length > 0) {
    return [
      `Headless credentials: detected ${configured.join(", ")} in this shell.`,
      "Secret values were not read or stored.",
    ];
  }
  return [
    `Headless credentials: none of ${MODEL_CREDENTIAL_ENV_NAMES.join(", ")} are set in this shell.`,
    "Set credentials in the Workbench app env or use Desktop/Agent-Native Code credentials; the migrate CLI will not store them.",
  ];
}

function walkSourceFiles(root: string): string[] {
  const out: string[] = [];
  const ignored = new Set([
    ".git",
    ".next",
    ".turbo",
    "node_modules",
    "dist",
    "build",
    ".output",
    "coverage",
  ]);
  const visit = (dir: string) => {
    if (out.length > 5000) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        out.push(toPosix(path.relative(root, absolute)));
      }
    }
  };
  visit(root);
  return out.sort();
}

function routeFromFile(
  relativePath: string,
): ProjectIRLike["site"]["routes"][number] | null {
  const normalized = toPosix(relativePath);
  const router = normalized.startsWith("app/") ? "next-app" : "next-pages";
  const isPageRoute =
    normalized.startsWith("pages/") &&
    /\.(ts|tsx|js|jsx|md|mdx)$/.test(normalized) &&
    !normalized.startsWith("pages/_app.") &&
    !normalized.startsWith("pages/_document.");
  const isAppRoute =
    normalized.startsWith("app/") &&
    /\/(page|route)\.(ts|tsx|js|jsx|md|mdx)$/.test(normalized);
  if (!isPageRoute && !isAppRoute) return null;

  const isApi =
    normalized.startsWith("pages/api/") ||
    /(^|\/)api\/.*\/route\.[tj]sx?$/.test(normalized) ||
    normalized.endsWith("/route.ts") ||
    normalized.endsWith("/route.tsx") ||
    normalized.endsWith("/route.js") ||
    normalized.endsWith("/route.jsx");

  let routePath = normalized;
  if (router === "next-app") {
    routePath = routePath
      .replace(/^app\//, "")
      .replace(/(^|\/)(page|route)\.(ts|tsx|js|jsx|md|mdx)$/, "");
  } else {
    routePath = routePath
      .replace(/^pages\//, "")
      .replace(/\.(ts|tsx|js|jsx|md|mdx)$/, "");
  }

  routePath = routePath
    .replace(/\/index$/, "")
    .replace(/^index$/, "")
    .replace(/^\(.*?\)\//, "")
    .replace(/\[(\.\.\.)?([^\]]+)\]/g, (_, dots: string, name: string) =>
      dots ? `*${name}` : `:${name}`,
    );
  const publicPath = routePath ? `/${routePath}` : "/";
  const pathValue = publicPath === "/api" && isApi ? "/api/*" : publicPath;
  const kind = isApi
    ? "api"
    : pathValue === "/"
      ? "landing"
      : pathValue.includes("docs")
        ? "docs"
        : pathValue.includes("pricing") || pathValue.includes("blog")
          ? "marketing"
          : "app";
  return {
    id: stableId(normalized),
    path: pathValue,
    filePath: normalized,
    router,
    kind,
    dynamic: pathValue.includes(":") || pathValue.includes("*"),
    public: kind !== "app" && kind !== "api",
    notes: isApi
      ? [
          "Convert to an action unless it uploads, streams, handles OAuth, or receives webhooks.",
        ]
      : [],
  };
}

function apiPathFromFile(file: string): string {
  let value = file
    .replace(/^pages\/api\//, "/api/")
    .replace(/^app\//, "/")
    .replace(/\/route\.[tj]sx?$/, "")
    .replace(/\.[tj]sx?$/, "");
  value = value
    .replace(/\/index$/, "")
    .replace(/\[(\.\.\.)?([^\]]+)\]/g, (_, dots: string, name: string) =>
      dots ? `*${name}` : `:${name}`,
    );
  return value || "/api";
}

function inferHttpMethod(text: string): string {
  const exported = text.match(
    /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/,
  );
  if (exported) return exported[1];
  const method = text.match(
    /method\s*[:=]\s*["'](GET|POST|PUT|PATCH|DELETE)["']/i,
  );
  return method?.[1]?.toUpperCase() ?? "GET";
}

function inferLlmProvider(text: string): string {
  if (/anthropic/i.test(text)) return "anthropic";
  if (/openai/i.test(text)) return "openai";
  return "unknown";
}

function inferAuthProvider(text: string): string {
  if (/better-auth/i.test(text)) return "better-auth";
  if (/next-auth/i.test(text)) return "next-auth";
  if (/clerk/i.test(text)) return "clerk";
  if (/auth0/i.test(text)) return "auth0";
  if (/supabase\.auth/i.test(text)) return "supabase";
  return "unknown";
}

function componentName(file: string): string {
  const base = path.basename(file).replace(/\.(ts|tsx|js|jsx)$/, "");
  return base
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
}

function detectPackageManager(sourceRoot: string): string {
  if (fs.existsSync(path.join(sourceRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(sourceRoot, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(sourceRoot, "package-lock.json"))) return "npm";
  return "unknown";
}

function readSmallText(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 256_000) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function readJsonIfExists(filePath: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function readTextIfExists(filePath: string | undefined): string | null {
  if (!filePath) return null;
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function hasAnyFile(root: string, files: string[]): boolean {
  return files.some((file) => fs.existsSync(path.join(root, file)));
}

function stableId(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function isProbablyUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function formatSourceForDisplay(source: SourceSpec): string {
  if (source.sourceRoot) return source.sourceRoot;
  return source.value;
}

function formatSourceForCommand(source: SourceSpec): string {
  if (source.kind === "description") {
    return `--describe ${shellQuote(source.value)}`;
  }
  const base = shellQuote(source.value);
  if (source.description) {
    return `${base} --describe ${shellQuote(source.description)}`;
  }
  return base;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
