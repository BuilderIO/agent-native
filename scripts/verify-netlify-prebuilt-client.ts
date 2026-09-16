import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type VerificationResult = {
  checkedFiles: number;
};

function listFiles(root: string, relative = ""): string[] {
  return readdirSync(path.join(root, relative), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const entryRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) return listFiles(root, entryRelative);
    if (!entry.isFile()) {
      throw new Error(
        `Client artifact contains unsupported entry: ${entryRelative}`,
      );
    }
    return [entryRelative];
  });
}

/**
 * React Router's client directory is the asset manifest Nitro bakes into the
 * trusted server bundle. Every byte must survive in the paired publish tree.
 */
export function verifyNetlifyPrebuiltClientArtifact(
  clientDirectory: string,
  publishDirectory: string,
): VerificationResult {
  if (!statSync(clientDirectory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Client artifact directory is missing: ${clientDirectory}`);
  }
  if (!statSync(publishDirectory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Publish directory is missing: ${publishDirectory}`);
  }

  const clientFiles = listFiles(clientDirectory).sort();
  if (clientFiles.length === 0) {
    throw new Error(`Client artifact directory is empty: ${clientDirectory}`);
  }

  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const relative of clientFiles) {
    const clientPath = path.join(clientDirectory, relative);
    const publishPath = path.join(publishDirectory, relative);
    const publishStat = statSync(publishPath, { throwIfNoEntry: false });
    if (!publishStat?.isFile()) {
      missing.push(relative);
      continue;
    }
    if (!readFileSync(clientPath).equals(readFileSync(publishPath))) {
      mismatched.push(relative);
    }
  }

  if (missing.length > 0 || mismatched.length > 0) {
    const details = [
      missing.length > 0 ? `missing: ${missing.join(", ")}` : "",
      mismatched.length > 0 ? `mismatched: ${mismatched.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(
      `Client artifact is not paired with publish output (${details}).`,
    );
  }

  return { checkedFiles: clientFiles.length };
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main(): void {
  const clientDirectory = argumentValue("--client");
  const publishDirectory = argumentValue("--publish");
  if (!clientDirectory || !publishDirectory) {
    throw new Error(
      "Usage: verify-netlify-prebuilt-client.ts --client <build/client> --publish <dist>",
    );
  }
  const { checkedFiles } = verifyNetlifyPrebuiltClientArtifact(
    clientDirectory,
    publishDirectory,
  );
  console.log(
    `Verified ${checkedFiles} client artifact file(s) are present byte-for-byte in publish output.`,
  );
}

const isMainModule =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
