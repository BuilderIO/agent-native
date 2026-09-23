import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const tablerRequire = createRequire(require.resolve("@tabler/icons-react"));
const iconPath = tablerRequire.resolve("@tabler/icons/outline/a-b.svg");
const packagePath = resolve(dirname(iconPath), "../..");
interface TablerMetadata {
  name: string;
  category: string;
  tags: Array<string | number>;
  styles: { outline?: unknown; filled?: unknown };
}
const metadata: Record<string, TablerMetadata> = JSON.parse(
  readFileSync(resolve(packagePath, "icons.json"), "utf8"),
);
const { version } = JSON.parse(
  readFileSync(resolve(packagePath, "package.json"), "utf8"),
);
const license = readFileSync(resolve(packagePath, "LICENSE"), "utf8").trim();
const entries = Object.values(metadata).map((entry) => [
  entry.name,
  entry.category.toLowerCase().replaceAll(" ", "-"),
  entry.tags.join(" "),
  Object.keys(entry.styles).join(" "),
]);

// Tabler ships icons.json but does not expose it through its package exports.
writeFileSync(
  new URL("../src/icons/tabler-catalog-data.ts", import.meta.url),
  `// Generated from @tabler/icons ${version} (MIT). Run node packages/toolkit/scripts/generate-tabler-catalog.ts.\n` +
    `/*!\n${license}\n*/\n` +
    `const entries: Array<[name: string, category: string, tags: string, styles: string]> = ${JSON.stringify(entries)};\nexport default entries;\n`,
);
