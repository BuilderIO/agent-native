import { describe, expect, it, beforeAll } from "vitest";

import { materializeSourceCorpus } from "../../../scripts/materialize-source-corpus.mjs";
import { captureCliOutput } from "../../server/cli-capture.js";
import frameworkSearch from "./framework-search.js";

async function runFrameworkSearch(args: string[]): Promise<string> {
  return captureCliOutput(() => frameworkSearch(args));
}

describe("framework-search", { timeout: 60000 }, () => {
  beforeAll(() => {
    materializeSourceCorpus();
  }, 60000);

  it("searches docs and source together", async () => {
    const output = await runFrameworkSearch([
      "--pattern",
      "framework-search",
      "--limit",
      "50",
    ]);

    expect(output).toContain("[doc]");
    expect(output).toContain("[source]");
    expect(output).toContain("docs/agent-native-docs");
    expect(output).toContain("core/src/scripts/docs/framework-search.ts");
  });

  it("supports glob path filters and SQL-like content matching", async () => {
    const globOutput = await runFrameworkSearch([
      "--pattern",
      "defineAction",
      "--scope",
      "source",
      "--path",
      "templates/chat/actions/*.ts",
    ]);
    expect(globOutput).toContain("templates/chat/actions/hello.ts");
    expect(globOutput).not.toContain("templates/mail/actions/");

    const sqlLikeOutput = await runFrameworkSearch([
      "--pattern",
      "%defineAction%",
      "--mode",
      "sql-like",
      "--scope",
      "source",
      "--path",
      "templates/chat/actions/hello.ts",
    ]);
    expect(sqlLikeOutput).toContain("templates/chat/actions/hello.ts");
  });

  it("supports safe regex matching and reports invalid patterns", async () => {
    const regexOutput = await runFrameworkSearch([
      "--pattern",
      "Agent(?:Panel|Sidebar)",
      "--mode",
      "regex",
      "--scope",
      "source",
      "--path",
      "core/src/client/*",
    ]);
    expect(regexOutput).toContain("core/src/client/AgentPanel.tsx");

    await expect(
      runFrameworkSearch(["--pattern", "[", "--mode", "regex"]),
    ).resolves.toContain("Invalid regex search pattern");
  });
});
