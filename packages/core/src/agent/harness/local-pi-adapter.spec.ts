import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  filterLocalPiHostTools,
  localPiHostToolsToDefinitions,
  localPiSessionEventToHarnessEvents,
  normalizeLocalPiResumeState,
} from "./local-pi-adapter.js";
import type { AgentHarnessHostTool } from "./types.js";

describe("local Pi harness adapter", () => {
  it("maps Pi streaming and tool events without exposing session data", () => {
    expect(
      localPiSessionEventToHarnessEvents({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hello" },
      }),
    ).toEqual([{ type: "text-delta", text: "hello" }]);
    expect(
      localPiSessionEventToHarnessEvents({
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: "read",
        args: { path: "README.md" },
      }),
    ).toEqual([
      {
        type: "tool-start",
        id: "call-1",
        name: "read",
        input: { path: "README.md" },
      },
    ]);
  });

  it("accepts resume files only from the configured Pi session directory", () => {
    const sessions = path.resolve("/tmp/pi-agent/sessions");
    expect(
      normalizeLocalPiResumeState(
        { sessionFile: path.join(sessions, "project", "session.jsonl") },
        sessions,
      ),
    ).toEqual({
      sessionFile: path.join(sessions, "project", "session.jsonl"),
    });
    expect(
      normalizeLocalPiResumeState(
        { sessionFile: "/tmp/pi-agent/auth.json" },
        sessions,
      ),
    ).toBeNull();
    expect(
      normalizeLocalPiResumeState(
        { sessionFile: "/tmp/other/session.jsonl" },
        sessions,
      ),
    ).toBeNull();
  });

  it("keeps only explicitly read-only host tools in allow-reads mode", () => {
    const read = hostTool(true);
    const write = hostTool(false);

    expect(
      Object.keys(filterLocalPiHostTools({ read, write }, "allow-reads")),
    ).toEqual(["read"]);
    expect(
      Object.keys(filterLocalPiHostTools({ read, write }, "allow-edits")),
    ).toEqual(["read", "write"]);
  });

  it("fails closed for actions that require approval", async () => {
    const execute = vi.fn(async () => "published");
    const definitions = localPiHostToolsToDefinitions({
      publish: {
        description: "Publish",
        inputSchema: { type: "object" },
        needsApproval: async () => true,
        execute,
      },
    });
    const publish = definitions[0] as {
      execute: (
        id: string,
        input: unknown,
        signal?: AbortSignal,
      ) => Promise<unknown>;
    };

    await expect(publish.execute("call-1", {})).rejects.toThrow(
      "requires approval",
    );
    expect(execute).not.toHaveBeenCalled();
  });
});

function hostTool(readOnly: boolean): AgentHarnessHostTool {
  return {
    description: readOnly ? "Read" : "Write",
    inputSchema: { type: "object" },
    readOnly,
    execute: vi.fn(async () => "ok"),
  };
}
