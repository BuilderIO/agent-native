import { describe, expect, it } from "vitest";

import addRecordingToSpace from "./add-recording-to-space.js";
import archiveRecording from "./archive-recording.js";
import deleteRecordingPermanent from "./delete-recording-permanent.js";
import listRecordings from "./list-recordings.js";
import restoreRecording from "./restore-recording.js";
import tagRecording from "./tag-recording.js";
import trashRecording from "./trash-recording.js";

type Listed = {
  mcpApp?: unknown;
  mcpTool?: unknown;
  readOnly?: boolean;
  mcpAnnotations?: Record<string, boolean>;
  needsApproval?: unknown;
};

const writes = {
  "archive-recording": { action: archiveRecording, destructive: false },
  "trash-recording": { action: trashRecording, destructive: true },
  "restore-recording": { action: restoreRecording, destructive: false },
  "tag-recording": { action: tagRecording, destructive: false },
  "add-recording-to-space": { action: addRecordingToSpace, destructive: false },
  "delete-recording-permanent": {
    action: deleteRecordingPermanent,
    destructive: true,
  },
} as const;

async function asksFor(
  action: Listed,
  ctx: { caller: string; networkProtocol?: string },
): Promise<boolean> {
  const gate = action.needsApproval;
  if (typeof gate !== "function") return Boolean(gate);
  return Boolean(await gate({}, ctx));
}

describe("Clips list and batch tools over MCP", () => {
  it("lists recordings as a read-only tool", () => {
    const action = listRecordings as Listed;
    expect(action.mcpApp).toEqual({ compactCatalog: true });
    expect(action.mcpTool).toBeUndefined();
    expect(action.readOnly).toBe(true);
    expect(action.mcpAnnotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  it.each(Object.entries(writes))(
    "lists %s in the compact catalog with its hints",
    (_name, { action, destructive }) => {
      const listed = action as Listed;
      expect(listed.mcpApp).toEqual({ compactCatalog: true });
      expect(listed.mcpTool).toBeUndefined();
      expect(listed.mcpAnnotations).toEqual({
        readOnlyHint: false,
        destructiveHint: destructive,
        openWorldHint: false,
      });
    },
  );

  it.each(["add-recording-to-space", "delete-recording-permanent"] as const)(
    "asks a person before an outside agent runs %s",
    async (name) => {
      const action = writes[name].action as Listed;
      for (const caller of ["mcp", "http", "cli", "a2a", "webmcp"]) {
        expect(await asksFor(action, { caller })).toBe(true);
      }
      // ask_app over MCP runs the app's own agent for an outside one.
      expect(
        await asksFor(action, { caller: "tool", networkProtocol: "mcp" }),
      ).toBe(true);
      expect(await asksFor(action, { caller: "tool" })).toBe(false);
      expect(await asksFor(action, { caller: "frontend" })).toBe(false);
    },
  );

  it.each([
    "archive-recording",
    "trash-recording",
    "restore-recording",
    "tag-recording",
  ] as const)("runs %s for an outside agent without asking", async (name) => {
    expect(
      await asksFor(writes[name].action as Listed, { caller: "mcp" }),
    ).toBe(false);
  });
});
