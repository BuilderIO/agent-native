import { spawn } from "child_process";
import path from "path";

import {
  NETLIFY_MANIFEST_IGNORED_MESSAGE,
  NETLIFY_MANIFEST_LAUNCH_MARGIN_MS,
  NETLIFY_MANIFEST_TTL_MS,
  NetlifyManifestExpiredError,
  assertManifestFresh,
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

/** No args means the full default publish; otherwise only the paths the manifest depends on are filled in. */
function withPathDefaults(args: string[]): string[] {
  if (args.length === 0) return DEFAULT_DEPLOY_ARGS;
  const has = (flag: string) =>
    args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
  const merged = [...args];
  if (!has("--dir")) merged.push("--dir=dist");
  if (!has("--functions")) merged.push(`--functions=${DEFAULT_FUNCTIONS_DIR}`);
  return merged;
}

function functionsDirOf(args: string[]): string {
  const inline = args.find((arg) => arg.startsWith("--functions="));
  if (inline) return inline.slice("--functions=".length);
  const flagAt = args.indexOf("--functions");
  const next = flagAt === -1 ? undefined : args[flagAt + 1];
  return next ?? DEFAULT_FUNCTIONS_DIR;
}

/**
 * `agent-native netlify-deploy [netlify deploy args]`: zips the workspace
 * functions deterministically and runs `netlify deploy` in the same command, so
 * the CLI reads the manifest well inside its TTL. Unchanged functions then keep
 * their digest and are not re-uploaded.
 */
export async function runNetlifyDeploy(rawArgs: string[]): Promise<void> {
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

  try {
    assertManifestFresh(
      manifestPath,
      Date.now(),
      NETLIFY_MANIFEST_TTL_MS - NETLIFY_MANIFEST_LAUNCH_MARGIN_MS,
    );
  } catch (error) {
    if (error instanceof NetlifyManifestExpiredError) {
      console.error(`[netlify-deploy] manifest-expired ${error.message}`);
    }
    throw error;
  }

  const exitCode = await new Promise<number>((resolve, reject) => {
    // The CLI prints the marker while choosing its functions, before anything
    // is uploaded or published, so stopping it here prevents the unstable deploy.
    const child = spawn(
      process.execPath,
      [cli.entryPoint, "deploy", ...deployArgs],
      { cwd: siteRoot, stdio: ["inherit", "pipe", "pipe"] },
    );
    let ignored = false;
    const watch = (stream: NodeJS.ReadableStream, sink: NodeJS.WriteStream) => {
      let tail = "";
      stream.on("data", (chunk: Buffer) => {
        sink.write(chunk);
        tail = (tail + chunk.toString()).slice(
          -(NETLIFY_MANIFEST_IGNORED_MESSAGE.length * 2),
        );
        if (!ignored && tail.includes(NETLIFY_MANIFEST_IGNORED_MESSAGE)) {
          ignored = true;
          child.kill("SIGTERM");
        }
      });
    };
    watch(child.stdout, process.stdout);
    watch(child.stderr, process.stderr);
    child.on("error", reject);
    child.on("close", (code) => {
      if (ignored) {
        console.error(
          "[netlify-deploy] manifest-expired netlify-cli discarded the functions manifest; the deploy was stopped before upload so unstable ZIPs are not published",
        );
        resolve(1);
      } else {
        resolve(code ?? 1);
      }
    });
  });
  process.exit(exitCode);
}
