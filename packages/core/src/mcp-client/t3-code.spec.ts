import { describe, expect, it } from "vitest";

import {
  t3CodeAgentsFromCapabilities,
  t3CodeThreadAgent,
  toT3CodeThread,
} from "./t3-code.js";

describe("T3 Code agents", () => {
  it("offers Claude Code and Codex only when T3 can run them", () => {
    expect(
      t3CodeAgentsFromCapabilities({
        providers: [
          {
            providerInstanceId: "codex-main",
            driverKind: "codex",
            models: [{ id: "gpt-5.5" }],
            constraints: [],
          },
          {
            providerInstanceId: "claude-main",
            driverKind: "claudeAgent",
            models: [{ id: "claude-opus-5-5" }, { id: "claude-sonnet-5-5" }],
            constraints: [],
          },
          {
            providerInstanceId: "claude-second",
            driverKind: "claudeAgent",
            models: [{ id: "claude-haiku-5-5" }],
            constraints: [],
          },
          {
            providerInstanceId: "cursor",
            driverKind: "cursor",
            models: [{ id: "auto" }],
            constraints: [],
          },
        ],
      }),
    ).toEqual([
      {
        kind: "claude-code",
        name: "Claude Code",
        providerInstanceId: "claude-main",
        model: "claude-opus-5-5",
      },
      {
        kind: "codex",
        name: "Codex",
        providerInstanceId: "codex-main",
        model: "gpt-5.5",
      },
    ]);
  });

  it("leaves out an agent that is signed out or has no model", () => {
    expect(
      t3CodeAgentsFromCapabilities({
        providers: [
          {
            providerInstanceId: "claude-main",
            driverKind: "claudeAgent",
            models: [{ id: "claude-opus-5-5" }],
            constraints: ["Sign in to Claude Code"],
          },
          {
            providerInstanceId: "codex-main",
            driverKind: "codex",
            models: [],
            constraints: [],
          },
        ],
      }),
    ).toEqual([]);
    expect(t3CodeAgentsFromCapabilities(null)).toEqual([]);
  });

  it("tells which agent ran a thread from its provider or model", () => {
    expect(t3CodeThreadAgent({ providerInstanceId: "claude-main" })).toBe(
      "claude-code",
    );
    expect(t3CodeThreadAgent({ model: "claude-opus-5-5" })).toBe("claude-code");
    expect(t3CodeThreadAgent({ model: "gpt-5.5" })).toBe("codex");
    expect(t3CodeThreadAgent({ providerInstanceId: "codex" })).toBe("codex");
    expect(t3CodeThreadAgent({ model: "gemini-3" })).toBeNull();
  });

  it("reads a thread T3 lists, and skips one with no ID", () => {
    expect(
      toT3CodeThread({
        threadId: "t-1",
        title: "Launch planning",
        status: "running",
        model: "claude-opus-5-5",
        projectId: "p-1",
        updatedAt: "2026-11-25T18:00:00.000Z",
      }),
    ).toEqual({
      threadId: "t-1",
      title: "Launch planning",
      status: "running",
      agent: "claude-code",
      projectId: "p-1",
      updatedAt: "2026-11-25T18:00:00.000Z",
    });
    expect(toT3CodeThread({ threadId: "t-2" })).toMatchObject({
      title: "Untitled thread",
      status: "idle",
      agent: null,
      projectId: null,
    });
    expect(toT3CodeThread({ title: "No ID" })).toBeNull();
  });
});
