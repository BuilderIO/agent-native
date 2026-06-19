import { describe, expect, it } from "vitest";
import {
  buildLocalCodebaseInstruction,
  isCodebaseTextPath,
  isIgnoredCodebaseDirectory,
  isSensitiveCodebasePath,
  renderCodebaseTree,
  resourcePathForLocalCodebaseFile,
  type LocalCodebaseSummary,
} from "./local-codebase-context";

const SUMMARY: LocalCodebaseSummary = {
  id: "my-app-1234",
  name: "My App",
  resourcePrefix: "codebases/my-app-1234",
  snapshotPrefix: "codebases/my-app-1234/snapshots/20260619120000",
  instructionPath: "instructions/local-codebases/my-app-1234.md",
  latestPath: "codebases/my-app-1234/latest.json",
  indexPath: "codebases/my-app-1234/snapshots/20260619120000/index.json",
  treePath: "codebases/my-app-1234/snapshots/20260619120000/tree.md",
  indexedFileCount: 3,
  capturedFileCount: 2,
  skippedFileCount: 1,
  totalCapturedBytes: 42,
  updatedAt: "2026-06-19T19:00:00.000Z",
};

describe("local codebase context", () => {
  it("detects source text files and ignores generated directories", () => {
    expect(isCodebaseTextPath("src/routes/api.ts")).toBe(true);
    expect(isCodebaseTextPath("package.json")).toBe(true);
    expect(isCodebaseTextPath("assets/logo.png")).toBe(false);

    expect(isIgnoredCodebaseDirectory("node_modules")).toBe(true);
    expect(isIgnoredCodebaseDirectory("src")).toBe(false);
  });

  it("skips secret-looking paths", () => {
    expect(isSensitiveCodebasePath(".env.local")).toBe(true);
    expect(isSensitiveCodebasePath("certs/private.key")).toBe(true);
    expect(isSensitiveCodebasePath("src/credentials/token.ts")).toBe(true);
    expect(isSensitiveCodebasePath("src/routes/billing.ts")).toBe(false);
  });

  it("preserves local source paths under the snapshot resource prefix", () => {
    expect(
      resourcePathForLocalCodebaseFile(
        SUMMARY.snapshotPrefix,
        "src/routes/billing.ts",
      ),
    ).toBe(
      "codebases/my-app-1234/snapshots/20260619120000/files/src/routes/billing.ts",
    );
    expect(() =>
      resourcePathForLocalCodebaseFile(SUMMARY.snapshotPrefix, "../secret.ts"),
    ).toThrow(/Invalid local codebase path/);
  });

  it("renders a tree that points captured files at resources", () => {
    expect(
      renderCodebaseTree([
        {
          path: "src/routes/billing.ts",
          size: 20,
          captured: true,
          resourcePath: `${SUMMARY.snapshotPrefix}/files/src/routes/billing.ts`,
        },
        {
          path: "src/routes/huge.ts",
          size: 500_000,
          captured: false,
          skippedReason: "larger than sync limit",
        },
      ]),
    ).toContain("* src/routes/billing.ts ->");
  });

  it("instructs the agent to read the personal resource index first", () => {
    const instruction = buildLocalCodebaseInstruction(SUMMARY);
    expect(instruction).toContain(SUMMARY.indexPath);
    expect(instruction).toContain('scope: "personal"');
    expect(instruction).toContain("visual-answer");
  });
});
