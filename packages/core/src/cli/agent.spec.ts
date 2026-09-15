import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  listFileUploadProviders,
  unregisterFileUploadProvider,
} from "../file-upload/index.js";
import {
  createHeadlessBuiltinActions,
  parseAgentArgs,
  formatAgentUsage,
  runAgent,
} from "./agent.js";

describe("agent CLI", () => {
  it("parses a positional prompt", () => {
    expect(parseAgentArgs(["Call", "hello"])).toMatchObject({
      prompt: "Call hello",
      json: false,
      errors: [],
    });
  });

  it("parses engine and execution options", () => {
    expect(
      parseAgentArgs([
        "--message",
        "Summarize",
        "--engine=anthropic",
        "--model",
        "claude-test",
        "--soft-timeout-ms",
        "1000",
        "--max-iterations=3",
        "--json",
      ]),
    ).toMatchObject({
      prompt: "Summarize",
      engine: "anthropic",
      model: "claude-test",
      softTimeoutMs: 1000,
      maxIterations: 3,
      json: true,
      errors: [],
    });
  });

  it("reports missing values and includes usage", () => {
    const parsed = parseAgentArgs(["--engine"]);
    expect(parsed.errors).toContain("Missing value for --engine");
    expect(formatAgentUsage()).toContain("agent-native agent");
  });

  it("exposes docs-search to the headless agent loop", async () => {
    const actions = await createHeadlessBuiltinActions();
    const entry = actions["docs-search"];

    expect(entry.readOnly).toBe(true);
    expect(entry.tool.description).toContain("version-matched");

    const result = await entry.run({ slug: "agent-native-docs" });
    expect(result).toContain("node_modules/@agent-native/core/docs");
  });

  it("exposes the unified framework-search tool to the headless agent loop", async () => {
    const actions = await createHeadlessBuiltinActions();
    const entry = actions["framework-search"];

    expect(entry.readOnly).toBe(true);
    expect(entry.tool.description).toContain("Core");
  });

  it("exposes source-search to the headless agent loop", async () => {
    const actions = await createHeadlessBuiltinActions();
    const entry = actions["source-search"];

    expect(entry.readOnly).toBe(true);
    expect(entry.tool.description).toContain("Core");
  });
});

/*
 * `agent-native agent` runs app actions with no Nitro plugins mounted, and
 * action discovery skips `run.ts` (`SKIP_FILES`), so this loop reaches an app's
 * own provider registration only through the shared CLI bootstrap. Without it,
 * a template whose provider accepts a configuration the framework's rejects
 * runs here against the framework provider instead of its own.
 */
describe("agent CLI bootstrap", () => {
  const originalCwd = process.cwd();
  let tmpDir: string | null = null;

  afterEach(() => {
    process.chdir(originalCwd);
    unregisterFileUploadProvider("s3");
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });

  it("loads the app's CLI bootstrap before running", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-agent-boot-"));
    fs.mkdirSync(path.join(tmpDir, "actions"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "actions", "_cli-bootstrap.mjs"),
      `
        const { registerFileUploadProvider } = await import(${JSON.stringify(
          new URL("../file-upload/index.ts", import.meta.url).href,
        )});
        registerFileUploadProvider({
          id: "s3",
          name: "Fixture app storage",
          isConfigured: () => true,
          upload: async () => ({ url: "https://app.example/a", provider: "s3" }),
        });
      `,
    );
    process.chdir(tmpDir);

    // No prompt: `runAgent` bootstraps, then exits on the argument error, which
    // keeps the test off the model path.
    const code = await runAgent([], { stderr: () => {}, stdout: () => {} });

    expect(code).not.toBe(0);
    expect(
      listFileUploadProviders().map((provider) => provider.name),
    ).toStrictEqual(["Fixture app storage"]);
  });
});
