/**
 * Keep AWS Signature V4 signing for S3 in one place: core's shared signer.
 *
 * Clips, Analytics and Assets each carried their own copy of the signer, and
 * each left an endpoint's base path out of the signature, so every upload to
 * an endpoint mounted under a path (Supabase Storage's `/storage/v1/s3`, say)
 * failed with 403 SignatureDoesNotMatch. Fixing one copy didn't reach the
 * others.
 *
 * Every SigV4 signer has to write the scope's closing literal, so finding the
 * literal finds the signer. Tests may use it to pin or check signatures.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { GUARD_EXIT_COULD_NOT_RUN } from "./lib/changed-lines.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const SIGNING_SCOPE_LITERAL = "aws4_request";
const SOURCE_PATHSPECS = [
  "*.ts",
  "*.tsx",
  "*.mts",
  "*.cts",
  "*.js",
  "*.jsx",
  "*.mjs",
  "*.cjs",
];
const ALLOWED_FILES = new Set([
  "packages/core/src/file-upload/s3-client.ts",
  "scripts/guard-single-s3-signer.ts",
]);
const TEST_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/;

/** Of the files that hold the literal, the ones that may not. */
export function findStrayS3Signers(files: readonly string[]): string[] {
  return files
    .filter((file) => !ALLOWED_FILES.has(file) && !TEST_FILE.test(file))
    .sort();
}

/** Tracked and new (not ignored) source files that hold the literal. */
export function listFilesWithSigningScope(root = rootDir): string[] {
  const result = spawnSync(
    "git",
    [
      "grep",
      "--untracked",
      "--files-with-matches",
      "--fixed-strings",
      SIGNING_SCOPE_LITERAL,
      "--",
      ...SOURCE_PATHSPECS,
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  // `git grep` exits 1 when nothing matches. Anything else means it couldn't
  // search, and a guard that didn't look must not pass.
  if (result.status === 1) return [];
  if (result.status !== 0) {
    throw new Error(
      `git grep failed: ${result.error?.message ?? result.stderr}`,
    );
  }
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let files: string[];
  try {
    files = listFilesWithSigningScope();
  } catch (error) {
    console.error(`[guard:single-s3-signer] could not run: ${String(error)}`);
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }
  const strays = findStrayS3Signers(files);

  if (strays.length > 0) {
    console.error(
      `[guard:single-s3-signer] ${strays.length} file(s) sign S3 requests outside core:`,
    );
    for (const stray of strays) console.error(`- ${stray}`);
    console.error(
      "Use signedS3Request or presignS3GetUrl from @agent-native/core/file-upload instead of writing a signer.",
    );
    process.exit(1);
  }

  console.log("[guard:single-s3-signer] core holds the only S3 signer");
}
