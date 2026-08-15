import { describe, expect, it } from "vitest";

import {
  HOSTED_HARNESS_AGENT_DESCRIPTIONS,
  filterHostedHarnessToolNames,
  hostedHarnessSystemPrompt,
  normalizeHostedHarnessRuntime,
  normalizeHostedHarnessRuntimes,
} from "./hosted.js";

describe("hosted tools-only harness policy", () => {
  it("accepts Claude's short runtime alias and the supported picker runtimes", () => {
    expect(normalizeHostedHarnessRuntime("claude")).toBe("claude-code");
    expect(normalizeHostedHarnessRuntimes(["codex", "pi", "opencode"])).toEqual(
      ["codex", "pi", "opencode"],
    );
  });

  it("removes repository, shell, and code-execution tools", () => {
    expect(
      filterHostedHarnessToolNames([
        "list-messages",
        "create-event",
        "run-code",
        "workspace-files",
        "data-program-query",
      ]),
    ).toEqual(["list-messages", "create-event"]);
  });

  it("explains the production boundary for every picker runtime", () => {
    expect(HOSTED_HARNESS_AGENT_DESCRIPTIONS.codex).toContain(
      "Use the Electron app for full coding workflows.",
    );
    expect(hostedHarnessSystemPrompt("claude-code")).toContain(
      "no repository, shell, filesystem, code-editing, or code-execution tools",
    );
  });
});
