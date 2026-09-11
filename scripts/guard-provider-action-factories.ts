import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// This syntax-level guard intentionally requires direct named factory imports.
// It does not resolve aliases, re-exports, or computed factory references.
const REQUIRED_TEMPLATE_NAMES = [
  "analytics",
  "brain",
  "calendar",
  "content",
  "design",
  "dispatch",
  "mail",
  "slides",
] as const;

const PACKAGE_DISPATCH_ACTIONS = "packages/dispatch/src/actions";

const ACTION_FACTORIES = {
  "provider-api-request": {
    factory: "createProviderApiRequestAction",
    module: "@agent-native/core/provider-api/actions/provider-api",
  },
  "provider-api-catalog": {
    factory: "createProviderApiCatalogAction",
    module: "@agent-native/core/provider-api/actions/provider-api",
  },
  "provider-api-docs": {
    factory: "createProviderApiDocsAction",
    module: "@agent-native/core/provider-api/actions/provider-api",
  },
  "query-staged-dataset": {
    factory: "createQueryStagedDatasetAction",
    module: "@agent-native/core/provider-api/actions/staged-datasets",
  },
  "list-staged-datasets": {
    factory: "createListStagedDatasetsAction",
    module: "@agent-native/core/provider-api/actions/staged-datasets",
  },
  "delete-staged-dataset": {
    factory: "createDeleteStagedDatasetAction",
    module: "@agent-native/core/provider-api/actions/staged-datasets",
  },
} as const;

type ActionName = keyof typeof ACTION_FACTORIES;

export type ProviderActionFactoryViolation = {
  file: string;
  message: string;
};

function maskCommentsAndStrings(source: string): string {
  const output = source.split("");
  let state: "code" | "line" | "block" | "single" | "double" | "template" =
    "code";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (state === "code") {
      if (char === "/" && next === "/") {
        output[index] = output[index + 1] = " ";
        state = "line";
        index += 1;
      } else if (char === "/" && next === "*") {
        output[index] = output[index + 1] = " ";
        state = "block";
        index += 1;
      } else if (char === "'") {
        output[index] = " ";
        state = "single";
      } else if (char === '"') {
        output[index] = " ";
        state = "double";
      } else if (char === "`") {
        output[index] = " ";
        state = "template";
      }
      continue;
    }

    if (char !== "\n" && char !== "\r") output[index] = " ";
    if (state === "line") {
      if (char === "\n") state = "code";
      continue;
    }
    if (state === "block") {
      if (char === "*" && next === "/") {
        output[index + 1] = " ";
        state = "code";
        index += 1;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (
      (state === "single" && char === "'") ||
      (state === "double" && char === '"') ||
      (state === "template" && char === "`")
    ) {
      state = "code";
    }
  }
  return output.join("");
}

export function analyzeProviderActionFactorySource(
  file: string,
  source: string,
  action: ActionName,
): ProviderActionFactoryViolation[] {
  const expected = ACTION_FACTORIES[action];
  const violations: ProviderActionFactoryViolation[] = [];
  const importPattern = new RegExp(
    `import\\s*\\{[^}]*\\b${expected.factory}\\b[^}]*\\}\\s*from\\s*["']${expected.module.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}["']`,
    "s",
  );

  if (!importPattern.test(source)) {
    violations.push({
      file,
      message: `must import ${expected.factory} from ${expected.module}`,
    });
  }

  const code = maskCommentsAndStrings(source);
  if (!new RegExp(`\\b${expected.factory}\\s*\\(`).test(code)) {
    violations.push({
      file,
      message: `must create the action with ${expected.factory}`,
    });
  }
  if (/\bdefineAction\s*\(/.test(code)) {
    violations.push({
      file,
      message:
        "must not define this shared provider/staged action locally with defineAction",
    });
  }
  return violations;
}

export function checkProviderActionFactories(
  repoRoot: string,
): ProviderActionFactoryViolation[] {
  const violations: ProviderActionFactoryViolation[] = [];
  for (const template of REQUIRED_TEMPLATE_NAMES) {
    checkProviderActionDirectory(
      repoRoot,
      path.join("templates", template, "actions"),
      true,
      violations,
    );
  }

  for (const entry of readdirSync(path.join(repoRoot, "templates"), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory() || REQUIRED_TEMPLATE_NAMES.includes(entry.name)) {
      continue;
    }
    checkProviderActionDirectory(
      repoRoot,
      path.join("templates", entry.name, "actions"),
      false,
      violations,
    );
  }

  checkProviderActionDirectory(
    repoRoot,
    PACKAGE_DISPATCH_ACTIONS,
    false,
    violations,
  );
  return violations;
}

function checkProviderActionDirectory(
  repoRoot: string,
  actionDirectory: string,
  required: boolean,
  violations: ProviderActionFactoryViolation[],
): void {
  for (const action of Object.keys(ACTION_FACTORIES) as ActionName[]) {
    const file = path.join(actionDirectory, `${action}.ts`);
    const absoluteFile = path.join(repoRoot, file);
    if (!existsSync(absoluteFile)) {
      if (required) {
        violations.push({
          file,
          message: "required provider action is missing",
        });
      }
      continue;
    }
    violations.push(
      ...analyzeProviderActionFactorySource(
        file,
        readFileSync(absoluteFile, "utf8"),
        action,
      ),
    );
  }
}

function main(): void {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const violations = checkProviderActionFactories(repoRoot);
  if (violations.length > 0) {
    console.error(
      `[guard:provider-action-factories] ${violations.length} issue(s):\n${violations
        .map((violation) => `- ${violation.file}: ${violation.message}`)
        .join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    "[guard:provider-action-factories] all shared action factories are in use",
  );
}

if (import.meta.main) main();
