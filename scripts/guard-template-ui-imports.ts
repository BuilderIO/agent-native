import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { scanModuleSpecifiers } from "./guard-toolkit-must-not-import-core";

const TOOLKIT_UI_PREFIX = "@agent-native/toolkit/ui";

export interface TemplateUiImportViolation {
  file: string;
  line: number;
  specifier: string;
}

export function findTemplateUiImports(
  file: string,
  content: string,
): TemplateUiImportViolation[] {
  return scanModuleSpecifiers(content)
    .filter(
      ({ value }) =>
        value === TOOLKIT_UI_PREFIX ||
        value.startsWith(`${TOOLKIT_UI_PREFIX}/`),
    )
    .map(({ index, value }) => ({
      file,
      line: content.slice(0, index).split("\n").length,
      specifier: value,
    }));
}

function walkTypeScript(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkTypeScript(child);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [child] : [];
  });
}

function main(): void {
  const root = path.resolve(import.meta.dirname, "..");
  const templateRoot = path.join(root, "templates");
  const violations: TemplateUiImportViolation[] = [];

  for (const entry of readdirSync(templateRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const appRoot = path.join(templateRoot, entry.name, "app");
    const rootFile = path.join(appRoot, "root.tsx");
    const packageFile = path.join(templateRoot, entry.name, "package.json");
    try {
      readFileSync(rootFile);
      readFileSync(packageFile);
    } catch {
      continue;
    }
    const adapterRoot = path.join(appRoot, "components", "ui");
    for (const file of walkTypeScript(appRoot)) {
      if (file.startsWith(`${adapterRoot}${path.sep}`)) continue;
      violations.push(
        ...findTemplateUiImports(
          path.relative(root, file),
          readFileSync(file, "utf8"),
        ),
      );
    }
  }

  if (violations.length > 0) {
    console.error(
      `[guard:template-ui-imports] ${violations.length} violation(s):\n${violations
        .map(
          ({ file, line, specifier }) =>
            `- ${file}:${line} imports ${specifier}; app product code must use its app/components/ui adapter.`,
        )
        .join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log("[guard:template-ui-imports] clean");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
