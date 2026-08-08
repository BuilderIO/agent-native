import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ALWAYS_ON_CORE_ACTIONS,
  autoDiscoverActions,
  CORE_ACTION_GROUPS,
  loadActionsFromStaticRegistry,
  mergeCoreSharingActions,
} from "./action-discovery.js";

const CORE_ACTION_DISCOVERY_TIMEOUT_MS = 15_000;
const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("action discovery", () => {
  it(
    "loads TypeScript action files from plain source directories",
    async () => {
      const actionsDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "agent-native-actions-"),
      );
      tmpDirs.push(actionsDir);
      fs.writeFileSync(
        path.join(actionsDir, "hello.ts"),
        [
          "export default {",
          '  tool: { description: "Greet", parameters: { type: "object", properties: {} } },',
          "  readOnly: true,",
          '  run: async () => ({ message: "Hello from TS" }),',
          "};",
          "",
        ].join("\n"),
      );

      const registry = await autoDiscoverActions(actionsDir);

      expect(registry.hello).toBeDefined();
      expect(registry.hello.readOnly).toBe(true);
      await expect(registry.hello.run({})).resolves.toEqual({
        message: "Hello from TS",
      });
    },
    CORE_ACTION_DISCOVERY_TIMEOUT_MS,
  );

  it("preserves explicit readOnly false from static defineAction entries", () => {
    const registry = loadActionsFromStaticRegistry({
      "mutating-read": {
        default: {
          tool: { description: "Mutating read", parameters: {} },
          http: { method: "GET" },
          readOnly: false,
          run: async () => ({ ok: true }),
        },
      },
    });

    expect(registry["mutating-read"].readOnly).toBe(false);
  });

  it("preserves explicit readOnly false from named action entries", () => {
    const registry = loadActionsFromStaticRegistry({
      "named-mutating-read": {
        tool: { description: "Named mutating read", parameters: {} },
        http: { method: "GET" },
        readOnly: false,
        run: async () => ({ ok: true }),
      },
    });

    expect(registry["named-mutating-read"].readOnly).toBe(false);
  });

  it("preserves explicit parallelSafe metadata", () => {
    const registry = loadActionsFromStaticRegistry({
      "safe-write": {
        default: {
          tool: { description: "Safe write", parameters: {} },
          parallelSafe: true,
          run: async () => ({ ok: true }),
        },
      },
    });

    expect(registry["safe-write"].parallelSafe).toBe(true);
  });

  it("preserves explicit duplicate-read opt-out metadata", () => {
    const registry = loadActionsFromStaticRegistry({
      "poll-run": {
        default: {
          tool: { description: "Poll run status", parameters: {} },
          readOnly: true,
          dedupe: false,
          run: async () => ({ status: "running" }),
        },
      },
    });

    expect(registry["poll-run"].dedupe).toBe(false);
  });

  it("preserves explicit allowInPlanMode false metadata", () => {
    const registry = loadActionsFromStaticRegistry({
      "act-only-read": {
        default: {
          tool: { description: "Act-only read", parameters: {} },
          readOnly: true,
          allowInPlanMode: false,
          run: async () => ({ ok: true }),
        },
      },
    });

    expect(registry["act-only-read"].allowInPlanMode).toBe(false);
  });

  it("preserves Plan-mode effect metadata", () => {
    const classify = (args: any) =>
      args.action === "list" ? ("read" as const) : ("write" as const);
    const registry = loadActionsFromStaticRegistry({
      "mixed-records": {
        default: {
          tool: { description: "Manage records", parameters: {} },
          planMode: {
            effect: classify,
            allowedValues: { action: ["list"] },
            allowedProperties: ["action"],
            requiredProperties: ["action"],
          },
          run: async () => ({ ok: true }),
        },
      },
    });

    expect(registry["mixed-records"].planMode).toEqual({
      effect: classify,
      allowedValues: { action: ["list"] },
      allowedProperties: ["action"],
      requiredProperties: ["action"],
    });
  });

  it("preserves per-tool timeout and result limits", () => {
    const registry = loadActionsFromStaticRegistry({
      "slow-provider": {
        default: {
          tool: { description: "Slow provider", parameters: {} },
          timeoutMs: 120_000,
          maxResultChars: 10_000,
          run: async () => ({ ok: true }),
        },
      },
    });

    expect(registry["slow-provider"].timeoutMs).toBe(120_000);
    expect(registry["slow-provider"].maxResultChars).toBe(10_000);
  });

  it("preserves agentTool:false so discovery keeps it hidden from the agent", () => {
    const registry = loadActionsFromStaticRegistry({
      "ui-sync": {
        default: {
          tool: { description: "Sync UI selection", parameters: {} },
          agentTool: false,
          run: async () => ({ ok: true }),
        },
      },
    });

    expect(registry["ui-sync"].agentTool).toBe(false);
  });

  it("preserves requiresAuth:false from static defineAction entries", () => {
    const registry = loadActionsFromStaticRegistry({
      "public-metadata": {
        default: {
          tool: { description: "Public metadata", parameters: {} },
          http: { method: "GET" },
          readOnly: true,
          requiresAuth: false,
          run: async () => ({ ok: true }),
        },
      },
    });

    expect(registry["public-metadata"].requiresAuth).toBe(false);
  });

  it("preserves publicAgent metadata from static defineAction entries", () => {
    const registry = loadActionsFromStaticRegistry({
      "public-search": {
        default: {
          tool: { description: "Public search", parameters: {} },
          publicAgent: {
            expose: true,
            readOnly: true,
            requiresAuth: false,
            isConsequential: false,
          },
          run: async () => ({ ok: true }),
        },
      },
    });

    expect(registry["public-search"].publicAgent).toEqual({
      expose: true,
      readOnly: true,
      requiresAuth: false,
      isConsequential: false,
    });
  });

  it("preserves MCP Apps metadata from static defineAction entries", () => {
    const mcpApp = {
      resource: {
        title: "Preview",
        html: "<!doctype html><p>Preview</p>",
        csp: { connectDomains: ["https://example.com"] },
      },
      visibility: ["model", "app"],
    };
    const registry = loadActionsFromStaticRegistry({
      "preview-thing": {
        default: {
          tool: { description: "Preview thing", parameters: {} },
          mcpApp,
          run: async () => ({ ok: true }),
        },
      },
    });

    expect(registry["preview-thing"].mcpApp).toBe(mcpApp);
  });

  it("preserves a boolean needsApproval gate through discovery", () => {
    const registry = loadActionsFromStaticRegistry({
      "send-email": {
        default: {
          tool: { description: "Send email", parameters: {} },
          needsApproval: true,
          run: async () => ({ ok: true }),
        },
      },
    });

    expect(registry["send-email"].needsApproval).toBe(true);
  });

  it("preserves a predicate needsApproval gate through discovery", () => {
    const gate = (args: { to?: string }) =>
      Boolean(args.to?.endsWith("@external.com"));
    const registry = loadActionsFromStaticRegistry({
      "send-email-named": {
        tool: { description: "Send email", parameters: {} },
        needsApproval: gate,
        run: async () => ({ ok: true }),
      },
    });

    expect(registry["send-email-named"].needsApproval).toBe(gate);
  });

  it("threads the http config through named and default static entries", () => {
    const registry = loadActionsFromStaticRegistry({
      "named-get": {
        tool: { description: "Named GET", parameters: {} },
        http: { method: "GET", path: "/custom" },
        run: async () => ({ ok: true }),
      },
      "default-post": {
        default: {
          tool: { description: "Default POST", parameters: {} },
          http: { method: "POST" },
          run: async () => ({ ok: true }),
        },
      },
    });
    expect(registry["named-get"].http).toEqual({
      method: "GET",
      path: "/custom",
    });
    expect(registry["default-post"].http).toEqual({ method: "POST" });
  });

  it("skips null/undefined and shape-less modules without throwing", () => {
    const registry = loadActionsFromStaticRegistry({
      "is-null": null as any,
      "is-undefined": undefined as any,
      "no-tool": { run: async () => "x" } as any,
      "no-run": { tool: { description: "d", parameters: {} } } as any,
      "default-not-callable": { default: { tool: {}, run: 42 } } as any,
      "valid-one": {
        tool: { description: "valid", parameters: {} },
        run: async () => "ok",
      },
    });
    expect(Object.keys(registry)).toEqual(["valid-one"]);
  });

  it("wraps a bare default function as a CLI-style action and captures its output", async () => {
    const seenArgs: string[][] = [];
    const registry = loadActionsFromStaticRegistry({
      greet: {
        default: async (args: string[]) => {
          seenArgs.push(args);
          console.log(`hello ${args[1] ?? ""}`.trim());
        },
      },
    });

    const entry = registry["greet"];
    expect(entry).toBeDefined();
    // A synthesized tool definition exposes a single space-separated `args` param.
    expect(entry.tool.parameters?.properties).toHaveProperty("args");

    // Single `args` string is shell-split into CLI tokens.
    const out = await entry.run({ args: '--name "Ada Lovelace"' });
    expect(seenArgs[0]).toEqual(["--name", "Ada Lovelace"]);
    expect(out).toContain("hello Ada Lovelace");
  });

  it("converts arbitrary key/value params into --key value CLI tokens", async () => {
    const seenArgs: string[][] = [];
    const registry = loadActionsFromStaticRegistry({
      "kv-action": {
        default: async (args: string[]) => {
          seenArgs.push(args);
        },
      },
    });

    await registry["kv-action"].run({ id: "abc", title: "Hi there" });
    // Each entry becomes `--key`, `value` (order follows Object.entries).
    expect(seenArgs[0]).toEqual(["--id", "abc", "--title", "Hi there"]);
  });

  it(
    "preserves toolCallable:false on merged core sharing actions (audit-H5)",
    async () => {
      // Regression guard: mergeCoreSharingActions must carry the security-relevant
      // toolCallable:false flag from the action defs into the registry, otherwise
      // the tools-iframe bridge 403 in action-routes.ts never fires and a
      // sandboxed extension could change resource visibility / revoke shares.
      const registry: Record<string, any> = {};
      await mergeCoreSharingActions(registry);

      for (const name of [
        "share-resource",
        "unshare-resource",
        "set-resource-visibility",
      ]) {
        expect(registry[name], `${name} should be merged`).toBeDefined();
        expect(
          registry[name].toolCallable,
          `${name} must keep toolCallable:false`,
        ).toBe(false);
      }
    },
    CORE_ACTION_DISCOVERY_TIMEOUT_MS,
  );

  it(
    "merges app-facing MCP actions without exposing them as agent tools",
    async () => {
      const registry: Record<string, any> = {};
      await mergeCoreSharingActions(registry);

      for (const name of ["list-mcp-tools", "call-mcp-tool"]) {
        expect(registry[name], `${name} should be merged`).toBeDefined();
        expect(registry[name].agentTool).toBe(false);
        expect(registry[name].requiresAuth).toBe(true);
      }
      expect(registry["list-mcp-tools"].http).toEqual({ method: "GET" });
      expect(registry["call-mcp-tool"].http).toBeUndefined();
      expect(registry["call-mcp-tool"].toolCallable).toBe(false);
    },
    CORE_ACTION_DISCOVERY_TIMEOUT_MS,
  );

  it("does not overwrite a template-provided action of the same name (template wins)", async () => {
    const templateRun = async () => "template-share";
    const registry: Record<string, any> = {
      "share-resource": {
        tool: { description: "Template share override", parameters: {} },
        run: templateRun,
      },
    };
    await mergeCoreSharingActions(registry);

    // The template's own share-resource must survive — core must not clobber it.
    expect(registry["share-resource"].run).toBe(templateRun);
    expect(registry["share-resource"].tool.description).toBe(
      "Template share override",
    );
    // Other core actions still get merged in.
    expect(registry["unshare-resource"]).toBeDefined();
  });

  it("merges automation editor actions without exposing them as agent tools", async () => {
    const registry: Record<string, any> = {};
    await mergeCoreSharingActions(registry);

    for (const name of [
      "list-recurring-jobs",
      "manage-recurring-job",
      "run-automation-now",
      "list-automation-runs",
      "list-automations",
      "list-automation-events",
      "manage-automation",
      "search-automation-accounts",
    ]) {
      expect(registry[name], `${name} should be merged`).toBeDefined();
      expect(registry[name].agentTool).toBe(false);
    }
    expect(registry["list-automation-events"].http).toEqual({ method: "GET" });
    expect(registry["list-automation-events"].readOnly).toBe(true);
    expect(registry["search-automation-accounts"].http).toEqual({
      method: "GET",
    });
    expect(registry["search-automation-accounts"].readOnly).toBe(true);
  });

  it("merges localization preference actions", async () => {
    const registry: Record<string, any> = {};
    await mergeCoreSharingActions(registry);

    expect(registry["get-localization-preference"]).toBeDefined();
    expect(registry["get-localization-preference"].http).toEqual({
      method: "GET",
    });
    expect(registry["set-localization-preference"]).toBeDefined();
  });

  it("merges toolkit history and review actions", async () => {
    const registry: Record<string, any> = {};
    await mergeCoreSharingActions(registry);

    for (const name of [
      "create-resource-version",
      "list-resource-versions",
      "get-resource-version",
      "restore-resource-version",
      "list-resource-history",
      "list-review-comments",
      "create-review-comment",
      "reply-review-comment",
      "resolve-review-thread",
      "delete-review-comment",
      "consume-review-feedback",
      "get-review-feedback",
      "set-review-status",
      "send-review-thread-to-agent",
    ]) {
      expect(registry[name], `${name} should be merged`).toBeDefined();
    }
    expect(registry["list-resource-history"].readOnly).toBe(true);
    expect(registry["list-review-comments"].readOnly).toBe(true);
  });

  it("classifies every merged core action as grouped or explicitly always-on", async () => {
    const registry: Record<string, any> = {};
    await mergeCoreSharingActions(registry);

    // Drift guard. An action added to mergeCoreSharingActions without a
    // CORE_ACTION_GROUPS entry would silently become always-on and ride along
    // in every app's first request — the exact default `frameworkTools` exists
    // to undo. Failing here forces the author to make that call on purpose.
    const unclassified = Object.keys(registry).filter(
      (name) =>
        CORE_ACTION_GROUPS[name] === undefined &&
        !ALWAYS_ON_CORE_ACTIONS.has(name),
    );
    expect(
      unclassified,
      `Add these to CORE_ACTION_GROUPS (gateable via frameworkTools) or ` +
        `ALWAYS_ON_CORE_ACTIONS (deliberately always-on): ${unclassified.join(", ")}`,
    ).toEqual([]);
  });

  it("stamps frameworkGroup on grouped kits and leaves always-on actions untagged", async () => {
    const registry: Record<string, any> = {};
    await mergeCoreSharingActions(registry);

    expect(registry["share-resource"].frameworkGroup).toBe("sharing");
    expect(registry["list-review-comments"].frameworkGroup).toBe("review");
    expect(registry["restore-resource-version"].frameworkGroup).toBe("history");
    expect(registry["set-feature-flag"].frameworkGroup).toBe("featureFlags");
    expect(registry["change-password"].frameworkGroup).toBe("userProfile");
    // Always-on: no group, so no `frameworkTools` switch can remove it.
    expect(registry["upload-image"].frameworkGroup).toBeUndefined();
    expect(registry["call-mcp-tool"].frameworkGroup).toBeUndefined();
  });
});
