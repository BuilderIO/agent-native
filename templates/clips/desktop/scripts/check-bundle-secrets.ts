// Fails when a built frontend carries the Tauri updater signing key.
// Exit 0: nothing found. Exit 1: found. Exit 2: nothing was inspected.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// A signing key is the base64 of a minisign secret-key file, which opens with
// this header. 45 bytes is a whole number of base64 groups, so the encoded
// header is the same at the start of every key.
const SECRET_KEY_HEADER = "untrusted comment: rsign encrypted secret key";
const SIGNING_ENV_NAMES = [
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
];
// Shorter values match unrelated text.
const MIN_VALUE_LENGTH = 8;

export interface Needle {
  label: string;
  bytes: Buffer;
}

export interface Leak {
  file: string;
  label: string;
}

export function signingKeyNeedles(
  env: NodeJS.ProcessEnv = process.env,
): Needle[] {
  const needles: Needle[] = [
    {
      label: "TAURI_SIGNING_ variable name",
      bytes: Buffer.from("TAURI_SIGNING_"),
    },
    {
      label: "minisign secret-key header",
      bytes: Buffer.from(SECRET_KEY_HEADER),
    },
    {
      label: "base64 minisign secret-key header",
      bytes: Buffer.from(Buffer.from(SECRET_KEY_HEADER).toString("base64")),
    },
  ];
  for (const name of SIGNING_ENV_NAMES) {
    const value = env[name];
    if (value && value.length >= MIN_VALUE_LENGTH) {
      needles.push({ label: `value of ${name}`, bytes: Buffer.from(value) });
    }
  }
  return needles;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

export function scanDir(
  dir: string,
  needles: Needle[],
): { files: number; leaks: Leak[] } {
  let files = 0;
  const leaks: Leak[] = [];
  for (const file of walk(dir)) {
    files += 1;
    const content = readFileSync(file);
    for (const needle of needles) {
      if (content.includes(needle.bytes))
        leaks.push({ file, label: needle.label });
    }
  }
  return { files, leaks };
}

export function main(argv: string[]): number {
  const dir = argv[0];
  if (!dir) {
    console.error("usage: node scripts/check-bundle-secrets.ts <built-dir>");
    return 2;
  }
  let result: ReturnType<typeof scanDir>;
  try {
    result = scanDir(dir, signingKeyNeedles());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`::error::Could not read ${dir}: ${reason}`);
    return 2;
  }
  if (result.files === 0) {
    console.error(`::error::${dir} has no files, so nothing was checked.`);
    return 2;
  }
  if (result.leaks.length > 0) {
    // The label names what matched; the matched text is never printed.
    for (const leak of result.leaks) {
      console.error(`::error file=${leak.file}::Contains the ${leak.label}.`);
    }
    return 1;
  }
  console.log(
    `Checked ${result.files} files in ${dir}: no signing key material.`,
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(main(process.argv.slice(2)));
}
