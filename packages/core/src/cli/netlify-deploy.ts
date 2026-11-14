import { spawn } from "child_process";
import path from "path";

import {
  NETLIFY_MANIFEST_REJECTED_MESSAGES,
  NETLIFY_MANIFEST_USED_MESSAGE,
  findNetlifyCli,
  loadCliZipIt,
  prepareNetlifyFunctionZips,
} from "../deploy/netlify-function-zips.js";

const DEFAULT_FUNCTIONS_DIR = ".netlify/functions-internal";
const DEFAULT_DEPLOY_ARGS = [
  "--prod",
  "--dir=dist",
  `--functions=${DEFAULT_FUNCTIONS_DIR}`,
];

function optionValue(
  args: string[],
  long: string,
  short: string,
): string | undefined {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg.startsWith(`${long}=`)) values.push(arg.slice(long.length + 1));
    else if (arg.startsWith(`${short}=`))
      values.push(arg.slice(short.length + 1));
    else if (arg === long || arg === short) values.push(args[i + 1] ?? "");
  }
  if (values.length > 1) {
    throw new Error(`${long} was given more than once; pass it a single time`);
  }
  if (values[0] === "") throw new Error(`${long} needs a directory`);
  return values[0];
}

export function assertStatusOutputEnabled(args: string[]): void {
  if (args.includes("--skip-functions-cache")) {
    throw new Error(
      "--skip-functions-cache makes the CLI ignore the deterministic functions manifest; run without it",
    );
  }
  const suppressed = args.find((arg) => arg === "--json" || arg === "--silent");
  if (suppressed) {
    throw new Error(
      `${suppressed} hides the CLI status line netlify-deploy watches to detect a discarded functions manifest; run without it`,
    );
  }
}

/**
 * No args means the full default publish. With args, nothing is injected so the
 * project's own netlify.toml publish directory still applies; the manifest
 * covers `.netlify/functions-internal`, which the CLI always scans.
 */
export function withPathDefaults(args: string[]): string[] {
  if (args.length === 0) return DEFAULT_DEPLOY_ARGS;
  optionValue(args, "--dir", "-d");
  optionValue(args, "--functions", "-f");
  return args;
}

export function functionsDirOf(args: string[]): string {
  return optionValue(args, "--functions", "-f") || DEFAULT_FUNCTIONS_DIR;
}

/**
 * `agent-native netlify-deploy [netlify deploy args]`: zips the workspace
 * functions deterministically and runs `netlify deploy` in the same command, so
 * the CLI reads the manifest well inside its TTL. Unchanged functions then keep
 * their digest and are not re-uploaded.
 */
export async function runNetlifyDeploy(rawArgs: string[]): Promise<void> {
  assertStatusOutputEnabled(rawArgs);
  const deployArgs = withPathDefaults(rawArgs);
  const siteRoot = process.cwd();
  const functionsDir = path.resolve(siteRoot, functionsDirOf(deployArgs));

  const cli = findNetlifyCli();
  const { zipIt, version } = await loadCliZipIt(cli);
  const { manifestPath, functions } = await prepareNetlifyFunctionZips({
    siteRoot,
    functionsDir,
    zipIt,
  });
  for (const fn of functions) {
    console.log(`[netlify-deploy] ${fn.name} sha256=${fn.sha256.slice(0, 16)}`);
  }
  console.log(
    `[netlify-deploy] ${functions.length} functions zipped with netlify-cli ${cli.version} (zip-it ${version})`,
  );

  const exitCode = await new Promise<number>((resolve, reject) => {
    // The CLI prints the marker while choosing its functions, before anything
    // is uploaded or published, so stopping it here prevents the unstable deploy.
    const child = spawn(
      process.execPath,
      [cli.entryPoint, "deploy", ...deployArgs],
      { cwd: siteRoot, stdio: ["inherit", "pipe", "pipe"] },
    );
    let rejected: string | undefined;
    let consumed = false;
    const watch = (stream: NodeJS.ReadableStream, sink: NodeJS.WriteStream) => {
      let tail = "";
      stream.on("data", (chunk: Buffer) => {
        sink.write(chunk);
        tail = (tail + chunk.toString()).slice(
          -(NETLIFY_MANIFEST_USED_MESSAGE.length * 2),
        );
        if (tail.includes(NETLIFY_MANIFEST_USED_MESSAGE)) consumed = true;
        if (!rejected) {
          rejected = NETLIFY_MANIFEST_REJECTED_MESSAGES.find((m) =>
            tail.includes(m),
          );
          if (rejected) child.kill("SIGTERM");
        }
      });
    };
    watch(child.stdout, process.stdout);
    watch(child.stderr, process.stderr);
    child.on("error", reject);
    child.on("close", (code) => {
      if (rejected) {
        const reason = rejected.startsWith("Ignored")
          ? "manifest-expired netlify-cli discarded the manifest as invalid or older than its 2 minute TTL"
          : "manifest-missing netlify-cli found no functions manifest at its resolved site path";
        console.error(
          `[netlify-deploy] ${reason}; the deploy was stopped before upload so unstable ZIPs are not published`,
        );
        resolve(1);
      } else if (code === 0 && !consumed) {
        console.error(
          "[netlify-deploy] manifest-not-used the CLI never confirmed it used the generated functions manifest; check that this run's functions were not re-zipped",
        );
        resolve(1);
      } else {
        resolve(code ?? 1);
      }
    });
  });
  process.exit(exitCode);
}
