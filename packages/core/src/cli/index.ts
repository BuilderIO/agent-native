#!/usr/bin/env node

import { execSync, spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import * as Sentry from "@sentry/node";

// Resolve version once at module scope — used by both --version and --help
let _version = "unknown";
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // dist/cli/index.js → ../../package.json
  const pkg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8"),
  );
  _version = pkg.version;
} catch {}

/**
 * Build a redacted "command" tag from process.argv. Strips the value that
 * follows any --token / --key / --secret / --password / --api-key flag so
 * we don't ship developer secrets to Sentry alongside the crash.
 *
 * Supports both `--token foo` (separate argv item) and `--token=foo`
 * (combined argv item) forms.
 */
const SECRET_FLAG_RE = /^--?(token|key|secret|password|api[_-]?key)$/i;
const SECRET_FLAG_EQ_RE =
  /^(--?(token|key|secret|password|api[_-]?key))=(.*)$/i;
function buildRedactedCommandTag(argv: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (SECRET_FLAG_RE.test(a)) {
      out.push(a);
      // Consume the next argv item as the secret value
      if (i + 1 < argv.length) {
        out.push("<redacted>");
        i++;
      }
      continue;
    }
    const m = a.match(SECRET_FLAG_EQ_RE);
    if (m) {
      out.push(`${m[1]}=<redacted>`);
      continue;
    }
    out.push(a);
  }
  return out.join(" ");
}

Sentry.init({
  dsn: "https://0d384e9eff2f6542af468b92769f2f5b@o117565.ingest.us.sentry.io/4511270386466816",
  release: `agent-native-cli@${_version}`,
  // sendDefaultPii MUST stay false — the CLI runs in third-party developer
  // environments and we never want to ship request headers, IPs, cookies,
  // or process env contents to Sentry without explicit consent.
  sendDefaultPii: false,
  beforeSend(event) {
    // Drop expected user-input rejections (validateRepoName, etc.) so they
    // don't pollute Sentry with non-bug noise.
    const exceptionType = event.exception?.values?.[0]?.type;
    if (
      exceptionType === "ValidationError" ||
      event.tags?.handled === "validation"
    ) {
      return null;
    }

    // Defense in depth: strip any sensitive fields that may have been
    // attached to the event despite sendDefaultPii: false (e.g. integrations
    // that capture request metadata).
    if (event.request) {
      if (event.request.headers) {
        const headers = event.request.headers as Record<string, string>;
        for (const k of Object.keys(headers)) {
          const lk = k.toLowerCase();
          if (
            lk === "cookie" ||
            lk === "authorization" ||
            lk === "set-cookie" ||
            lk === "proxy-authorization"
          ) {
            delete headers[k];
          }
        }
      }
      // Cookies are also exposed via event.request.cookies as a separate field
      delete (event.request as Record<string, unknown>).cookies;
    }
    // Keep user info that was explicitly set via Sentry.setUser (id/email)
    // so we can attribute crashes back to the operator. Always strip
    // ip_address — the CLI runs on third-party machines and the IP is auto-
    // collected without consent. If only auto-collected fields remain,
    // drop the user object entirely.
    if (event.user) {
      const user = event.user as Record<string, unknown>;
      delete user.ip_address;
      const hasIdentity =
        typeof user.id === "string" ||
        typeof user.email === "string" ||
        typeof user.username === "string";
      if (!hasIdentity) {
        delete event.user;
      }
    }
    // Sentry's contexts can carry process.env snapshots — strip env-shaped
    // contexts so we don't leak deployment secrets.
    if (event.contexts && typeof event.contexts === "object") {
      delete (event.contexts as Record<string, unknown>).runtime_env;
    }

    event.tags = {
      ...event.tags,
      // Build the command tag from process.argv with secrets redacted so
      // `agent-native ... --token foo` doesn't leak `foo` to Sentry.
      command: buildRedactedCommandTag(process.argv.slice(2)),
      subcommand: process.argv[2] ?? "none",
      nodeVersion: process.version,
      platform: process.platform,
    };
    return event;
  },
});

// Identify the operator so future CLI errors carry spaceId / builderUserId
// that we can map back to a real Builder user. The CLI doesn't have a real
// email today — only the env-managed identifiers from the workspace's .env.
{
  const builderUserId = process.env.BUILDER_USER_ID;
  const builderPublicKey = process.env.BUILDER_PUBLIC_KEY;
  if (builderUserId) {
    Sentry.setUser({ id: builderUserId });
    Sentry.setTag("builderUserId", builderUserId);
  }
  if (builderPublicKey) {
    Sentry.setTag("spaceId", builderPublicKey);
  }
}

const FEEDBACK_URL =
  "https://forms.agent-native.com/f/agent-native-feedback/_16ewV?source=cli";
const BUGS_URL = "https://github.com/BuilderIO/agent-native/issues";

const command = process.argv[2];
// Filter out bare "--" separators that pnpm inserts between its args and script args
const args = process.argv.slice(3).filter((a) => a !== "--");

function parseScaffoldArgs(argv: string[]): {
  name?: string;
  template?: string;
  standalone: boolean;
} {
  let name: string | undefined;
  let template: string | undefined;
  let standalone = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--template" && argv[i + 1]) {
      template = argv[++i];
    } else if (arg.startsWith("--template=")) {
      template = arg.slice("--template=".length);
    } else if (arg === "--standalone") {
      standalone = true;
    } else if (!arg.startsWith("-") && !name) {
      name = arg;
    }
  }

  return { name, template, standalone };
}

// Track CLI usage (best-effort, non-blocking)
function trackCli(event: string, props?: Record<string, unknown>): void {
  try {
    import("../tracking/registry.js").then((m) => {
      m.track(event, { command, ...props });
    });
    import("../tracking/providers.js").then((m) =>
      m.registerBuiltinProviders(),
    );
  } catch {}
}

// Global error handler — show feedback link on unhandled crashes
process.on("uncaughtException", (err) => {
  console.error(`\n  Unexpected error: ${err.message}\n`);
  console.error(`  Report this bug: ${BUGS_URL}`);
  console.error(`  Send feedback:   ${FEEDBACK_URL}\n`);
  trackCli("cli.crash", { error: err.message });
  Sentry.captureException(err);
  Sentry.flush(2000).finally(() => process.exit(1));
});

process.on("unhandledRejection", (reason: any) => {
  console.error(`\n  Unhandled error: ${reason?.message ?? reason}\n`);
  console.error(`  Report this bug: ${BUGS_URL}`);
  console.error(`  Send feedback:   ${FEEDBACK_URL}\n`);
  trackCli("cli.crash", { error: reason?.message ?? String(reason) });
  Sentry.captureException(reason);
  Sentry.flush(2000).finally(() => process.exit(1));
});

function findViteBin(): string {
  // Look for vite in node_modules/.bin
  const localVite = path.resolve("node_modules/.bin/vite");
  if (fs.existsSync(localVite)) return localVite;
  return "vite"; // fallback to PATH
}

function findTsxBin(): string {
  const localTsx = path.resolve("node_modules/.bin/tsx");
  if (fs.existsSync(localTsx)) return localTsx;
  return "tsx";
}

function findReactRouterBin(): string {
  const localBin = path.resolve("node_modules/.bin/react-router");
  if (fs.existsSync(localBin)) return localBin;
  return "react-router";
}

/** Check if the project uses React Router framework mode (has react-router.config.ts) */
function isReactRouterFramework(): boolean {
  return (
    fs.existsSync(path.resolve("react-router.config.ts")) ||
    fs.existsSync(path.resolve("react-router.config.js"))
  );
}

function isWorkspaceRoot(): boolean {
  const pkgPath = path.resolve("package.json");
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return (
      typeof pkg?.["agent-native"]?.workspaceCore === "string" &&
      fs.existsSync(path.resolve("apps"))
    );
  } catch {
    return false;
  }
}

function run(
  cmd: string,
  cmdArgs: string[],
  opts?: { stdio?: "inherit" | "pipe" },
) {
  const child = spawn(cmd, cmdArgs, {
    stdio: opts?.stdio ?? "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  // Forward signals to child so Cmd+C doesn't leave zombie processes holding ports
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      child.kill(sig);
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        process.exit(1);
      }, 5000).unref();
    });
  }
  return child;
}

/**
 * Walk up from `cwd` and try to figure out which template / app this build
 * is running for. We look for two patterns:
 *
 *   - `templates/<name>/...` — building inside the framework monorepo
 *   - `apps/<name>/...`      — building inside a scaffolded workspace
 *
 * Both, neither, or one may match. Used purely as Sentry tags so we can
 * filter the noisy "Command failed: react-router build" issues by template.
 */
function inferBuildContext(cwd: string): {
  template?: string;
  app?: string;
} {
  const segs = cwd.split(path.sep);
  let template: string | undefined;
  let app: string | undefined;
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] === "templates" && segs[i + 1] && !segs[i + 1].startsWith("."))
      template = segs[i + 1];
    if (segs[i] === "apps" && segs[i + 1] && !segs[i + 1].startsWith("."))
      app = segs[i + 1];
  }
  return { template, app };
}

/**
 * Run a build subcommand, streaming its stdout/stderr to the user's terminal
 * in real time while also capturing bounded tails for Sentry. On non-zero
 * exit we report a structured event (template, app, exit code, stderr/stdout
 * tails) and exit with the child's code. We deliberately do NOT throw — the
 * global uncaughtException handler would re-capture with a generic
 * "Error: Command failed" title, collapsing every template's failure into
 * one issue (which is exactly what we're trying to fix here).
 */
function runBuildStep(
  cmd: string,
  cmdArgs: string[],
  opts: { label: string; env?: NodeJS.ProcessEnv },
): Promise<void> {
  return new Promise<void>((resolve) => {
    const STDERR_TAIL_BYTES = 8000;
    const STDOUT_TAIL_BYTES = 4000;
    let stderrBuf = "";
    let stdoutBuf = "";

    const child = spawn(cmd, cmdArgs, {
      stdio: ["inherit", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: opts.env ?? process.env,
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      const next = stdoutBuf + chunk.toString("utf-8");
      stdoutBuf =
        next.length > STDOUT_TAIL_BYTES ? next.slice(-STDOUT_TAIL_BYTES) : next;
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      const next = stderrBuf + chunk.toString("utf-8");
      stderrBuf =
        next.length > STDERR_TAIL_BYTES ? next.slice(-STDERR_TAIL_BYTES) : next;
    });

    child.on("error", (err) => {
      // Failure to spawn (ENOENT, etc.).
      const cwd = process.cwd();
      const { template, app } = inferBuildContext(cwd);
      Sentry.captureException(err, {
        tags: {
          buildStep: opts.label,
          ...(template ? { template } : {}),
          ...(app ? { app } : {}),
        },
        extra: {
          command: `${cmd} ${cmdArgs.join(" ")}`,
          cwd,
          stage: "spawn",
        },
      });
      Sentry.flush(2000).finally(() => process.exit(1));
    });

    child.on("exit", (code, signal) => {
      const exitCode = code ?? (signal ? 1 : 0);
      if (exitCode === 0) {
        resolve();
        return;
      }
      const cwd = process.cwd();
      const { template, app } = inferBuildContext(cwd);
      const childCommand = `${cmd} ${cmdArgs.join(" ")}`;
      const err = new Error(
        `Build step "${opts.label}" failed with exit code ${exitCode}` +
          (template ? ` (template=${template})` : "") +
          (app ? ` (app=${app})` : ""),
      );
      Sentry.captureException(err, {
        tags: {
          buildStep: opts.label,
          ...(template ? { template } : {}),
          ...(app ? { app } : {}),
        },
        extra: {
          command: childCommand,
          cwd,
          exitCode,
          signal: signal ?? null,
          stderrTail: stderrBuf,
          stdoutTail: stdoutBuf,
        },
      });
      // Don't throw — see comment on runBuildStep above.
      Sentry.flush(2000).finally(() => process.exit(exitCode));
    });
  });
}

trackCli("cli.run");

switch (command) {
  case "dev": {
    if (isWorkspaceRoot()) {
      import("./workspace-dev.js");
      break;
    }
    const vite = findViteBin();
    run(vite, args);
    break;
  }

  case "workspace-dev": {
    import("./workspace-dev.js");
    break;
  }

  case "build": {
    // React Router framework mode uses `react-router build` which
    // internally runs `vite build` with proper environment orchestration.
    // Legacy SPA mode uses `vite build` directly.
    //
    // Each step uses runBuildStep so that on failure we get a Sentry event
    // tagged with template/app and including stderr/stdout tails. If the
    // child exits non-zero, runBuildStep calls process.exit itself; the
    // continuation only runs on success.
    (async () => {
      if (isReactRouterFramework()) {
        const rr = findReactRouterBin();
        console.log("Building (React Router framework mode)...");
        await runBuildStep(rr, ["build"], { label: "react-router-build" });
      } else {
        const vite = findViteBin();
        console.log("Building...");
        await runBuildStep(vite, ["build"], { label: "vite-build" });
      }

      // Post-build: framework-mode apps also need a Nitro server bundle for
      // `agent-native start` and for serverless presets.
      if (isReactRouterFramework()) {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const deployBuild = path.resolve(__dirname, "../deploy/build.js");
        if (fs.existsSync(deployBuild)) {
          await runBuildStep("node", [deployBuild], {
            label: "deploy-build",
            env: process.env,
          });
        } else {
          console.warn(
            `[build] Deploy build script not found at ${deployBuild}. Skipping post-build step.`,
          );
        }
      }

      console.log("\nBuild complete.");
    })().catch((err) => {
      // runBuildStep handles its own failures and exits, so reaching here
      // implies a programming error in the orchestration above. Capture
      // and exit so the global unhandledRejection handler doesn't double-
      // report with a generic title.
      Sentry.captureException(err);
      Sentry.flush(2000).finally(() => process.exit(1));
    });
    break;
  }

  case "start": {
    // Like `next start` — runs Nitro production server
    const serverEntry = path.resolve(".output/server/index.mjs");
    if (!fs.existsSync(serverEntry)) {
      console.error(
        'No production build found. Run "agent-native build" first.',
      );
      process.exit(1);
    }
    run("node", [serverEntry, ...args]);
    break;
  }

  case "action": {
    // Run an action from actions/ (or scripts/ for backwards compat)
    const actionName = args[0];
    if (!actionName) {
      console.error("Usage: agent-native action <name> [--args]");
      process.exit(1);
    }
    const tsxAction = findTsxBin();
    // Try actions/run.ts first, fall back to scripts/run.ts
    const actionsRun = path.resolve("actions/run.ts");
    const scriptsRun = path.resolve("scripts/run.ts");
    const runFile = fs.existsSync(actionsRun) ? actionsRun : scriptsRun;
    run(tsxAction, [runFile, ...args]);
    break;
  }

  case "script": {
    // @deprecated — use `agent-native action` instead
    const scriptName = args[0];
    if (!scriptName) {
      console.error("Usage: agent-native script <name> [--args]");
      process.exit(1);
    }
    const tsx = findTsxBin();
    // Try actions/run.ts first, fall back to scripts/run.ts
    const actionsRunScript = path.resolve("actions/run.ts");
    const scriptsRunScript = path.resolve("scripts/run.ts");
    const runFileScript = fs.existsSync(actionsRunScript)
      ? actionsRunScript
      : scriptsRunScript;
    run(tsx, [runFileScript, ...args]);
    break;
  }

  case "typecheck": {
    // Run TypeScript type checking
    // React Router framework mode generates route types first
    if (isReactRouterFramework()) {
      const rr = findReactRouterBin();
      try {
        execSync(`${rr} typegen`, { stdio: "inherit" });
      } catch {
        // typegen may fail if routes aren't set up yet — continue to tsc
      }
    }
    const tsc = path.resolve("node_modules/.bin/tsc");
    const tscBin = fs.existsSync(tsc) ? tsc : "tsc";
    run(tscBin, ["--noEmit", ...args]);
    break;
  }

  case "create": {
    // Defaults to creating a workspace with a multi-select template picker.
    // Use --standalone for the old single-app flow.
    //   --template foo,bar         Pre-select multiple templates in the picker
    //   --standalone               Scaffold a single standalone app
    const parsed = parseScaffoldArgs(args);
    import("./create.js").then((m) =>
      m.createApp(parsed.name, {
        template: parsed.template,
        standalone: parsed.standalone,
      }),
    );
    break;
  }

  case "create-workspace": {
    // Deprecated alias for `create` (since workspace is now the default).
    const parsed = parseScaffoldArgs(args);
    import("./create-workspace.js").then((m) =>
      m.createWorkspace({ name: parsed.name, template: parsed.template }),
    );
    break;
  }

  case "add-app": {
    // Add one or more apps to the current workspace.
    const parsed = parseScaffoldArgs(args);
    import("./create.js").then((m) =>
      m.addAppToWorkspace(parsed.name, { template: parsed.template }),
    );
    break;
  }

  case "deploy": {
    // Build and deploy the entire workspace as one unit. Each app is served
    // at /<app>/* under the same origin.
    import("../deploy/workspace-deploy.js")
      .then((m) => m.runWorkspaceDeploy({ args }))
      .catch((err) => {
        console.error("Deploy failed:", err?.message ?? err);
        process.exit(1);
      });
    break;
  }

  case "setup-agents": {
    import("./setup-agents.js").then((m) => m.runSetupAgents());
    break;
  }

  case "info": {
    // Print read-only info about an installable package (e.g. @agent-native/scheduling).
    // Lists subpath exports, source paths in node_modules, and docs pointers.
    import("./info.js").then((m) => m.runInfo(args[0]));
    break;
  }

  case "--version":
  case "-v": {
    console.log(_version);
    break;
  }

  case "--help":
  case "-h":
  case undefined:
    console.log(`agent-native v${_version}

Usage:
  agent-native dev              Start development server
                                (or the workspace gateway at a workspace root)
  agent-native build            Build for production (client + server)
  agent-native start            Start production server
  agent-native action <name>    Run an action from actions/
  agent-native script <name>    Run an action (deprecated alias for 'action')
  agent-native typecheck        Run TypeScript type checking
  agent-native create [name]    Scaffold a new agent-native workspace with a
                                multi-select template picker. Use --standalone
                                for a single-app scaffold.
  agent-native add-app [name]   Add one or more apps to the current workspace
  agent-native workspace-dev    Start the multi-app workspace gateway
  agent-native deploy           Build & deploy every app in the workspace to
                                a single origin (your-agents.com/<app>/*)
  agent-native setup-agents     Create symlinks for all agent tools
  agent-native info <pkg>       Print info about an installed package:
                                exports, source paths, and docs links.

Options:
  -h, --help                    Show this help message
  -v, --version                 Show version number
  --template <names>            Comma-separated templates to pre-select
                                (mail,calendar,analytics,...) — or
                                github:user/repo for community templates
  --standalone                  Scaffold a single standalone app (no workspace)
  --preset <name>               Workspace deploy preset:
                                cloudflare_pages (default) or netlify
  --build-only                  Build workspace deploy artifacts without publishing

Feedback:  ${FEEDBACK_URL}
Bugs:      ${BUGS_URL}`);
    break;

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run "agent-native --help" for usage.');
    console.error(`Bugs: ${BUGS_URL}`);
    process.exit(1);
}
