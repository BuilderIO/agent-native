import { describe, expect, it } from "vitest";
import { z } from "zod";

import { actionCallIsRetrySafe } from "../action-call-classification.js";
import {
  ACTION_EXECUTION_KEY,
  actionCallIntent,
  defineAction,
  preparedCallArguments,
} from "../action.js";
import { loadActionsFromStaticRegistry } from "./action-discovery.js";
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

  it("keeps the schema and gates a built registry keeps", () => {
    const action = defineAction({
      description: "Send a message",
      schema: z.object({ to: z.string(), body: z.string() }),
      needsApproval: true,
      requiresAuth: true,
      capabilityScopes: ["messages:send"],
      timeoutMs: 5_000,
      run: async () => ({ ok: true }),
    });

    const entry = filesystemActionEntry(action);
    const {
      mcpAnnotations: _annotations,
      mcpAnnotationDefaults: _defaults,
      ...built
    } = loadActionsFromStaticRegistry({ send: { default: action } }).send!;

    expect(entry).toMatchObject(built);
    expect(entry.schema).toBe(action.schema);
    expect(entry.needsApproval).toBe(true);
    expect(entry.requiresAuth).toBe(true);
    expect(entry.capabilityScopes).toEqual(["messages:send"]);
  });

  it("keeps the browser-persistence opt-out in the dev scan and a built registry", () => {
    const action = defineAction({
      description: "Reveal an API key",
      schema: z.object({ id: z.string() }),
      http: { method: "GET" },
      persistInBrowser: false,
      run: async () => ({ key: "secret" }),
    });

    expect(filesystemActionEntry(action).persistInBrowser).toBe(false);
    expect(
      loadActionsFromStaticRegistry({ reveal: { default: action } }).reveal!
        .persistInBrowser,
    ).toBe(false);
  });

  it("classifies a retrySafe predicate with schema defaults applied", async () => {
    const action = defineAction({
      description: "Append or replace a row",
      schema: z.object({
        id: z.string(),
        mode: z.enum(["append", "replace"]).default("append"),
      }),
      retrySafe: (input) => input.mode !== "append",
      run: async () => ({ ok: true }),
    });
    const entry = filesystemActionEntry(action);

    const intent = await actionCallIntent(entry, { id: "row-1" });
    if (!intent.valid) throw intent.error;

    // The handler appends by default, so the call is not safe to retry.
    expect(preparedCallArguments(intent)).toEqual({
      id: "row-1",
      mode: "append",
    });
    expect(actionCallIsRetrySafe(entry, preparedCallArguments(intent))).toBe(
      false,
    );
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
