import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll } from "vitest";
import sourceSearch from "./source-search.js";
import { materializeSourceCorpus } from "../../../scripts/materialize-source-corpus.mjs";
import { captureCliOutput } from "../../server/cli-capture.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(currentDir, "../../..");
const corpusRoot = path.join(packageRoot, "corpus");

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
  });

  it("reads and searches the packaged source corpus", async () => {
    await expect(
      runSourceSearch(["--path", "templates/chat/package.json"]),
    ).resolves.toContain('"name": "chat"');

    const output = await runSourceSearch(["--query", "defineAction"]);
    expect(output).toContain("Found");
    expect(output).toContain("core/src/action.ts");
  });
});
