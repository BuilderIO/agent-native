import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative } from "node:path";

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
    } else {
      files.push(path);
    }
  }
  return files;
}
for (const sourceFile of walk("src")) {
  const extension = extname(sourceFile);
  if (extension !== ".css" && extension !== ".wgsl") continue;
  const output = join("dist", relative("src", sourceFile));
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(sourceFile, output);
  if (extension === ".wgsl") {
    writeFileSync(
      `${output}.js`,
      `export default ${JSON.stringify(readFileSync(sourceFile, "utf8"))};\n`,
    );
  }
}

for (const outputFile of walk("dist")) {
  if (extname(outputFile) !== ".js") continue;
  const source = readFileSync(outputFile, "utf8");
  const rewritten = source.replace(
    /(["'])(\.\.?\/[^"']+\.wgsl)\?raw\1/g,
    "$1$2.js$1",
  );
  if (rewritten !== source) writeFileSync(outputFile, rewritten);
}

const missing = [];
for (const sourceFile of walk("src")) {
  const extension = extname(sourceFile);
  if (
    extension !== ".ts" &&
    extension !== ".tsx" &&
    extension !== ".css" &&
    extension !== ".wgsl"
  ) {
    continue;
  }
  if (
    /\.(?:spec|test)\.(?:ts|tsx)$/.test(sourceFile) ||
    sourceFile.endsWith(".d.ts") ||
    sourceFile.endsWith(".e2e-host.tsx")
  ) {
    continue;
  }

  const relativeSource = relative("src", sourceFile);
  const withoutExtension = relativeSource.slice(0, -extension.length);

  if (extension === ".wgsl") {
    const output = join("dist", relativeSource);
    if (!existsSync(output)) missing.push(output);
    if (!existsSync(`${output}.js`)) missing.push(`${output}.js`);
    continue;
  }

  if (extension === ".css") {
    const output = join("dist", `${withoutExtension}.css`);
    if (!existsSync(output)) missing.push(output);
    continue;
  }

  for (const outputExtension of [".js", ".d.ts"]) {
    const output = join("dist", `${withoutExtension}${outputExtension}`);
    if (!existsSync(output)) missing.push(output);
  }
}

if (missing.length > 0) {
  console.error(
    [
      "[toolkit finalize-build] Missing expected dist output:",
      ...missing.map((path) => `  - ${path}`),
    ].join("\n"),
  );
  process.exitCode = 1;
}
