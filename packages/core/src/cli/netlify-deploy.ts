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
  const deployArgs = rawArgs.length > 0 ? rawArgs : DEFAULT_DEPLOY_ARGS;
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
    const child = spawn("netlify", ["deploy", ...deployArgs], {
      cwd: siteRoot,
      stdio: ["inherit", "pipe", "pipe"],
    });
    let ignored = false;
    const tee = (stream: NodeJS.ReadableStream, sink: NodeJS.WriteStream) =>
      stream.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes(NETLIFY_MANIFEST_IGNORED_MESSAGE)) {
          ignored = true;
        }
        sink.write(chunk);
      });
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    child.on("error", reject);
    child.on("close", (code) => {
      if (ignored) {
        console.error(
          "[netlify-deploy] manifest-expired netlify-cli discarded the functions manifest and re-zipped; function digests are no longer stable for this deploy",
        );
        resolve(code === 0 ? 1 : (code ?? 1));
      } else {
        resolve(code ?? 1);
      }
    });
  });
  process.exit(exitCode);
}
