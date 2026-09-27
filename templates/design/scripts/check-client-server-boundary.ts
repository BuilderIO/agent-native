import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../build/client",
);
const textAsset = /\.(?:css|html|js|json|map|mjs)$/i;
const forbidden = [
  ["PGlite database client", "__agentNativePgliteClients"],
  ["server database module", /server[\\/]db(?:[\\/.'"?]|$)/i],
] as const;

async function textAssets(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map((entry) => {
      const filePath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? textAssets(filePath)
        : textAsset.test(entry.name)
          ? [filePath]
          : [];
    }),
  );
  return paths.flat();
}

const assets = await textAssets(clientRoot);
if (assets.length === 0) {
  throw new Error(`No text assets found in client build: ${clientRoot}`);
}

const leaks: string[] = [];
for (const asset of assets) {
  const source = await readFile(asset, "utf8");
  for (const [label, pattern] of forbidden) {
    if (
      typeof pattern === "string"
        ? source.includes(pattern)
        : pattern.test(source)
    ) {
      leaks.push(`${path.relative(clientRoot, asset)}: ${label}`);
    }
  }
}

if (leaks.length > 0) {
  throw new Error(
    `Server database code found in client assets:\n${leaks.join("\n")}`,
  );
}

console.log(`Checked ${assets.length} client assets for server database code.`);
