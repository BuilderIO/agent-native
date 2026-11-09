import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { actionCallIsRetrySafe } from "../action-call-classification.js";
import {
  ACTION_EXECUTION_KEY,
  actionCallIntent,
  defineAction,
  isActionDefinitionError,
  preparedCallArguments,
} from "../action.js";
import { loadActionsFromStaticRegistry } from "./action-discovery.js";
import {
  actionDefinition,
  filesystemActionEntry,
  importDevActionEntry,
} from "./filesystem-action-entry.js";

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

  it("keeps an action's word that its empty lists erase nothing", () => {
    const action = defineAction({
      description: "Generate a design",
      schema: z.object({ devices: z.array(z.string()).optional() }),
      emptyListsEraseNothing: true,
      run: async () => ({ ok: true }),
    });

    expect(filesystemActionEntry(action).emptyListsEraseNothing).toBe(true);
    expect(
      loadActionsFromStaticRegistry({ generate: { default: action } }).generate
        ?.emptyListsEraseNothing,
    ).toBe(true);
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

  it("keeps each MCP decision from the action module and drops anything else", () => {
    const decided = (mcpTool: unknown) =>
      filesystemActionEntry({
        tool: { description: "Decided", parameters: { type: "object" } },
        run: async () => ({}),
        mcpTool,
      }).mcpTool;

    expect(decided(true)).toBe(true);
    expect(decided(false)).toBe(false);
    expect(decided("search")).toBe("search");
    expect(decided("yes")).toBeUndefined();
    expect(decided(undefined)).toBeUndefined();
  });

  it("drops malformed MCP annotations and uses the conservative defaults", () => {
    const entry = filesystemActionEntry({
      tool: { description: "Malformed", parameters: { type: "object" } },
      run: async () => ({}),
      readOnly: true,
      mcpAnnotations: { readOnlyHint: "yes" },
    });

    expect(entry.mcpAnnotations).toBeUndefined();
    expect(entry.mcpAnnotationDefaults).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    });
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

describe("actionDefinition", () => {
  const tool = { description: "Send", parameters: { type: "object" } };
  const run = async () => ({});

  it("takes named tool and run before a default action, as the built registry does", () => {
    const mod = {
      tool,
      run,
      needsApproval: true,
      default: { tool, run, needsApproval: false },
    };

    expect(actionDefinition(mod)).toBe(mod);
    expect(filesystemActionEntry(mod).needsApproval).toBe(true);
    expect(
      loadActionsFromStaticRegistry({ send: mod }).send!.needsApproval,
    ).toBe(true);
  });

  it("takes a default action when the module names none", () => {
    const action = { tool, run };
    expect(actionDefinition({ default: action })).toBe(action);
  });

  it("finds no action in a CLI script", () => {
    expect(actionDefinition({ default: async () => {} })).toBeUndefined();
    expect(actionDefinition({ tool })).toBeUndefined();
  });
});

describe("importDevActionEntry", () => {
  const write = (dir: string, file: string, source: string) => {
    const filePath = path.join(dir, file);
    fs.writeFileSync(filePath, source);
    return filePath;
  };

  it("loads a real action, and leaves CLI scripts to the shell wrapper", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "an-dev-entry-"));
    try {
      const good = write(
        dir,
        "good.ts",
        `export default { tool: { description: "Rules", parameters: { type: "object" } }, searchHints: ["inbox rule"], run: async () => "ok" };
`,
      );
      const cli = write(dir, "cli.ts", 'throw new Error("runs at import");\n');
      const plain = write(dir, "plain.ts", "export const value = 1;\n");

      expect((await importDevActionEntry(good, "good"))?.searchHints).toEqual([
        "inbox rule",
      ]);
      await expect(importDevActionEntry(cli, "cli")).resolves.toBeNull();
      await expect(importDevActionEntry(plain, "plain")).resolves.toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws a named definition error instead of falling back to the wrapper", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "an-dev-entry-"));
    try {
      // What `defineAction` throws at import for bad hints: a definition error
      // that cannot name the file it is in.
      const defined = write(
        dir,
        "defined.ts",
        `throw Object.assign(new TypeError("searchHints must be at most 12 non-empty strings."), { name: "ActionDefinitionError", actionDefinitionError: true });
`,
      );
      const handBuilt = write(
        dir,
        "hand-built.ts",
        `export default { tool: { description: "Rules", parameters: { type: "object" } }, searchHints: "inbox rule", run: async () => "ok" };
`,
      );

      for (const [filePath, name] of [
        [defined, "manage-rules"],
        [handBuilt, "hand-built"],
      ] as const) {
        await expect(importDevActionEntry(filePath, name)).rejects.toSatisfy(
          (error) =>
            isActionDefinitionError(error) &&
            error.actionName === name &&
            error.message.startsWith(`Action "${name}": searchHints`),
        );
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
