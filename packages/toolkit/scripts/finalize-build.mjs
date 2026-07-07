// tsgo compiles TypeScript only; it does not emit non-TS assets. Copy the CSS
// entrypoint(s) from src into dist so the published package ships them, mirroring
// @agent-native/core's finalize-build step.
import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

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
for (const name of readdirSync("src")) {
  if (name.endsWith(".css")) {
    copyFileSync(join("src", name), join("dist", name));
  }
}

const missing = [];
for (const sourceFile of walk("src")) {
  const extension = extname(sourceFile);
  if (extension !== ".ts" && extension !== ".tsx" && extension !== ".css") {
    continue;
  }

  const relativeSource = relative("src", sourceFile);
  const withoutExtension = relativeSource.slice(0, -extension.length);

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
