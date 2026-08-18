import { describe, expect, it } from "vitest";

import {
  HOSTED_HARNESS_AGENT_LABELS,
  HOSTED_HARNESS_AGENT_DESCRIPTIONS,
  filterHostedHarnessToolNames,
  hostedHarnessSystemPrompt,
  isHostedHarnessConfigured,
  normalizeHostedHarnessRuntime,
  normalizeHostedHarnessRuntimes,
} from "./hosted.js";

describe("hosted tools-only harness policy", () => {
  it("accepts Claude's short runtime alias and the supported picker runtimes", () => {
    expect(normalizeHostedHarnessRuntime("claude")).toBe("claude-code");
    expect(normalizeHostedHarnessRuntimes(["codex", "pi", "opencode"])).toEqual(
      ["codex", "pi", "opencode"],
    );
    expect(normalizeHostedHarnessRuntimes(undefined)).toEqual([
      "claude-code",
      "codex",
      "pi",
      "opencode",
    ]);
    expect(isHostedHarnessConfigured(true)).toBe(true);
    expect(isHostedHarnessConfigured({ runtimes: ["codex"] })).toBe(true);
    expect(isHostedHarnessConfigured(false)).toBe(false);
  });

  it("removes repository, shell, and code-execution tools", () => {
    expect(
      filterHostedHarnessToolNames([
        "list-messages",
        "create-event",
        "run-code",
        "read-file",
        "write-file",
        "read-local-file",
        "write-local-file",
        "apply-source-edit",
        "update-file",
        "delete-file",
        "github-repo-list-files",
        "github-repo-read-file",
        "github-repo-search-code",
        "github-repo-write-file",
        "github-repo-delete-file",
        "save-data-program",
        "preview-data-program",
        "run-data-program",
        "list-data-programs",
        "get-data-program",
        "delete-data-program",
        "workspace-files",
        "connect-builder",
        "data-program-query",
      ]),
    ).toEqual(["list-messages", "create-event"]);
  });

  it("explains the production boundary for every picker runtime", () => {
    expect(HOSTED_HARNESS_AGENT_LABELS["claude-code"]).toBe("Claude Code");
    expect(HOSTED_HARNESS_AGENT_DESCRIPTIONS.codex).toContain(
      "Use the Electron app for full coding workflows.",
    );
    expect(hostedHarnessSystemPrompt("claude-code")).toContain(
      "no repository, shell, filesystem, code-editing, or code-execution tools",
    );
  });
});
