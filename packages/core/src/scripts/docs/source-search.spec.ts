import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, beforeAll, afterEach } from "vitest";

import { materializeSourceCorpus } from "../../../scripts/materialize-source-corpus.mjs";
import { captureCliOutput } from "../../server/cli-capture.js";
import sourceSearch from "./source-search.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(currentDir, "../../..");
const corpusRoot = path.join(packageRoot, "corpus");
const scopeFixtureRoot = path.join(corpusRoot, "templates", "scope-fixture");

function listCorpusFiles(dir = corpusRoot, base = corpusRoot): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listCorpusFiles(abs, base));
    } else if (entry.isFile()) {
      files.push(path.relative(base, abs).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

async function runSourceSearch(args: string[]): Promise<string> {
  return captureCliOutput(() => sourceSearch(args));
}

describe("source-search", { timeout: 60000 }, () => {
  beforeAll(() => {
    materializeSourceCorpus();
  }, 60000);

  afterEach(() => {
    fs.rmSync(scopeFixtureRoot, { recursive: true, force: true });
  });

  it("materializes version-matched core and template source without runtime artifacts", () => {
    const files = listCorpusFiles();

    expect(files).toContain("core/src/action.ts");
    expect(files).toContain("core/docs/AGENTS.md");
    expect(files).toContain("templates/chat/package.json");
    expect(files).toContain("templates/chat/data/sync-config.json");

    expect(files.some((file) => file.includes("/node_modules/"))).toBe(false);
    expect(files.some((file) => file.includes("/target/"))).toBe(false);
    expect(files.some((file) => file.includes("/.output/"))).toBe(false);
    expect(files.some((file) => file.endsWith("/.env"))).toBe(false);
    expect(files.some((file) => /\.spec\.[cm]?[jt]sx?$/.test(file))).toBe(
      false,
    );
    expect(files.some((file) => /\.test\.[cm]?[jt]sx?$/.test(file))).toBe(
      false,
    );
    expect(files.some((file) => file.endsWith(".db"))).toBe(false);
    expect(files.some((file) => file.endsWith(".db-wal"))).toBe(false);
    expect(files).not.toContain("core/src/assets/branding/favicon.png");
    expect(files).not.toContain(
      "templates/clips/chrome-extension/public/icons/icon-128.png",
    );
    expect(files).not.toContain(
      "templates/plan/public/fonts/Excalifont-Regular.woff2",
    );
    expect(
      files.some((file) => /\.(png|webp|ico|woff2?|ttf)$/.test(file)),
    ).toBe(false);
  });

  it("reads and searches the packaged source corpus", async () => {
    await expect(
      runSourceSearch(["--path", "templates/chat/package.json"]),
    ).resolves.toContain('"name": "chat"');

    const output = await runSourceSearch(["--query", "defineAction"]);
    expect(output).toContain("Found");
    expect(output).toContain("core/src/action.ts");
  });

  it("hides dev-scoped skill files from runtime query, path, and directory results", async () => {
    writeCorpusFixture(
      ".agents/skills/dev-only/SKILL.md",
      [
        "---",
        "name: dev-only",
        "description: Dev-only source-search fixture",
        "scope: dev",
        "---",
        "DEV_ONLY_SOURCE_SEARCH_TOKEN",
      ].join("\r\n"),
    );
    writeCorpusFixture(
      ".agents/skills/dev-only/notes.md",
      "DEV_ONLY_EXTRA_SOURCE_SEARCH_TOKEN",
    );
    writeCorpusFixture(
      ".agents/skills/runtime-only/SKILL.md",
      [
        "---",
        "name: runtime-only",
        "description: Runtime source-search fixture",
        "scope: runtime",
        "---",
        "RUNTIME_SOURCE_SEARCH_TOKEN",
      ].join("\n"),
    );

    await expect(
      runSourceSearch([
        "--path",
        "templates/scope-fixture/.agents/skills/dev-only/SKILL.md",
      ]),
    ).resolves.toContain("not available to runtime source-search");
    await expect(
      runSourceSearch([
        "--path",
        "templates/scope-fixture/.agents/skills/dev-only/notes.md",
      ]),
    ).resolves.toContain("not available to runtime source-search");

    const directoryOutput = await runSourceSearch([
      "--path",
      "templates/scope-fixture/.agents/skills",
    ]);
    expect(directoryOutput).not.toContain("dev-only");
    expect(directoryOutput).toContain("runtime-only");

    const devQueryOutput = await runSourceSearch([
      "--query",
      "DEV_ONLY_SOURCE_SEARCH_TOKEN",
    ]);
    expect(devQueryOutput).toContain("No source files found");
    expect(devQueryOutput).not.toContain("dev-only");

    const runtimeQueryOutput = await runSourceSearch([
      "--query",
      "RUNTIME_SOURCE_SEARCH_TOKEN",
    ]);
    expect(runtimeQueryOutput).toContain(
      "templates/scope-fixture/.agents/skills/runtime-only/SKILL.md",
    );
  });
});

function writeCorpusFixture(relativePath: string, contents: string): void {
  const filePath = path.join(scopeFixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}
