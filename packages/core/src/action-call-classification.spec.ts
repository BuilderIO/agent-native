import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  actionCallEmitsChange,
  actionChangeResource,
} from "./action-call-classification.js";
import { defineAction } from "./action.js";
import { createAgentEngineScriptEntries } from "./server/agent-chat/script-entries.js";

const emits = (entry: object, params: unknown, fallbackReadOnly = false) =>
  actionCallEmitsChange(entry as never, params, fallbackReadOnly);

describe("actionCallEmitsChange", () => {
  it("does not publish change events for manage-agent-engine reads that the UI polls", async () => {
    const entry = (await createAgentEngineScriptEntries("analytics"))[
      "manage-agent-engine"
    ]!;

    for (const action of ["list", "test", "get-app-default"]) {
      expect(emits(entry, { action }), action).toBe(false);
    }
  });

  it("still publishes for manage-agent-engine writes and for operations it has not classified", async () => {
    const entry = (await createAgentEngineScriptEntries("analytics"))[
      "manage-agent-engine"
    ]!;

    for (const action of ["set", "set-app-default", "reset-app-default"]) {
      expect(emits(entry, { action }), action).toBe(true);
    }
    // A new operation nobody has declared read-only must not go quiet.
    expect(emits(entry, { action: "get-something-new" })).toBe(true);
  });

  it("treats declared read-only actions as quiet and undeclared actions as mutating", () => {
    const get = defineAction({
      description: "read",
      schema: z.object({}),
      http: { method: "GET" },
      run: async () => ({}),
    });
    const flagged = defineAction({
      description: "read",
      schema: z.object({}),
      readOnly: true,
      run: async () => ({}),
    });
    const undeclared = defineAction({
      description: "unknown",
      schema: z.object({}),
      run: async () => ({}),
    });

    expect(emits(get, {})).toBe(false);
    expect(emits(flagged, {})).toBe(false);
    expect(emits(undeclared, {})).toBe(true);
    expect(emits({}, {}, true)).toBe(false);
    expect(emits({}, {}, false)).toBe(true);
  });

  it("lets a mutating action opt out without presenting it as read-only", () => {
    const telemetry = defineAction({
      description: "save playback position",
      schema: z.object({}),
      changeEvents: false,
      run: async () => ({}),
    });

    expect(telemetry.changeEvents).toBe(false);
    expect(emits(telemetry, {})).toBe(false);
    // The opt-out must not leak into read-only semantics (plan mode, result caching).
    expect(telemetry.readOnly).toBeUndefined();
  });

  it("keeps publishing when changeEvents is explicitly true", () => {
    expect(emits({ changeEvents: true }, {})).toBe(true);
  });
});

describe("actionChangeResource", () => {
  const resource = { resourceType: "document", resourceId: "doc-1" };

  it("returns nothing for an action that declares no resource", () => {
    expect(actionChangeResource({}, { id: "doc-1" }, {})).toBeUndefined();
  });

  it("derives the resource from the call input", () => {
    const entry = defineAction({
      description: "edit",
      schema: z.object({ id: z.string() }),
      changeResource: (input) => ({
        resourceType: "document",
        resourceId: input.id,
      }),
      run: async () => ({}),
    });

    expect(actionChangeResource(entry, { id: "doc-1" }, {})).toEqual(resource);
  });

  it("derives the resource from the result when the input names only a child id", () => {
    const entry = defineAction({
      description: "delete file",
      schema: z.object({ fileId: z.string() }),
      changeResource: (_input, result) =>
        result.changed
          ? { resourceType: "design", resourceId: result.designId }
          : null,
      run: async () => ({ changed: true, designId: "d1" }),
    });

    expect(
      actionChangeResource(
        entry,
        { fileId: "f1" },
        { changed: true, designId: "d1" },
      ),
    ).toEqual({ resourceType: "design", resourceId: "d1" });
    expect(
      actionChangeResource(
        entry,
        { fileId: "f1" },
        { changed: false, designId: "d1" },
      ),
    ).toBeUndefined();
  });

  it("treats null, malformed, and throwing declarations as the actor-only default", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(actionChangeResource({ changeResource: () => null }, {}, {})).toBe(
        undefined,
      );
      expect(
        actionChangeResource(
          {
            changeResource: () => ({
              resourceType: "document",
              resourceId: "",
            }),
          },
          {},
          {},
        ),
      ).toBeUndefined();
      expect(
        actionChangeResource(
          {
            changeResource: () => {
              throw new Error("bad input");
            },
          },
          {},
          {},
        ),
      ).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});
