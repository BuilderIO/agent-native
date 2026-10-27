import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ACTION_EXECUTION_KEY, defineAction } from "../action.js";
import { filesystemActionEntry } from "./filesystem-action-entry.js";

const keyOf = (entry: object) =>
  (entry as Record<symbol, unknown>)[ACTION_EXECUTION_KEY];

describe("filesystemActionEntry", () => {
  it("keeps the execution key, retry safety and zoneless-time zone of a defineAction module", () => {
    const action = defineAction({
      description: "Replace the dashboard config",
      schema: z.object({ id: z.string() }),
      retrySafe: true,
      zonelessTimes: "calendar",
      run: async () => ({ ok: true }),
    });
    expect(keyOf(action)).toBeDefined();

    const entry = filesystemActionEntry(action);

    expect(keyOf(entry)).toBe(keyOf(action));
    expect(entry.retrySafe).toBe(true);
    expect(entry.zonelessTimes).toBe("calendar");
    expect(entry.run).toBe(action.run);
    // A registry rebuild spreads entries; the key has to survive the copy.
    expect(keyOf({ ...entry })).toBe(keyOf(action));
  });

  it("preserves read-only metadata and defaults unknown writes to destructive", () => {
    const run = async () => ({});
    const entry = filesystemActionEntry({
      tool: { description: "Plain", parameters: { type: "object" } },
      run,
      readOnly: true,
    });

    expect(entry.run).toBe(run);
    expect(keyOf(entry)).toBeUndefined();
    expect(entry.readOnly).toBe(true);
    expect(entry.mcpAnnotations).toBeUndefined();
    expect(entry.mcpAnnotationDefaults).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    });
  });

  it("keeps plan-mode effects, so a read-only action that can write defaults to a write", () => {
    const planMode = {
      effect: (args: { method?: string }) =>
        args.method === "POST" ? ("write" as const) : ("read" as const),
    };
    const entry = filesystemActionEntry({
      tool: { description: "Fetch or send", parameters: { type: "object" } },
      run: async () => ({}),
      readOnly: true,
      planMode,
    });

    expect(entry.planMode).toBe(planMode);
    expect(entry.mcpAnnotationDefaults).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
  });

  it("preserves explicit MCP annotations from the action module", () => {
    const mcpAnnotations = {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    };
    const entry = filesystemActionEntry({
      tool: { description: "Explicit", parameters: { type: "object" } },
      run: async () => ({}),
      readOnly: false,
      mcpAnnotations,
    });

    expect(entry.readOnly).toBe(false);
    expect(entry.mcpAnnotations).toBe(mcpAnnotations);
    expect(entry.mcpAnnotationDefaults).toBeUndefined();
  });

  it("defaults an unannotated filesystem write to destructive without declaring it", () => {
    const entry = filesystemActionEntry({
      tool: { description: "Write", parameters: { type: "object" } },
      run: async () => ({}),
      readOnly: false,
    });

    expect(entry.mcpAnnotations).toBeUndefined();
    expect(entry.mcpAnnotationDefaults).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
  });

  it("treats a module that does not say it is read-only as a write", () => {
    const entry = filesystemActionEntry({
      tool: { description: "Unknown", parameters: { type: "object" } },
      run: async () => ({}),
    });

    expect(entry.readOnly).toBeUndefined();
    expect(entry.mcpAnnotations).toBeUndefined();
    expect(entry.mcpAnnotationDefaults).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
  });
});
