import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ACTION_EXECUTION_KEY, defineAction } from "../action.js";
import { filesystemActionEntry } from "./filesystem-action-entry.js";

const keyOf = (entry: object) =>
  (entry as Record<symbol, unknown>)[ACTION_EXECUTION_KEY];

describe("filesystemActionEntry", () => {
  it("keeps the execution key and retry safety of a defineAction module", () => {
    const action = defineAction({
      description: "Replace the dashboard config",
      schema: z.object({ id: z.string() }),
      retrySafe: true,
      run: async () => ({ ok: true }),
    });
    expect(keyOf(action)).toBeDefined();

    const entry = filesystemActionEntry(action);

    expect(keyOf(entry)).toBe(keyOf(action));
    expect(entry.retrySafe).toBe(true);
    expect(entry.run).toBe(action.run);
    // A registry rebuild spreads entries; the key has to survive the copy.
    expect(keyOf({ ...entry })).toBe(keyOf(action));
  });

  it("carries only the scan's fields and no key for a plain module", () => {
    const run = async () => ({});
    const entry = filesystemActionEntry({
      tool: { description: "Plain", parameters: { type: "object" } },
      run,
      readOnly: true,
    });

    expect(entry.run).toBe(run);
    expect(keyOf(entry)).toBeUndefined();
    expect(entry.readOnly).toBeUndefined();
  });
});
