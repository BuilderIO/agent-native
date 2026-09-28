import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type VerificationResult = {
  checkedFiles: number;
};

type ServerManifestVerificationResult = {
  checkedAssets: number;
};

const ABSOLUTE_ASSET_PATH =
  /["'`]((?:\/[A-Za-z0-9._~-]+)*\/assets\/[^"'`\s?#]+)["'`]/g;

const NETLIFY_GENERATED_FILES = new Set(["_headers", "_redirects"]);

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
    if (
      !NETLIFY_GENERATED_FILES.has(relative) &&
      !readFileSync(clientPath).equals(readFileSync(publishPath))
    ) {
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

export function verifyNetlifyPrebuiltServerManifest(
  serverDirectory: string,
  publishDirectory: string,
): ServerManifestVerificationResult {
  if (!statSync(serverDirectory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Server artifact directory is missing: ${serverDirectory}`);
  }
  if (!statSync(publishDirectory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Publish directory is missing: ${publishDirectory}`);
  }

  const assetPaths = new Set<string>();
  for (const relative of listFiles(serverDirectory)) {
    if (!/\.(?:cjs|js|mjs)$/.test(relative)) continue;
    const source = readFileSync(path.join(serverDirectory, relative), "utf8");
    for (const match of source.matchAll(ABSOLUTE_ASSET_PATH)) {
      for (const assetPath of match[1].split(",")) {
        if (assetPath.startsWith("/") && /\.[A-Za-z0-9_-]+$/.test(assetPath)) {
          assetPaths.add(assetPath);
        }
      }
    }
  }

  if (assetPaths.size === 0) {
    throw new Error(
      `Server artifact contains no absolute client asset paths: ${serverDirectory}`,
    );
  }

  const publishRoot = path.resolve(publishDirectory);
  const missing: string[] = [];
  const outsidePublish: string[] = [];
  for (const assetPath of [...assetPaths].sort()) {
    const relative = assetPath.replace(/^\/+/, "");
    const resolved = path.resolve(publishRoot, relative);
    if (
      resolved !== publishRoot &&
      !resolved.startsWith(`${publishRoot}${path.sep}`)
    ) {
      outsidePublish.push(assetPath);
      continue;
    }
    if (!statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
      missing.push(assetPath);
    }
  }
  if (outsidePublish.length > 0) {
    throw new Error(
      `Server asset manifest contains paths outside publish output (unsafe: ${outsidePublish.join(", ")}).`,
    );
  }
  if (missing.length > 0) {
    throw new Error(
      `Server asset manifest is not paired with publish output (missing: ${missing.join(", ")}).`,
    );
  }

  return { checkedAssets: assetPaths.size };
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

  const serverDirectory = argumentValue("--server");
  if (serverDirectory) {
    const { checkedAssets } = verifyNetlifyPrebuiltServerManifest(
      serverDirectory,
      publishDirectory,
    );
    console.log(
      `Verified ${checkedAssets} server manifest asset path(s) are present in publish output.`,
    );
  }
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
