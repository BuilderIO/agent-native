import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

writeFileSync(
  new URL("../src/icons/tabler-catalog-data.ts", import.meta.url),
  `// Generated from @tabler/icons ${version} (MIT). Run node packages/toolkit/scripts/generate-tabler-catalog.ts.\n` +
    `/*!\n${license}\n*/\n` +
    `const entries: Array<[name: string, category: string, tags: string, styles: string]> = ${JSON.stringify(entries)};\nexport default entries;\n`,
);

const exportName = (name: string) =>
  `Icon${name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}`;
const chunks = new Map<string, Set<string>>();
for (const entry of Object.values(metadata)) {
  for (const style of Object.keys(entry.styles)) {
    const name = `${entry.name}${style === "filled" ? "-filled" : ""}`;
    const initial = name.charAt(0).toLowerCase();
    if (!/^[a-z0-9]$/.test(initial)) {
      throw new Error(`Unsupported Tabler icon name: ${name}`);
    }
    const names = chunks.get(initial) ?? new Set<string>();
    names.add(exportName(name));
    chunks.set(initial, names);
  }
}

const chunkDirectory = new URL("../src/icons/tabler-chunks/", import.meta.url);
mkdirSync(chunkDirectory, { recursive: true });
for (const [initial, names] of chunks) {
  const exports = [...names].sort();
  writeFileSync(
    new URL(`${initial}.ts`, chunkDirectory),
    `// Generated from @tabler/icons ${version}. Run node packages/toolkit/scripts/generate-tabler-catalog.ts.\n` +
      `import { ${exports.join(", ")} } from "@tabler/icons-react";\n` +
      `export default { ${exports.join(", ")} };\n`,
  );
}
writeFileSync(
  new URL("../src/icons/tabler-chunk-loaders.ts", import.meta.url),
  `// Generated from @tabler/icons ${version}. Run node packages/toolkit/scripts/generate-tabler-catalog.ts.\n` +
    `export default {\n${[...chunks.keys()]
      .sort()
      .map(
        (initial) =>
          `  ${JSON.stringify(initial)}: () => import("./tabler-chunks/${initial}.js"),`,
      )
      .join("\n")}\n};\n`,
);
